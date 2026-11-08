import type { Card } from '../types/card';
import { cardNumberToCsvCode, normalizeCardNumber } from './collection-csv';
import { selectDefaultPrinting } from './card-groups';

export type LegacyCollectionMigration = {
  quantities: Record<string, number>;
  migratedIds: number;
  unmatchedIds: string[];
};

/** Moves saved quantities from legacy provider IDs to stable OpenRift printing IDs by card code. */
export function migrateLegacyCollection(
  quantities: Record<string, number>,
  legacyCards: Card[],
  openRiftCards: Card[],
): LegacyCollectionMigration {
  const cardsByCode = new Map<string, Card[]>();
  for (const card of openRiftCards) {
    const code = cardNumberToCsvCode(card.cardNumber);
    if (!code) continue;
    const list = cardsByCode.get(code) ?? [];
    list.push(card);
    cardsByCode.set(code, list);
  }
  const legacyById = new Map(legacyCards.map((card) => [card.id, card]));
  const result = { ...quantities };
  const unmatchedIds: string[] = [];
  let migratedIds = 0;
  for (const [oldId, qty] of Object.entries(quantities)) {
    const oldCard = legacyById.get(oldId);
    if (!oldCard) continue;
    const code = cardNumberToCsvCode(oldCard.cardNumber);
    let candidates = code ? cardsByCode.get(code) ?? [] : [];
    if (oldCard.publicCode) {
      const exactPublicCode = candidates.filter((card) => normalizeCardNumber(card.publicCode) === normalizeCardNumber(oldCard.publicCode));
      if (exactPublicCode.length) candidates = exactPublicCode;
    }
    if (candidates.length > 1) {
      const english = candidates.filter((card) => card.language?.toUpperCase() === 'EN');
      if (english.length) candidates = english;
    }
    if (candidates.length > 1) {
      const normal = candidates.filter((card) => (card.printingVariant ?? '').toLowerCase() === 'normal');
      if (normal.length) candidates = normal;
    }
    if (candidates.length > 1) {
      const ordinary = candidates.filter((card) => !card.distributionMarkers?.length);
      if (ordinary.length) candidates = ordinary;
    }
    const target = selectDefaultPrinting(candidates);
    if (!target) { unmatchedIds.push(oldId); continue; }
    const newId = target.id;
    result[newId] = (result[newId] ?? 0) + qty;
    delete result[oldId];
    migratedIds += 1;
  }
  return { quantities: result, migratedIds, unmatchedIds };
}
