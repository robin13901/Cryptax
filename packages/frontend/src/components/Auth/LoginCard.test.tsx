import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginCard from './LoginCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLoginCard(onSuccess = vi.fn()) {
  return render(<LoginCard onSuccess={onSuccess} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginCard', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders password input and submit button', () => {
    renderLoginCard();

    expect(screen.getByPlaceholderText('Passwort')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /anmelden/i })).toBeInTheDocument();
  });

  it('renders Cryptax title and Anmeldung subtitle', () => {
    renderLoginCard();

    expect(screen.getByRole('heading', { name: 'Cryptax' })).toBeInTheDocument();
    expect(screen.getByText('Anmeldung')).toBeInTheDocument();
  });

  it('calls onSuccess when login returns 200', async () => {
    const onSuccess = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    renderLoginCard(onSuccess);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Passwort'), 'correctpassword');
    await user.click(screen.getByRole('button', { name: /anmelden/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it('shows "Falsches Passwort" error on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Falsches Passwort' }), { status: 401 })
    );

    renderLoginCard();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Passwort'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: /anmelden/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Falsches Passwort');
    });
  });

  it('shows generic error on non-401 failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
    );

    renderLoginCard();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Passwort'), 'somepassword');
    await user.click(screen.getByRole('button', { name: /anmelden/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });

  it('disables button while loading', async () => {
    let resolveResponse!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    renderLoginCard();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Passwort'), 'somepassword');

    const btn = screen.getByRole('button', { name: /anmelden/i });
    await user.click(btn);

    // Button should be disabled while loading
    expect(btn).toBeDisabled();

    // Resolve the request
    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it('disables submit button when password is empty', () => {
    renderLoginCard();

    expect(screen.getByRole('button', { name: /anmelden/i })).toBeDisabled();
  });

  it('sends password to /api/auth/login', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    renderLoginCard();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Passwort'), 'mypassword');
    await user.click(screen.getByRole('button', { name: /anmelden/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'mypassword' }),
        })
      );
    });
  });
});
