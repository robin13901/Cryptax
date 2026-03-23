import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupCard from './SetupCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSetupCard(onSuccess = vi.fn()) {
  return render(<SetupCard onSuccess={onSuccess} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SetupCard', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders two password inputs and submit button', () => {
    renderSetupCard();

    const inputs = screen.getAllByPlaceholderText(/passwort/i);
    expect(inputs).toHaveLength(2);
    expect(screen.getByRole('button', { name: /passwort setzen/i })).toBeInTheDocument();
  });

  it('renders Cryptax title and subtitle', () => {
    renderSetupCard();

    expect(screen.getByRole('heading', { name: 'Cryptax' })).toBeInTheDocument();
    expect(screen.getByText('Passwort erstellen')).toBeInTheDocument();
  });

  it('shows error when passwords do not match', async () => {
    renderSetupCard();

    const user = userEvent.setup();
    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/passwort/i);
    await user.type(firstInput, 'abcdefgh');
    await user.type(secondInput, 'differentpw');
    await user.click(screen.getByRole('button', { name: /passwort setzen/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/stimmen nicht ueberein/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows error when password is shorter than 8 characters', async () => {
    renderSetupCard();

    const user = userEvent.setup();
    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/passwort/i);
    await user.type(firstInput, 'short');
    await user.type(secondInput, 'short');
    await user.click(screen.getByRole('button', { name: /passwort setzen/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/mindestens 8 Zeichen/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('calls onSuccess when setup returns 201', async () => {
    const onSuccess = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 201 })
    );

    renderSetupCard(onSuccess);

    const user = userEvent.setup();
    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/passwort/i);
    await user.type(firstInput, 'strongpassword1');
    await user.type(secondInput, 'strongpassword1');
    await user.click(screen.getByRole('button', { name: /passwort setzen/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
    });
  });

  it('shows error message on server error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Password already set' }), { status: 409 })
    );

    renderSetupCard();

    const user = userEvent.setup();
    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/passwort/i);
    await user.type(firstInput, 'validpassword');
    await user.type(secondInput, 'validpassword');
    await user.click(screen.getByRole('button', { name: /passwort setzen/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Password already set');
    });
  });

  it('sends password to /api/auth/setup', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 201 })
    );

    renderSetupCard();

    const user = userEvent.setup();
    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/passwort/i);
    await user.type(firstInput, 'mypassword1');
    await user.type(secondInput, 'mypassword1');
    await user.click(screen.getByRole('button', { name: /passwort setzen/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/setup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ password: 'mypassword1' }),
        })
      );
    });
  });

  it('disables submit button when password is empty', () => {
    renderSetupCard();

    expect(screen.getByRole('button', { name: /passwort setzen/i })).toBeDisabled();
  });

  it('disables button while loading', async () => {
    let resolveResponse!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );

    renderSetupCard();

    const user = userEvent.setup();
    const [firstInput, secondInput] = screen.getAllByPlaceholderText(/passwort/i);
    await user.type(firstInput, 'validpassword');
    await user.type(secondInput, 'validpassword');

    const btn = screen.getByRole('button', { name: /passwort setzen/i });
    await user.click(btn);

    expect(btn).toBeDisabled();

    resolveResponse(new Response(JSON.stringify({ ok: true }), { status: 201 }));
  });
});
