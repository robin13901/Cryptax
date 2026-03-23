import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CredentialForm from './CredentialForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderCredentialForm(
  onSave = vi.fn(),
  onCancel = vi.fn()
) {
  return render(<CredentialForm onSave={onSave} onCancel={onCancel} />);
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Bezeichnung'), 'Mein Konto');
  await user.type(screen.getByLabelText('API Key'), 'testapikey');
  await user.type(screen.getByLabelText('Secret'), 'testsecret');
  await user.type(screen.getByLabelText('Passphrase'), 'testpass');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialForm', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders all four input fields', () => {
    renderCredentialForm();

    expect(screen.getByLabelText('Bezeichnung')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Secret')).toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
  });

  it('renders credential fields as password type by default', () => {
    renderCredentialForm();

    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Passphrase')).toHaveAttribute('type', 'password');
  });

  it('renders save and cancel buttons', () => {
    renderCredentialForm();

    expect(screen.getByRole('button', { name: /verbindung speichern/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /abbrechen/i })).toBeInTheDocument();
  });

  it('save button is disabled when fields are empty', () => {
    renderCredentialForm();

    expect(screen.getByRole('button', { name: /verbindung speichern/i })).toBeDisabled();
  });

  it('save button is enabled when all fields are filled', async () => {
    const user = userEvent.setup();
    renderCredentialForm();

    await fillForm(user);

    expect(screen.getByRole('button', { name: /verbindung speichern/i })).not.toBeDisabled();
  });

  it('toggles API Key to visible when eye button is clicked', async () => {
    const user = userEvent.setup();
    renderCredentialForm();

    const apiKeyInput = screen.getByLabelText('API Key');
    expect(apiKeyInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'API Key anzeigen' }));

    expect(apiKeyInput).toHaveAttribute('type', 'text');
  });

  it('toggles Secret to visible when eye button is clicked', async () => {
    const user = userEvent.setup();
    renderCredentialForm();

    const secretInput = screen.getByLabelText('Secret');
    expect(secretInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Secret anzeigen' }));

    expect(secretInput).toHaveAttribute('type', 'text');
  });

  it('toggles Passphrase to visible when eye button is clicked', async () => {
    const user = userEvent.setup();
    renderCredentialForm();

    const passphraseInput = screen.getByLabelText('Passphrase');
    expect(passphraseInput).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Passphrase anzeigen' }));

    expect(passphraseInput).toHaveAttribute('type', 'text');
  });

  it('toggles back to hidden when eye button is clicked again', async () => {
    const user = userEvent.setup();
    renderCredentialForm();

    await user.click(screen.getByRole('button', { name: 'API Key anzeigen' }));
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'text');

    await user.click(screen.getByRole('button', { name: 'API Key verbergen' }));
    expect(screen.getByLabelText('API Key')).toHaveAttribute('type', 'password');
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<CredentialForm onSave={vi.fn()} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /abbrechen/i }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('sends POST /api/exchanges on submit and calls onSave', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();

    const savedConnection = {
      id: 1,
      exchange: 'bitget',
      label: 'Mein Konto',
      lastSyncAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    };

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(savedConnection), { status: 201 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'ccxt not yet installed' }), {
          status: 200,
        })
      );

    render(<CredentialForm onSave={onSave} onCancel={vi.fn()} />);
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: /verbindung speichern/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(savedConnection);
    });

    // Verify POST body
    const postCall = vi.mocked(fetch).mock.calls[0];
    expect(postCall?.[0]).toBe('/api/exchanges');
    expect(postCall?.[1]).toMatchObject({ method: 'POST' });

    const bodyParsed = JSON.parse((postCall?.[1] as RequestInit)?.body as string);
    expect(bodyParsed.exchange).toBe('bitget');
    expect(bodyParsed.label).toBe('Mein Konto');
    expect(bodyParsed.credentials.apiKey).toBe('testapikey');
  });

  it('shows error message when POST fails', async () => {
    const user = userEvent.setup();

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'label must be a non-empty string' }), { status: 400 })
    );

    renderCredentialForm();
    await fillForm(user);

    await user.click(screen.getByRole('button', { name: /verbindung speichern/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('shows test result after save', async () => {
    const user = userEvent.setup();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 2,
            exchange: 'bitget',
            label: 'Test',
            lastSyncAt: null,
            createdAt: '2026-01-01T00:00:00Z',
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'ccxt not yet installed' }), {
          status: 200,
        })
      );

    renderCredentialForm();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /verbindung speichern/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  it('calls POST /api/exchanges/:id/test after successful save', async () => {
    const user = userEvent.setup();

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 5,
            exchange: 'bitget',
            label: 'Konto 5',
            lastSyncAt: null,
            createdAt: '2026-01-01T00:00:00Z',
          }),
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'ccxt not yet installed' }), {
          status: 200,
        })
      );

    renderCredentialForm();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /verbindung speichern/i }));

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls;
      expect(calls.some((c) => String(c[0]).includes('/api/exchanges/5/test'))).toBe(true);
    });
  });
});
