export const COLLECTION_STORAGE_KEY = 'riftbound-collection-v1';
export const CARD_CODE_MAPPINGS_KEY = 'riftbound-card-code-mappings-v1';
export const DECK_CARD_MAPPINGS_KEY = 'riftbound-deck-card-mappings-v1';

export function readCardCodeMappings(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(CARD_CODE_MAPPINGS_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([code, id]) =>
        typeof code === 'string' && !!code.trim() && typeof id === 'string' && !!id.trim(),
      ).map(([code, id]) => [code.trim().toUpperCase(), id.trim()]),
    );
  } catch {
    return {};
  }
}

export function writeCardCodeMappings(
  storage: Pick<Storage, 'setItem'>,
  mappings: Record<string, string>,
): void {
  const validMappings = Object.fromEntries(
    Object.entries(mappings).filter(([code, id]) =>
      !!code.trim() && typeof id === 'string' && !!id.trim(),
    ).map(([code, id]) => [code.trim().toUpperCase(), id.trim()]),
  );
  storage.setItem(CARD_CODE_MAPPINGS_KEY, JSON.stringify(validMappings));
}

export function readDeckCardMappings(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const value: unknown = JSON.parse(storage.getItem(DECK_CARD_MAPPINGS_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, id]) =>
      typeof key === 'string' && !!key.trim() && typeof id === 'string' && !!id.trim(),
    ).map(([key, id]) => [key.trim(), id.trim()]));
  } catch { return {}; }
}

export function writeDeckCardMappings(storage: Pick<Storage, 'setItem'>, mappings: Record<string, string>): void {
  const validMappings = Object.fromEntries(Object.entries(mappings).filter(([key, id]) =>
    !!key.trim() && typeof id === 'string' && !!id.trim(),
  ).map(([key, id]) => [key.trim(), id.trim()]));
  storage.setItem(DECK_CARD_MAPPINGS_KEY, JSON.stringify(validMappings));
}

/** Clears collection quantities only. Catalog data and card-code mappings are separate stores. */
export function resetCollectionStorage(storage: Pick<Storage, 'setItem'>): void {
  storage.setItem(COLLECTION_STORAGE_KEY, '{}');
}
