import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SyncResult } from '@cryptax/shared';
import SyncProgress from './SyncProgress';

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    connectionId: 1,
    exchange: 'bitget',
    spotTrades: { imported: 5, duplicates: 2, errors: 0 },
    futuresTrades: { imported: 3, duplicates: 1, errors: 0 },
    totalImported: 8,
    totalDuplicates: 3,
    syncedAt: '2026-03-23T10:00:00Z',
    warnings: [],
    ...overrides,
  };
}

describe('SyncProgress', () => {
  it('renders spinner and text when syncing=true', () => {
    render(<SyncProgress syncing={true} />);

    expect(screen.getByLabelText('Synchronisierung laeuft')).toBeInTheDocument();
    expect(screen.getByText('Synchronisiere...')).toBeInTheDocument();
  });

  it('renders nothing when syncing=false with no result or error', () => {
    const { container } = render(<SyncProgress syncing={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders success state with imported/duplicate counts when result is provided', () => {
    const result = makeSyncResult({ totalImported: 10, totalDuplicates: 2 });
    render(<SyncProgress syncing={false} result={result} />);

    expect(screen.getByLabelText('Synchronisierung abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText(/10 importiert/)).toBeInTheDocument();
    expect(screen.getByText(/2 Duplikate/)).toBeInTheDocument();
  });

  it('renders error state when error is provided', () => {
    render(<SyncProgress syncing={false} error="Verbindung fehlgeschlagen" />);

    expect(screen.getByLabelText('Synchronisierungsfehler')).toBeInTheDocument();
    expect(screen.getByText('Verbindung fehlgeschlagen')).toBeInTheDocument();
  });

  it('syncing=true takes priority over result', () => {
    const result = makeSyncResult();
    render(<SyncProgress syncing={true} result={result} />);

    // Should show syncing state, not done state
    expect(screen.getByLabelText('Synchronisierung laeuft')).toBeInTheDocument();
    expect(screen.queryByLabelText('Synchronisierung abgeschlossen')).not.toBeInTheDocument();
  });

  it('syncing=true takes priority over error', () => {
    render(<SyncProgress syncing={true} error="Some error" />);

    expect(screen.getByLabelText('Synchronisierung laeuft')).toBeInTheDocument();
    expect(screen.queryByLabelText('Synchronisierungsfehler')).not.toBeInTheDocument();
  });

  it('error takes priority over result when not syncing', () => {
    const result = makeSyncResult();
    render(<SyncProgress syncing={false} result={result} error="Some error" />);

    // Error is shown before result in the component logic
    expect(screen.getByLabelText('Synchronisierungsfehler')).toBeInTheDocument();
  });

  it('renders 0 imported and 0 duplicates correctly', () => {
    const result = makeSyncResult({ totalImported: 0, totalDuplicates: 0 });
    render(<SyncProgress syncing={false} result={result} />);

    expect(screen.getByText(/0 importiert/)).toBeInTheDocument();
    expect(screen.getByText(/0 Duplikate/)).toBeInTheDocument();
  });
});
