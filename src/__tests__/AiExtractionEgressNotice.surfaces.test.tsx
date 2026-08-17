// Stage 6 review fixes batch 3 — THE F4 HOLE ON THE DOCUMENT-EXTRACTION SURFACES.
//
// Batch 2 closed the data-egress disclosure gap on the CHAT surface. It left the same hole open
// on the four surfaces that mount a ModelPicker for `extraction` — FolderLogic, SyncButton,
// AssetCard and InvestmentsImportModal — where the exposure is materially LARGER: those surfaces
// send real bank statements, credit-card files and PDFs to a third-party provider. The settings
// banner does name extraction, but only a super-admin ever opens that screen.
//
// A family uploading a bank statement should be told, at the moment they choose the file, that
// the DOCUMENT ITSELF leaves the house and where it goes. That distinction — the document, not
// merely a question about it — is the whole reason this line is worth showing separately from
// the chat one.
//
// WHY THESE TESTS ARE SHAPED THIS WAY
//
// 1. Asserting "the string exists in src/config/aiDisclosure.ts" is exactly the check that would
//    have PASSED before F4 was found — the copy existed, in a file nobody but a super-admin ever
//    rendered. So every test below drives the REAL surface component and asserts the notice is in
//    ITS rendered DOM, naming the provider ITS picker is currently set to.
//
// 2. THE ROLE AXIS. None of the four components reads a role today — role lives in
//    useAuthSession, which App.tsx consumes and these four do not. That role-blindness is what
//    makes the disclosure unconditional, and it is the property worth PINNING: F4's root cause
//    was a role gate silently swallowing a disclosure. So each surface is parameterised over a
//    'member' and a 'parent' session with useAuthSession mocked to that role. The mock is inert
//    today, deliberately and honestly so — its job is to fail the day someone gates one of these
//    surfaces on the app's one real role source, which is precisely how F4 happened.
//
// 3. THE RACE. Batch 2 hit a real one that only a FULL-SUITE run exposed: the notice is always in
//    the DOM (that is the point — it never waits on a load to appear), so a findByTestId resolves
//    before listAiModels settles, while the line still reads its provider-unknown fallback. Three
//    assertions passed in isolation and failed under load. aiClient is therefore mocked ASYNC
//    here (the real useAiModels hook runs, so the race is real), and every provider-naming
//    assertion sits inside waitFor.
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FolderLogic from '../components/FolderLogic';
import SyncButton from '../components/SyncButton';
import AssetCard, { type Investment, type TypeConfig } from '../components/AssetCard';
import InvestmentsImportModal from '../components/InvestmentsImportModal';
import {
  aiExtractionEgressNoticeHe,
  AI_EXTRACTION_NO_EGRESS_MOCK_HE,
  AI_EXTRACTION_EGRESS_UNKNOWN_PROVIDER_HE,
} from '../config/aiDisclosure';

type ModelRow = {
  providerId: string;
  modelId: string;
  label: string;
  defaultForActions: string[];
  usdInputPer1kTokens: number;
  usdOutputPer1kTokens: number;
};

const MOCK_MODEL: ModelRow = {
  providerId: 'mock', modelId: 'mock-standard', label: 'מודל דמה (ללא מפתח)',
  defaultForActions: ['extraction'], usdInputPer1kTokens: 0, usdOutputPer1kTokens: 0,
};
const GOOGLE_MODEL: ModelRow = {
  providerId: 'google', modelId: 'gemini-3-flash-preview', label: 'Gemini 3 Flash',
  defaultForActions: ['extraction'], usdInputPer1kTokens: 0.0001, usdOutputPer1kTokens: 0.0004,
};
const ANTHROPIC_MODEL: ModelRow = {
  providerId: 'anthropic', modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5',
  defaultForActions: ['extraction'], usdInputPer1kTokens: 0.003, usdOutputPer1kTokens: 0.015,
};

/** Mutable harness — vi.mock factories are hoisted, so they read through this object. */
const H: { models: ModelRow[]; role: string } = { models: [GOOGLE_MODEL], role: 'member' };

// Mocked at the aiClient boundary (not at useAiModels) ON PURPOSE: the real hook then runs, so
// the loading -> ready transition — and the race described above — is genuinely exercised.
vi.mock('../services/aiClient', () => ({
  listAiModels: vi.fn(async () => H.models),
  sendChatMessage: vi.fn(),
}));

