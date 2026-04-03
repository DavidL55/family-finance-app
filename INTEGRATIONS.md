# Family Finance App — External Integrations

This document covers every external service the app connects to: how authentication works, which APIs are called, what scopes/permissions are needed, and what data flows in/out.

---

## 1. Firebase Authentication

**Library:** `firebase/auth` (Firebase SDK v12)
**Strategy:** Anonymous sign-in

### Flow

```
App.tsx mounts
  └── onAuthStateChanged(auth, callback)
        ├── user exists → setAuthReady(true)
        └── no user   → signInAnonymously(auth)
                            └── onAuthStateChanged fires again with new user
                                    └── setAuthReady(true)
```

Anonymous authentication creates a temporary Firebase user with a unique `uid`. This user:
- Can read/write Firestore (given current dev rules: `allow read, write: if true`)
- Is persistent across browser sessions (stored in IndexedDB by Firebase)
- Does NOT have email/password — it's a device-level identity

**Production implication:** Firestore rules should check `request.auth != null` to gate access to the anonymous user's data.

**Logout:** The LogOut button in the header triggers `signOut(auth)`. Currently it's a placeholder — the UI button exists but the onClick handler is not wired to Firebase signOut yet.

---

## 2. Firebase Firestore

**Library:** `firebase/firestore` (Firebase SDK v12)
**Project:** `family-finance-app-c9aa4`

### Initialization

```typescript
// src/services/firebase.ts
const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});
```

`persistentLocalCache()` uses the browser's IndexedDB to persist all Firestore reads. This means:
- Data is available immediately on reload (no loading flash)
- App reads work while offline
- Writes are queued offline and auto-synced when reconnected

### Collections Used

| Collection | Access Pattern |
|-----------|---------------|
| `transactions` | Read (filter by date), write (addDoc), query (duplicate check) |
| `incomes` | Read (onSnapshot filtered by month/year), write (addDoc), delete (deleteDoc) |
| `investments` | Read (getDocs), write (addDoc, updateDoc), delete (deleteDoc) |
| `goals` | Read (onSnapshot), write (addDoc), delete (deleteDoc) |
| `settings/budgetConfig` | Read (getDoc), write (setDoc) |
| `settings/ecosystem` | Read (getDoc), write (setDoc) |
| `settings/expenseClusters` | Read (getDoc), write (setDoc) |

### Read Patterns

**Real-time listeners (`onSnapshot`):** Used for incomes and goals — data updates instantly when changed elsewhere.

**One-time reads (`getDocs`, `getDoc`):** Used for investments, transactions (filtered), and settings documents.

### Write Pattern

Every `addDoc` to `transactions` includes:
```typescript
created_at: serverTimestamp()
```

This is a critical timestamp — never omitted. Missing `created_at` causes sort failures.

---

## 3. Google OAuth 2.0

**Library:** `@react-oauth/google` v0.13.4
**Purpose:** Authorize access to the user's Google Drive

### Setup

```tsx
// src/main.tsx
<GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
  <App />
</GoogleOAuthProvider>
```

`VITE_GOOGLE_CLIENT_ID` is a public OAuth 2.0 client ID registered in Google Cloud Console.

### Login Flow

```typescript
// src/components/SyncButton.tsx
const login = useGoogleLogin({
  onSuccess: (tokenResponse) => {
    setToken(tokenResponse.access_token);
    localStorage.setItem('google_access_token', tokenResponse.access_token);
  },
  scope: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ].join(' ')
});
```

**Token storage:** `localStorage` under `google_access_token`. Loaded on component mount. Cleared on OAuth error.

**Token usage:** Passed as `Authorization: Bearer {token}` header on all Drive API calls.

### OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `drive.readonly` | Read any file in Drive (for downloading receipts) |
| `drive.file` | Create/modify files the app created (for uploading organized receipts) |
| `drive.metadata.readonly` | Read folder/file metadata (for browsing, listing, searching) |

---

## 4. Google Drive API v3

**No client library** — all calls use `fetch()` directly with the OAuth bearer token.
**Base URL:** `https://www.googleapis.com/drive/v3/`
**Upload URL:** `https://upload.googleapis.com/upload/drive/v3/`

### API Endpoints Used

#### List files/folders
```
GET /drive/v3/files
  ?q={query}
  &fields=files(id,name,mimeType,createdTime,modifiedTime),nextPageToken
  &orderBy=modifiedTime desc
  &pageSize=100
```

Query examples:
- List folders: `mimeType='application/vnd.google-apps.folder' and trashed=false`
- List in parent: `'{folderId}' in parents and trashed=false`
- Find specific folder: `mimeType='...' and name='{name}' and trashed=false and '{parentId}' in parents`
- PDF + images in folder: `'{folderId}' in parents and trashed=false and (mimeType='application/pdf' or mimeType='image/jpeg' ...)`

#### Get single file
```
GET /drive/v3/files/{fileId}?fields=id,name
```

#### Download file content
```
GET /drive/v3/files/{fileId}?alt=media
```
Returns binary content as the response body.

