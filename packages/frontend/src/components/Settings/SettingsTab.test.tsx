import type { ExchangeConnection } from '@cryptax/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsTab from './SettingsTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<ExchangeConnection> = {}): ExchangeConnection {
  return {
    id: 1,
    exchange: 'bitget',
    label: 'Mein Konto',
    lastSyncAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderSettingsTab(onLogout = vi.fn()) {
  return render(<SettingsTab onLogout={onLogout} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsTab', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders exchange connections section heading', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /boersenverbindungen/i })).toBeInTheDocument();
    });
  });

  it('renders app settings section heading', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /app-einstellungen/i })).toBeInTheDocument();
    });
  });

  it('shows empty state when no connections exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(
        screen.getByText(/keine exchange-verbindungen konfiguriert/i)
      ).toBeInTheDocument();
    });
  });

  it('renders connection cards for each existing connection', async () => {
    const connections = [
      makeConnection({ id: 1, label: 'Konto A' }),
      makeConnection({ id: 2, label: 'Konto B' }),
    ];

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(connections), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByText('Konto A')).toBeInTheDocument();
      expect(screen.getByText('Konto B')).toBeInTheDocument();
    });
  });

  it('shows add connection button', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /verbindung hinzufuegen/i })
      ).toBeInTheDocument();
    });
  });

  it('shows CredentialForm when add button is clicked', async () => {
    const user = userEvent.setup();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /verbindung hinzufuegen/i })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /verbindung hinzufuegen/i }));

    // CredentialForm should now be visible
    expect(screen.getByLabelText('Bezeichnung')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
  });

  it('hides form when cancel is clicked inside CredentialForm', async () => {
    const user = userEvent.setup();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /verbindung hinzufuegen/i })
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /verbindung hinzufuegen/i }));
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();

    // Click cancel inside form — target the CredentialForm cancel button specifically
    const allCancelBtns = screen.getAllByRole('button', { name: /abbrechen/i });
    // Last "Abbrechen" is inside the CredentialForm
    await user.click(allCancelBtns[allCancelBtns.length - 1]);

    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  });

  it('renders password change section with password fields', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByLabelText(/aktuelles passwort/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Neues Passwort')).toBeInTheDocument();
    });
  });

  it('renders logout button in app settings section', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /abmelden/i })).toBeInTheDocument();
    });
  });

  it('calls onLogout when logout button is clicked', async () => {
    const onLogout = vi.fn();
    const user = userEvent.setup();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    render(<SettingsTab onLogout={onLogout} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /abmelden/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /abmelden/i }));

    // Logout button click triggers fetch then logout - but PasswordChange directly calls onLogout
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('fetches connections from /api/exchanges on mount', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/exchanges');
    });
  });

  it('adds new connection card after save from CredentialForm', async () => {
    const user = userEvent.setup();
    const newConn = makeConnection({ id: 10, label: 'Neu hinzugefuegt' });

    // Initial load: empty
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      // POST /api/exchanges
      .mockResolvedValueOnce(new Response(JSON.stringify(newConn), { status: 201 }))
      // POST /api/exchanges/10/test
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'ccxt not yet installed' }), {
          status: 200,
        })
      );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verbindung hinzufuegen/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /verbindung hinzufuegen/i }));

    // Fill and submit form
    await user.type(screen.getByLabelText('Bezeichnung'), 'Neu hinzugefuegt');
    await user.type(screen.getByLabelText('API Key'), 'apikey');
    await user.type(screen.getByLabelText('Secret'), 'secret');
    await user.type(screen.getByLabelText('Passphrase'), 'pass');

    await user.click(screen.getByRole('button', { name: /verbindung speichern/i }));

    await waitFor(() => {
      expect(screen.getByText('Neu hinzugefuegt')).toBeInTheDocument();
    });
  });

  it('shows "Alle synchronisieren" button when connections exist', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([makeConnection()]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /alle synchronisieren/i })).toBeInTheDocument();
    });
  });

  it('does not show "Alle synchronisieren" button when no connections', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 })
    );

    renderSettingsTab();

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /alle synchronisieren/i })
      ).not.toBeInTheDocument();
    });
  });

  it('removes deleted connection from list', async () => {
    const conn = makeConnection({ id: 3, label: 'Zu loeschender Account' });

    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify([conn]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }));

    const user = userEvent.setup();
    renderSettingsTab();

    await waitFor(() => {
      expect(screen.getByText('Zu loeschender Account')).toBeInTheDocument();
    });

    // Click delete, then confirm
    await user.click(screen.getByRole('button', { name: /zu loeschender account entfernen/i }));

    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    // Find confirm delete button (second "Entfernen" button in the dialog)
    const confirmBtn = screen.getByRole('button', { name: /^entfernen$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText('Zu loeschender Account')).not.toBeInTheDocument();
    });
  });
});
