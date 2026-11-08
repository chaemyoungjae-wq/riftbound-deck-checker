import type { Card } from '../types/card';
import type { Deck, DeckCard, DeckComparison, DeckFormat, DeckSection } from '../types/deck';
import { koreanCardNameIndex, matchDeckCardCode, matchDeckCardName, normalizeDeckCardName } from './korean-card-reference';

export type ParsedPastedDeck = { deck: Deck; format: DeckFormat; issues: string[] };
export const DECK_SECTION_LABELS: Record<DeckSection, string> = {
  legend: 'Legend', champion: 'Champion', mainDeck: 'Main Deck',
  battlefields: 'Battlefields', runes: 'Runes', sideboard: 'Sideboard',
};
const SECTION_HEADERS: Record<string, DeckSection> = {
  legend: 'legend', champion: 'champion', maindeck: 'mainDeck',
  battlefields: 'battlefields', 'rune pool': 'runes', runes: 'runes', sideboard: 'sideboard',
};
function createDeckId(): string {
  return globalThis.crypto?.randomUUID?.() ?? 'deck-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}
function addOrCombine(cards: DeckCard[], entry: DeckCard): void {
  const sourceIdentity = entry.cardId ? 'id:' + entry.cardId : entry.sourceKey ?? entry.sourceName ?? entry.sourceCode ?? '';
  const same = cards.find((card) => card.section === entry.section &&
    (card.cardId ? 'id:' + card.cardId : card.sourceKey ?? card.sourceName ?? card.sourceCode ?? '') === sourceIdentity);
  if (same) {
    const quantity = same.quantity + entry.quantity;
    if (!Number.isSafeInteger(quantity)) throw new Error('카드 수량이 허용 범위를 넘습니다.');
    same.quantity = quantity;
  } else cards.push(entry);
}
function parseQuantityLine(line: string): { quantity: number; name: string } | null {
  const match = line.trim().match(/^(\d+)\s+(.+?)\s*$/);
  if (!match) return null;
  const quantity = Number(match[1]);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  return { quantity, name: match[2].trim() };
}
function deckTitle(text: string): string {
  const line = text.split(/\r?\n/).find((item) => /^\s*#\s*.+/.test(item));
  return line?.replace(/^\s*#\s*/, '').trim() || '가져온 덱';
}
function sectionFor(line: string): DeckSection | null {
  const header = line.trim().match(/^([^:]+):\s*$/);
  return header ? SECTION_HEADERS[header[1].trim().toLocaleLowerCase()] ?? null : null;
}
function parseSectionDeck(text: string, cards: Card[], id: string, savedMappings: Record<string, string>, preferredLanguage: 'EN' | 'KR'): ParsedPastedDeck {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let section: DeckSection | null = null;
  const parsed: DeckCard[] = [];
  const issues: string[] = [];
  let hasKoreanNames = false;
  let hasEnglishNames = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^#/.test(line)) continue;
    const headerSection = sectionFor(line);
    if (headerSection) { section = headerSection; continue; }
    if (!section) continue;
    const row = parseQuantityLine(line);
    if (!row) { issues.push('수량을 읽을 수 없어 제외: ' + line); continue; }
    if (koreanCardNameIndex.has(normalizeDeckCardName(row.name))) hasKoreanNames = true;
    else hasEnglishNames = true;
    const match = matchDeckCardName(row.name, cards, savedMappings, preferredLanguage);
    addOrCombine(parsed, {
      cardId: match.card?.id ?? null,
      quantity: row.quantity,
      section,
      sourceName: row.name,
      sourceKey: match.sourceKey,
      matchStatus: match.status,
      candidateCardIds: match.candidates.map((card) => card.id),
    });
    if (match.status === 'ambiguous') issues.push('이름이 여러 카드와 일치합니다: ' + row.name);
  }
  if (!parsed.length) throw new Error('섹션 형식에서 수량이 있는 카드 줄을 찾지 못했습니다.');
  const format: DeckFormat = hasKoreanNames || (!hasEnglishNames && lines.some((line) => /[가-힣]/.test(line)))
    ? 'korean-sections' : 'english-sections';
  return { deck: { id, name: deckTitle(text), cards: parsed }, format, issues };
}
function parseCodeDeck(text: string, cards: Card[], id: string, savedMappings: Record<string, string>, preferredLanguage: 'EN' | 'KR'): ParsedPastedDeck {
  const tokens = text.replace(/^\uFEFF/, '').split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line)).join(' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('지원되는 덱 형식을 확인할 수 없습니다.');
  const result: DeckCard[] = [];
  const issues: string[] = [];
  let recognized = 0;
  for (const token of tokens) {
    const match = token.match(/^(.+)-(\d+)$/);
    if (!match || !/[A-Za-z]/.test(match[1]) || !match[1].includes('-')) {
      issues.push('Code 형식이 아닌 항목을 제외: ' + token);
      continue;
    }
    const quantity = Number(match[2]);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      issues.push('수량이 올바르지 않아 제외: ' + token);
      continue;
    }
    recognized += 1;
    const code = match[1].trim();
    const resolved = matchDeckCardCode(code, cards, savedMappings, preferredLanguage);
    addOrCombine(result, {
      cardId: resolved.card?.id ?? null,
      quantity,
      section: 'mainDeck',
      sourceCode: code,
      sourceKey: resolved.sourceKey,
      matchStatus: resolved.status,
      candidateCardIds: resolved.candidates.map((card) => card.id),
    });
    if (resolved.status === 'ambiguous') issues.push('Code가 여러 카드와 일치합니다: ' + code);
  }
  if (!recognized) throw new Error('지원되는 덱 형식을 확인할 수 없습니다.');
  return { deck: { id, name: deckTitle(text), cards: result }, format: 'codes', issues };
}

