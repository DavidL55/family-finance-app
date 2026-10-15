import { describe, expect, it } from 'vitest';
import { validateSignup, MIN_PASSWORD_LENGTH } from '../utils/signupValidation';

describe('validateSignup (spec §4.1 — ≥10 chars enforced in the form, Identity Platform is paid)', () => {
  it('rejects a short password', () => { expect(validateSignup('a@b.co', '123456789', '123456789')).toMatch(/10/); });
  it('rejects a mismatch', () => { expect(validateSignup('a@b.co', '1234567890', '1234567899')).toMatch(/אינן תואמות/); });
  it('rejects an email without @', () => { expect(validateSignup('ab.co', '1234567890', '1234567890')).toMatch(/אימייל/); });
  it('accepts a valid form', () => { expect(validateSignup(' a@b.co ', 'x'.repeat(MIN_PASSWORD_LENGTH), 'x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull(); });
});
