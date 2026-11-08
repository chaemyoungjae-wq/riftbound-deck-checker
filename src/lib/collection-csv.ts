import Papa from 'papaparse';
import type { Card } from '../types/card';
import { isPromoPrinting, preferredCardPrintings } from './card-groups';

export type CollectionCsvPreview = {
  quantities: Record<string, number>;
  matchedKinds: number;
  totalQuantity: number;
  unmatchedCodes: string[];
  unmatchedRows: Array<{ code: string; qty: number }>;
  duplicateCodes: string[];
  invalidRows: number;
};

export class CollectionCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CollectionCsvError';
  }
}

/** Deliberately preserves punctuation: only whitespace and letter case are normalized. */
export function normalizeCardNumber(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

/** Removes only Riftcodex's final three-digit catalog suffix, preserving art markers such as A. */
export function cardNumberToCsvCode(value: string | null | undefined): string {
  const normalized = normalizeCardNumber(value);
  return normalized.replace(/^([A-Z0-9]+-.+)-\d{3}$/, '$1');
}

function choosePrinting(cards: Card[], language?: 'EN' | 'KR'): Card | null {
  if (!language) return preferEnglishPrinting(cards);
  const matching = preferredCardPrintings(cards).filter((card) => (card.language?.toUpperCase() ?? 'EN') === language);
  return matching.length === 1 ? matching[0] : null;
}

export function resolveCardByCode(code: string, cards: Card[], language?: 'EN' | 'KR'): Card | null {
  const normalizedCode = normalizeCardNumber(code);
  const printingSuffix = normalizedCode.match(/^(.*) \[(STANDARD|FOIL|PROMO-STANDARD|PROMO-FOIL)\]$/);
  if (printingSuffix) {
    const baseCode = printingSuffix[1];
    const variant = printingSuffix[2];
    const exactVariant = cards.filter((card) => {
      const codeMatches = normalizeCardNumber(card.publicCode) === baseCode || normalizeCardNumber(card.cardNumber) === baseCode || cardNumberToCsvCode(card.cardNumber) === baseCode;
      const finish = card.finish?.toLowerCase() === 'foil' ? 'FOIL' : 'STANDARD';
      return codeMatches && finish === variant.replace(/^PROMO-/, '') && isPromoPrinting(card) === variant.startsWith('PROMO-');
    });
    return choosePrinting(exactVariant, language);
  }
  const publicMatch = cards.filter((card) => normalizeCardNumber(card.publicCode) === normalizedCode);
  if (publicMatch.length) return choosePrinting(publicMatch, language);
  const exact = cards.filter((card) => normalizeCardNumber(card.cardNumber) === normalizedCode);
  if (exact.length) return choosePrinting(exact, language);

  // The final Riftcodex suffix (e.g. `-298`) is omitted from the CSV code.
  // Keep all preceding characters, including alternate-art markers (`042A`).
  const candidates = cards.filter((card) => cardNumberToCsvCode(card.cardNumber) === normalizedCode);
  return choosePrinting(candidates, language);
}

function preferEnglishPrinting(cards: Card[]): Card | null {
  if (!cards.length) return null;
  const collapsed = preferredCardPrintings(cards);
  const english = collapsed.filter((card) => !card.language || card.language.toUpperCase() === 'EN');
  const preferred = english.length ? english : collapsed;
  return preferred.length === 1 ? preferred[0] : null;
}

export function searchCardCandidates(query: string, cards: Card[]): Card[] {
  const needle = normalizeCardNumber(query);
  if (!needle) return [];
  return cards.filter((card) => {
    const number = normalizeCardNumber(card.cardNumber);
    const collector = card.collectorNumber === null ? '' : String(card.collectorNumber).padStart(3, '0');
    const printedCode = `${card.setCode}-${collector}`.toUpperCase();
    return [number, normalizeCardNumber(card.publicCode), card.name.toLocaleUpperCase(), ...(card.localizedNames ?? []).map((name) => name.toLocaleUpperCase()), card.setCode.toLocaleUpperCase(), printedCode]
      .some((field) => field.includes(needle));
  }).sort((a, b) => {
    const aExact = cardNumberToCsvCode(a.cardNumber) === needle || normalizeCardNumber(a.publicCode) === needle ? 0 : 1;
    const bExact = cardNumberToCsvCode(b.cardNumber) === needle || normalizeCardNumber(b.publicCode) === needle ? 0 : 1;
    return aExact - bExact;
  });
}

export function previewCollectionCsv(
  text: string,
  cards: Card[],
  savedMappings: Record<string, string> = {},
): CollectionCsvPreview {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) {
    throw new CollectionCsvError(`CSV 형식을 읽을 수 없습니다: ${parsed.errors[0].message}`);
  }
  const [header = [], ...rows] = parsed.data;
  const normalizedHeader = header.map((value) => String(value).trim().toLocaleLowerCase());
  const codeIndex = normalizedHeader.indexOf('code');
  const qtyIndex = normalizedHeader.indexOf('qty');
  const printIndex = normalizedHeader.indexOf('print');
  const languageIndex = normalizedHeader.indexOf('language');
  const nameIndex = normalizedHeader.indexOf('name');
  if (codeIndex < 0 || qtyIndex < 0) {
    throw new CollectionCsvError('CSV에 Code와 Qty 열이 모두 있어야 합니다.');
  }

  const latestByCode = new Map<string, { code: string; qty: number; rowOrder: number }>();
  const duplicateCodes = new Set<string>();
  let invalidRows = 0;
  let validRows = 0;
  for (const [rowOrder, row] of rows.entries()) {
    const code = String(row[codeIndex] ?? '').trim();
    if (!code) continue;
    const rawQty = String(row[qtyIndex] ?? '').trim();
    if (!/^\d+$/.test(rawQty)) {
      invalidRows += 1;
      continue;
    }
    const qty = Number(rawQty);
    if (!Number.isSafeInteger(qty) || qty < 0) {
      invalidRows += 1;
      continue;
    }
    validRows += 1;
    const key = normalizeCardNumber(code);
    if (latestByCode.has(key)) duplicateCodes.add(code);
    latestByCode.set(key, { code, qty, rowOrder });
  }
  if (!validRows) throw new CollectionCsvError('가져올 수 있는 Code와 유효한 Qty가 있는 행이 없습니다.');

  const quantities = new Map<string, number>();
  const unmatchedCodes: string[] = [];
  const unmatchedRows: Array<{ code: string; qty: number }> = [];
  for (const { code, qty, rowOrder } of [...latestByCode.values()].sort((a, b) => a.rowOrder - b.rowOrder)) {
    const sourceRow = rows[rowOrder];
    const print = String(sourceRow?.[printIndex >= 0 ? printIndex : languageIndex] ?? '').trim().toUpperCase();
    const name = String(sourceRow?.[nameIndex] ?? '');
    const language: 'EN' | 'KR' | undefined = /^(KR|KOREAN)(?:\b|[-_])/.test(print) || /[\uac00-\ud7a3]/.test(name) || /(?:-KR|\/KR)$/i.test(code)
      ? 'KR'
      : /^(EN|ENGLISH)(?:\b|[-_])/.test(print)
        ? 'EN'
        : undefined;
    const savedId = savedMappings[normalizeCardNumber(code)];
    const savedCards = savedId ? cards.filter((candidate) => candidate.id === savedId) : [];
    const savedCard = savedCards.length === 1 ? savedCards[0] : undefined;
    const savedLanguageMatches = !language || (savedCard?.language?.toUpperCase() ?? 'EN') === language;
    const card = savedCard && savedLanguageMatches ? savedCard : resolveCardByCode(code, cards, language);
    if (!card) {
      unmatchedCodes.push(code);
      unmatchedRows.push({ code, qty });
    }
    else quantities.set(card.id, qty);
  }
  const quantityRecord = Object.fromEntries(quantities);
  return {
    quantities: quantityRecord,
    matchedKinds: quantities.size,
    totalQuantity: [...quantities.values()].reduce((total, qty) => total + qty, 0),
    unmatchedCodes,
    unmatchedRows,
    duplicateCodes: [...duplicateCodes],
    invalidRows,
  };
}

export function mergeCollectionQuantities(
  current: Record<string, number>,
  imported: Record<string, number>,
): Record<string, number> {
  return { ...current, ...imported };
}

export function addManualCardCodeMapping(
  mappings: Record<string, string>,
  code: string,
  cardId: string,
): Record<string, string> {
  return { ...mappings, [normalizeCardNumber(code)]: cardId };
}

export function applyManualCardQuantity(
  current: Record<string, number>,
  cardId: string,
  qty: number,
): Record<string, number> {
  return mergeCollectionQuantities(current, { [cardId]: qty });
}

export function serializeCollectionCsv(rows: Array<{ code: string; qty: number }>): string {
  const csv = Papa.unparse({
    fields: ['Code', 'Qty'],
    data: rows.map(({ code, qty }) => [code, qty]),
  });
  return `\uFEFF${csv}`;
}
