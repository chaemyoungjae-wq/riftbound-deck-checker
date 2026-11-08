import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Card, CardSet } from './types/card';
import type { CardGroup } from './lib/card-groups';
import { buildCardGroups, cardPrintingCode, isPromoPrinting, printingLabel } from './lib/card-groups';
import type { Deck, DeckComparisonItem, DeckFormat, DeckSection } from './types/deck';
import { loadCards } from './lib/cards';
import { compareDeckWithCollection, DECK_SECTION_LABELS, parsePastedDeck } from './lib/decks';
import { normalizeDeckCardName } from './lib/korean-card-reference';
import { migrateLegacyCollection } from './lib/collection-migration';
import { getCardCatalog as getLegacyCardCatalog } from './lib/card-providers/riftcodex';
import { CardProviderError } from './lib/card-providers/openrift';
import { addManualCardCodeMapping, applyManualCardQuantity, CollectionCsvError, mergeCollectionQuantities, normalizeCardNumber, previewCollectionCsv, searchCardCandidates, serializeCollectionCsv } from './lib/collection-csv';
import { COLLECTION_STORAGE_KEY, readCardCodeMappings, readDeckCardMappings, resetCollectionStorage, writeCardCodeMappings, writeDeckCardMappings } from './lib/collection-storage';
import { readSavedDecks, writeSavedDecks } from './lib/saved-decks';
import './style.css';

const THEME = 'riftbound-theme-v2';
const domainOrder = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'];
const domainColors: Record<string, string> = {
  fury: '#d85b52', calm: '#59a56b', mind: '#557bd5', body: '#df8a42',
  chaos: '#9866ca', order: '#d8b945', colorless: '#e9e9e2',
};
const domainIcons: Record<string, string> = { body: '\u2694', calm: '\u223f', chaos: '\u2726', colorless: '\u25c7', fury: '\u2668', mind: '\u25ce', order: '\u2600' };

type ImportReviewRow = { code: string; qty: number; cardId: string | null };
type ImportReview = { rows: ImportReviewRow[]; autoRegistered: number };

function readQty(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(COLLECTION_STORAGE_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, qty]) => Number.isSafeInteger(qty) && Number(qty) >= 0) as [string, number][]);
  } catch {
    return {};
  }
}

function isBattlefieldCard(card: Card): boolean {
  if (card.types?.length) return card.types.some((type) => /battlefield/i.test(type));
  return card.setCode.toUpperCase() === 'OGN' && (card.collectorNumber ?? 0) >= 275 && (card.collectorNumber ?? 0) <= 298;
}

function CardTile({ group, qty, onCount, onOpen }: {
  group: CardGroup;
  qty: number;
  onCount: (id: string, qty: number) => void;
  onOpen: (group: CardGroup) => void;
}) {
  const card = group.primary;
  const battlefield = isBattlefieldCard(card);
  const stack = group.printings;
  return <article className={`card-tile ${group.totalQuantity === 0 ? 'unowned' : ''} ${battlefield ? 'battlefield-tile' : ''}`}>
    <div className="art">
      <button className="stack-preview" type="button" onClick={() => onOpen(group)} aria-label={`${card.name}, ${group.printings.length} printings, ${group.totalQuantity} owned. Open details`}>
        {stack.slice(1).map((printing, index) => <span className="stack-layer" key={printing.id} style={{ zIndex: stack.length - index, '--stack-angle': `${(index + 1) * 5}deg` } as React.CSSProperties}>
          {printing.imageUrl ? <img className={battlefield ? 'battlefield-image' : undefined} src={printing.imageUrl} alt="" loading="lazy" /> : <span className="placeholder"><strong>{printing.setCode}</strong></span>}
        </span>)}
        <span className="stack-front" style={{ zIndex: stack.length + 1 }}>
          {card.imageUrl ? <img className={battlefield ? 'battlefield-image' : undefined} src={card.imageUrl} alt={card.imageAlt ?? card.name} loading="lazy" referrerPolicy="no-referrer" /> : <span className="placeholder"><strong>{card.setCode}</strong><small>{card.domains.join(' ')}</small></span>}
        </span>
      </button>
      <span className="set-badge">{card.setCode} | {card.language ?? 'EN'}</span>
      {group.printings.length > 1 && <span className="printing-count">{group.printings.length} printings</span>}
    </div>
    <div className="card-info">
      <button className="card-title card-title-button" type="button" onClick={() => onOpen(group)} title={card.name}>{card.name}</button>
      <div className="card-sub"><span>{card.publicCode ?? card.cardNumber ?? `#${card.collectorNumber ?? '?'}`}</span><span>{card.rarity ?? ''}</span></div>
      <div className="domain-line">{card.domains.join(' / ')}</div>
      <div className="quantity">
        <button aria-label={`${card.name} base printing quantity decrease`} disabled={qty === 0} onClick={() => onCount(card.id, qty - 1)}>-</button>
        <button className="qty-value" aria-label={`${group.totalQuantity} total copies across printings; open individual quantities`} onClick={() => onOpen(group)}>{group.totalQuantity}</button>
        <button aria-label={`${card.name} base printing quantity increase`} onClick={() => onCount(card.id, qty + 1)}>+</button>
      </div>
    </div>
  </article>;
}

