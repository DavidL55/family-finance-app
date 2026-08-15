// Task 7: LoginScreen — email+password against the Auth emulator, Hebrew RTL, one primary
// action, loading/error states. A wrong password (or any other Auth error) must render a clear
// Hebrew message inline — never a blank screen and never an unhandled rejection.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSignIn } = vi.hoisted(() => ({ mockSignIn: vi.fn() }));

vi.mock('../services/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mockSignIn,
}));

import LoginScreen from '../components/LoginScreen';

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email and password fields and a single primary submit action', () => {
    render(<LoginScreen />);
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument();
    expect(screen.getByLabelText('סיסמה')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /התחבר/ })).toHaveLength(1);
  });

  it('calls signInWithEmailAndPassword with the entered credentials on submit', async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValueOnce({ user: { uid: 'x' } });
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('אימייל'), 'david-levy@familyfinance.local');
    await user.type(screen.getByLabelText('סיסמה'), 'FamilyFinance2026!');
    await user.click(screen.getByRole('button', { name: /התחבר/ }));

    await waitFor(() => expect(mockSignIn).toHaveBeenCalledTimes(1));
    expect(mockSignIn).toHaveBeenCalledWith(
      {},
      'david-levy@familyfinance.local',
      'FamilyFinance2026!'
    );
  });

  it('renders a clear Hebrew error message on wrong-password — never a blank screen', async () => {
    const user = userEvent.setup();
    mockSignIn.mockRejectedValueOnce({ code: 'auth/wrong-password' });
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('אימייל'), 'david-levy@familyfinance.local');
    await user.type(screen.getByLabelText('סיסמה'), 'wrong');
    await user.click(screen.getByRole('button', { name: /התחבר/ }));

    await waitFor(() => expect(screen.getByText('סיסמה שגויה.')).toBeInTheDocument());
    // The form itself is still on screen — not a blank/unmounted page.
    expect(screen.getByLabelText('אימייל')).toBeInTheDocument();
  });

  it('renders a generic Hebrew fallback message for an unrecognized error code', async () => {
    const user = userEvent.setup();
    mockSignIn.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('אימייל'), 'a@b.com');
    await user.type(screen.getByLabelText('סיסמה'), 'x');
    await user.click(screen.getByRole('button', { name: /התחבר/ }));

    await waitFor(() => expect(screen.getByText('ההתחברות נכשלה. נסה שוב.')).toBeInTheDocument());
  });

  it('disables the submit button while a sign-in is in flight', async () => {
    const user = userEvent.setup();
    let resolveSignIn: (v: unknown) => void = () => {};
    mockSignIn.mockImplementationOnce(() => new Promise((resolve) => { resolveSignIn = resolve; }));
    render(<LoginScreen />);

    await user.type(screen.getByLabelText('אימייל'), 'a@b.com');
    await user.type(screen.getByLabelText('סיסמה'), 'x');
    await user.click(screen.getByRole('button', { name: /התחבר/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /התחבר/ })).toBeDisabled());
    resolveSignIn({ user: { uid: 'x' } });
  });
});
