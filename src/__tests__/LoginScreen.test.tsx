// Task 7: LoginScreen — email+password against the Auth emulator, Hebrew RTL, one primary
// action, loading/error states. A wrong password (or any other Auth error) must render a clear
// Hebrew message inline — never a blank screen and never an unhandled rejection.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSignIn, mockSignInWithPopup, mockCreateUser, mockSendVerification } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSignInWithPopup: vi.fn(),
  mockCreateUser: vi.fn(),
  mockSendVerification: vi.fn(),
}));

vi.mock('../services/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mockSignIn,
  signInWithPopup: mockSignInWithPopup,
  GoogleAuthProvider: vi.fn(),
  createUserWithEmailAndPassword: mockCreateUser,
  sendEmailVerification: mockSendVerification,
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
  it('"כניסה עם Google" calls signInWithPopup', async () => {
    mockSignInWithPopup.mockResolvedValueOnce({ user: { uid: 'g' } });
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'כניסה עם Google' }));
    expect(mockSignInWithPopup).toHaveBeenCalled();
  });

  it('renders a Hebrew message when the Google popup is closed', async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'כניסה עם Google' }));
    await waitFor(() => expect(screen.getByText('חלון ההתחברות נסגר לפני שהסתיים.')).toBeInTheDocument());
  });

  it('toggling to signup does not submit a sign-in', async () => {
    render(<LoginScreen />);
    // Valid values so constraint validation passes: a regressed type="submit" toggle would
    // then really submit (an empty required form is blocked by validation and hides the bug).
    await userEvent.type(screen.getByLabelText('אימייל'), 'a@b.com');
    await userEvent.type(screen.getByLabelText('סיסמה'), 'x');
    const toggle = screen.getByRole('button', { name: 'אין לך חשבון? הרשמה' });
    expect(toggle).toHaveAttribute('type', 'button');
    await userEvent.click(toggle);
    expect(mockSignIn).not.toHaveBeenCalled();
    expect(screen.getByLabelText('אימות סיסמה')).toBeInTheDocument();
  });

  it('signup creates the account and sends a verification email', async () => {
    mockCreateUser.mockResolvedValue({ user: { uid: 'u' } });
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'אין לך חשבון? הרשמה' }));
    await userEvent.type(screen.getByLabelText('אימייל'), 'g@gmail.com');
    await userEvent.type(screen.getByLabelText('סיסמה'), '1234567890');
    await userEvent.type(screen.getByLabelText('אימות סיסמה'), '1234567890');
    await userEvent.click(screen.getByRole('button', { name: 'הרשמה' }));
    expect(mockCreateUser).toHaveBeenCalledWith(expect.anything(), 'g@gmail.com', '1234567890');
    expect(mockSendVerification).toHaveBeenCalledWith({ uid: 'u' });
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('signup with a 9-char password never calls Firebase', async () => {
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'אין לך חשבון? הרשמה' }));
    await userEvent.type(screen.getByLabelText('אימייל'), 'g@gmail.com');
    await userEvent.type(screen.getByLabelText('סיסמה'), '123456789');
    await userEvent.type(screen.getByLabelText('אימות סיסמה'), '123456789');
    await userEvent.click(screen.getByRole('button', { name: 'הרשמה' }));
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('10');
  });

  it('signup on an existing email renders the Hebrew already-in-use message', async () => {
    mockCreateUser.mockRejectedValueOnce({ code: 'auth/email-already-in-use' });
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'אין לך חשבון? הרשמה' }));
    await userEvent.type(screen.getByLabelText('אימייל'), 'g@gmail.com');
    await userEvent.type(screen.getByLabelText('סיסמה'), '1234567890');
    await userEvent.type(screen.getByLabelText('אימות סיסמה'), '1234567890');
    await userEvent.click(screen.getByRole('button', { name: 'הרשמה' }));
    await waitFor(() => expect(screen.getByText(/כבר קיים חשבון/)).toBeInTheDocument());
    expect(mockSendVerification).not.toHaveBeenCalled();
  });
});