#### Create folder
```
POST /drive/v3/files
Content-Type: application/json
{
  "name": "Family_Finance",
  "mimeType": "application/vnd.google-apps.folder",
  "parents": ["{parentId}"]
}
```

#### Upload file (multipart)
```
POST /upload/drive/v3/files?uploadType=multipart
Authorization: Bearer {token}
Content-Type: multipart/form-data

-- Part 1: JSON metadata
{"name": "2026-03-15_שופרסל_350.pdf", "parents": ["{folderId}"]}

-- Part 2: Binary file data
```

### Folder Tree Created in Drive

```
My Drive/
└── Family_Finance/
    └── {YYYY}/
        └── {MM}/
            └── {Hebrew Category}/
                └── {date}_{vendor}_{amount}.{ext}
```

`getOrCreateFolder()` is idempotent — if the folder already exists, it returns the existing ID without creating a duplicate.

---

## 5. Google GenAI (Gemini API)

**Library:** `@google/genai` v1.29.0
**API Key:** `GEMINI_API_KEY` — environment variable, injected at build time via Vite `define`

### Client Initialization

```typescript
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

### Models In Use

**`gemini-2.0-flash`** (document extraction):
```typescript
ai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: [
    { inlineData: { data: base64, mimeType: 'application/pdf' } },
    { text: extractionPrompt }
  ],
  config: { responseMimeType: "application/json" }
})
```

Accepts binary file data encoded as base64 (inline, no separate file upload step). Returns JSON string.

**`gemini-3-flash-preview`** (insights + chat):
```typescript
// Single call
ai.models.generateContent({
  model: "gemini-3-flash-preview",
  contents: prompt,
  config: {
    responseMimeType: "application/json",
    responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
  }
})

// Multi-turn chat
ai.chats.create({
  model: "gemini-3-flash-preview",
  config: { systemInstruction: "..." }
})
// then: session.sendMessage(text)
```

### Rate Limits (Free Tier)

| Limit | Value | App Response |
|-------|-------|-------------|
| Requests per minute | 15 | 4,500ms delay between calls in SyncService |
| Requests per day | ~1,500 | Shows "daily quota exhausted" error, no retry |

When a 429 is returned, `extractRetryDelay()` parses the `retryDelay` field from Gemini's error response body to get the exact wait time. Default fallback: 30 seconds.

---

## 6. Firebase Hosting

**CLI:** `firebase deploy --only hosting`
**Config:** `firebase.json`

```json
{
  "hosting": {
    "public": "dist",
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

- Serves the Vite build output from `dist/`
- All routes rewrite to `index.html` (SPA mode — React Router handles routing client-side)
- HTTPS enforced automatically
- Global CDN via Firebase/Google infrastructure
- Firebase project: `family-finance-app-c9aa4` (`.firebaserc`)

---

## 7. PWA (Progressive Web App)

**Plugin:** `vite-plugin-pwa` v1.2.0

### Manifest (`public/manifest.json`)
```json
{
  "name": "מערכת חכמה לניהול תקציב משפחתי",
  "short_name": "תקציב משפחתי",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#3b82f6"
}
```

### Icons
- `public/icons/icon-192x192.png` — Home screen icon
- `public/icons/icon-512x512.png` — Splash / large icon
- Apple splash screens: 2048×2732, 2732×2048, 1668×2388 (iPhone/iPad)

### Service Worker
Generated by `vite-plugin-pwa`. Caches all assets after first load. Allows:
- Offline access to the app shell
- Instant load on repeat visits
- "Add to Home Screen" prompt on mobile

---

## Environment Variables Summary

| Variable | Scope | Used By |
|---------|-------|---------|
| `GEMINI_API_KEY` | Server (Vite define → `process.env`) | `ai.ts`, `FileProcessor.ts` |
| `VITE_GOOGLE_CLIENT_ID` | Client (bundled) | `main.tsx` (GoogleOAuthProvider) |
| `VITE_FIREBASE_API_KEY` | Client (bundled) | `firebase.ts` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Client (bundled) | `firebase.ts` |
| `VITE_FIREBASE_PROJECT_ID` | Client (bundled) | `firebase.ts` |
| `VITE_FIREBASE_STORAGE_BUCKET` | Client (bundled) | `firebase.ts` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Client (bundled) | `firebase.ts` |
| `VITE_FIREBASE_APP_ID` | Client (bundled) | `firebase.ts` |

Firebase config values are safe to bundle in the client (they don't grant admin access — Firestore security rules control access, not the API key). `GEMINI_API_KEY` should ideally be server-side only to prevent quota abuse.

---

## Security Checklist

| Item | Status |
|------|--------|
| Firestore rules (production) | ❌ Still `allow read, write: if true` |
| Firestore rules (auth-gated) | 🔲 Needed: `request.auth != null` |
| GEMINI_API_KEY in client bundle | ⚠️ Currently exposed via Vite define |
| Google OAuth scopes minimal | ✅ Only Drive (read + file + metadata) |
| Firebase config in client | ✅ Safe (standard practice) |
| No secrets hardcoded | ✅ All via env vars |
| Input validation (Israeli ID) | ✅ Checksum validated |
| No XSS (React JSX) | ✅ React escapes all output by default |
