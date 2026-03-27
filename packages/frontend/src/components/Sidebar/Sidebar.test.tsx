import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { TabId } from './Sidebar';
import Sidebar from './Sidebar';

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultProps = {
  activeTab: 'dashboard' as TabId,
  onTabChange: vi.fn(),
  collapsed: false,
  onToggleCollapse: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sidebar', () => {
  it('renders all 4 navigation items', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Transaktionen')).toBeInTheDocument();
    expect(screen.getByText('Steuerreport')).toBeInTheDocument();
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });

  it('highlights active tab with active CSS class', () => {
    render(<Sidebar {...defaultProps} activeTab="transactions" />);

    const transactionsBtn = screen.getByText('Transaktionen').closest('button');
    expect(transactionsBtn).toHaveClass('sidebar__nav-item--active');
  });

  it('does not highlight inactive tabs', () => {
    render(<Sidebar {...defaultProps} activeTab="transactions" />);

    const dashboardBtn = screen.getByText('Dashboard').closest('button');
    expect(dashboardBtn).not.toHaveClass('sidebar__nav-item--active');
  });

  it('calls onTabChange with correct id when nav item clicked', async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();

    render(<Sidebar {...defaultProps} onTabChange={onTabChange} />);

    await user.click(screen.getByText('Steuerreport'));

    expect(onTabChange).toHaveBeenCalledOnce();
    expect(onTabChange).toHaveBeenCalledWith('report');
  });

  it('calls onToggleCollapse when toggle button clicked', async () => {
    const onToggleCollapse = vi.fn();
    const user = userEvent.setup();

    render(<Sidebar {...defaultProps} onToggleCollapse={onToggleCollapse} />);

    await user.click(screen.getByRole('button', { name: /sidebar einklappen/i }));

    expect(onToggleCollapse).toHaveBeenCalledOnce();
  });

  it('hides nav item labels when collapsed', () => {
    render(<Sidebar {...defaultProps} collapsed={true} />);

    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Transaktionen')).not.toBeInTheDocument();
    expect(screen.queryByText('Steuerreport')).not.toBeInTheDocument();
    expect(screen.queryByText('Einstellungen')).not.toBeInTheDocument();
  });

  it('shows brand text when expanded', () => {
    render(<Sidebar {...defaultProps} collapsed={false} />);

    expect(screen.getByText('Cryptax')).toBeInTheDocument();
  });

  it('hides brand text when collapsed', () => {
    render(<Sidebar {...defaultProps} collapsed={true} />);

    expect(screen.queryByText('Cryptax')).not.toBeInTheDocument();
  });

  it('shows title tooltip on nav items when collapsed', () => {
    render(<Sidebar {...defaultProps} collapsed={true} />);

    const buttons = screen.getAllByRole('button');
    // Nav item buttons should have title attributes when collapsed
    const navButtons = buttons.filter(
      (btn) => btn.getAttribute('title') !== null && btn.getAttribute('aria-label') === null
    );

    const titles = navButtons.map((btn) => btn.getAttribute('title'));
    expect(titles).toContain('Dashboard');
    expect(titles).toContain('Transaktionen');
    expect(titles).toContain('Steuerreport');
    expect(titles).toContain('Einstellungen');
  });

  it('renders aside with navigation aria-label', () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('toggle button shows "ausklappen" label when collapsed', () => {
    render(<Sidebar {...defaultProps} collapsed={true} />);

    expect(screen.getByRole('button', { name: /sidebar ausklappen/i })).toBeInTheDocument();
  });

  it('toggle button shows "einklappen" label when expanded', () => {
    render(<Sidebar {...defaultProps} collapsed={false} />);

    expect(screen.getByRole('button', { name: /sidebar einklappen/i })).toBeInTheDocument();
  });

  it('applies sidebar--collapsed class when collapsed', () => {
    render(<Sidebar {...defaultProps} collapsed={true} />);

    const aside = screen.getByRole('navigation').closest('aside');
    expect(aside).toHaveClass('sidebar--collapsed');
  });

  it('does not apply sidebar--collapsed class when expanded', () => {
    render(<Sidebar {...defaultProps} collapsed={false} />);

    const aside = screen.getByRole('navigation').closest('aside');
    expect(aside).not.toHaveClass('sidebar--collapsed');
  });
});
