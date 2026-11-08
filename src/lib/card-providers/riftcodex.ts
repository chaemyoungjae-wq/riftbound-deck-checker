import type { Card, CardCatalog, CardSet, CatalogDiagnostics } from '../../types/card';

// The UI talks to one local provider route; Vite relays its read-only calls to Riftcodex.
const API_ROOT = '/api/riftcodex';
const PAGE_SIZE = 100; // Riftcodex documents 100 as the maximum page size.
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 2;

type Page<T> = { items: T[]; total: number; page: number; size: number; pages: number };
type RawCard = Record<string, unknown>;
type RawSet = Record<string, unknown>;

export class CardProviderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CardProviderError';
  }
}

let cache: { value: CardCatalog; expiresAt: number } | undefined;
let inFlight: Promise<CardCatalog> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function getJson<T>(path: string, reload: boolean): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        signal: controller.signal,
        cache: reload ? 'reload' : 'default',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new CardProviderError(`Riftcodex 응답 오류 (${response.status})`);
      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new CardProviderError('Riftcodex가 올바른 JSON을 반환하지 않았습니다.', { cause: error });
      }
    } catch (error) {
      lastError = error;
      if (error instanceof CardProviderError && !error.message.includes('응답 오류 (5')) throw error;
      if (attempt + 1 < MAX_ATTEMPTS) await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  throw new CardProviderError(
    lastError instanceof DOMException && lastError.name === 'AbortError'
      ? 'Riftcodex 요청 시간이 초과되었습니다.'
      : 'Riftcodex API에 연결할 수 없습니다. 인터넷 연결과 API 상태를 확인해 주세요.',
    { cause: lastError },
  );
}

function validatePage<T>(value: unknown, label: string): Page<T> {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new CardProviderError(`${label} 응답의 items 목록을 확인할 수 없습니다.`);
  }
  const { total, page, size, pages } = value;
  if (![total, page, size, pages].every((n) => Number.isInteger(n) && Number(n) >= 0)) {
    throw new CardProviderError(`${label} 응답의 페이지 정보가 예상한 형식이 아닙니다.`);
  }
  return value as Page<T>;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validImageUrl(value: unknown): string | null {
  const text = optionalString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Riftcodex 응답을 UI에서 쓰는 표준 타입으로 한 번만 변환합니다. */
export function mapRiftcodexCard(raw: RawCard): Card | null {
  const id = optionalString(raw.id);
  if (!id) return null; // 수량을 안전하게 연결할 수 없는 카드는 제외합니다.
  const set = isRecord(raw.set) ? raw.set : {};
  const classification = isRecord(raw.classification) ? raw.classification : {};
  const media = isRecord(raw.media) ? raw.media : {};
  const domains = Array.isArray(classification.domain)
    ? classification.domain.filter((domain): domain is string => typeof domain === 'string' && !!domain.trim()).map((domain) => domain.trim())
    : [];
  const number = Number.isInteger(raw.collector_number) ? Number(raw.collector_number) : null;
  return {
    id,
    name: optionalString(raw.name) ?? '이름 미상',
    cardNumber: optionalString(raw.riftbound_id),
    collectorNumber: number,
    setCode: optionalString(set.set_id) ?? 'UNKNOWN',
    setName: optionalString(set.label),
    domains,
    rarity: optionalString(classification.rarity),
    imageUrl: validImageUrl(media.image_url),
    imageAlt: optionalString(media.accessibility_text),
  };
}

function mapSet(raw: RawSet): CardSet | null {
  const id = optionalString(raw.id);
  const code = optionalString(raw.set_id);
  if (!id || !code) return null;
  return {
    id,
    code,
    name: optionalString(raw.name) ?? code,
    cardCount: Number.isInteger(raw.card_count) ? Number(raw.card_count) : null,
  };
}

async function readAllPages<T>(path: string, label: string, reload: boolean): Promise<{ rows: T[]; pages: number; total: number }> {
  const first = validatePage<T>(await getJson<unknown>(`${path}?size=${PAGE_SIZE}&page=1`, reload), label);
  const all = [...first.items];
  for (let page = 2; page <= first.pages; page += 1) {
    const next = validatePage<T>(await getJson<unknown>(`${path}?size=${PAGE_SIZE}&page=${page}`, reload), label);
    if (next.page !== page || next.total !== first.total || next.pages !== first.pages) {
      throw new CardProviderError(`${label} 페이지가 서로 다른 목록을 반환했습니다. 다시 시도해 주세요.`);
    }
    all.push(...next.items);
  }
  if (all.length !== first.total) {
    throw new CardProviderError(`${label} 목록이 일부만 도착했습니다 (${all.length}/${first.total}).`);
  }
  return { rows: all, pages: first.pages, total: first.total };
}

function stableCardOrder(a: Card, b: Card): number {
  return a.setCode.localeCompare(b.setCode) ||
    (a.collectorNumber ?? Number.MAX_SAFE_INTEGER) - (b.collectorNumber ?? Number.MAX_SAFE_INTEGER) ||
    a.id.localeCompare(b.id);
}

async function fetchCatalog(reload: boolean): Promise<CardCatalog> {
  const [rawCards, rawSets] = await Promise.all([
    readAllPages<RawCard>('/cards', '카드', reload),
    readAllPages<RawSet>('/sets', '세트', reload),
  ]);
  const cards: Card[] = [];
  const seenIds = new Set<string>();
  let duplicateIds = 0;
  let cardsSkippedWithoutId = 0;
  for (const raw of rawCards.rows) {
    const card = mapRiftcodexCard(raw);
    if (!card) { cardsSkippedWithoutId += 1; continue; }
    if (seenIds.has(card.id)) { duplicateIds += 1; continue; }
    seenIds.add(card.id);
    cards.push(card);
  }
  cards.sort(stableCardOrder);
  const sets = rawSets.rows.map(mapSet).filter((set): set is CardSet => set !== null)
    .sort((a, b) => a.code.localeCompare(b.code));
  const domains = [...new Set(cards.flatMap((card) => card.domains))].sort((a, b) => a.localeCompare(b));
  const diagnostics: CatalogDiagnostics = {
    cardCount: cards.length,
    apiCardCount: rawCards.total,
    cardPages: rawCards.pages,
    setCount: sets.length,
    apiSetCount: rawSets.total,
    setPages: rawSets.pages,
    duplicateIds,
    cardsSkippedWithoutId,
    domains,
  };
  return { cards, sets, diagnostics };
}

/** Successful catalog results stay in memory for ten minutes; failures are never cached. */
export function getCardCatalog(options: { force?: boolean } = {}): Promise<CardCatalog> {
  if (options.force) { cache = undefined; inFlight = undefined; }
  if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.value);
  if (inFlight) return inFlight;
  inFlight = fetchCatalog(Boolean(options.force))
    .then((value) => { cache = { value, expiresAt: Date.now() + CACHE_TTL_MS }; return value; })
    .finally(() => { inFlight = undefined; });
  return inFlight;
}

export function clearCardCatalogCache(): void {
  cache = undefined;
  inFlight = undefined;
}

