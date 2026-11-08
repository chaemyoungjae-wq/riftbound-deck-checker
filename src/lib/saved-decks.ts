import type { Deck, DeckCard, DeckFormat, DeckSection } from '../types/deck';

export const SAVED_DECKS_STORAGE_KEY = 'riftbound-saved-decks-v1';
const sections = new Set<DeckSection>(['legend', 'champion', 'mainDeck', 'battlefields', 'runes', 'sideboard']);
const formats = new Set<DeckFormat>(['korean-sections', 'english-sections', 'codes']);
const statuses = new Set(['matched', 'unmatched', 'ambiguous']);

type UnknownRecord = Record<string, unknown>;
function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function parseDeckCard(value: unknown): DeckCard | null {
  if (!isRecord(value)) return null;
  const cardId = value.cardId === null ? null : optionalString(value.cardId) ?? null;
  const quantity = value.quantity;
  const section = value.section;
  const matchStatus = value.matchStatus;
  const candidates = value.candidateCardIds;
  if (!Number.isSafeInteger(quantity) || Number(quantity) < 1 || !sections.has(section as DeckSection) ||
      !statuses.has(String(matchStatus)) || !Array.isArray(candidates) ||
      candidates.some((candidate) => typeof candidate !== 'string')) return null;
  return {
    cardId,
    quantity: Number(quantity),
    section: section as DeckSection,
    matchStatus: matchStatus as DeckCard['matchStatus'],
    candidateCardIds: candidates as string[],
    ...(optionalString(value.sourceName) ? { sourceName: optionalString(value.sourceName) } : {}),
    ...(optionalString(value.sourceCode) ? { sourceCode: optionalString(value.sourceCode) } : {}),
    ...(optionalString(value.sourceKey) ? { sourceKey: optionalString(value.sourceKey) } : {}),
  };
}
function parseDeck(value: unknown): Deck | null {
  if (!isRecord(value) || !optionalString(value.id) || !optionalString(value.name) || !Array.isArray(value.cards)) return null;
  const cards = value.cards.map(parseDeckCard);
  if (cards.some((card) => card === null)) return null;
  const format = formats.has(value.format as DeckFormat) ? value.format as DeckFormat : undefined;
  return { id: value.id as string, name: value.name as string, cards: cards as DeckCard[], ...(format ? { format } : {}) };
}

export function readSavedDecks(storage: Pick<Storage, 'getItem'>): Deck[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(SAVED_DECKS_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.map(parseDeck).filter((deck): deck is Deck => deck !== null);
  } catch {
    return [];
  }
}

export function writeSavedDecks(storage: Pick<Storage, 'setItem'>, decks: Deck[]): void {
  storage.setItem(SAVED_DECKS_STORAGE_KEY, JSON.stringify(decks));
}