/** Parses the supported section-based and CARD-CODE-QUANTITY formats; compressed RB1 strings stay unsupported. */
export function parsePastedDeck(
  text: string,
  cards: Card[],
  makeId: () => string = createDeckId,
  savedMappings: Record<string, string> = {},
): ParsedPastedDeck {
  const value = text.trim();
  if (!value) throw new Error('덱 목록을 붙여넣어 주세요.');
  if (/^\s*RB1\|/im.test(value)) {
    throw new Error('RB1|로 시작하는 압축 덱 형식은 지원하지 않습니다. 섹션 목록 또는 Code-수량 목록을 붙여넣어 주세요.');
  }
  const hasSection = value.split(/\r?\n/).some((line) => sectionFor(line));
  const preferredLanguage = /[\uac00-\ud7a3]/.test(value) ? 'KR' : 'EN';
  const id = makeId();
  return hasSection
    ? parseSectionDeck(value, cards, id, savedMappings, preferredLanguage)
    : parseCodeDeck(value, cards, id, savedMappings, preferredLanguage);
}

export function compareDeckWithCollection(
  deck: Deck,
  catalogCards: Card[],
  collection: Record<string, number>,
): DeckComparison {
  const cardsById = new Map(catalogCards.map((card) => [card.id, card]));
  const groupQuantities = new Map<string, number>();
  for (const card of catalogCards) {
    const key = card.canonicalCardId ?? card.cardGroupId;
    if (!key) continue;
    groupQuantities.set(key, (groupQuantities.get(key) ?? 0) + (collection[card.id] ?? 0));
  }
  const cards = deck.cards.map((entry, entryIndex) => {
    const card = entry.cardId ? cardsById.get(entry.cardId) ?? null : null;
    const quantityKey = card?.canonicalCardId ?? card?.cardGroupId;
    const storedQuantity = entry.cardId && quantityKey
      ? groupQuantities.get(quantityKey) ?? 0
      : entry.cardId ? collection[entry.cardId] : 0;
    const ownedQuantity = Number.isSafeInteger(storedQuantity) && Number(storedQuantity) >= 0 ? Number(storedQuantity) : 0;
    const missingQuantity = Math.max(entry.quantity - ownedQuantity, 0);
    return { ...entry, entryIndex, card, ownedQuantity, missingQuantity };
  });
  const totalRequired = cards.reduce((sum, card) => sum + card.quantity, 0);
  const fulfilledKinds = cards.filter((card) => card.missingQuantity === 0 && !!card.cardId && !!card.card).length;
  const missingItems = cards.filter((card) => card.missingQuantity > 0);
  return {
    cards,
    totalKinds: cards.length,
    totalRequired,
    fulfilledKinds,
    missingKinds: missingItems.length,
    missingTotal: missingItems.reduce((sum, card) => sum + card.missingQuantity, 0),
  };
}
