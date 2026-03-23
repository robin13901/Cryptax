import type { TransactionListItem, TransactionPageResponse } from '@cryptax/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import TransactionFilters, { DEFAULT_FILTERS, type FilterState } from './TransactionFilters';
import TransactionRow from './TransactionRow';
import './TransactionList.css';

type SortColumn = 'tradedAt' | 'amount' | 'symbol' | 'canonicalType';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

const COLUMNS: { key: SortColumn | null; label: string }[] = [
  { key: 'tradedAt', label: 'Datum' },
  { key: 'symbol', label: 'Coin' },
  { key: 'canonicalType', label: 'Typ' },
  { key: null, label: 'Richtung' },
  { key: 'amount', label: 'Menge' },
  { key: null, label: 'EUR Wert' },
  { key: null, label: 'Gebühr' },
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
      if (filters.type) p.set('canonicalType', filters.type);
      if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) p.set('dateTo', filters.dateTo);
      return p;
    },
    [filters, sortBy, sortDir],
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

        const data: TransactionPageResponse = await res.json() as TransactionPageResponse;

        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(currentOffset + data.items.length);

        // Extract years for filter dropdown on first load
        if (!append && availableYears.length === 0) {
          const years = [...new Set(data.items.map((i) => i.taxYear))].sort((a, b) => b - a);
          if (years.length) setAvailableYears(years);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setError('Fehler beim Laden der Transaktionen.');
      } finally {
        setLoading(false);
        setInitialLoading(false);
      }
    },
    [buildParams, availableYears.length],
  );

  // Reset and reload when filters / sort changes
  useEffect(() => {
    setItems([]);
    setOffset(0);
    setHasMore(false);
    void fetchPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sortBy, sortDir]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          void fetchPage(offset, true);
        }
      },
      { threshold: 0.1 },
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

  const getSortIndicator = (col: SortColumn | null) => {
    if (col === null || col !== sortBy) return null;
    return <span className="tx-sort-indicator">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  };

  return (
    <div className="tx-list-container">
      <div className="tx-list-header">
        <h2 className="tx-list-title">Transaktionen</h2>
        {!initialLoading && (
          <span className="tx-list-count">
            {total.toLocaleString('de-DE')} gesamt
          </span>
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
              {COLUMNS.map((col, i) => (
                <th
                  key={i}
                  className={`tx-th${col.key ? ' tx-th--sortable' : ''}${col.key === sortBy ? ' tx-th--active' : ''}`}
                  onClick={col.key ? () => handleSort(col.key!) : undefined}
                  tabIndex={col.key ? 0 : undefined}
                  onKeyDown={
                    col.key
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') handleSort(col.key!);
                        }
                      : undefined
                  }
                  aria-sort={
                    col.key && col.key === sortBy
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {col.label}
                  {col.key && getSortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {initialLoading ? (
              <tr>
                <td colSpan={7} className="tx-loading-cell">
                  <div className="tx-skeleton-rows">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="tx-skeleton-row" />
                    ))}
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="tx-empty-cell">
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
    </div>
  );
};

export default TransactionList;
