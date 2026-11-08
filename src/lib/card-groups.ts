import type { Card } from '../types/card';

export type CardGroup = {
  id: string;
  primary: Card;
  printings: Card[];
  totalQuantity: number;
};

export function isPromoPrinting(card: Card): boolean {
  return (card.distributionMarkers ?? []).some((marker) => /promo/i.test(marker)) ||
    (card.distributionChannels ?? []).some((channel) => /promo/i.test(channel));
}

function printingPriority(card: Card): number {
  if (isPromoPrinting(card)) return 3;
  if (card.finish?.toLowerCase() === 'normal') return 0;
  if (card.finish?.toLowerCase() === 'foil') return 1;
  return 2;
}

export function preferredCardPrintings(cards: Card[]): Card[] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const key = card.cardGroupId ?? card.id;
    const group = groups.get(key) ?? [];
    group.push(card);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) =>
    [...group].sort((a, b) => printingPriority(a) - printingPriority(b) || a.id.localeCompare(b.id))[0],
  );
}

export function selectDefaultPrinting(cards: Card[]): Card | null {
  const preferred = preferredCardPrintings(cards);
  return preferred.length === 1 ? preferred[0] : null;
}

export function buildCardGroups(cards: Card[], quantities: Record<string, number>): CardGroup[] {
  const groups = new Map<string, Card[]>();
  for (const card of cards) {
    const key = card.cardGroupId ?? card.id;
    const group = groups.get(key) ?? [];
    group.push(card);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, printings]) => {
    const ordered = [...printings].sort((a, b) => printingPriority(a) - printingPriority(b) ||
      (a.publicCode ?? '').localeCompare(b.publicCode ?? '') || a.id.localeCompare(b.id));
    return {
      id,
      primary: ordered[0],
      printings: ordered,
      totalQuantity: ordered.reduce((sum, card) => sum + (quantities[card.id] ?? 0), 0),
    };
  });
}

export function cardPrintingCode(card: Card): string {
  const code = card.publicCode ?? card.cardNumber ?? '';
  if (!card.cardGroupId) return code;
  const finish = card.finish?.toLowerCase() === 'foil' ? 'FOIL' : 'STANDARD';
  return `${code} [${isPromoPrinting(card) ? 'PROMO-' : ''}${finish}]`;
}

export function printingLabel(card: Card): string {
  const finish = card.finish?.toLowerCase() === 'foil' ? '\uD3EC\uC77C' : '\uC77C\uBC18';
  return isPromoPrinting(card) ? `\uD504\uB85C\uBAA8 \u00B7 ${finish}` : finish;
}
