// Stage 6 review fixes batch 3 — the document-egress disclosure for the four extraction surfaces.
//
// WHY A COMPONENT HERE, WHEN THE CHAT SURFACE GOT ONLY A SHARED STRING.
//
// Dashboard could take the string alone because it is ONE surface and it already held a
// useAiModels('chat') call for the per-answer model badge — the provider resolution was free.
// The four extraction surfaces are a different situation: FolderLogic, SyncButton, AssetCard and
// InvestmentsImportModal are byte-for-byte identical in the part that matters (each holds a
// `modelId` string and mounts <ModelPicker action="extraction" />), and NONE of them resolves a
// providerId today. A shared-string-only fix would therefore have copied the models-list lookup,
// the contrast token and the test id into four files — and "duplicating that map is how the F4
// class starts" is this project's own recorded lesson. One of the four going quietly stale after
// a later edit is the exact failure mode F4 was.
//
// So: the RESOLUTION and the RENDERING live once, here; the PLACEMENT stays per-surface, because
// the four layouts genuinely differ (a full-page upload modal, two Drive folder browsers, and a
// small card). Each surface mounts this where its own eye-line is and passes a `className` for
// its own spacing. Shared where the surfaces are the same, per-surface where they really differ.
//
// The extra listAiModels call alongside ModelPicker's own is deliberate and follows the precedent
// Dashboard set for exactly this: listAiModels is cheap metadata behind no cost gate (D5).
import React from 'react';
import { useAiModels } from '../hooks/useAiModels';
import { aiExtractionEgressNoticeHe } from '../config/aiDisclosure';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BATCH 5 — the SECOND way a surface knows which provider will receive the document.
//
// Batch 3 assumed every extraction trigger sits beside a ModelPicker. Three of SyncButton's do
// not: handleStartSync (whole folder / incremental / custom range) and handleSyncSelectedMonths
// pass NO modelId at all, because SyncService.syncFilesFromDrive resolves
// listAiModels('extraction')[0] itself — Task 7's explicit design for an UNATTENDED trigger,
// where no human is present to choose. Whole-folder sync is the highest-volume egress path in
// the app.
//
// Rendering those notices off SyncButton's own `modelId` state would have been wrong, not merely
// imprecise: that state is the PICKER's value, and it agrees with what SyncService will call
// only until the user switches the picker. After that the notice would name a provider that
// never receives anything — a disclosure that states a falsehood, the same defect class the mock
// line below exists to avoid. So the provider is resolved AT THE POINT OF USE instead.
//
// A STRING discriminant, not a boolean or an optional `modelId`: the root tsconfig is not strict,
// so a boolean discriminant would not narrow, and an optional modelId would let a caller silently
// pass neither. `source` makes the two cases impossible to confuse and impossible to omit.
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type AiExtractionEgressNoticeSource =
  /** The surface mounts a ModelPicker and the user's choice governs — pass the picker's value. */
  | { source: 'picker'; modelId: string }
  /**
   * The surface has no picker: the app resolves the model itself, and this notice must name
   * whatever THAT resolution produces. Mirrors SyncService's own `listAiModels('extraction')[0]`
   * — a correspondence between two files, pinned by a structural test in
   * AiExtractionEgressNotice.surfaces.test.tsx because nothing in the type system ties them.
   */
  | { source: 'default' };

export type AiExtractionEgressNoticeProps = AiExtractionEgressNoticeSource & {
  /** Per-surface spacing only — the typography and contrast tokens are fixed here on purpose. */
  className?: string;
  /**
   * Overrides the test/tour id. SyncButton mounts FOUR of these — one per extraction trigger —
   * and two can be on screen at once (the sync-mode modal carries both the whole-folder line and
   * the category-import one), so a single shared id would make them indistinguishable to a query
   * and to a future guided tour alike.
   */
  noticeId?: string;
};

export default function AiExtractionEgressNotice(
  props: AiExtractionEgressNoticeProps
): React.JSX.Element {
  const { className = '', noticeId = 'ai-extraction-egress-notice' } = props;

  // Same list the surface's own picker renders from, so the named recipient and the selected
  // option can never disagree — and, for `source: 'default'`, the same list SyncService itself
  // reads, so the named recipient is the one that will actually receive the documents.
  const { models } = useAiModels('extraction');
  const providerId =
    props.source === 'picker'
      ? models.find((m) => m.modelId === props.modelId)?.providerId ?? null
      : models[0]?.providerId ?? null;

  return (
    <p
      data-testid={noticeId}
      data-tour-id={noticeId}
      // Quiet, but not unreadable, and measured rather than copied: amber-800 clears WCAG AA on
      // every background these surfaces paint text on, with room to spare. A disclosure nobody
      // can read is the same as no disclosure — and this one must also be DISTINGUISHABLE from
      // the ordinary helper text beside it, or it is read as boilerplate and skipped, which is
      // why it is not simply the same darker slate the helper text now uses.
      //
      // Batch 5 — the numbers that used to be written out here are GONE ON PURPOSE, and so is
      // the claim that "slate-500 is the token the surrounding helper text uses". The first was
      // a hardcoded measurement that a Tailwind palette change would silently falsify; the
      // second stopped being true the moment batch 5 fixed that helper text (slate-500 failed AA
      // on slate-100, which is what the measurement turned up). Both now live in
      // src/__tests__/AiExtractionSurfaces.contrast.test.ts, which DERIVES the ratios from the
      // installed Tailwind theme and fails if any of them stops holding.
      // No dir/text-align override: <html dir="rtl"> makes RTL the inherited default, and the
      // "ל-Anthropic" construction is the same one the chat line already ships.
      className={`text-xs leading-snug text-amber-800 ${className}`.trim()}
    >
      {aiExtractionEgressNoticeHe(providerId)}
    </p>
  );
}
