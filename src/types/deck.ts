export type DeckSection = 'legend' | 'champion' | 'mainDeck' | 'battlefields' | 'runes' | 'sideboard';
export type DeckMatchStatus = 'matched' | 'unmatched' | 'ambiguous';
export type DeckFormat = 'korean-sections' | 'english-sections' | 'codes';

export type DeckCard = {
  cardId: string | null;
  quantity: number;
  section: DeckSection;
  sourceName?: string;
  sourceCode?: string;
  sourceKey?: string;
  matchStatus: DeckMatchStatus;
  candidateCardIds: string[];
};

export type Deck = {
  id: string;
  name: string;
  cards: DeckCard[];
  format?: DeckFormat;
};

export type DeckComparisonItem = DeckCard & {
  entryIndex: number;
  card: import('./card').Card | null;
  ownedQuantity: number;
  missingQuantity: number;
};

export type DeckComparison = {
  cards: DeckComparisonItem[];
  totalKinds: number;
  totalRequired: number;
  fulfilledKinds: number;
  missingKinds: number;
  missingTotal: number;
};