function DeckCardRow({ item, section, onFind }: { item: DeckComparisonItem; section: string; onFind?: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [item.card?.imageUrl]);
  const card = item.card;
  return <article className={`deck-card-row ${item.missingQuantity > 0 ? 'needs-cards' : 'has-cards'}`}>
    <div className="deck-card-thumb">
      {card?.imageUrl && !imageFailed
        ? <img src={card.imageUrl} alt={card.imageAlt ?? card.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} />
        : <div className="deck-card-placeholder"><b>{card?.setCode ?? '?'}</b><span>{card?.cardNumber ?? '카드 정보 없음'}</span></div>}
    </div>
    <div className="deck-card-info">
      <span className="deck-section-label">{section}</span>
      <h3>{card?.name ?? item.sourceName ?? item.sourceCode ?? '알 수 없는 카드'}</h3>
      <p>{card ? `${card.cardNumber ?? '번호 없음'} · ${card.setCode}` : item.matchStatus === 'ambiguous' ? '여러 후보가 있어 카드 선택이 필요합니다.' : item.sourceName ? '이름으로 카드를 찾지 못했습니다.' : item.sourceCode ? 'Code로 카드를 찾지 못했습니다.' : `cardId: ${item.cardId}`}</p>
      {!card && onFind && <button className="deck-find-button" type="button" onClick={onFind}>카드 찾기</button>}
    </div>
    <div className="deck-card-count"><span>덱 필요</span><b>{item.quantity}</b></div>
    <div className="deck-card-count"><span>보유</span><b>{item.ownedQuantity}</b></div>
    <div className={`deck-card-status ${item.missingQuantity > 0 ? 'short' : 'complete'}`}>
      {!card ? '⚠ 카드 연결 필요' : item.missingQuantity > 0 ? `⚠ ${item.missingQuantity}장 부족` : '✓ 보유 수량 충족'}
    </div>
  </article>;
}

