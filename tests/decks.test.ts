import { describe, expect, it } from 'vitest';
import type { Card } from '../src/types/card';
import { compareDeckWithCollection, parsePastedDeck } from '../src/lib/decks';
import { matchDeckCardCode, matchDeckCardName, koreanCardCodeIndex } from '../src/lib/korean-card-reference';
import type { Deck } from '../src/types/deck';

function card(id: string, name: string, cardNumber: string): Card {
  return {
    id, name, cardNumber, collectorNumber: 42, setCode: 'OGN', setName: 'Origins',
    domains: [], rarity: 'Rare', imageUrl: null, imageAlt: null,
  };
}
const normal042 = card('normal-042', 'Calm Rune', 'ogn-042-298');
const alternate042 = card('alternate-042', 'Calm Rune', 'ogn-042a-298');
const normal007 = card('normal-007', 'Fury Rune', 'ogn-007-298');
const alternate007 = card('alternate-007', 'Fury Rune', 'ogn-007a-298');

describe('Korean reference matching', () => {
  it('bundles the supplied Korean OGN reference and indexes code entries', () => {
    expect(koreanCardCodeIndex.get('OGN-001')).toMatchObject({ koreanName: '타오르는 화염용' });
    expect(matchDeckCardName(' 타오르는   화염용 ', [card('ogn-001-id', 'Blazing Scorcher', 'ogn-001-298')]))
      .toMatchObject({ status: 'matched', card: { id: 'ogn-001-id' } });
  });

  it('does not collapse OGN-042 and OGN-042A', () => {
    expect(matchDeckCardCode('OGN-042', [normal042, alternate042]).card?.id).toBe(normal042.id);
    expect(matchDeckCardCode('OGN-042A', [normal042, alternate042]).card?.id).toBe(alternate042.id);
  });

  it('does not collapse OGN-007 and OGN-007A', () => {
    expect(matchDeckCardCode('OGN-007', [normal007, alternate007]).card?.id).toBe(normal007.id);
    expect(matchDeckCardCode('OGN-007A', [normal007, alternate007]).card?.id).toBe(alternate007.id);
  });

  it('keeps repeated Korean names ambiguous when the reference lists multiple variants', () => {
    const result = matchDeckCardName('평정 룬', [normal042, alternate042]);
    expect(result.status).toBe('ambiguous');
    expect(result.card).toBeNull();
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([normal042.id, alternate042.id]);
  });

  it('uses exact English API names when the Korean reference has no match', () => {
    const target = card('cleave', 'Cleave', 'ogn-004-298');
    expect(matchDeckCardName(' Cleave ', [target]).card?.id).toBe(target.id);
    expect(matchDeckCardName('Cleav', [target]).status).toBe('unmatched');
  });

  it('reuses a saved manual card ID mapping even when automatic matching found no candidate', () => {
    const saved = card('manual-id', 'Any API name', 'ogn-999-298');
    expect(matchDeckCardName('Unlisted Korean name', [saved], { 'name:unlisted korean name': saved.id }))
      .toMatchObject({ status: 'matched', card: { id: saved.id } });
    expect(matchDeckCardCode('OGN-999', [saved], { 'code:OGN-999': saved.id }))
      .toMatchObject({ status: 'matched', card: { id: saved.id } });
  });
});

