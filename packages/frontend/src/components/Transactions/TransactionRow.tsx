import type { TransactionListItem } from '@cryptax/shared';
import { formatEur, formatNumber, gainLossColor } from '../../utils/format';
import CategoryBadge from './CategoryBadge';
import type { CurrencyMode } from './TransactionList';

interface TransactionRowProps {
  item: TransactionListItem;
  selected: boolean;
  onSelect: (id: number) => void;
  currencyMode: CurrencyMode;
}

const TransactionRow = ({ item, selected, onSelect, currencyMode }: TransactionRowProps) => {
  const dateStr = new Intl.DateTimeFormat('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.tradedAt));

  const amount = parseFloat(item.amount);
  const eurPrice = item.eurPrice != null ? parseFloat(item.eurPrice) : null;
  const price = item.price != null ? parseFloat(item.price) : null;
  const gainLoss = item.gainLossEur != null ? parseFloat(item.gainLossEur) : null;
  const fee = parseFloat(item.fee);

  const sideLabel = item.side === 'buy' ? 'Kauf' : item.side === 'sell' ? 'Verkauf' : '--';

  // EUR-mode values
  const eurValue = eurPrice != null && !Number.isNaN(amount) ? eurPrice * amount : null;
  const feeEur = eurPrice != null && !Number.isNaN(fee) ? fee * eurPrice : null;

  // Token-mode values (price is in quote currency e.g. USDT)
  const tokenValue =
    item.totalValue != null
      ? parseFloat(item.totalValue)
      : price != null && !Number.isNaN(amount)
        ? price * amount
        : null;
  const gainLossToken =
    gainLoss != null && eurPrice != null && eurPrice !== 0 ? gainLoss / eurPrice : null;

  const isEur = currencyMode === 'eur';

  return (
    <tr
      className={`tx-row${selected ? ' tx-row--selected' : ''}`}
      onClick={() => onSelect(item.id)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(item.id);
      }}
      aria-selected={selected}
    >
      <td className="tx-cell tx-cell--date">{dateStr}</td>
      <td className="tx-cell tx-cell--coin">{item.baseCoin}</td>
      <td className="tx-cell tx-cell--pair">{item.tradingPair ?? '--'}</td>
      <td className="tx-cell tx-cell--type">
        <CategoryBadge canonicalType={item.canonicalType} />
      </td>
      <td className="tx-cell tx-cell--side">{sideLabel}</td>
      <td className="tx-cell tx-cell--amount tx-cell--number">{formatNumber(amount, 6)}</td>
      {/* Kurs */}
      <td className="tx-cell tx-cell--number">
        {isEur
          ? eurPrice != null
            ? formatEur(eurPrice)
            : '--'
          : price != null
            ? formatNumber(price, 6)
            : '--'}
      </td>
      {/* Wert */}
      <td className="tx-cell tx-cell--number">
        {isEur
          ? eurValue != null
            ? formatEur(eurValue)
            : '--'
          : tokenValue != null
            ? formatNumber(tokenValue, 2)
            : '--'}
      </td>
      {/* P&L */}
      <td
        className="tx-cell tx-cell--number"
        style={{
          color: gainLoss != null ? gainLossColor(gainLoss) : undefined,
        }}
      >
        {isEur
          ? gainLoss != null
            ? formatEur(gainLoss, true)
            : '--'
          : gainLossToken != null
            ? formatNumber(gainLossToken, 2)
            : '--'}
      </td>
      {/* Gebühr */}
      <td className="tx-cell tx-cell--number">
        {isEur
          ? feeEur != null && !Number.isNaN(feeEur) && feeEur !== 0
            ? formatEur(feeEur)
            : '--'
          : !Number.isNaN(fee) && fee !== 0
            ? formatNumber(fee, 6)
            : '--'}
      </td>
    </tr>
  );
};

export default TransactionRow;
