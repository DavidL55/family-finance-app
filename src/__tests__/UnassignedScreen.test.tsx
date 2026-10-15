import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ redeem: vi.fn(), sendVerification: vi.fn(), signOut: vi.fn() }));
// No importOriginal (Ruling F4): the real service pulls ./firebase → getAuth, which this file's
// partial firebase/auth mock does not define. The screen only needs redeemMyInvite.
vi.mock('../services/InvitesService', () => ({ redeemMyInvite: m.redeem }));
vi.mock('firebase/auth', () => ({ sendEmailVerification: m.sendVerification }));
vi.mock('../hooks/useAuthSession', () => ({ signOutCurrentUser: m.signOut }));

import UnassignedScreen from '../components/UnassignedScreen';

const user = (over = {}) => ({ uid: 'u', email: 'g@gmail.com', emailVerified: true, reload: vi.fn().mockResolvedValue(undefined), ...over }) as never;

describe('UnassignedScreen', () => {
  it('verified user: "יש לי הזמנה" redeems and shows a failure reason in Hebrew', async () => {
    m.redeem.mockResolvedValue({ ok: false, reason: 'expired', message: 'ההזמנה פגה. בקש מדויד הזמנה חדשה.' });
    render(<UnassignedScreen user={user()} message="לא משויך" />);
    await userEvent.click(screen.getByRole('button', { name: 'יש לי הזמנה' }));
    expect(await screen.findByText('ההזמנה פגה. בקש מדויד הזמנה חדשה.')).toBeInTheDocument();
  });
  it('unverified user: offers resend + "אימתתי", no redeem button', async () => {
    render(<UnassignedScreen user={user({ emailVerified: false })} message="לא משויך" />);
    expect(screen.queryByRole('button', { name: 'יש לי הזמנה' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'שלח שוב מייל אימות' }));
    expect(m.sendVerification).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'אימתתי' })).toBeInTheDocument();
  });
  it('"אימתתי" with a failing reload() shows a Hebrew error and re-enables the button (no dead end)', async () => {
    const reload = vi.fn().mockRejectedValue(new Error('auth/network-request-failed'));
    render(<UnassignedScreen user={user({ emailVerified: false, reload })} message="לא משויך" />);
    await userEvent.click(screen.getByRole('button', { name: 'אימתתי' }));
    expect(await screen.findByText('הבדיקה נכשלה. בדוק את החיבור לרשת ונסה שוב.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'אימתתי' })).toBeEnabled();
  });
  it('"אימתתי" pressed too early (still unverified after reload) says so instead of doing nothing', async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<UnassignedScreen user={user({ emailVerified: false, reload })} message="לא משויך" />);
    await userEvent.click(screen.getByRole('button', { name: 'אימתתי' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/עדיין לא אומת/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'אימתתי' })).toBeEnabled();
  });
  it('"אימתתי" after verifying in another tab flips to "יש לי הזמנה" with no warning', async () => {
    const u = user({ emailVerified: false }) as unknown as { emailVerified: boolean; reload: ReturnType<typeof vi.fn> };
    u.reload.mockImplementation(async () => { u.emailVerified = true; });
    render(<UnassignedScreen user={u as never} message="לא משויך" />);
    await userEvent.click(screen.getByRole('button', { name: 'אימתתי' }));
    expect(await screen.findByRole('button', { name: 'יש לי הזמנה' })).toBeInTheDocument();
    expect(screen.queryByText(/עדיין לא אומת/)).toBeNull();
  });
  it('always offers sign-out', () => {
    render(<UnassignedScreen user={user()} message={null} />);
    expect(screen.getByRole('button', { name: 'התנתק' })).toBeInTheDocument();
  });
});
