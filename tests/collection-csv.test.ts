import { describe, expect, it } from 'vitest';
import type { Card } from '../src/types/card';
import {
  addManualCardCodeMapping,
  applyManualCardQuantity,
  cardNumberToCsvCode,
  mergeCollectionQuantities,
  normalizeCardNumber,
  previewCollectionCsv,
  searchCardCandidates,
  serializeCollectionCsv,
} from '../src/lib/collection-csv';

function card(id: string, cardNumber: string, setCode: string, collectorNumber: number): Card {
  return {
    id, cardNumber, setCode, collectorNumber, name: '테스트 이름', setName: null,
    domains: [], rarity: null, imageUrl: null, imageAlt: null,
  };
}

const cards = [
  card('riftcodex-179', 'ogn-179-298', 'OGN', 179),
  card('riftcodex-56', 'ogn-056-298', 'OGN', 56),
  card('riftcodex-other', 'ogs-179-298', 'OGS', 179),
];
const alternateArtPair = [
  card('normal-042', 'ogn-042-298', 'OGN', 42),
  card('alternate-042', 'ogn-042a-298', 'OGN', 42),
];

describe('collection CSV', () => {
  it('maps Code to Riftcodex IDs and ignores localized Name and other columns', () => {
    const result = previewCollectionCsv(
      '\uFEFFCode,Name,Set,Rarity,Print,Qty\nOGN-179,한국어 이름,XXX,common,KR,2\nOGN-056,다른 이름,XXX,rare,EN,3',
      cards,
    );
    expect(result.quantities).toEqual({ 'riftcodex-179': 2, 'riftcodex-56': 3 });
    expect(result.matchedKinds).toBe(2);
    expect(result.totalQuantity).toBe(5);
    expect(result.unmatchedCodes).toEqual([]);
  });

  it('preserves punctuation in normalization and matches full API card numbers case-insensitively', () => {
    expect(normalizeCardNumber('  ogn-179*-298 ')).toBe('OGN-179*-298');
    const special = card('special', 'ogn-179*-298', 'OGN', 179);
    expect(previewCollectionCsv('Code,Qty\nOGN-179*-298,1', [special]).quantities).toEqual({ special: 1 });
  });

  it('matches OGN-042 only to the normal card, not the alternate art with the same collector number', () => {
    expect(cardNumberToCsvCode(' ogn-042-298 ')).toBe('OGN-042');
    expect(cardNumberToCsvCode('ogn-042a-298')).toBe('OGN-042A');
    const result = previewCollectionCsv('Code,Qty\nOGN-042,2', alternateArtPair);
    expect(result.quantities).toEqual({ 'normal-042': 2 });
    expect(result.unmatchedCodes).toEqual([]);
  });

  it('matches OGN-042A only to alternate art and preserves marker through case/space normalization', () => {
    const result = previewCollectionCsv('Code,Qty\n  ogn-042a  ,1', alternateArtPair);
    expect(result.quantities).toEqual({ 'alternate-042': 1 });
    expect(result.unmatchedCodes).toEqual([]);
    expect(previewCollectionCsv('Code,Qty\nOGN-042A,3', alternateArtPair).quantities)
      .toEqual({ 'alternate-042': 3 });
  });

  it('retains alternate-art markers in saved Code to card ID mappings', () => {
    expect(addManualCardCodeMapping({}, ' OGN-042A ', 'alternate-042'))
      .toEqual({ 'OGN-042A': 'alternate-042' });
  });

  it('ranks exact-code manual candidates first without selecting one automatically', () => {
    expect(searchCardCandidates('OGN-042', alternateArtPair).map((entry) => entry.id))
      .toEqual(['normal-042', 'alternate-042']);
    expect(searchCardCandidates('OGN-042A', alternateArtPair).map((entry) => entry.id))
      .toEqual(['alternate-042']);
  });

  it('reports unknown or ambiguous codes and applies the last valid duplicate quantity', () => {
    const result = previewCollectionCsv(
      'Code,Qty\nOGN-179,1\nogn-179,4\nUNKNOWN-1,2\nOGN-056,2.5\nOGN-056,6',
      cards,
    );
    expect(result.quantities).toEqual({ 'riftcodex-179': 4, 'riftcodex-56': 6 });
    expect(result.duplicateCodes).toEqual(['ogn-179']);
    expect(result.invalidRows).toBe(1);
    expect(result.unmatchedCodes).toEqual(['UNKNOWN-1']);
  });

  it('uses the last CSV row when different valid codes resolve to the same card', () => {
    const result = previewCollectionCsv(
      'Code,Qty\nOGN-179,1\nOGN-179-298,2\nOGN-179,3',
      cards,
    );
    expect(result.quantities).toEqual({ 'riftcodex-179': 3 });
  });

  it('prefers a saved Code to card ID mapping over an ambiguous shorthand', () => {
    const alternate = card('riftcodex-179-alt', 'ogn-179*-298', 'OGN', 179);
    const result = previewCollectionCsv(
      'Code,Qty\nOGN-179,2',
      [...cards, alternate],
      { 'OGN-179': 'riftcodex-179-alt' },
    );
    expect(result.quantities).toEqual({ 'riftcodex-179-alt': 2 });
    expect(result.unmatchedRows).toEqual([]);
  });

  it('applies a manual match to the chosen Riftcodex ID and reuses it on a later import', () => {
    const alternate = card('riftcodex-179-alt', 'ogn-179*-298', 'OGN', 179);
    const availableCards = [...cards, alternate];
    const savedMappings = addManualCardCodeMapping({}, ' ogn-179 ', alternate.id);
    const preview = previewCollectionCsv('Code,Qty\nOGN-179,3', availableCards, savedMappings);
    expect(preview.quantities).toEqual({ 'riftcodex-179-alt': 3 });
    expect(applyManualCardQuantity({ 'riftcodex-179': 5 }, alternate.id, 3)).toEqual({
      'riftcodex-179': 5, 'riftcodex-179-alt': 3,
    });
    expect(previewCollectionCsv('Code,Qty\nogn-179,4', availableCards, savedMappings).quantities)
      .toEqual({ 'riftcodex-179-alt': 4 });
  });

  it('leaves duplicate API codes and unknown Codes out of quantities for manual review', () => {
    const duplicate = card('riftbound-duplicate', 'ogn-179-298', 'OGN', 179);
    const result = previewCollectionCsv('Code,Qty\nOGN-179,2\nUNKNOWN-8,4', [...cards, duplicate]);
    expect(result.quantities).toEqual({});
    expect(result.unmatchedRows).toEqual([{ code: 'OGN-179', qty: 2 }, { code: 'UNKNOWN-8', qty: 4 }]);
  });

  it('rejects missing columns and files with no valid quantity rows', () => {
    expect(() => previewCollectionCsv('Name,Qty\nX,2', cards)).toThrow(/Code/);
    expect(() => previewCollectionCsv('Code,Qty\nOGN-179,-1\nOGN-056,1.5', cards)).toThrow(/유효한 Qty/);
  });

  it('merges imported quantities without removing cards absent from the CSV', () => {
    expect(mergeCollectionQuantities({ old: 3, keep: 1 }, { old: 5, added: 0 })).toEqual({ old: 5, keep: 1, added: 0 });
  });

  it('exports only the Code and Qty columns as a UTF-8-compatible CSV body', () => {
    expect(serializeCollectionCsv([{ code: 'OGN-179', qty: 2 }])).toBe('\uFEFFCode,Qty\r\nOGN-179,2');
  });
});
