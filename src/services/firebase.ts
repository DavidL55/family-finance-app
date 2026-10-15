import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator } from "firebase/firestore";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);

const usingEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1';
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

// Spec C1 §6.1 — App Check (reCAPTCHA v3, free) gates Firestore in the cloud. Not on the emulator
// (nothing to attest, and the emulator does not enforce). No site key = no App Check: a PROD build
// outside the emulator says so with a console.warn (a dev build stays quiet); enforcement in the
// console is switched on only after Task 15 shows verified requests.
// Deliberately no debug-token path (approved deviation from spec §6.1).
if (!usingEmulator && recaptchaSiteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(recaptchaSiteKey), isTokenAutoRefreshEnabled: true });
} else if (!usingEmulator && import.meta.env.PROD) {
    console.warn('App Check is OFF: VITE_RECAPTCHA_SITE_KEY is missing from this production build, so Firestore requests are not attested.');
}

// Use modern persistence API (Firebase 10+) — persists writes while offline.
// persistentMultipleTabManager allows multiple tabs to share IndexedDB access
// without the "exclusive access" error.
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const auth = getAuth(app);
export const functions = getFunctions(app);

if (usingEmulator) {
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export default app;
