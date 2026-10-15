// Spec C1 §4.5/§6.2 — the one way an operator script opens Firestore/Auth. Cloud = Admin SDK with
// David's ADC (`gcloud auth application-default login`; no key file on disk). Emulator only with
// an explicit --emulator AND a demo- project, and never live mode's :8080.
import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export const CLOUD_PROJECT_ID = 'family-finance-app-c9aa4';
export type Target = { kind: 'cloud' } | { kind: 'emulator'; projectId: string };

export function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function resolveTarget(argv: string[], env: Record<string, string | undefined>): Target {
  const emu = env.FIRESTORE_EMULATOR_HOST;
  // firebase-admin Auth follows FIREBASE_AUTH_EMULATOR_HOST independently of Firestore, so a stray
  // auth host in a cloud run would read an emulator uid and write it into prod (a ghost owner).
  const authEmu = env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!argv.includes('--emulator')) {
    if (emu) throw new Error('FIRESTORE_EMULATOR_HOST is set but --emulator was not given — refusing. Unset it for a cloud run.');
    if (authEmu) throw new Error('FIREBASE_AUTH_EMULATOR_HOST is set but --emulator was not given — refusing. Unset it for a cloud run.');
    return { kind: 'cloud' };
  }
  if (!emu) throw new Error('--emulator given but FIRESTORE_EMULATOR_HOST is not set.');
  if (emu.endsWith(':8080')) throw new Error('refusing: :8080 is LIVE mode (the family\'s real data). Use the test emulator (:8180).');
  if (authEmu?.endsWith(':9099')) throw new Error('refusing: auth :9099 is LIVE mode (the family\'s real accounts). Use the test emulator (:9199).');
  const projectId = flagValue(argv, '--project') ?? 'demo-familyfinance-restore';
  if (!projectId.startsWith('demo-')) throw new Error(`--emulator needs a demo- project id, got "${projectId}".`);
  return { kind: 'emulator', projectId };
}

let app: App | null = null;
function adminApp(target: Target): App {
  app ??= target.kind === 'cloud'
    ? initializeApp({ credential: applicationDefault(), projectId: CLOUD_PROJECT_ID }, 'c1-cloud')
    : initializeApp({ projectId: target.projectId }, 'c1-emulator');
  return app;
}
export const openFirestore = (t: Target): Firestore => getFirestore(adminApp(t));
export function openAuth(t: Target): Auth {
  // Without this, an emulator-target Auth call would silently go to the REAL Auth service.
  // (Not enforced in resolveTarget: Firestore-only tools — backup/restore — need no auth host.)
  if (t.kind === 'emulator' && !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('emulator target but FIREBASE_AUTH_EMULATOR_HOST is not set — refusing to open Auth.');
  }
  return getAuth(adminApp(t));
}