function App() {
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof loadCards>> | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState<'all' | 'EN' | 'KR'>('KR');
  const [selectedRarities, setSelectedRarities] = useState<string[]>([]);
  const [selectedPrintings, setSelectedPrintings] = useState<string[]>([]);
  const [view, setView] = useState<'all' | 'owned' | 'missing'>('all');
  const [dark, setDark] = useState(true);
  const [deckPage, setDeckPage] = useState(false);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [savedDecks, setSavedDecks] = useState<Deck[]>([]);
  const [deckFormat, setDeckFormat] = useState<DeckFormat | null>(null);
  const [deckCardMappings, setDeckCardMappings] = useState<Record<string, string>>({});
  const [deckError, setDeckError] = useState('');
  const [deckText, setDeckText] = useState('');
  const [showDeckImport, setShowDeckImport] = useState(false);
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null);
  const [draftDeckName, setDraftDeckName] = useState('');
  const [activeDeckEntry, setActiveDeckEntry] = useState<number | null>(null);
  const [deckCandidateSearch, setDeckCandidateSearch] = useState('');
  const [selectedDeckCandidateId, setSelectedDeckCandidateId] = useState('');
  const [deckFilter, setDeckFilter] = useState<'all' | 'missing'>('all');
  const [selectedCardGroup, setSelectedCardGroup] = useState<CardGroup | null>(null);
  const [collectionMessage, setCollectionMessage] = useState('');
  const [codeMappings, setCodeMappings] = useState<Record<string, string>>({});
  const [importReview, setImportReview] = useState<ImportReview | null>(null);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  async function refreshCatalog(force = false, background = false) {
    if (!background || !catalog) setStatus('loading');
    setError('');
    try {
      const data = await loadCards({ force });
      setCatalog(data);
      const migrationMarker = 'riftbound-openrift-id-migration-v1';
      try {
        if (localStorage.getItem(migrationMarker) !== 'done') {
          const currentQty = readQty();
          const newIds = new Set(data.cards.map((card) => card.id));
          const oldKeys = Object.keys(currentQty).filter((id) => !newIds.has(id));
          if (oldKeys.length) {
            const legacy = await getLegacyCardCatalog();
            const migrated = migrateLegacyCollection(currentQty, legacy.cards, data.cards);
            setQty(migrated.quantities);
            localStorage.setItem(migrationMarker, 'done');
            setCollectionMessage(migrated.unmatchedIds.length
              ? `\uAE30\uC874 \uBCF4\uC720 \uC218\uB7C9 ${migrated.migratedIds}\uAC1C\uB97C OpenRift \uCE74\uB4DC\uC5D0 \uC5F0\uACB0\uD588\uC2B5\uB2C8\uB2E4. ${migrated.unmatchedIds.length}\uAC1C \uD56D\uBAA9\uC740 \uCE74\uB4DC\uB97C \uCC3E\uC9C0 \uBABB\uD558\uC5EC \uAE30\uC874 \uAC12\uC73C\uB85C \uBCF4\uC874\uD588\uC2B5\uB2C8\uB2E4.`
              : `\uAE30\uC874 Riftcodex \uBCF4\uC720 \uC218\uB7C9 ${migrated.migratedIds}\uAC1C\uB97C OpenRift\uB85C \uC774\uC804\uD588\uC2B5\uB2C8\uB2E4.`);
          } else localStorage.setItem(migrationMarker, 'done');
        }
      } catch {
        setCollectionMessage('OpenRift \uCE74\uB4DC \uBAA9\uB85D\uC740 \uBD88\uB7EC\uC654\uC9C0\uB9CC, \uC774\uC804 Riftcodex \uBCF4\uC720 \uC218\uB7C9\uC744 \uC5F0\uACB0\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uAE30\uC874 \uAC12\uC740 \uADF8\uB300\uB85C \uBCF4\uC874\uD588\uC2B5\uB2C8\uB2E4.');
      }
      setStatus('ready');
    } catch (cause) {
      setError(cause instanceof CardProviderError ? cause.message : '카드 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      if (!background || !catalog) setStatus('error');
    }
  }

  useEffect(() => {
    setQty(readQty());
    setSavedDecks(readSavedDecks(localStorage));
    setReady(true);
    try { setCodeMappings(readCardCodeMappings(localStorage)); } catch { setCodeMappings({}); }
    try { setDeckCardMappings(readDeckCardMappings(localStorage)); } catch { setDeckCardMappings({}); }
    try { const storedTheme = localStorage.getItem(THEME); if (storedTheme) setDark(storedTheme === 'dark'); } catch { setDark(true); }
    void refreshCatalog();
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = window.setInterval(() => { void refreshCatalog(true, true); }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (ready) { try { localStorage.setItem(THEME, dark ? 'dark' : 'light'); } catch { /* storage may be unavailable */ } }
  }, [dark, ready]);
  useEffect(() => {
    if (ready) { try { localStorage.setItem(COLLECTION_STORAGE_KEY, JSON.stringify(qty)); } catch { /* keep the current session usable */ } }
  }, [qty, ready]);
  useEffect(() => {
    if (ready) { try { writeSavedDecks(localStorage, savedDecks); } catch { /* saved decks remain usable in this session */ } }
  }, [savedDecks, ready]);

  const cards = catalog?.cards ?? [];
  const cardGroups = useMemo(() => buildCardGroups(cards, qty), [cards, qty]);
  const filtered = useMemo(() => cardGroups.filter((group) => {
    const card = group.primary;
    const haystack = group.printings.map((printing) => `${printing.name} ${(printing.localizedNames ?? []).join(' ')} ${printing.cardNumber ?? ''} ${printing.publicCode ?? ''} ${printing.collectorNumber ?? ''} ${printing.setCode}`).join(' ').toLocaleLowerCase();
    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLocaleLowerCase());
    const matchesSet = !selectedSets.length || group.printings.some((printing) => selectedSets.includes(printing.setCode));
    const matchesRegion = !selectedRegions.length || group.printings.some((printing) => selectedRegions.some((region) => printing.domains.includes(region)));
    const matchesLanguage = selectedLanguage === 'all' || card.language === selectedLanguage;
    const matchesRarity = !selectedRarities.length || group.printings.some((printing) => selectedRarities.includes(printing.rarity ?? 'Unknown'));
    const matchesPrinting = !selectedPrintings.length || group.printings.some((printing) => selectedPrintings.some((kind) => kind === 'promo' ? isPromoPrinting(printing) : !isPromoPrinting(printing) && (kind === 'foil' ? printing.finish?.toLowerCase() === 'foil' : printing.finish?.toLowerCase() !== 'foil')));
    return matchesSearch && matchesSet && matchesRegion && matchesLanguage && matchesRarity && matchesPrinting && (view === 'all' || (view === 'owned' ? group.totalQuantity > 0 : group.totalQuantity === 0));
  }), [cardGroups, search, selectedSets, selectedRegions, selectedLanguage, selectedRarities, selectedPrintings, view]);
  const detailGroup = selectedCardGroup ? cardGroups.find((group) => group.id === selectedCardGroup.id) ?? selectedCardGroup : null;
  const ownedKinds = cardGroups.filter((group) => group.totalQuantity > 0).length;
  const totalOwned = cards.reduce((total, card) => total + (qty[card.id] ?? 0), 0);
  const domains = catalog?.diagnostics.domains ?? [];
  const releaseOrderedSets = useMemo(() => [...(catalog?.sets ?? [])].sort((a, b) => {
    const dateFor = (set: CardSet) => {
      const dates = selectedLanguage === 'EN' ? [set.releaseDates?.EN ?? null]
        : selectedLanguage === 'KR' ? [set.releaseDates?.KR ?? null]
          : [set.releaseDates?.EN ?? null, set.releaseDates?.KR ?? null];
      return dates.filter((date): date is string => Boolean(date)).sort()[0] ?? '9999-99-99';
    };
    return dateFor(a).localeCompare(dateFor(b)) || a.code.localeCompare(b.code);
  }), [catalog?.sets, selectedLanguage]);
  const manualCandidates = useMemo(
    () => activeCode ? searchCardCandidates(candidateSearch || activeCode, cards).slice(0, 60) : [],
    [activeCode, candidateSearch, cards],
  );
  const deckComparison = useMemo(
    () => deck ? compareDeckWithCollection(deck, cards, qty) : null,
    [deck, cards, qty],
  );
  const visibleDeckCards = deckComparison?.cards.filter((entry) => deckFilter === 'all' || entry.missingQuantity > 0) ?? [];
  const deckCandidates = useMemo(
    () => {
      if (activeDeckEntry === null || !deck) return [];
      const entry = deck.cards[activeDeckEntry];
      if (!entry) return [];
      const originalQuery = entry.sourceName ?? entry.sourceCode ?? '';
      if (entry.candidateCardIds.length && normalizeDeckCardName(deckCandidateSearch) === normalizeDeckCardName(originalQuery)) {
        const ids = new Set(entry.candidateCardIds);
        return cards.filter((card) => ids.has(card.id));
      }
      return searchCardCandidates(deckCandidateSearch, cards).slice(0, 60);
    },
    [activeDeckEntry, deck, deckCandidateSearch, cards],
  );
  const deckSections = useMemo(() => {
    const sections: DeckSection[] = ['legend', 'champion', 'mainDeck', 'battlefields', 'runes', 'sideboard'];
    return sections.map((section) => ({ section, items: visibleDeckCards.filter((item) => item.section === section) })).filter((group) => group.items.length);
  }, [visibleDeckCards]);

  function toggle(values: string[], value: string, setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }
  function changeCount(id: string, count: number) {
    const safeCount = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
    setQty((previous) => ({ ...previous, [id]: safeCount }));
  }
  function resetCollection() {
    setQty({});
    setShowResetConfirm(false);
    setCollectionMessage('도감의 모든 보유 수량을 초기화했습니다. 저장된 CSV 매핑과 카드 정보는 유지됩니다.');
    try { resetCollectionStorage(localStorage); }
    catch { setCollectionMessage('화면의 보유 수량은 초기화했지만 브라우저 저장소에 기록하지 못했습니다.'); }
  }
  function importDeck() {
    setDeckError('');
    try {
      const loaded = parsePastedDeck(deckText, cards, undefined, deckCardMappings);
      const importedDeck: Deck = { ...loaded.deck, format: loaded.format };
      setSavedDecks((previous) => [importedDeck, ...previous]);
      setDeck(null);
      setDeckFormat(null);
      setDeckFilter('all');
      setDeckText('');
      setShowDeckImport(false);
      if (loaded.issues.length) setDeckError(`\uB371\uC744 \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4. \uC77C\uBD80 \uCE74\uB4DC \uD655\uC778\uC774 \uD544\uC694\uD569\uB2C8\uB2E4: ${loaded.issues.join(' \u00B7 ')}`);
    } catch (cause) {
      setDeckError(cause instanceof Error ? cause.message : '\uB371 \uB0B4\uC6A9\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.');
    }
  }
  function toggleDeckReview(savedDeck: Deck) {
    if (deck?.id === savedDeck.id) {
      setDeck(null);
      setDeckFormat(null);
      return;
    }
    setDeck(savedDeck);
    setDeckFormat(savedDeck.format ?? null);
    setDeckFilter('missing');
  }
  function beginRenameDeck(savedDeck: Deck) {
    setEditingDeckId(savedDeck.id);
    setDraftDeckName(savedDeck.name);
    setDeckError('');
  }
  function saveDeckName(id: string) {
    const name = draftDeckName.trim();
    if (!name) {
      setDeckError('\uB371 \uC774\uB984\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694.');
      return;
    }
    setSavedDecks((previous) => previous.map((saved) => saved.id === id ? { ...saved, name } : saved));
    setDeck((current) => current?.id === id ? { ...current, name } : current);
    setEditingDeckId(null);
    setDraftDeckName('');
  }
  function deleteSavedDeck(id: string) {
    if (!window.confirm('\uC774 \uC800\uC7A5\uB41C \uB371\uC744 \uC0AD\uC81C\uD560\uAE4C\uC694?')) return;
    setSavedDecks((previous) => previous.filter((saved) => saved.id !== id));
    setDeck((current) => current?.id === id ? null : current);
    if (deck?.id === id) setDeckFormat(null);
  }
  function openDeckMatch(entryIndex: number) {
    const entry = deck?.cards[entryIndex];
    if (!entry) return;
    setActiveDeckEntry(entryIndex);
    setDeckCandidateSearch(entry.sourceName ?? entry.sourceCode ?? '');
    setSelectedDeckCandidateId('');
  }
  function saveDeckMatch() {
    if (activeDeckEntry === null || !selectedDeckCandidateId) return;
    const card = cards.find((entry) => entry.id === selectedDeckCandidateId);
    if (!card) return;
    const matchedEntry = deck?.cards[activeDeckEntry];
    if (matchedEntry?.sourceKey) {
      const nextMappings = { ...deckCardMappings, [matchedEntry.sourceKey]: card.id };
      setDeckCardMappings(nextMappings);
      try { writeDeckCardMappings(localStorage, nextMappings); } catch { /* keep this session's selection */ }
    }
    if (deck) {
      const updatedDeck: Deck = {
        ...deck,
        cards: deck.cards.map((entry, index) => index === activeDeckEntry
          ? { ...entry, cardId: card.id, matchStatus: 'matched', candidateCardIds: [card.id] } : entry),
      };
      setDeck(updatedDeck);
      setSavedDecks((previous) => previous.map((saved) => saved.id === updatedDeck.id ? updatedDeck : saved));
    }
    setActiveDeckEntry(null);
    setSelectedDeckCandidateId('');
  }
  async function importCollection(file: File | undefined, input: HTMLInputElement) {
    setCollectionMessage('');
    setImportReview(null);
    setActiveCode(null);
    setSelectedCandidateId('');
    try {
      if (!file) return;
      if (!file.name.toLocaleLowerCase().endsWith('.csv')) throw new CollectionCsvError('CSV 파일만 가져올 수 있습니다.');
      const preview = previewCollectionCsv(await file.text(), cards, codeMappings);
      if (preview.matchedKinds > 0) setQty((current) => mergeCollectionQuantities(current, preview.quantities));
      setImportReview({
        autoRegistered: preview.matchedKinds,
        rows: preview.unmatchedRows.map(({ code, qty }) => ({ code, qty, cardId: null })),
      });
      const details = [
        `자동 등록 ${preview.matchedKinds}종`,
        `자동 등록 수량 ${preview.totalQuantity}장`,
        preview.unmatchedCodes.length ? `확인 필요 ${preview.unmatchedCodes.length}개` : '',
        preview.duplicateCodes.length ? `중복 Code(마지막 유효 Qty 적용): ${preview.duplicateCodes.join(', ')}` : '',
        preview.invalidRows ? `잘못된 Qty 행 ${preview.invalidRows}개 제외` : '',
      ].filter(Boolean).join(' · ');
      setCollectionMessage(`가져오기 완료 · ${details}`);
    } catch (cause) {
      setCollectionMessage(cause instanceof Error ? cause.message : 'CSV를 읽지 못했습니다.');
    } finally {
      input.value = '';
    }
  }
  function openManualMatch(code: string) {
    setActiveCode(code);
    setCandidateSearch(code);
    setSelectedCandidateId('');
  }
  function saveManualMatch() {
    if (!activeCode || !selectedCandidateId || !importReview) return;
    const row = importReview.rows.find((entry) => entry.code === activeCode && !entry.cardId);
    const card = cards.find((entry) => entry.id === selectedCandidateId);
    if (!row || !card) return;
    const normalizedCode = normalizeCardNumber(row.code);
    const nextMappings = addManualCardCodeMapping(codeMappings, normalizedCode, card.id);
    let persisted = true;
    try { writeCardCodeMappings(localStorage, nextMappings); } catch { persisted = false; }
    setCodeMappings(nextMappings);
    setQty((current) => applyManualCardQuantity(current, card.id, row.qty));
    setImportReview((current) => current ? {
      ...current,
      rows: current.rows.map((entry) => entry.code === row.code ? { ...entry, cardId: card.id } : entry),
    } : current);
    setCollectionMessage(persisted
      ? `${row.code}을(를) ${card.name}에 연결하고 ${row.qty}장의 수량을 적용했습니다.`
      : `${row.code}을(를) ${card.name}에 연결하고 수량을 적용했지만 매핑을 저장하지 못했습니다.`);
    setActiveCode(null);
    setSelectedCandidateId('');
  }
  function exportCollection() {
    const rows = cards
      .filter((card) => (qty[card.id] ?? 0) > 0 && normalizeCardNumber(cardPrintingCode(card)))
      .map((card) => ({ code: cardPrintingCode(card), qty: qty[card.id] ?? 0 }))
      .sort((a, b) => a.code.localeCompare(b.code));
    if (!rows.length) {
      setCollectionMessage('내보낼 보유 카드가 없습니다.');
      return;
    }
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const blob = new Blob([serializeCollectionCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `riftbound-collection-${date}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setCollectionMessage(`보유 카드 ${rows.length}종을 CSV로 내보냈습니다.`);
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setDeckPage(false); }}>RIFTBOUND<span>COLLECTION</span></a>
      <nav aria-label="주 메뉴"><button className={!deckPage ? 'nav-active' : ''} onClick={() => setDeckPage(false)}>카드</button><button className={deckPage ? 'nav-active' : ''} onClick={() => setDeckPage(true)}>덱</button></nav>
      <div className="nav-actions"><button className="icon-button" aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'} onClick={() => setDark(!dark)}>{dark ? '☀' : '☾'}</button><button className="icon-button account" aria-label="계정 기능 준비 중" title="계정 기능 준비 중">◉</button></div>
    </header>
    {deckPage ? <main className="content deck-page">
      <div className="heading"><div><div className="kicker">RIFTBOUND / DECKS</div><h1>덱 빌더</h1><p>외부 덱 목록을 붙여넣어 현재 컬렉션과 비교합니다.</p></div><button type="button" className="deck-import-launch" disabled={status !== 'ready'} onClick={() => { setDeckError(''); setShowDeckImport(true); }}>{'\uB371 \uBD88\uB7EC\uC624\uAE30'}</button></div>
      {deckError && <div className="deck-error" role="alert">{deckError}</div>}
      {showDeckImport && <div className="modal-backdrop deck-import-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDeckImport(false); }}><section className="match-dialog deck-import-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-import-title"><header className="deck-import-heading"><div><span className="kicker">IMPORT DECK</span><h2 id="deck-import-title">{'\uC678\uBD80 \uB371 \uBD99\uC5EC\uB123\uAE30'}</h2></div><button type="button" className="card-detail-close" aria-label="Close import dialog" onClick={() => setShowDeckImport(false)}>&times;</button></header><p>{'\uB2E4\uB978 \uC0AC\uC774\uD2B8\uC5D0\uC11C \uB0B4\uBCF4\uB0B8 \uB371 \uBAA9\uB85D\uC744 \uC544\uB798\uC5D0 \uBD99\uC5EC\uB123\uC73C\uC138\uC694. \uC800\uC7A5\uD558\uBA74 \uB371 \uBAA9\uB85D\uC5D0 \uCD94\uAC00\uB429\uB2C8\uB2E4.'}</p><label className="deck-import-input-label" htmlFor="deck-import-text">{'\uB371 \uB0B4\uC6A9'}</label><textarea id="deck-import-text" autoFocus value={deckText} onChange={(event) => setDeckText(event.target.value)} placeholder={'Legend:\n1 Card name\n\nChampion:\n1 Card name\n\nMain Deck:\n3 Card name\n\nor OGN-027-1'} rows={12} /><small className="deck-import-help">RB1| compressed strings are not supported.</small><div className="dialog-actions"><button type="button" onClick={() => setShowDeckImport(false)}>{'\uCDE8\uC18C'}</button><button type="button" className="primary-action" disabled={!deckText.trim()} onClick={importDeck}>{'\uC800\uC7A5\uD558\uAE30'}</button></div></section></div>}
      {status === 'loading' && <div className="status-panel" role="status"><span className="spinner" /> {'\uC774\uBBF8\uC9C0 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.'}</div>}
      {status === 'error' && <div className="status-panel error-panel" role="alert"><div><b>카드 정보를 불러오지 못했습니다</b><p>{error}</p><small>카드 데이터가 로드되면 붙여넣은 덱을 비교할 수 있습니다.</small></div><button className="solid" onClick={() => void refreshCatalog(true)}>다시 시도</button></div>}
      
      {<section className="saved-deck-library" aria-label="Saved decks">
        <div className="saved-deck-library-heading"><h2>{'\uC800\uC7A5\uD55C \uB371'}</h2><span>{savedDecks.length} {'\uAC1C'}</span></div>
        <div className="saved-deck-list">
          {savedDecks.map((saved) => {
            const selected = deck?.id === saved.id;
            const totalCards = saved.cards.reduce((sum, entry) => sum + entry.quantity, 0);
            const heroEntry = saved.cards.find((entry) => entry.section === 'legend' && entry.cardId) ??
              saved.cards.find((entry) => entry.section === 'champion' && entry.cardId) ??
              saved.cards.find((entry) => entry.cardId);
            const heroCard = heroEntry?.cardId ? cards.find((card) => card.id === heroEntry.cardId) : undefined;
            const editing = editingDeckId === saved.id;
            return <article className={`saved-deck-card ${selected ? 'selected' : ''}`} key={saved.id}>
              <div className="saved-deck-main"><div className="saved-deck-hero">{heroCard?.imageUrl ? <img src={heroCard.imageUrl} alt={heroCard.name} loading="lazy" referrerPolicy="no-referrer" /> : <div className="saved-deck-hero-empty">{heroEntry?.section === 'legend' ? 'LEGEND' : 'CHAMPION'}</div>}</div><div className="saved-deck-info">{editing ? <form className="saved-deck-rename" onSubmit={(event) => { event.preventDefault(); saveDeckName(saved.id); }}><input autoFocus aria-label="Deck name" value={draftDeckName} onChange={(event) => setDraftDeckName(event.target.value)} maxLength={80} /><button type="submit">{'\uC800\uC7A5'}</button><button type="button" onClick={() => { setEditingDeckId(null); setDraftDeckName(''); }}>{'\uCDE8\uC18C'}</button></form> : <><h3>{saved.name}</h3><span>{saved.cards.length} {'\uC885'} {'\u00B7'} {totalCards} {'\uC7A5'}</span></>}</div></div>
              <div className="saved-deck-actions">{!editing && <button type="button" className="rename-deck-button" onClick={() => beginRenameDeck(saved)}>{'\uC774\uB984 \uC218\uC815'}</button>}<button type="button" className="review-deck-button" disabled={status !== 'ready'} aria-expanded={selected} onClick={() => toggleDeckReview(saved)}>{selected ? '\uBD80\uC871 \uC218\uB7C9 \uC228\uAE30\uAE30' : '\uBD80\uC871 \uC218\uB7C9 \uD655\uC778\uD558\uAE30'}</button><button type="button" className="delete-deck-button" onClick={() => deleteSavedDeck(saved.id)}>{'\uC0AD\uC81C'}</button></div>
            </article>;
          })}
          {savedDecks.length === 0 && <p className="saved-decks-empty">{'\uC544\uC9C1 \uC800\uC7A5\uD55C \uB371\uC774 \uC5C6\uC2B5\uB2C8\uB2E4. \uC678\uBD80 \uB371\uC744 \uAC00\uC838\uC624\uBA74 \uC5EC\uAE30\uC5D0 \uBCF4\uAD00\uB429\uB2C8\uB2E4.'}</p>}
        </div>
      </section>}
      {status === 'ready' && deck && deckComparison && <>
        <section className="deck-title-bar"><div><div className="kicker">CURRENT DECK</div><h2>{deck.name}</h2><small className="deck-format-label">감지 형식: {deckFormat === 'korean-sections' ? '섹션 기반 한국어' : deckFormat === 'english-sections' ? '섹션 기반 영어' : 'Code-수량 토큰'}</small></div><span>{deckComparison.totalRequired.toLocaleString()}장 필요</span></section>
        <section className="deck-summary" aria-label="덱 보유 현황">
          <div><span>카드 종류</span><b>{deckComparison.totalKinds.toLocaleString()}종</b></div>
          <div><span>필요 카드</span><b>{deckComparison.totalRequired.toLocaleString()}장</b></div>
          <div><span>보유 충족</span><b>{deckComparison.fulfilledKinds.toLocaleString()}종</b></div>
          <div className={deckComparison.missingKinds ? 'deck-stat-alert' : ''}><span>부족 카드</span><b>{deckComparison.missingKinds.toLocaleString()}종</b></div>
          <div className={deckComparison.missingTotal ? 'deck-stat-alert' : ''}><span>부족 수량</span><b>{deckComparison.missingTotal.toLocaleString()}장</b></div>
        </section>
        <div className="deck-list-toolbar"><div className="view-tabs" role="tablist" aria-label="덱 카드 표시"><button role="tab" aria-selected={deckFilter === 'all'} className={deckFilter === 'all' ? 'active' : ''} onClick={() => setDeckFilter('all')}>전체</button><button role="tab" aria-selected={deckFilter === 'missing'} className={deckFilter === 'missing' ? 'active' : ''} onClick={() => setDeckFilter('missing')}>부족 카드</button></div><span>{visibleDeckCards.length} / {deckComparison.totalKinds}종 표시</span></div>
        {deckSections.map(({ section, items }) => <section className="deck-section-group" key={section} aria-label={DECK_SECTION_LABELS[section]}><h3>{DECK_SECTION_LABELS[section]} <span>{items.length}종</span></h3><div className="deck-card-list">{items.map((item) => <DeckCardRow key={`${item.entryIndex}-${item.cardId ?? item.sourceName ?? item.sourceCode}`} item={item} section={DECK_SECTION_LABELS[item.section]} onFind={!item.card ? () => openDeckMatch(item.entryIndex) : undefined} />)}</div></section>)}
        {visibleDeckCards.length === 0 && <div className="no-results">부족한 카드가 없습니다. 현재 덱의 수량을 모두 보유하고 있습니다.</div>}
      </>}
      <footer className="page-footer"><span>RIFTBOUND</span><span>{'\uC800\uC7A5\uD55C \uB371\uC740 \uC774 \uBE0C\uB77C\uC6B0\uC800\uC5D0 \uBCF4\uAD00\uB418\uBA70, \uCEEC\uB809\uC158 \uBCF4\uC720 \uC218\uB7C9\uACFC \uBE44\uAD50\uB429\uB2C8\uB2E4.'}</span></footer>
    </main> : <main className="content">
      <div className="heading"><div><div className="kicker">CARD LIBRARY <span>•</span> COLLECTION</div><h1>카드 도감</h1></div></div>
      <section className="filter-box" aria-label="검색 및 필터"><div className="search-row">
        <label className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="카드 이름 또는 번호 검색" aria-label="카드 이름 또는 번호 검색" />{search && <button aria-label="검색어 지우기" onClick={() => setSearch('')}>×</button>}</label>
        <div className="filter-groups"><div className="filter-group"><span className="filter-label">{'\uC5B8\uC5B4'}</span><div className="chips">{([['all', '\uC804\uCCB4'], ['EN', 'English'], ['KR', '\uD55C\uAD6D\uC5B4']] as const).map(([language, label]) => <button key={language} type="button" aria-pressed={selectedLanguage === language} className={`chip ${selectedLanguage === language ? 'chosen' : ''}`} onClick={() => setSelectedLanguage(language)}>{label}</button>)}</div></div><div className="filter-group"><span className="filter-label">세트</span><div className="chips">{releaseOrderedSets.map((set) => <button key={set.id} aria-pressed={selectedSets.includes(set.code)} className={`chip ${selectedSets.includes(set.code) ? 'chosen' : ''}`} onClick={() => toggle(selectedSets, set.code, setSelectedSets)} title={set.name}>{set.code}</button>)}</div></div>
          <div className="filter-group region-group"><span className="filter-label">영역</span><div className="domain-dots">{[...domainOrder.filter((name) => domains.some((domain) => domain.toLocaleLowerCase() === name.toLocaleLowerCase())), ...domains.filter((domain) => !domainOrder.some((name) => domain.toLocaleLowerCase() === name.toLocaleLowerCase()))].map((domain) => <button key={domain} type="button" aria-label={domain} aria-pressed={selectedRegions.includes(domain)} className="domain-dot" style={{ '--domain-color': domainColors[domain.toLocaleLowerCase()] ?? '#9b9d96' } as React.CSSProperties} onClick={() => toggle(selectedRegions, domain, setSelectedRegions)} title={domain} />)}</div></div>
        </div>
      </div><div className="catalog-filter-rows">
        <div className="filter-group"><span className="filter-label">Rarity</span><div className="chips">{[...new Set(cards.map((card) => card.rarity).filter((rarity): rarity is string => Boolean(rarity)))].sort((a, b) => a.localeCompare(b)).map((rarity) => <button key={rarity} type="button" aria-pressed={selectedRarities.includes(rarity)} className={`chip ${selectedRarities.includes(rarity) ? 'chosen' : ''}`} onClick={() => toggle(selectedRarities, rarity, setSelectedRarities)}>{rarity}</button>)}</div></div>
        <div className="filter-group"><span className="filter-label">Printing</span><div className="chips">{([['standard', 'Standard'], ['foil', 'Foil'], ['promo', 'Promo']] as const).map(([kind, label]) => <button key={kind} type="button" aria-pressed={selectedPrintings.includes(kind)} className={`chip ${selectedPrintings.includes(kind) ? 'chosen' : ''}`} onClick={() => toggle(selectedPrintings, kind, setSelectedPrintings)}>{label}</button>)}</div></div>
      </div></section>
      {status === 'loading'  && <div className="status-panel" role="status"><span className="spinner" /> {'\uC774\uBBF8\uC9C0 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4.'}</div>}
      {status === 'error' && <div className="status-panel error-panel" role="alert"><div><b>카드 데이터를 불러오지 못했습니다</b><p>{error}</p><small>저장된 보유 수량은 변경하거나 삭제하지 않았습니다.</small></div><button className="solid" onClick={() => void refreshCatalog(true)}>다시 시도</button></div>}
      {status === 'ready' && <>
        <section className="collection-bar"><div className="collection-controls"><div className="view-tabs" role="tablist" aria-label="카드 보기">{([['all', '전체 도감'], ['owned', '보유 중'], ['missing', '미보유']] as const).map(([key, label]) => <button role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} key={key} onClick={() => setView(key)}>{label}</button>)}</div><div className="csv-actions"><input ref={importInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void importCollection(event.currentTarget.files?.[0], event.currentTarget)} /><button type="button" onClick={() => importInput.current?.click()}>도감 가져오기</button><button type="button" onClick={exportCollection}>도감 내보내기</button><button type="button" onClick={() => setShowResetConfirm(true)}>도감 초기화</button></div></div><div className="summary"><span><b>{ownedKinds.toLocaleString()}</b>종 보유</span><i /><span><b>{totalOwned.toLocaleString()}</b>장 보유</span><i /><span><b>{filtered.length.toLocaleString()}</b>장 표시</span></div></section>
        {collectionMessage && <p className="collection-message" role="status">{collectionMessage}</p>}
        {importReview && <section className="import-review" aria-labelledby="import-review-title"><div className="import-review-heading"><h2 id="import-review-title">CSV 가져오기 완료</h2><button type="button" aria-label="가져오기 결과 닫기" onClick={() => setImportReview(null)}>닫기</button></div><p><b>등록 성공: {importReview.autoRegistered + importReview.rows.filter((row) => row.cardId).length}개</b><span>매칭되지 않은 카드: {importReview.rows.filter((row) => !row.cardId).length}개</span></p>{importReview.rows.length > 0 && <><small>아래 카드는 도감에 자동 등록하지 않았습니다. 카드 찾기에서 직접 선택하면 수량이 적용됩니다.</small><ul>{importReview.rows.map((row) => { const card = row.cardId ? cards.find((entry) => entry.id === row.cardId) : null; return <li key={row.code}><span>{card ? `✓ ${row.code} → ${card.name}` : row.code}<small>{row.qty}장</small></span>{!row.cardId && <button type="button" onClick={() => openManualMatch(row.code)}>카드 찾기</button>}</li>; })}</ul></>}</section>}
        {detailGroup && <div className="modal-backdrop card-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedCardGroup(null); }}><section className="card-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="card-detail-title"><header className="card-detail-heading"><div><span className="kicker">PRINTINGS | {detailGroup.printings.length}</span><h2 id="card-detail-title">{detailGroup.primary.name}</h2><p>{detailGroup.primary.setCode} | {detailGroup.primary.publicCode ?? detailGroup.primary.cardNumber} | {detailGroup.primary.language}</p></div><button type="button" className="card-detail-close" aria-label="Close details" onClick={() => setSelectedCardGroup(null)}>X</button></header><div className="card-detail-content"><div className="card-detail-art">{detailGroup.primary.imageUrl && <img className={isBattlefieldCard(detailGroup.primary) ? 'battlefield-image' : undefined} src={detailGroup.primary.imageUrl} alt={detailGroup.primary.imageAlt ?? detailGroup.primary.name} />}</div><div className="card-detail-list"><div className="card-detail-list-heading"><b>PRINTINGS</b><span>{detailGroup.totalQuantity} total owned</span></div>{detailGroup.printings.map((printing) => <div className={`printing-row ${printing.id === detailGroup.primary.id ? 'base-printing' : ''}`} key={printing.id}><div className="printing-thumb">{printing.imageUrl && <img src={printing.imageUrl} alt="" />}</div><div className="printing-meta"><b>{printingLabel(printing)}{printing.id === detailGroup.primary.id ? ' | Base' : ''}</b><small>{printing.publicCode ?? printing.cardNumber} | {printing.language}</small><small>{printing.distributionChannels?.join(', ')}</small></div><div className="printing-quantity"><button type="button" aria-label={`Decrease ${printingLabel(printing)} quantity`} disabled={(qty[printing.id] ?? 0) === 0} onClick={() => changeCount(printing.id, (qty[printing.id] ?? 0) - 1)}>-</button><input type="number" min="0" step="1" aria-label={`${printingLabel(printing)} quantity`} value={qty[printing.id] ?? 0} onChange={(event) => changeCount(printing.id, Number(event.target.value))} /><button type="button" aria-label={`Increase ${printingLabel(printing)} quantity`} onClick={() => changeCount(printing.id, (qty[printing.id] ?? 0) + 1)}>+</button></div></div>)}</div></div></section></div>}{showResetConfirm && <div className="modal-backdrop"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title"><h2 id="reset-dialog-title">도감을 초기화하시겠습니까?</h2><p>현재 등록된 모든 보유 수량이 삭제됩니다.<br />이 작업은 되돌릴 수 없습니다.</p><div><button type="button" onClick={() => setShowResetConfirm(false)}>취소</button><button type="button" className="danger-action" onClick={resetCollection}>초기화</button></div></section></div>}
        {activeDeckEntry !== null && deck && <div className="modal-backdrop"><section className="match-dialog" role="dialog" aria-modal="true" aria-labelledby="deck-match-title"><h2 id="deck-match-title">{deck.cards[activeDeckEntry]?.sourceName ?? deck.cards[activeDeckEntry]?.sourceCode ?? '카드 찾기'}</h2><p>현재 카드 목록에서 연결할 카드를 선택하세요. 컬렉션 수량은 변경되지 않습니다.</p><label className="candidate-search">카드 이름 또는 번호<input autoFocus value={deckCandidateSearch} onChange={(event) => { setDeckCandidateSearch(event.target.value); setSelectedDeckCandidateId(''); }} placeholder="이름, 카드 번호 또는 세트 검색" /></label><div className="candidate-list" role="radiogroup" aria-label="덱 카드 후보">{deckCandidates.map((card) => <label className={`candidate-option ${selectedDeckCandidateId === card.id ? 'selected' : ''}`} key={card.id}><input type="radio" name="deck-card-match" value={card.id} checked={selectedDeckCandidateId === card.id} onChange={() => setSelectedDeckCandidateId(card.id)} /><span><b>{card.name}</b><small>cardNumber: {card.cardNumber ?? '없음'} · collectorNumber: {card.collectorNumber ?? '없음'} · Set: {card.setCode}</small></span></label>)}{deckCandidates.length === 0 && <p className="candidate-empty">후보가 없습니다. 카드 이름이나 번호를 바꿔 검색해 보세요.</p>}</div><div className="dialog-actions"><button type="button" onClick={() => setActiveDeckEntry(null)}>취소</button><button type="button" className="primary-action" disabled={!selectedDeckCandidateId} onClick={saveDeckMatch}>선택</button></div></section></div>}
        {activeCode && <div className="modal-backdrop"><section className="match-dialog" role="dialog" aria-modal="true" aria-labelledby="match-dialog-title"><h2 id="match-dialog-title">{activeCode}</h2><p>이 Code에 해당하는 카드를 선택하세요.</p><label className="candidate-search">카드 이름 또는 번호<input autoFocus value={candidateSearch} onChange={(event) => { setCandidateSearch(event.target.value); setSelectedCandidateId(''); }} placeholder="이름, 카드 번호 또는 세트 검색" /></label><div className="candidate-list" role="radiogroup" aria-label="카드 후보">{manualCandidates.map((card) => <label className={`candidate-option ${selectedCandidateId === card.id ? 'selected' : ''}`} key={card.id}><input type="radio" name="manual-card-match" value={card.id} checked={selectedCandidateId === card.id} onChange={() => setSelectedCandidateId(card.id)} /><span><b>{card.name}</b><small>cardNumber: {card.cardNumber ?? '없음'} · collectorNumber: {card.collectorNumber ?? '없음'} · Set: {card.setCode}</small></span></label>)}{manualCandidates.length === 0 && <p className="candidate-empty">후보가 없습니다. 카드 이름이나 번호를 바꿔 검색해 보세요.</p>}</div><div className="dialog-actions"><button type="button" onClick={() => setActiveCode(null)}>취소</button><button type="button" className="primary-action" disabled={!selectedCandidateId} onClick={saveManualMatch}>선택</button></div></section></div>}
        <div className="results-head"><span>{filtered.length.toLocaleString()} cards</span>{(search || selectedSets.length || selectedRegions.length || selectedLanguage !== 'KR' || selectedRarities.length || selectedPrintings.length) ? <button onClick={() => { setSearch(''); setSelectedSets([]); setSelectedRegions([]); setSelectedLanguage('KR'); setSelectedRarities([]); setSelectedPrintings([]); }}>필터 초기화 <span>↗</span></button> : <span />}</div>
        <section className="card-grid" aria-label="Card catalog">{filtered.map((group) => <CardTile key={group.id} group={group} qty={qty[group.primary.id] ?? 0} onCount={changeCount} onOpen={setSelectedCardGroup} />)}</section>
        {filtered.length === 0 && <div className="no-results">현재 검색과 필터 조건에 맞는 카드가 없습니다.</div>}
      </>}
      {import.meta.env.DEV && catalog && <details className="diagnostics"><summary>개발 진단 정보</summary><p>카드: {catalog.diagnostics.cardCount.toLocaleString()} / API {catalog.diagnostics.apiCardCount.toLocaleString()} · 페이지 {catalog.diagnostics.cardPages}</p><p>세트: {catalog.diagnostics.setCount} / API {catalog.diagnostics.apiSetCount} · 페이지 {catalog.diagnostics.setPages}</p><p>영역: {catalog.diagnostics.domains.join(', ') || '없음'} · 중복 ID: {catalog.diagnostics.duplicateIds} · ID 누락으로 제외: {catalog.diagnostics.cardsSkippedWithoutId}</p><p>세트별 카드 수: {catalog.sets.map((set) => `${set.code} ${set.cardCount ?? '?'}`).join(' · ')}</p></details>}
      <footer className="page-footer"><span>RIFTBOUND</span><span>카드 정보 및 이미지는 OpenRift에서 불러옵니다. Riot Games는 이 프로젝트를 후원하거나 보증하지 않습니다.</span></footer>
    </main>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
