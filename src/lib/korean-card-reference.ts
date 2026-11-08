import koreanReference from '../data/riftbound-ogn-korean-cards.json';
import type { Card } from '../types/card';
import { cardNumberToCsvCode, normalizeCardNumber, resolveCardByCode } from './collection-csv';
import { preferredCardPrintings } from './card-groups';

export type KoreanCardReferenceEntry = {
  code: string;
  koreanName: string;
  englishName?: string;
  variant?: string;
};

type KoreanReferenceFile = { entries: KoreanCardReferenceEntry[] };
const entries = (koreanReference as KoreanReferenceFile).entries;

export function normalizeDeckCardName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}
function normalizeCode(value: string | null | undefined): string {
  return normalizeCardNumber(value);
}

const entriesByKoreanName = new Map<string, KoreanCardReferenceEntry[]>();
const entriesByCode = new Map<string, KoreanCardReferenceEntry>();
for (const entry of entries) {
  const name = normalizeDeckCardName(entry.koreanName);
  const named = entriesByKoreanName.get(name) ?? [];
  named.push(entry);
  entriesByKoreanName.set(name, named);
  entriesByCode.set(normalizeCode(entry.code), entry);
}
export const koreanCardNameIndex: ReadonlyMap<string, readonly KoreanCardReferenceEntry[]> = entriesByKoreanName;
export const koreanCardCodeIndex: ReadonlyMap<string, KoreanCardReferenceEntry> = entriesByCode;

export type NameMatch = {
  card: Card | null;
  candidates: Card[];
  status: 'matched' | 'unmatched' | 'ambiguous';
  sourceKey: string;
};

function uniqueCards(cards: Array<Card | null>): Card[] {
  const found = new Map<string, Card>();
  for (const card of cards) if (card) found.set(card.id, card);
  return [...found.values()];
}

function resolveKoreanReference(code: string, cards: Card[]): Card | null {
  const normalized = normalizeCode(code);
  const matches = cards.filter((card) => card.language?.toUpperCase() === 'KR' && (
    normalizeCode(card.publicCode) === normalized ||
    normalizeCode(card.cardNumber) === normalized ||
    cardNumberToCsvCode(card.cardNumber) === normalized
  ));
  return preferredCardPrintings(matches).length === 1 ? preferredCardPrintings(matches)[0] : null;
}

/** Match localized OpenRift printings, while retaining the supplied Korean OGN code index. */
export function matchDeckCardName(
  name: string,
  cards: Card[],
  savedMappings: Record<string, string> = {},
  preferredLanguage?: 'EN' | 'KR',
): NameMatch {
  const normalized = normalizeDeckCardName(name);
  const koreanEntries = entriesByKoreanName.get(normalized) ?? [];
  const isKorean = /[\uac00-\ud7a3]/.test(name);
  const sourceKey = (isKorean ? 'ko:' : koreanEntries.length ? 'ko:' : 'name:') + normalized;
  let localized = cards.filter((card) =>
    [card.name, ...(card.localizedNames ?? [])].some((candidate) => normalizeDeckCardName(candidate) === normalized)
  );
  const language = preferredLanguage ?? (isKorean ? 'KR' : 'EN');
  localized = localized.filter((card) => (card.language?.toUpperCase() ?? 'EN') === language);
  const byReference = uniqueCards(koreanEntries.map((entry) => isKorean
    ? resolveKoreanReference(entry.code, cards)
    : resolveCardByCode(entry.code, cards)));
  let candidates = preferredCardPrintings(localized.length ? localized : byReference);
  if (candidates.length > 1) {
    const preferred = candidates.filter((card) => card.language?.toUpperCase() === language);
    if (preferred.length) candidates = preferred;
    const byCanonicalCard = new Map<string, Card>();
    for (const card of candidates) byCanonicalCard.set(card.canonicalCardId ?? card.id, card);
    candidates = [...byCanonicalCard.values()];
  }
  const savedId = savedMappings[sourceKey];
  if (savedId) {
    const saved = cards.find((card) => card.id === savedId);
    if (saved && (saved.language?.toUpperCase() ?? 'EN') === language) return { card: saved, candidates: uniqueCards([...candidates, saved]), status: 'matched', sourceKey };
  }
  if (candidates.length === 1) return { card: candidates[0], candidates, status: 'matched', sourceKey };
  if (candidates.length > 1) return { card: null, candidates, status: 'ambiguous', sourceKey };
  return { card: null, candidates: [], status: 'unmatched', sourceKey };
}

export function matchDeckCardCode(
  code: string,
  cards: Card[],
  savedMappings: Record<string, string> = {},
  preferredLanguage?: 'EN' | 'KR',
): NameMatch {
  const normalized = normalizeCode(code);
  const sourceKey = 'code:' + normalized;
  const publicExact = cards.filter((card) => normalizeCode(card.publicCode) === normalized);
  const exact = publicExact.length ? publicExact : cards.filter((card) =>
    normalizeCode(card.cardNumber) === normalized ||
    normalizeCode(card.cardNumber).replace(/^([A-Z0-9]+-.+)-\d{3}$/, '$1') === normalized
  );
  let preferredExact = exact;
  const hasKoreanCodeMarker = /(?:-KR|\/KR)$/i.test(code) || /[^\x00-\x7F]/.test(code);
  const language = hasKoreanCodeMarker ? 'KR' : preferredLanguage ?? 'EN';
  const preferredLanguageCards = preferredExact.filter((card) => (card.language?.toUpperCase() ?? 'EN') === language);
  if (preferredLanguageCards.length || preferredLanguage !== undefined || hasKoreanCodeMarker) preferredExact = preferredLanguageCards;
  const candidates = preferredCardPrintings(preferredExact);
  const savedId = savedMappings[sourceKey];
  if (savedId) {
    const saved = cards.find((card) => card.id === savedId);
    if (saved && (saved.language?.toUpperCase() ?? 'EN') === language) return { card: saved, candidates: [...new Map([...candidates, saved].map((card) => [card.id, card])).values()], status: 'matched', sourceKey };
  }
  const enforceLanguage = preferredLanguage !== undefined || hasKoreanCodeMarker;
  const card = candidates.length === 1 ? candidates[0] : enforceLanguage && !candidates.length ? null : resolveCardByCode(code, cards);
  const resultCandidates = card && !candidates.some((item) => item.id === card.id) ? [...candidates, card] : candidates;
  if (resultCandidates.length === 1) return { card: resultCandidates[0], candidates: resultCandidates, status: 'matched', sourceKey };
  if (resultCandidates.length > 1) return { card: null, candidates: resultCandidates, status: 'ambiguous', sourceKey };
  return { card: null, candidates: [], status: 'unmatched', sourceKey };
}
