/** UI와 컬렉션 저장소가 사용하는 제공처 독립 카드 형식 */
export type Card = {
  id: string;
  name: string;
  cardNumber: string | null;
  collectorNumber: number | null;
  setCode: string;
  setName: string | null;
  domains: string[];
  types?: string[];
  rarity: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  publicCode?: string | null;
  language?: string;
  localizedNames?: string[];
  printingVariant?: string | null;
  finish?: string | null;
  distributionMarkers?: string[];
  distributionChannels?: string[];
  canonicalCardId?: string;
  cardGroupId?: string;
};

export type CardSet = {
  id: string;
  code: string;
  name: string;
  cardCount: number | null;
  releaseDates?: { EN: string | null; KR: string | null };
};

export type CatalogDiagnostics = {
  cardCount: number;
  apiCardCount: number;
  cardPages: number;
  setCount: number;
  apiSetCount: number;
  setPages: number;
  duplicateIds: number;
  cardsSkippedWithoutId: number;
  domains: string[];
};

export type CardCatalog = {
  cards: Card[];
  sets: CardSet[];
  diagnostics: CatalogDiagnostics;
};
