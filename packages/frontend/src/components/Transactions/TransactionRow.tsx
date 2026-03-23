import type { TransactionListItem } from '@cryptax/shared';
import { formatEur, formatNumber } from '../../utils/format';
import CategoryBadge from './CategoryBadge';

interface TransactionRowProps {
  item: TransactionListItem;
  selected: boolean;
  onSelect: (id: number) => void;
}

const TransactionRow = ({ item, selected, onSelect }: TransactionRowProps) => {
  const dateStr = new Intl.DateTimeFormat('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(item.tradedAt));

  const amount = parseFloat(item.amount);
  const eurPrice = item.eurPrice != null ? parseFloat(item.eurPrice) : null;
  const eurValue = eurPrice != null && !Number.isNaN(amount) ? eurPrice * amount : null;
  const fee = parseFloat(item.fee);

  const sideLabel =
    item.side === 'buy' ? 'Kauf' : item.side === 'sell' ? 'Verkauf' : '--';

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
      <td className="tx-cell tx-cell--coin">{item.symbol}</td>
      <td className="tx-cell tx-cell--type">
        <CategoryBadge canonicalType={item.canonicalType} />
      </td>
      <td className="tx-cell tx-cell--side">{sideLabel}</td>
      <td className="tx-cell tx-cell--amount tx-cell--number">
        {formatNumber(amount, 6)}
      </td>
      <td className="tx-cell tx-cell--eur tx-cell--number">
        {eurValue != null ? formatEur(eurValue) : '--'}
      </td>
      <td className="tx-cell tx-cell--fee tx-cell--number">
        {!Number.isNaN(fee) && fee !== 0 ? formatEur(fee) : '--'}
      </td>
    </tr>
  );
};

export default TransactionRow;
