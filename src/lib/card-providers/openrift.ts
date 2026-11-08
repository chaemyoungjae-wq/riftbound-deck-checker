import type { Card, CardCatalog, CardSet, CatalogDiagnostics } from '../../types/card';

const API_ROUTE = '/api/openrift/catalog?langs=EN%2CKR';
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

type RawRecord = Record<string, unknown>;
type RawPrinting = {
  shortCode?: unknown;
  publicCode?: unknown;
  setId?: unknown;
  language?: unknown;
  printedName?: unknown;
  artVariant?: unknown;
  finish?: unknown;
  markers?: unknown;
  cardId?: unknown;
  images?: unknown;
  distributionChannels?: unknown;
  rarity?: unknown;
};
type RawCard = { name?: unknown; domains?: unknown; types?: unknown };
type RawSet = { id?: unknown; slug?: unknown; name?: unknown; releases?: unknown };

export class CardProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CardProviderError';
  }
}

let cache: { value: CardCatalog; expiresAt: number } | undefined;
let inFlight: Promise<CardCatalog> | undefined;

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function titleCase(value: string): string {
  return value ? value[0].toLocaleUpperCase() + value.slice(1).toLocaleLowerCase() : value;
}
function validImageUrl(imageId: unknown): string | null {
  const id = optionalString(imageId);
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) return null;
  return `https://openrift.app/media/cards/${encodeURIComponent(id)}-full.webp`;
}
function collectorNumber(shortCode: string): number | null {
  const match = shortCode.match(/-(\d+)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
}

function setReleaseDate(set: RawSet, language: 'EN' | 'KR'): string | null {
  if (!isRecord(set.releases) || !isRecord(set.releases[language])) return null;
  return optionalString(set.releases[language].releasedAt);
}

function isReleasedForLanguage(set: RawSet | undefined, language: string): boolean {
  if (language !== 'KR') return true;
  if (!set || !isRecord(set.releases) || !isRecord(set.releases.KR)) return false;
  const releasedAt = optionalString(set.releases.KR.releasedAt);
  if (!releasedAt || Number.isNaN(Date.parse(releasedAt))) return false;
  return Date.parse(`${releasedAt}T00:00:00`) <= Date.now();
}

/** Convert OpenRift canonical cards and EN/KR printings to the app printing model. */
export function mapOpenRiftCatalog(value: unknown): CardCatalog {
  if (!isRecord(value) || !isRecord(value.cards) || !isRecord(value.printings) || !Array.isArray(value.sets)) {
    throw new CardProviderError('OpenRift returned an invalid catalog structure.');
  }
  const canonicalCards = value.cards as Record<string, RawCard>;
  const printings = value.printings as Record<string, RawPrinting>;
  const rawSets = value.sets as RawSet[];
  const setsById = new Map<string, RawSet>();
  const uniqueCardIdsBySet = new Map<string, Set<string>>();
  for (const set of rawSets) {
    const id = optionalString(set.id);
    if (id) setsById.set(id, set);
  }

  // Localized names must stay scoped to a language. Sharing names by canonical
  // card lets a Korean deck name accidentally resolve to its English printing.
  const localizedNamesByCard = new Map<string, Set<string>>();
  let cardsSkippedWithoutId = 0;
  const validPrintings = Object.entries(printings).filter(([, printing]) => {
    const language = optionalString(printing.language)?.toUpperCase() ?? 'EN';
    if (language !== 'EN' && language !== 'KR') return false;
    const setId = optionalString(printing.setId);
    return isReleasedForLanguage(setId ? setsById.get(setId) : undefined, language);
  });
  if (!validPrintings.length) throw new CardProviderError('OpenRift returned no printings.');

  for (const [printingId, printing] of validPrintings) {
    const cardId = optionalString(printing.cardId);
    const canonical = cardId ? canonicalCards[cardId] : undefined;
    if (!printingId || !cardId || !canonical) { cardsSkippedWithoutId += 1; continue; }
    const language = optionalString(printing.language)?.toUpperCase() ?? 'EN';
    const namesKey = `${cardId}|${language}`;
    const names = localizedNamesByCard.get(namesKey) ?? new Set<string>();
    const canonicalName = optionalString(canonical.name);
    const printedName = optionalString(printing.printedName);
    if (canonicalName) names.add(canonicalName);
    if (printedName) names.add(printedName);
    localizedNamesByCard.set(namesKey, names);
    const setId = optionalString(printing.setId);
    if (setId) {
      const cardIds = uniqueCardIdsBySet.get(setId) ?? new Set<string>();
      cardIds.add(cardId);
      uniqueCardIdsBySet.set(setId, cardIds);
    }
  }

  const cards: Card[] = [];
  for (const [printingId, printing] of validPrintings) {
    const canonicalId = optionalString(printing.cardId);
    const canonical = canonicalId ? canonicalCards[canonicalId] : undefined;
    const name = optionalString(printing.printedName) ?? optionalString(canonical?.name);
    const shortCode = optionalString(printing.shortCode);
    if (!printingId || !canonicalId || !canonical || !name || !shortCode) continue;
    const setId = optionalString(printing.setId);
    const set = setId ? setsById.get(setId) : undefined;
    const publicCode = optionalString(printing.publicCode);
    const setCode = optionalString(set?.slug) ?? publicCode?.match(/^([A-Z0-9]+)-/i)?.[1]?.toUpperCase() ?? 'UNKNOWN';
    const images = Array.isArray(printing.images) ? printing.images : [];
    const imageId = images.length && isRecord(images[0]) ? images[0].imageId : null;
    const domains = Array.isArray(canonical.domains)
      ? canonical.domains.filter((domain): domain is string => typeof domain === 'string' && !!domain.trim()).map(titleCase)
      : [];
    const types = Array.isArray(canonical.types)
      ? canonical.types.filter((type): type is string => typeof type === 'string' && !!type.trim()).map(titleCase)
      : [];
    const markers = Array.isArray(printing.markers)
      ? printing.markers.filter((marker): marker is string => typeof marker === 'string')
      : [];
    const channels = Array.isArray(printing.distributionChannels)
      ? printing.distributionChannels.flatMap((channel) => {
        if (typeof channel === 'string') return [channel];
        if (isRecord(channel) && typeof channel.channel === 'string') return [channel.channel];
        return [];
      })
      : [];
    cards.push({
      id: printingId,
      name,
      cardNumber: shortCode.toUpperCase(),
      publicCode: publicCode?.toUpperCase() ?? null,
      collectorNumber: collectorNumber(shortCode),
      setCode,
      setName: optionalString(set?.name),
      domains,
      types,
      rarity: titleCase(optionalString(printing.rarity) ?? ''),
      imageUrl: validImageUrl(imageId),
      imageAlt: name,
      language: optionalString(printing.language)?.toUpperCase() ?? 'EN',
      localizedNames: [...(localizedNamesByCard.get(`${canonicalId}|${optionalString(printing.language)?.toUpperCase() ?? 'EN'}`) ?? new Set([name]))],
      printingVariant: optionalString(printing.artVariant),
      finish: optionalString(printing.finish),
      distributionMarkers: markers,
      distributionChannels: channels,
      canonicalCardId: canonicalId,
      cardGroupId: [canonicalId, optionalString(printing.language)?.toUpperCase() ?? 'EN'].join('|'),
    });
  }
  if (!cards.length) throw new CardProviderError('OpenRift had no usable EN/KR printings.');

  // OpenRift currently has the Recruit and Sprite canonical records but no
  // numbered OGN token printings. Add local catalog fallbacks until it does.
  // These are language-specific entries so they never cross into the other
  // language filter or collection during imports.
  const ognTokens = [
    { number: 271, english: 'Recruit (DE)', korean: '\uC2E0\uBCD1 (DE)', canonicalId: 'local:ogn-token-recruit-de', types: ['Unit'] },
    { number: 272, english: 'Recruit (NX)', korean: '\uC2E0\uBCD1 (NX)', canonicalId: 'local:ogn-token-recruit-nx', types: ['Unit'] },
    { number: 273, english: 'Recruit (ZN)', korean: '\uC2E0\uBCD1 (ZN)', canonicalId: 'local:ogn-token-recruit-zn', types: ['Unit'] },
    { number: 274, english: 'Sprite', korean: '\uC815\uB839', canonicalId: 'local:ogn-token-spirit', types: ['Unit'] },
  ];
  for (const token of ognTokens) {
    for (const language of ['EN', 'KR'] as const) {
      if (cards.some((card) => card.setCode === 'OGN' && card.collectorNumber === token.number && card.language === language)) continue;
      const name = language === 'KR' ? token.korean : token.english;
      const suffix = language === 'KR' ? '-KR' : '';
      const cardNumber = `OGN-${String(token.number).padStart(3, '0')}`;
      cards.push({
        id: `${token.canonicalId}|${language}`,
        name,
        cardNumber,
        collectorNumber: token.number,
        setCode: 'OGN',
        setName: 'Origins',
        domains: ['Colorless'],
        types: token.types,
        rarity: 'Token',
        imageUrl: null,
        imageAlt: name,
        publicCode: `${cardNumber}/298${suffix}`,
        language,
        localizedNames: [name],
        printingVariant: null,
        finish: 'normal',
        distributionMarkers: [],
        distributionChannels: [],
        canonicalCardId: token.canonicalId,
        cardGroupId: `${token.canonicalId}|${language}`,
      });
    }
  }

  const fallbackImageByGroup = new Map<string, string>();
  for (const card of cards) {
    if (!card.imageUrl || !card.cardGroupId) continue;
    const current = fallbackImageByGroup.get(card.cardGroupId);
    if (!current || (card.finish === 'normal' && !card.distributionMarkers?.some((marker) => /promo/i.test(marker)))) {
      fallbackImageByGroup.set(card.cardGroupId, card.imageUrl);
    }
  }
  for (const card of cards) {
    if (!card.imageUrl && card.cardGroupId) card.imageUrl = fallbackImageByGroup.get(card.cardGroupId) ?? null;
  }

  cards.sort((a, b) => a.setCode.localeCompare(b.setCode) ||
    (a.collectorNumber ?? Number.MAX_SAFE_INTEGER) - (b.collectorNumber ?? Number.MAX_SAFE_INTEGER) ||
    (a.language === b.language ? 0 : a.language === 'EN' ? -1 : 1) || a.id.localeCompare(b.id));
  const sets: CardSet[] = rawSets.flatMap((rawSet) => {
    const id = optionalString(rawSet.id);
    const code = optionalString(rawSet.slug);
    if (!id || !code) return [];
    return [{ id, code, name: optionalString(rawSet.name) ?? code, cardCount: uniqueCardIdsBySet.get(id)?.size ?? 0, releaseDates: { EN: setReleaseDate(rawSet, 'EN'), KR: setReleaseDate(rawSet, 'KR') } }];
  }).sort((a, b) => a.code.localeCompare(b.code));
  const domains = [...new Set(cards.flatMap((card) => card.domains))].sort((a, b) => a.localeCompare(b));
  const diagnostics: CatalogDiagnostics = {
    cardCount: cards.length,
    apiCardCount: Object.keys(canonicalCards).length,
    cardPages: 1,
    setCount: sets.length,
    apiSetCount: sets.length,
    setPages: 1,
    duplicateIds: cards.length - new Set(cards.map((card) => card.id)).size,
    cardsSkippedWithoutId,
    domains,
  };
  return { cards, sets, diagnostics };
}

async function fetchCatalog(force: boolean): Promise<CardCatalog> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(API_ROUTE, {
        signal: controller.signal,
        cache: force ? 'reload' : 'default',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new CardProviderError(`OpenRift request failed (${response.status})`);
      try {
        return mapOpenRiftCatalog(await response.json());
      } catch (error) {
        if (error instanceof CardProviderError) throw error;
        throw new CardProviderError('OpenRift returned invalid JSON.', { cause: error });
      }
    } catch (error) {
      lastError = error;
      if (error instanceof CardProviderError && !/\(5\d{2}\)$/.test(error.message)) throw error;
      if (attempt + 1 < MAX_ATTEMPTS) await new Promise((resolve) => globalThis.setTimeout(resolve, 400));
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  throw new CardProviderError(
    lastError instanceof DOMException && lastError.name === 'AbortError'
      ? 'OpenRift request timed out.'
      : 'Unable to connect to OpenRift. Check your connection and the API status.',
    { cause: lastError },
  );
}

/** The catalog cache follows OpenRift's documented one-hour cache window. */
export function getOpenRiftCatalog(options: { force?: boolean } = {}): Promise<CardCatalog> {
  if (options.force) { cache = undefined; inFlight = undefined; }
  if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.value);
  if (inFlight) return inFlight;
  inFlight = fetchCatalog(Boolean(options.force))
    .then((value) => { cache = { value, expiresAt: Date.now() + CACHE_TTL_MS }; return value; })
    .finally(() => { inFlight = undefined; });
  return inFlight;
}
export function clearOpenRiftCatalogCache(): void {
  cache = undefined;
  inFlight = undefined;
}