// The app's ONE real role source. Inert for these four components today; see note 2 above.
vi.mock('../hooks/useAuthSession', () => ({
  useAuthSession: () => ({ status: 'ready', role: H.role, memberId: 'omer', user: null }),
}));

vi.mock('@react-oauth/google', () => ({ useGoogleLogin: () => vi.fn() }));

vi.mock('../services/GoogleDriveService', () => ({
  fetchFolderContents: vi.fn(async () => ({ folders: [], files: [] })),
  fetchFolderById: vi.fn(),
  downloadFileBuffer: vi.fn(),
  fetchFilesByYearAndCategory: vi.fn(async () => []),
  listFilesInFolder: vi.fn(async () => []),
}));

vi.mock('../services/SyncService', () => ({
  syncFilesFromDrive: vi.fn(),
  getLastSyncTimeFromFirestore: vi.fn(async () => null),
  saveLastSyncTimeToFirestore: vi.fn(),
  organizeAndUploadFile: vi.fn(),
}));

vi.mock('../utils/FileProcessor', () => ({
  extractForReview: vi.fn(),
  commitExtractionDraft: vi.fn(),
  classifyError: vi.fn(() => ({ kind: 'unknown', message: 'x' })),
  CATEGORY_MAP: { General_Misc: 'שונות' },
}));

vi.mock('../services/MembersService', () => ({ listMembers: vi.fn(async () => []) }));
vi.mock('../services/CategoriesService', () => ({
  getCategories: vi.fn(async () => []),
  addCategory: vi.fn(),
}));

vi.mock('../components/ExtractionReviewModal', () => ({ default: () => <div data-testid="review-modal" /> }));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({ addNotification: vi.fn() }),
}));

// framer-motion's exit animations don't settle deterministically under jsdom; presence, not
// animation, is what these tests care about.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, whileHover: _wh, whileTap: _wt, ...rest } = props;
      void _i; void _a; void _e; void _t; void _wh; void _wt;
      return <div {...rest}>{children}</div>;
    },
  }),
}));

const NOTICE = 'ai-extraction-egress-notice';

