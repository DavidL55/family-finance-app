import { db } from './firebase';
import { doc, getDoc, setDoc, arrayUnion } from 'firebase/firestore';

const CATEGORIES_DOC = () => doc(db, 'settings', 'categories');

/**
 * Reads `settings/categories`. Does NOT self-seed on a missing/empty doc (M6, Stage 4 review) —
 * `settings` writes are super-admin/parent only (firestore.rules), so a member-role session
 * calling this on a fresh database used to hit permission-denied on the old seed-on-read setDoc
 * and render a permanent error, per this project's own no-silent-catch rule. Seeding now happens
 * once, at bootstrap, in `MembersService.ensureSeeded()` (already super-admin-gated at its one
 * call site in App.tsx) — a genuinely missing/empty doc here is a legitimate (if unusual) empty
 * state, not an error. Like every other read in this codebase, a query failure is NOT caught into
 * `[]` — it propagates as a rejected promise so the caller can render an explicit error state.
 */
export async function getCategories(): Promise<string[]> {
  const snap = await getDoc(CATEGORIES_DOC());
  return snap.exists() ? ((snap.data()?.list as string[] | undefined) ?? []) : [];
}

export async function addCategory(name: string): Promise<void> {
  await setDoc(CATEGORIES_DOC(), { list: arrayUnion(name) }, { merge: true });
}