describe('pasted deck parsing and collection comparison', () => {
  it('parses Korean section rows and preserves complete names and title', () => {
    const parsed = parsePastedDeck('# Viktor Deck\nMainDeck:\n3 설교하는 요들\n1 이름에 공백, 쉼표 - 포함', [], () => 'deck');
    expect(parsed.format).toBe('korean-sections');
    expect(parsed.deck.name).toBe('Viktor Deck');
    expect(parsed.deck.cards[0]).toMatchObject({ quantity: 3, sourceName: '설교하는 요들', section: 'mainDeck', matchStatus: 'unmatched' });
    expect(parsed.deck.cards[1].sourceName).toBe('이름에 공백, 쉼표 - 포함');
  });

  it('parses English sections and keeps a comma in the name', () => {
    const target = card('mundo', 'Dr. Mundo, Expert', 'ogn-109-298');
    const parsed = parsePastedDeck('# English deck\nSideboard:\n3 Dr. Mundo, Expert', [target], () => 'deck');
    expect(parsed.format).toBe('english-sections');
    expect(parsed.deck.cards[0]).toMatchObject({ cardId: 'mundo', quantity: 3, sourceName: 'Dr. Mundo, Expert', section: 'sideboard' });
  });

  it('matches a unique English name case-insensitively after trimming', () => {
    const parsed = parsePastedDeck('Champion:\n  1  cleave  ', [card('cleave', 'Cleave', 'ogn-004-298')], () => 'deck');
    expect(parsed.deck.cards[0]).toMatchObject({ cardId: 'cleave', matchStatus: 'matched' });
  });

  it('sums repeated code tokens and uses only the final hyphen quantity', () => {
    const target = card('target', 'Darius', 'ogn-027-298');
    const parsed = parsePastedDeck('OGN-027-1 OGN-027-1\nOGN-027-1', [target], () => 'deck');
    expect(parsed.format).toBe('codes');
    expect(parsed.deck.cards[0]).toMatchObject({ cardId: 'target', quantity: 3, sourceCode: 'OGN-027' });
  });

  it('sums non-unit code quantities', () => {
    const target = card('target', 'Card', 'ogn-027-298');
    expect(parsePastedDeck('OGN-027-2 OGN-027-1', [target], () => 'deck').deck.cards[0].quantity).toBe(3);
  });

  it('keeps normal and alternate art code entries separate in format 4', () => {
    const parsed = parsePastedDeck('OGN-042-1 OGN-042A-2', [normal042, alternate042], () => 'deck');
    expect(parsed.deck.cards.map(({ cardId, quantity }) => [cardId, quantity])).toEqual([
      [normal042.id, 1], [alternate042.id, 2],
    ]);
  });

  it('parses extended codes with hyphens such as Korean promo codes', () => {
    const promo = card('yasuo-promo', 'Yasuo Promo', 'ogn-076b-p-kr-298');
    expect(parsePastedDeck('OGN-076B-P-KR-1', [promo], () => 'deck').deck.cards[0])
      .toMatchObject({ cardId: promo.id, sourceCode: 'OGN-076B-P-KR', quantity: 1 });
  });

  it('keeps the six supported deck sections separate', () => {
    const parsed = parsePastedDeck([
      'Legend:', '1 Legend card', 'Champion:', '1 Champion card', 'MainDeck:', '1 Main card',
      'Battlefields:', '1 Field', 'Rune Pool:', '1 Rune', 'Sideboard:', '1 Side card',
    ].join('\n'), [], () => 'deck');
    expect(parsed.deck.cards.map(({ section }) => section)).toEqual([
      'legend', 'champion', 'mainDeck', 'battlefields', 'runes', 'sideboard',
    ]);
  });

  it('compares quantities by card ID and does not mutate collection values', () => {
    const deck: Deck = { id: 'deck', name: 'Test', cards: [
      { cardId: 'a', quantity: 3, section: 'mainDeck', matchStatus: 'matched', candidateCardIds: ['a'] },
      { cardId: 'b', quantity: 2, section: 'mainDeck', matchStatus: 'matched', candidateCardIds: ['b'] },
    ] };
    const collection = { a: 1, b: 5 };
    const result = compareDeckWithCollection(deck, [], collection);
    expect(result.cards.map((entry) => entry.missingQuantity)).toEqual([2, 0]);
    expect(result).toMatchObject({ totalRequired: 5, missingTotal: 2, missingKinds: 1 });
    expect(collection).toEqual({ a: 1, b: 5 });
  });

  it('keeps unmatched entries non-crashing and explicitly rejects unsupported inputs', () => {
    const unmatched = parsePastedDeck('Legend:\n1 Unknown Card', [], () => 'deck').deck.cards[0];
    expect(unmatched).toMatchObject({ cardId: null, sourceName: 'Unknown Card', matchStatus: 'unmatched' });
    expect(compareDeckWithCollection({ id: 'd', name: 'd', cards: [unmatched] }, [], {}).cards[0])
      .toMatchObject({ card: null, ownedQuantity: 0, missingQuantity: 1 });
    expect(() => parsePastedDeck('random words', [])).toThrow(/지원되는 덱 형식/);
    expect(() => parsePastedDeck('RB1|265|246|...', [])).toThrow(/지원하지 않습니다/);
  });
});
