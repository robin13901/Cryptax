import type { CanonicalType } from '@cryptax/shared';
import { useEffect, useRef, useState } from 'react';
import './TransactionFilters.css';

export interface FilterState {
  year: string;
  type: string;
  coin: string;
  dateFrom: string;
  dateTo: string;
  search: string;
}

export const DEFAULT_FILTERS: FilterState = {
  year: '',
  type: '',
  coin: '',
  dateFrom: '',
  dateTo: '',
  search: '',
};

interface TransactionFiltersProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  availableYears?: number[];
}

const SPOT_TYPES: { value: CanonicalType; label: string }[] = [
  { value: 'buy', label: 'Kauf (buy)' },
  { value: 'sell', label: 'Verkauf (sell)' },
];

const FUTURES_TYPES: { value: CanonicalType; label: string }[] = [
  { value: 'futures_open_long', label: 'Open Long' },
  { value: 'futures_open_short', label: 'Open Short' },
  { value: 'futures_close_long', label: 'Close Long' },
  { value: 'futures_close_short', label: 'Close Short' },
  { value: 'futures_funding', label: 'Funding' },
  { value: 'futures_fee', label: 'Futures-Fee' },
];

const EARN_TYPES: { value: CanonicalType; label: string }[] = [
  { value: 'earn_deposit', label: 'Earn-Einzahlung' },
  { value: 'earn_interest', label: 'Earn-Zinsen' },
  { value: 'earn_withdrawal', label: 'Earn-Auszahlung' },
];

const OTHER_TYPES: { value: CanonicalType; label: string }[] = [
  { value: 'fee', label: 'Gebühr (fee)' },
  { value: 'transfer_in', label: 'Transfer-Eingang' },
  { value: 'transfer_out', label: 'Transfer-Ausgang' },
  { value: 'unknown', label: 'Sonstige' },
];

const TransactionFilters = ({
  filters,
  onChange,
  availableYears = [],
}: TransactionFiltersProps) => {
  const [localSearch, setLocalSearch] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync if parent resets filters
  useEffect(() => {
    setLocalSearch(filters.search);
  }, [filters.search]);

  const handleSearchChange = (value: string) => {
    setLocalSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onChange({ ...filters, search: value });
    }, 300);
  };

  const handleField = (field: keyof FilterState, value: string) => {
    onChange({ ...filters, [field]: value });
  };

  return (
    <div className="tx-filters">
      {/* Search */}
      <div className="tx-filter-group tx-filter-group--search">
        <input
          type="text"
          className="tx-filter-input tx-filter-input--search"
          placeholder="Coin oder Order-ID suchen..."
          value={localSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          aria-label="Nach Coin oder Order-ID suchen"
        />
      </div>

      {/* Year */}
      <div className="tx-filter-group">
        <select
          className="tx-filter-select"
          value={filters.year}
          onChange={(e) => handleField('year', e.target.value)}
          aria-label="Jahr filtern"
        >
          <option value="">Alle Jahre</option>
          {availableYears.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* Type */}
      <div className="tx-filter-group">
        <select
          className="tx-filter-select"
          value={filters.type}
          onChange={(e) => handleField('type', e.target.value)}
          aria-label="Typ filtern"
        >
          <option value="">Alle Typen</option>
          <optgroup label="Spot">
            {SPOT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Futures">
            {FUTURES_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Earn">
            {EARN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Sonstige">
            {OTHER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Coin */}
      <div className="tx-filter-group">
        <input
          type="text"
          className="tx-filter-input"
          placeholder="Coin (z.B. BTC)"
          value={filters.coin}
          onChange={(e) => handleField('coin', e.target.value.toUpperCase())}
          aria-label="Coin filtern"
        />
      </div>

      {/* Date range */}
      <div className="tx-filter-group tx-filter-group--dates">
        <input
          type="date"
          className="tx-filter-input tx-filter-input--date"
          value={filters.dateFrom}
          onChange={(e) => handleField('dateFrom', e.target.value)}
          aria-label="Von Datum"
          title="Von"
        />
        <span className="tx-filter-sep">–</span>
        <input
          type="date"
          className="tx-filter-input tx-filter-input--date"
          value={filters.dateTo}
          onChange={(e) => handleField('dateTo', e.target.value)}
          aria-label="Bis Datum"
          title="Bis"
        />
      </div>

      {/* Reset button — only show when any filter is active */}
      {Object.values(filters).some(Boolean) && (
        <button type="button" className="tx-filter-reset" onClick={() => onChange(DEFAULT_FILTERS)}>
          Zurücksetzen
        </button>
      )}
    </div>
  );
};

export default TransactionFilters;