/** Every provider-naming assertion goes through here — see note 3 on the race. */
async function noticeSaying(expected: string): Promise<HTMLElement> {
  // Re-QUERIES inside the waitFor rather than holding the first match: the surfaces re-render as
  // the model list settles and the auto-select effect fills modelId, and a reference captured
  // before that can be detached from the document by the time the text is right.
  await waitFor(() => expect(screen.getByTestId(NOTICE)).toHaveTextContent(expected));
  return screen.getByTestId(NOTICE);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  H.models = [GOOGLE_MODEL];
  H.role = 'member';
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Surface 1 — FolderLogic: the "העלאת מסמכים חכמה" modal. Bank statements and PDFs, dropped in
// bulk. The single largest-volume egress path in the app.
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function openFolderLogicUpload(): Promise<void> {
  render(<FolderLogic />);
  fireEvent.click(screen.getByRole('button', { name: /העלאת מסמכים/ }));
  await screen.findByTestId(NOTICE);
}

describe('FolderLogic upload modal — document-egress disclosure', () => {
  it.each(['member', 'parent'] as const)(
    'a %s session is told the document itself is sent, and to whom',
    async (role) => {
      H.role = role;
      H.models = [GOOGLE_MODEL];
      await openFolderLogicUpload();

      const notice = await noticeSaying(aiExtractionEgressNoticeHe('google'));
      expect(notice).toHaveTextContent('Google');
      // The distinction that makes this line worth showing at all: the DOCUMENT travels, not a
      // question about it.
      expect(notice).toHaveTextContent('המסמך עצמו');
    }
  );

  it('the named recipient follows the picker — an Anthropic model names Anthropic, not Google', async () => {
    H.models = [ANTHROPIC_MODEL];
    await openFolderLogicUpload();

    const notice = await noticeSaying('Anthropic');
    expect(notice).not.toHaveTextContent('Google');
  });

  it('a mock model does NOT claim an egress that never happens', async () => {
    H.models = [MOCK_MODEL];
    H.role = 'parent';
    await openFolderLogicUpload();

    // The mock adapter answers inside our OWN Cloud Function. Telling a family their bank
    // statement was "sent to מודל דמה" would be a disclosure that states a falsehood — the same
    // defect class the disclosure exists to fix.
    const notice = await noticeSaying(AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('עוזב את המחשב שלך');
    // The AFFIRMATIVE egress claim must be absent. Asserted against 'המסמך עצמו נשלח' and not
    // the bare 'נשלח ל', because the honest mock line legitimately contains the NEGATED form
    // ("...לא נשלח לספק AI חיצוני") — a substring check on the verb alone would fail the very
    // copy it is meant to protect.
    expect(notice).not.toHaveTextContent('המסמך עצמו נשלח');
    expect(notice).not.toHaveTextContent('Google');
  });

  it('with no model resolvable it still discloses the egress rather than rendering nothing', async () => {
    H.models = [];
    await openFolderLogicUpload();
    await noticeSaying(AI_EXTRACTION_EGRESS_UNKNOWN_PROVIDER_HE);
  });

  it('sits between the model picker and the drop zone — where the eye is when the file is chosen', async () => {
    await openFolderLogicUpload();
    const notice = await screen.findByTestId(NOTICE);
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    // Precedes the file control in document order, and follows the picker whose provider it
    // names — never buried under the upload button where it would be read after the fact.
    expect(notice.compareDocumentPosition(fileInput as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('בחירת מודל AI')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Surface 2 — SyncButton: the Drive folder-select browser. Whole folders of statements.
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function openSyncFolderBrowser(): Promise<void> {
  sessionStorage.setItem('drive_token', 'tok');
  render(<SyncButton />);
  // Token present, no folder chosen yet → handleSyncClick opens the Drive folder browser, which
  // is the surface that carries the extraction picker.
  fireEvent.click(await screen.findByText('סנכרן עם גוגל דרייב'));
  await screen.findByTestId(NOTICE);
}

describe('SyncButton folder browser — document-egress disclosure', () => {
  it.each(['member', 'parent'] as const)(
    'a %s session is told the document itself is sent, and to whom',
    async (role) => {
      H.role = role;
      await openSyncFolderBrowser();
      const notice = await noticeSaying(aiExtractionEgressNoticeHe('google'));
      expect(notice).toHaveTextContent('המסמך עצמו');
    }
  );

  it('a mock model does NOT claim an egress that never happens', async () => {
    H.models = [MOCK_MODEL];
    await openSyncFolderBrowser();
    const notice = await noticeSaying(AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('עוזב את המחשב שלך');
  });

  it('sits with the model picker it names, above the folder list the files are chosen from', async () => {
    await openSyncFolderBrowser();
    const notice = await screen.findByTestId(NOTICE);
    const picker = screen.getByLabelText('בחירת מודל AI');
    expect(picker.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Surface 3 — AssetCard: a single quarterly pension/investment statement, uploaded per asset.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const INV: Investment = {
  id: 1, name: 'קרן פנסיה', type: 'pension', value: 1000, monthlyDeposit: 0,
  returnPct: 0, returnVal: 0,
};
const CONFIG: TypeConfig = {
  label: 'פנסיה', color: 'text-indigo-600', bg: 'bg-indigo-50', chartColor: '#4338ca',
  icon: () => null,
};

function renderAssetCard(): void {
  render(<AssetCard inv={INV} config={CONFIG} onUpdate={() => undefined} />);
}

describe('AssetCard quarterly upload — document-egress disclosure', () => {
  it.each(['member', 'parent'] as const)(
    'a %s session is told the document itself is sent, and to whom',
    async (role) => {
      H.role = role;
      renderAssetCard();
      const notice = await noticeSaying(aiExtractionEgressNoticeHe('google'));
      expect(notice).toHaveTextContent('המסמך עצמו');
      expect(notice).toHaveTextContent('Google');
    }
  );

  it('a mock model does NOT claim an egress that never happens', async () => {
    H.models = [MOCK_MODEL];
    renderAssetCard();
    const notice = await noticeSaying(AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('עוזב את המחשב שלך');
  });

  it('sits between the model picker and the file-choose button', async () => {
    renderAssetCard();
    const notice = await screen.findByTestId(NOTICE);
    const picker = screen.getByLabelText('בחירת מודל AI');
    const fileInput = document.querySelector('input[type="file"]');
    expect(picker.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(fileInput as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Surface 4 — InvestmentsImportModal: the Drive browser for investment/pension reports.
// ─────────────────────────────────────────────────────────────────────────────────────────────
async function openInvestmentsImport(): Promise<void> {
  sessionStorage.setItem('drive_token', 'tok');
  render(<InvestmentsImportModal isOpen onClose={() => undefined} onSuccess={() => undefined} />);
  await screen.findByTestId(NOTICE);
}

describe('InvestmentsImportModal — document-egress disclosure', () => {
  it.each(['member', 'parent'] as const)(
    'a %s session is told the document itself is sent, and to whom',
    async (role) => {
      H.role = role;
      await openInvestmentsImport();
      const notice = await noticeSaying(aiExtractionEgressNoticeHe('google'));
      expect(notice).toHaveTextContent('המסמך עצמו');
    }
  );

  it('a mock model does NOT claim an egress that never happens', async () => {
    H.models = [MOCK_MODEL];
    await openInvestmentsImport();
    const notice = await noticeSaying(AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('עוזב את המחשב שלך');
  });

  it('sits with the model picker it names, above the folder list', async () => {
    await openInvestmentsImport();
    const notice = await screen.findByTestId(NOTICE);
    const picker = screen.getByLabelText('בחירת מודל AI');
    expect(picker.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ROLE AXIS, MADE LOAD-BEARING.
//
// The per-surface member/parent cases above render the real components, but they cannot FAIL on a
// future role gate: none of the four reads a role today, so the useAuthSession mock is inert (see
// note 2 at the top of this file). That is an honest limit, and leaving it there would repeat the
// mistake F4 was — a disclosure that looks covered and isn't.
//
// So this is the guard that actually bites. F4's mechanism was precisely a super-admin gate
// swallowing a disclosure; the structural fact that keeps these four unconditional is that
// neither they nor the notice component mention a role at all. Same grep-guard technique the
// project already uses for the Functions-mirroring constraint and the transaction write guard.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the extraction disclosure is unconditional — no role can be gated out of it', () => {
  const SURFACES = [
    'src/components/FolderLogic.tsx',
    'src/components/SyncButton.tsx',
    'src/components/AssetCard.tsx',
    'src/components/InvestmentsImportModal.tsx',
    'src/components/AiExtractionEgressNotice.tsx',
  ];

  it.each(SURFACES)('%s contains no role check that could hide the notice from a member', (rel) => {
    const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
    // Any of these appearing in one of these files means someone introduced a role concept where
    // there was none — the exact move that put the original banner behind a super-admin screen.
    // If a legitimate need for one ever arises, this guard must be changed deliberately (and
    // reviewed), which is the whole point of it being here rather than in a comment.
    expect(src).not.toMatch(/super-admin/);
    expect(src).not.toMatch(/isSuperAdmin/);
    expect(src).not.toMatch(/useAuthSession/);
    expect(src).not.toMatch(/useResolvedPermissions/);
  });

  it('every extraction ModelPicker in the codebase has the disclosure mounted beside it', () => {
    // The four surfaces are the four that exist today. This fails the day a FIFTH extraction
    // surface is added without the notice — the way this hole opened in the first place, when
    // Task 7 added extraction pickers to four files and the disclosure stayed on one screen.
    const withPicker = SURFACES.slice(0, 4).filter((rel) => {
      const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
      return /<ModelPicker\s+action="extraction"/.test(src);
    });
    expect(withPicker).toHaveLength(4);
    for (const rel of withPicker) {
      const src = readFileSync(resolve(__dirname, '../..', rel), 'utf8');
      expect(src).toMatch(/<AiExtractionEgressNotice\s/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 5 — SyncButton's THREE TRIGGERS THAT HAVE NO PICKER, and therefore had no disclosure.
//
// Batch 3 covered every surface that MOUNTS a ModelPicker. SyncButton has three extraction
// triggers that do not:
//
//   handleStartSync           whole folder / incremental / custom range   (Sync-mode modal)
//   handleSyncSelectedMonths  the month board                            (Month board footer)
//   handleCategoryImport      year+category bulk import                  (Sync-mode modal)
//
// The first two pass NO modelId at all — SyncService.syncFilesFromDrive resolves
// listAiModels('extraction')[0] itself, by Task 7's explicit design for an unattended trigger
// (no human is present to pick). Whole-folder sync is the highest-volume egress path in the app,
// and on the common repeat-use path the folder id is already in localStorage, so the user never
// opens the folder browser and never sees batch 3's notice.
//
// WHY THE NOTICE COULD NOT SIMPLY BE RENDERED OFF SyncButton'S OWN `modelId` STATE.
//
// That state is the PICKER's value. It agrees with what SyncService will actually call only
// until the user switches the picker — after which a notice driven by it would name the WRONG
// provider on these two triggers. That is the "a disclosure that states a falsehood" defect the
// mock line exists to avoid, reproduced. So the notice resolves the provider AT THE POINT OF
// USE: `source="default"` resolves listAiModels('extraction')[0] — the same expression, off the
// same list, that SyncService itself uses — independently of the picker.
//
// handleCategoryImport is the opposite case: it DOES pass the picker's modelId, so its notice
// takes `source="picker"`. The two live in the same modal and are allowed to disagree, because
// on those two buttons the app genuinely does two different things.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const NOTICE_SYNC = 'ai-extraction-egress-notice-sync';
const NOTICE_MONTHS = 'ai-extraction-egress-notice-months';
const NOTICE_CATEGORY = 'ai-extraction-egress-notice-category';

/** Re-queries inside waitFor for the same detached-node reason noted at the top of this file. */
async function idSaying(testId: string, expected: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByTestId(testId)).toHaveTextContent(expected));
  return screen.getByTestId(testId);
}

/**
 * Drives the real component to the month board: a folder id already in localStorage is the
 * COMMON REPEAT-USE PATH — the folder browser (and batch 3's notice) is never opened at all.
 */
async function openMonthBoard(): Promise<void> {
  const { fetchFolderContents } = await import('../services/GoogleDriveService');
  sessionStorage.setItem('drive_token', 'tok');
  localStorage.setItem('drive_folder_id', 'root-folder');
  localStorage.setItem('drive_folder_name', 'Family_Finance');
  render(<SyncButton />);
  fireEvent.click(await screen.findByText('מחובר לדרייב'));
  await waitFor(() => expect(fetchFolderContents).toHaveBeenCalled());
}

describe('SyncButton month board — the trigger that passes NO modelId', () => {
  beforeEach(async () => {
    const { fetchFolderContents } = await import('../services/GoogleDriveService');
    // Root holds a year folder, the year holds a month folder → a real month board with a
    // "סנכרן N חודשים" button, which is handleSyncSelectedMonths' only entry point.
    vi.mocked(fetchFolderContents).mockImplementation(async (_t: string, id?: string) =>
      id === 'root-folder'
        ? { folders: [{ id: 'y2026', name: '2026' }], files: [] }
        : { folders: [{ id: 'm01', name: '01' }], files: [] }
    );
  });

  it.each(['member', 'parent'] as const)(
    'a %s session is told the document itself is sent, and to whom, without ever opening the folder browser',
    async (role) => {
      H.role = role;
      await openMonthBoard();

      const notice = await idSaying(NOTICE_MONTHS, aiExtractionEgressNoticeHe('google'));
      expect(notice).toHaveTextContent('המסמך עצמו');
      expect(notice).toHaveTextContent('Google');
      // The picker's notice is NOT what is being read here — this path never renders it.
      expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument();
    }
  );

  it('names the DEFAULT model provider, not whatever a picker elsewhere holds', async () => {
    // Two extraction models configured. SyncService resolves [0]; a picker would let the user
    // choose [1]. The month-board notice must name [0]'s provider — the one that will actually
    // receive the files — no matter what any picker holds.
    H.models = [ANTHROPIC_MODEL, GOOGLE_MODEL];
    await openMonthBoard();

    const notice = await idSaying(NOTICE_MONTHS, 'Anthropic');
    expect(notice).not.toHaveTextContent('Google');
  });

  it('a mock default does NOT claim an egress that never happens', async () => {
    H.models = [MOCK_MODEL];
    await openMonthBoard();

    const notice = await idSaying(NOTICE_MONTHS, AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    // Asserted on 'המסמך עצמו נשלח' and the provider label, NOT on the bare 'נשלח ל' — the
    // honest negated form ('לא נשלח לספק') contains that substring and would pass vacuously.
    expect(notice).not.toHaveTextContent('המסמך עצמו נשלח');
    expect(notice).not.toHaveTextContent('עוזב את המחשב שלך');
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE TEST THAT ACTUALLY SEPARATES `default` FROM `picker`, by driving the one path where the
  // two genuinely diverge.
  //
  // The cases above cannot do it on their own: SyncButton auto-selects models[0] into its picker
  // state, so while the user leaves the picker alone, `modelId` and the default are the SAME
  // value and a notice wired to either one reads identically. (Confirmed by mutation — swapping
  // this notice to source="picker" left every behavioural assertion above passing, and only the
  // structural guard failed. That is precisely the "passes for the wrong reason" shape.)
  //
  // They diverge only after the user SWITCHES the picker, which is reachable and ordinary: the
  // folder browser carries the picker, `modelId` persists in component state after that panel
  // closes, and the month board then runs an unattended sync that ignores it entirely. This is
  // the exact scenario that made a picker-driven notice unshippable — it would name the switched
  // provider while SyncService called the default one.
  // ───────────────────────────────────────────────────────────────────────────────────────────
  it('still names the DEFAULT after the user switches the picker in the folder browser — the picker does not govern this trigger', async () => {
    H.models = [GOOGLE_MODEL, ANTHROPIC_MODEL]; // default (SyncService's [0]) is Google
    const { fetchFolderContents } = await import('../services/GoogleDriveService');
    vi.mocked(fetchFolderContents).mockImplementation(async (_t: string, id?: string) =>
      id === 'root' || id === undefined
        ? { folders: [{ id: 'root-folder', name: 'Family_Finance' }], files: [] }
        : id === 'root-folder'
          ? { folders: [{ id: 'y2026', name: '2026' }], files: [] }
          : { folders: [{ id: 'm01', name: '01' }], files: [] }
    );

    sessionStorage.setItem('drive_token', 'tok');
    render(<SyncButton />); // no folder in localStorage → the folder browser opens
    fireEvent.click(await screen.findByText('סנכרן עם גוגל דרייב'));

    // The browser's own picker-driven notice names the default too, until it is switched.
    await noticeSaying('Google');
    fireEvent.change(await screen.findByLabelText('בחירת מודל AI'), {
      target: { value: ANTHROPIC_MODEL.modelId },
    });
    await noticeSaying('Anthropic'); // the picker's notice follows the picker, correctly

    // Choose the folder: closes the browser, and `modelId` stays switched in component state.
    fireEvent.click(await screen.findByText('Family_Finance'));
    fireEvent.click(await screen.findByText('מחובר לדרייב'));

    // handleSyncSelectedMonths ignores modelId entirely — SyncService resolves [0] = Google.
    const notice = await idSaying(NOTICE_MONTHS, 'Google');
    expect(notice).not.toHaveTextContent('Anthropic');
  });

  it('sits above the sync button it describes — read before the files are sent, not after', async () => {
    await openMonthBoard();
    await idSaying(NOTICE_MONTHS, 'Google');

    const notice = screen.getByTestId(NOTICE_MONTHS);
    // By ROLE, not by text: the board's own heading reads 'בחר חודשים לסנכרון', so a text query
    // for the button's label matches the heading as well and resolves to two nodes.
    const syncBtn = screen.getByRole('button', { name: 'בחר חודשים' });
    expect(notice.compareDocumentPosition(syncBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('SyncButton sync-mode modal — whole folder / incremental / custom range', () => {
  /** An unstructured folder (no YYYY subfolders) routes the board to its "sync the whole folder" offer. */
  async function openSyncModeModal(): Promise<void> {
    const { fetchFolderContents } = await import('../services/GoogleDriveService');
    vi.mocked(fetchFolderContents).mockResolvedValue({ folders: [], files: [] });
    await openMonthBoard();
    fireEvent.click(await screen.findByText('סנכרן את כל התיקייה'));
  }

  it.each(['member', 'parent'] as const)(
    'a %s session is told, before pressing any of the three whole-folder buttons, where the documents go',
    async (role) => {
      H.role = role;
      await openSyncModeModal();

      const notice = await idSaying(NOTICE_SYNC, aiExtractionEgressNoticeHe('google'));
      expect(notice).toHaveTextContent('המסמך עצמו');
      // Precedes all three handleStartSync entry points in document order.
      for (const label of ['סנכרן את כל התיקייה', 'סנכרן חדש בלבד', 'בחר טווח תאריכים']) {
        const btn = screen.getByText(label);
        expect(notice.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
  );

  it('names the DEFAULT model provider — this trigger passes no modelId, so a picker cannot govern it', async () => {
    H.models = [ANTHROPIC_MODEL, GOOGLE_MODEL];
    await openSyncModeModal();
    const notice = await idSaying(NOTICE_SYNC, 'Anthropic');
    expect(notice).not.toHaveTextContent('Google');
  });

  it('a mock default does NOT claim an egress that never happens', async () => {
    H.models = [MOCK_MODEL];
    await openSyncModeModal();
    const notice = await idSaying(NOTICE_SYNC, AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('המסמך עצמו נשלח');
  });

  it('the CATEGORY import gets its own notice, following its own picker value rather than the default', async () => {
    // The one trigger in this modal that DOES pass SyncButton's picker modelId. It is allowed to
    // name a different provider than the whole-folder line beside it, because it genuinely calls
    // a different model — that is the fact being disclosed, not a bug.
    await openSyncModeModal();
    await idSaying(NOTICE_SYNC, 'Google');

    fireEvent.click(screen.getByText('ייבוא לפי קטגוריה'));
    const notice = await idSaying(NOTICE_CATEGORY, aiExtractionEgressNoticeHe('google'));
    expect(notice).toHaveTextContent('המסמך עצמו');
    const importBtn = screen.getByText('התחל ייבוא');
    expect(notice.compareDocumentPosition(importBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a mock model does NOT claim an egress on the category import either', async () => {
    H.models = [MOCK_MODEL];
    await openSyncModeModal();
    fireEvent.click(screen.getByText('ייבוא לפי קטגוריה'));
    const notice = await idSaying(NOTICE_CATEGORY, AI_EXTRACTION_NO_EGRESS_MOCK_HE);
    expect(notice).not.toHaveTextContent('המסמך עצמו נשלח');
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE CORRESPONDENCE THAT MAKES `source="default"` TRUE, PINNED STRUCTURALLY.
//
// The whole-folder and month-board notices are honest only while the notice's default
// resolution and SyncService's own default resolution are THE SAME EXPRESSION over the same
// list. Nothing in the type system ties them together — it is a correspondence between two
// files, which is exactly the shape that rots silently. If SyncService ever picks its default
// differently (a config key, a stored preference, a per-folder override), these two notices
// start naming a provider that is not the one receiving the documents — a disclosure that
// states a falsehood, the defect class this whole line of work exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the unattended default resolution is the same one the notice names', () => {
  it('SyncService still resolves its extraction model as listAiModels(\'extraction\')[0]', () => {
    const src = readFileSync(resolve(__dirname, '../..', 'src/services/SyncService.ts'), 'utf8');
    expect(src).toMatch(/listAiModels\(\s*'extraction'\s*\)/);
    // Indexes the FIRST entry, with no other selection step in between.
    expect(src).toMatch(/extractionModels\[0\]\?\.modelId/);
  });

  it('AiExtractionEgressNotice resolves its default off the same first entry of the same list', () => {
    const src = readFileSync(resolve(__dirname, '../..', 'src/components/AiExtractionEgressNotice.tsx'), 'utf8');
    expect(src).toMatch(/useAiModels\(\s*'extraction'\s*\)/);
    expect(src).toMatch(/models\[0\]/);
  });

  it('SyncButton mounts a notice for every one of its extraction triggers', () => {
    const src = readFileSync(resolve(__dirname, '../..', 'src/components/SyncButton.tsx'), 'utf8');
    // Three no-picker triggers + the folder browser's picker-driven one = four mounts. This
    // fails the day a fifth trigger is added without a disclosure, which is exactly how the
    // three covered here came to be uncovered in the first place.
    expect(src.match(/<AiExtractionEgressNotice\b/g) ?? []).toHaveLength(4);
    // Both no-picker triggers must resolve the DEFAULT, never the picker's value. Anchored to
    // the JSX TAG, not the bare attribute: the first version of this assertion counted
    // `source="default"` anywhere in the file and passed at 4 because the comments explaining
    // the choice contain the same text. A test a comment can satisfy is not a test.
    expect(src.match(/<AiExtractionEgressNotice source="default"/g) ?? []).toHaveLength(2);
    expect(src.match(/<AiExtractionEgressNotice source="picker"/g) ?? []).toHaveLength(2);
  });
});
