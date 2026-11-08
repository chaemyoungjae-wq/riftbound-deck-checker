import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCardCatalogCache, getCardCatalog, mapRiftcodexCard } from '../src/lib/card-providers/riftcodex';

afterEach(() => {
  clearCardCatalogCache();
  vi.unstubAllGlobals();
});

describe('Riftcodex provider adapter', () => {
  it('maps documented fields and tolerates optional fields being absent', () => {
    const card = mapRiftcodexCard({
      id: 'stable-print-id', name: 'Example', riftbound_id: 'ogn-001-001', collector_number: 1,
      set: { set_id: 'OGN', label: 'Origins' }, classification: { domain: ['Fury', null, 'Mind'], rarity: 'Rare' },
      media: { image_url: 'https://images.example/card.png', accessibility_text: 'Example card' },
    });
    expect(card).toMatchObject({
      id: 'stable-print-id', name: 'Example', cardNumber: 'ogn-001-001', collectorNumber: 1,
      setCode: 'OGN', setName: 'Origins', domains: ['Fury', 'Mind'], rarity: 'Rare',
      imageUrl: 'https://images.example/card.png',
    });
    expect(mapRiftcodexCard({ id: 'partial' })).toMatchObject({
      id: 'partial', name: '이름 미상', setCode: 'UNKNOWN', domains: [], imageUrl: null,
    });
    expect(mapRiftcodexCard({ name: 'Cannot identify safely' })).toBeNull();
  });

  it('loads all documented pages, keeps stable API ids, diagnoses duplicates, and caches success', async () => {
    const card = (id: string, name: string, collector_number: number, set_id: string) => ({
      id, name, riftbound_id: `${set_id.toLowerCase()}-${collector_number}`, collector_number,
      set: { set_id, label: set_id }, classification: { domain: ['Colorless'], rarity: 'Common' },
      media: { image_url: null },
    });
    const payloads: Record<string, unknown> = {
      '/api/riftcodex/cards?page=1&size=100': { items: [card('id-a', 'Card A', 2, 'OGN')], total: 3, page: 1, size: 100, pages: 2 },
      '/api/riftcodex/cards?page=2&size=100': { items: [card('id-b', 'Card B', 1, 'OGS'), card('id-a', 'Duplicate', 3, 'OGN')], total: 3, page: 2, size: 100, pages: 2 },
      '/api/riftcodex/sets?page=1&size=100': { items: [{ id: 'set-id', set_id: 'OGN', name: 'Origins', card_count: 1 }], total: 1, page: 1, size: 100, pages: 1 },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const payload = payloads[`${url.pathname}?${[...url.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&')}`];
      if (!payload) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCardCatalog();
    expect(result.diagnostics).toMatchObject({ cardCount: 2, apiCardCount: 3, cardPages: 2, setCount: 1, duplicateIds: 1 });
    expect(result.cards.map((entry) => entry.id)).toEqual(['id-a', 'id-b']);
    expect(result.sets[0].code).toBe('OGN');
    const callsAfterFirstLoad = fetchMock.mock.calls.length;
    expect(await getCardCatalog()).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirstLoad);
  });

  it('rejects malformed response structures instead of treating them as an empty library', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ cards: [] }), { status: 200 })));
    await expect(getCardCatalog()).rejects.toThrow('items 목록을 확인할 수 없습니다');
  });
});
