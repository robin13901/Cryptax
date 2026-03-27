import type { CanonicalType } from '@cryptax/shared';
import './CategoryBadge.css';

type BadgeCategory = 'Spot' | 'Futures' | 'Earn' | 'Fee' | 'Transfer' | 'Sonstige';

interface CategoryBadgeProps {
  canonicalType: CanonicalType;
}

function getCategory(canonicalType: CanonicalType): BadgeCategory {
  switch (canonicalType) {
    case 'buy':
    case 'sell':
      return 'Spot';
    case 'futures_open_long':
    case 'futures_open_short':
    case 'futures_close_long':
    case 'futures_close_short':
    case 'futures_funding':
      return 'Futures';
    case 'earn_deposit':
    case 'earn_interest':
    case 'earn_withdrawal':
      return 'Earn';
    case 'fee':
    case 'futures_fee':
      return 'Fee';
    case 'transfer_in':
    case 'transfer_out':
      return 'Transfer';
    default:
      return 'Sonstige';
  }
}

const CATEGORY_CLASS: Record<BadgeCategory, string> = {
  Spot: 'badge--spot',
  Futures: 'badge--futures',
  Earn: 'badge--earn',
  Fee: 'badge--fee',
  Transfer: 'badge--transfer',
  Sonstige: 'badge--sonstige',
};

const CategoryBadge = ({ canonicalType }: CategoryBadgeProps) => {
  const category = getCategory(canonicalType);
  return <span className={`category-badge ${CATEGORY_CLASS[category]}`}>{category}</span>;
};

export default CategoryBadge;
export type { BadgeCategory };
export { getCategory };
