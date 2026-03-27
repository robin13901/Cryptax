import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CategoryBadge from './CategoryBadge';

describe('CategoryBadge', () => {
  it('renders "Spot" for buy canonicalType', () => {
    render(<CategoryBadge canonicalType="buy" />);
    expect(screen.getByText('Spot')).toBeInTheDocument();
  });

  it('renders "Spot" for sell canonicalType', () => {
    render(<CategoryBadge canonicalType="sell" />);
    expect(screen.getByText('Spot')).toBeInTheDocument();
  });

  it('renders "Futures" for futures_close_long canonicalType', () => {
    render(<CategoryBadge canonicalType="futures_close_long" />);
    expect(screen.getByText('Futures')).toBeInTheDocument();
  });

  it('renders "Futures" for futures_open_short canonicalType', () => {
    render(<CategoryBadge canonicalType="futures_open_short" />);
    expect(screen.getByText('Futures')).toBeInTheDocument();
  });

  it('renders "Futures" for futures_funding canonicalType', () => {
    render(<CategoryBadge canonicalType="futures_funding" />);
    expect(screen.getByText('Futures')).toBeInTheDocument();
  });

  it('renders "Earn" for earn_interest canonicalType', () => {
    render(<CategoryBadge canonicalType="earn_interest" />);
    expect(screen.getByText('Earn')).toBeInTheDocument();
  });

  it('renders "Earn" for earn_deposit canonicalType', () => {
    render(<CategoryBadge canonicalType="earn_deposit" />);
    expect(screen.getByText('Earn')).toBeInTheDocument();
  });

  it('renders "Earn" for earn_withdrawal canonicalType', () => {
    render(<CategoryBadge canonicalType="earn_withdrawal" />);
    expect(screen.getByText('Earn')).toBeInTheDocument();
  });

  it('renders "Fee" for fee canonicalType', () => {
    render(<CategoryBadge canonicalType="fee" />);
    expect(screen.getByText('Fee')).toBeInTheDocument();
  });

  it('renders "Fee" for futures_fee canonicalType', () => {
    render(<CategoryBadge canonicalType="futures_fee" />);
    expect(screen.getByText('Fee')).toBeInTheDocument();
  });

  it('renders "Transfer" for transfer_in canonicalType', () => {
    render(<CategoryBadge canonicalType="transfer_in" />);
    expect(screen.getByText('Transfer')).toBeInTheDocument();
  });

  it('renders "Transfer" for transfer_out canonicalType', () => {
    render(<CategoryBadge canonicalType="transfer_out" />);
    expect(screen.getByText('Transfer')).toBeInTheDocument();
  });

  it('renders "Sonstige" for unknown canonicalType', () => {
    render(<CategoryBadge canonicalType="unknown" />);
    expect(screen.getByText('Sonstige')).toBeInTheDocument();
  });

  it('applies the correct CSS class for Spot badge', () => {
    const { container } = render(<CategoryBadge canonicalType="buy" />);
    expect(container.querySelector('.badge--spot')).toBeInTheDocument();
  });

  it('applies the correct CSS class for Futures badge', () => {
    const { container } = render(<CategoryBadge canonicalType="futures_close_short" />);
    expect(container.querySelector('.badge--futures')).toBeInTheDocument();
  });

  it('applies the correct CSS class for Earn badge', () => {
    const { container } = render(<CategoryBadge canonicalType="earn_interest" />);
    expect(container.querySelector('.badge--earn')).toBeInTheDocument();
  });

  it('applies the correct CSS class for Fee badge', () => {
    const { container } = render(<CategoryBadge canonicalType="fee" />);
    expect(container.querySelector('.badge--fee')).toBeInTheDocument();
  });

  it('applies the correct CSS class for Transfer badge', () => {
    const { container } = render(<CategoryBadge canonicalType="transfer_out" />);
    expect(container.querySelector('.badge--transfer')).toBeInTheDocument();
  });
});
