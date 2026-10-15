export const MIN_PASSWORD_LENGTH = 10;

export function validateSignup(email: string, password: string, confirm: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'כתובת האימייל אינה תקינה.';
  if (password.length < MIN_PASSWORD_LENGTH) return `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`;
  if (password !== confirm) return 'הסיסמאות אינן תואמות.';
  return null;
}
