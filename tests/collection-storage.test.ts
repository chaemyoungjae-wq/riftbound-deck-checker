import { describe, expect, it } from 'vitest';
import type { Card } from '../src/types/card';
import {
  CARD_CODE_MAPPINGS_KEY,
  COLLECTION_STORAGE_KEY,
  DECK_CARD_MAPPINGS_KEY,
  readCardCodeMappings,
  readDeckCardMappings,
  resetCollectionStorage,
  writeCardCodeMappings,
  writeDeckCardMappings,
} from '../src/lib/collection-storage';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('collection storage', () => {
  it('resets only quantities and leaves mappings and card records untouched', () => {
    const storage = memoryStorage({
      [COLLECTION_STORAGE_KEY]: JSON.stringify({ 'api-id': 4 }),
      [CARD_CODE_MAPPINGS_KEY]: JSON.stringify({ 'OGN-042A': 'api-id' }),
    });
    const cards: Card[] = [{
      id: 'api-id', name: 'Card', cardNumber: 'ogn-042a-298', collectorNumber: 42,
      setCode: 'OGN', setName: 'Origins', domains: ['Fury'], rarity: 'Rare', imageUrl: null, imageAlt: null,
    }];
    const cardsBefore = structuredClone(cards);

    resetCollectionStorage(storage);

    expect(storage.getItem(COLLECTION_STORAGE_KEY)).toBe('{}');
    expect(readCardCodeMappings(storage)).toEqual({ 'OGN-042A': 'api-id' });
    expect(cards).toEqual(cardsBefore);
  });

  it('normalizes mapping Codes and rejects malformed mapping entries', () => {
    const storage = memoryStorage();
    writeCardCodeMappings(storage, { 'ogn-151 ': ' api-id ', ' OGN-042A ': 'alternate-id', '': 'bad', 'OGN-2': '' });
    expect(readCardCodeMappings(storage)).toEqual({ 'OGN-151': 'api-id', 'OGN-042A': 'alternate-id' });
    storage.setItem(CARD_CODE_MAPPINGS_KEY, JSON.stringify({ ' ogn-151 ': ' api-id ', 'ogn-042a': ' alternate-id ', empty: '', invalid: 3 }));
    expect(readCardCodeMappings(storage)).toEqual({ 'OGN-151': 'api-id', 'OGN-042A': 'alternate-id' });
  });

  it('stores deck source keys mapped to stable API card IDs', () => {
    const storage = memoryStorage();
    writeDeckCardMappings(storage, { 'ko:평정 룬': ' normal-id ', 'code:OGN-042A': 'alternate-id', '': 'bad' });
    expect(readDeckCardMappings(storage)).toEqual({ 'ko:평정 룬': 'normal-id', 'code:OGN-042A': 'alternate-id' });
    storage.setItem(DECK_CARD_MAPPINGS_KEY, JSON.stringify({ 'name:cleave': 'api-id', bad: '', invalid: 3 }));
    expect(readDeckCardMappings(storage)).toEqual({ 'name:cleave': 'api-id' });
  });
});
