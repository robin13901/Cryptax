import type { TransactionListItem, TransactionPageResponse } from '@cryptax/shared';
import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import TransactionDetail from './TransactionDetail';
import TransactionFilters, { DEFAULT_FILTERS, type FilterState } from './TransactionFilters';
import TransactionRow from './TransactionRow';
import './TransactionList.css';

type SortColumn = 'tradedAt' | 'amount' | 'symbol' | 'canonicalType';
type SortDir = 'asc' | 'desc';
export type CurrencyMode = 'eur' | 'token';

const PAGE_SIZE = 50;
const COL_COUNT = 10;

interface ColumnDef {
  key: SortColumn | null;
  label: string;
  toggleable?: boolean;
  numeric?: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: 'tradedAt', label: 'Datum' },
  { key: 'symbol', label: 'Coin' },
  { key: null, label: 'Paar' },
  { key: 'canonicalType', label: 'Typ' },
  { key: null, label: 'Richtung' },
  { key: 'amount', label: 'Anteile', numeric: true },
  { key: null, label: 'Kurs', toggleable: true, numeric: true },
  { key: null, label: 'Wert', toggleable: true, numeric: true },
  { key: null, label: 'P&L', toggleable: true, numeric: true },
  { key: null, label: 'Gebühr', toggleable: true, numeric: true },
];

const TransactionList = () => {
  const [items, setItems] = useState<TransactionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<SortColumn>('tradedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('eur');

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Build URL search params from current state
  const buildParams = useCallback(
    (currentOffset: number): URLSearchParams => {
      const p = new URLSearchParams();
      p.set('limit', String(PAGE_SIZE));
      p.set('offset', String(currentOffset));
      p.set('sortBy', sortBy);
      p.set('sortDir', sortDir);
      if (filters.search) p.set('search', filters.search);
      if (filters.year) p.set('year', filters.year);
      if (filters.type) p.set('type', filters.type);
      if (filters.coin) p.set('coin', filters.coin);
      if (filters.dateFrom) p.set('from', filters.dateFrom);
      if (filters.dateTo) p.set('to', filters.dateTo);
      return p;
    },
    [filters, sortBy, sortDir]
  );

  // Fetch a page, optionally appending to existing list
  const fetchPage = useCallback(
    async (currentOffset: number, append: boolean) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      if (!append) setInitialLoading(true);
      setError(null);

      try {
        const params = buildParams(currentOffset);
        const res = await fetch(`/api/transactions?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data: TransactionPageResponse = (await res.json()) as TransactionPageResponse;

        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(currentOffset + data.items.length);

        // Use backend-provided available years
        if (data.availableYears?.length) {
          setAvailableYears(data.availableYears);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError('Fehler beim Laden der Transaktionen.');
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    },
    [buildParams]
  );

  // Reset and reload when filters / sort changes
  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(false);
    void fetchPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          void fetchPage(offset, true);
        }
      },
      { threshold: 0.1 }
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => {
      observerRef.current?.disconnect();
    };
  }, [hasMore, loading, offset, fetchPage]);

  const handleSort = (col: SortColumn) => {
    if (col === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const handleFiltersChange = (newFilters: FilterState) => {
    setFilters(newFilters);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedId === null) return;
    const idx = items.findIndex((i) => i.id === selectedId);
    if (idx === -1) return;
    const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (nextIdx >= 0 && nextIdx < items.length) {
      setSelectedId(items[nextIdx]?.id);
    }
  };

  const selectedIdx = selectedId !== null ? items.findIndex((i) => i.id === selectedId) : -1;
  const hasPrev = selectedIdx > 0;
  const hasNext = selectedIdx >= 0 && selectedIdx < items.length - 1;

  const toggleCurrencyMode = () => setCurrencyMode((m) => (m === 'eur' ? 'token' : 'eur'));

  const getSortIndicator = (col: SortColumn | null) => {
    if (col === null || col !== sortBy) return null;
    return <span className="tx-sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <div className="tx-list-container">
      <div className="tx-list-header">
        <h2 className="tx-list-title">Transaktionen</h2>
        {!initialLoading && (
          <span className="tx-list-count">{total.toLocaleString('de-DE')} gesamt</span>
        )}
      </div>

      <TransactionFilters
        filters={filters}
        onChange={handleFiltersChange}
        availableYears={availableYears}
      />

      {error && <div className="tx-error">{error}</div>}

      <div className="tx-table-wrapper">
        <table className="tx-table" aria-label="Transaktionsliste">
          <thead>
            <tr>
              {COLUMNS.map((col, i) => {
                const isSortable = !!col.key;
                const isToggleable = !!col.toggleable;
                const isActive = col.key === sortBy;
                const clickable = isSortable || isToggleable;
                return (
                  <th
                    key={i}
                    className={`tx-th${isSortable ? ' tx-th--sortable' : ''}${isActive ? ' tx-th--active' : ''}${isToggleable ? ' tx-th--toggleable' : ''}${col.numeric ? ' tx-th--numeric' : ''}`}
                    onClick={
                      isSortable
                        ? () => handleSort(col.key!)
                        : isToggleable
                          ? toggleCurrencyMode
                          : undefined
                    }
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={
                      clickable
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              if (isSortable) handleSort(col.key!);
                              else toggleCurrencyMode();
                            }
                          }
                        : undefined
                    }
                    aria-sort={
                      col.key && isActive
                        ? sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {col.label}
                    {isSortable && getSortIndicator(col.key)}
                    {isToggleable && (
                      <span className="tx-currency-badge">
                        {currencyMode === 'eur' ? '€' : 'Token'}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {initialLoading ? (
              <tr>
                <td colSpan={COL_COUNT} className="tx-loading-cell">
                  <div className="tx-skeleton-rows">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="tx-skeleton-row" />
                    ))}
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={COL_COUNT} className="tx-empty-cell">
                  Keine Transaktionen gefunden
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <TransactionRow
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  onSelect={setSelectedId}
                  currencyMode={currencyMode}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="tx-sentinel" aria-hidden="true" />

      {loading && !initialLoading && (
        <div className="tx-loading-more">
          <span className="tx-loading-spinner" />
          Lade weitere Transaktionen...
        </div>
      )}

      {!hasMore && items.length > 0 && !loading && (
        <div className="tx-end-marker">
          Alle {total.toLocaleString('de-DE')} Transaktionen geladen
        </div>
      )}

      {/* Transaction detail slide-in panel */}
      <AnimatePresence>
        {selectedId !== null && (
          <TransactionDetail
            transactionId={selectedId}
            onClose={() => setSelectedId(null)}
            onNavigate={handleNavigate}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default TransactionList;
