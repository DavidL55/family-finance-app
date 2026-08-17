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

export interface AiExtractionEgressNoticeProps {
  /** The extraction model the surface's own ModelPicker is currently set to. */
  modelId: string;
  /** Per-surface spacing only — the typography and contrast tokens are fixed here on purpose. */
  className?: string;
}

export default function AiExtractionEgressNotice({
  modelId,
  className = '',
}: AiExtractionEgressNoticeProps): React.JSX.Element {
  // Same list the surface's own picker renders from, so the named recipient and the selected
  // option can never disagree.
  const { models } = useAiModels('extraction');
  const providerId = models.find((m) => m.modelId === modelId)?.providerId ?? null;

  return (
    <p
      data-testid="ai-extraction-egress-notice"
      data-tour-id="ai-extraction-egress-notice"
      // Quiet, but not unreadable, and measured rather than copied: amber-800 is 7.09:1 on white
      // and 6.47:1 on slate-100 — the two backgrounds these four surfaces actually use — so it
      // clears AA on both with room to spare. slate-500, the token the surrounding helper text
      // uses, drops to 4.34:1 on slate-100 and FAILS; indigo-500 fails even on plain white
      // (4.47:1), which is why the chat line went darker too. A disclosure nobody can read is the
      // same as no disclosure — and this one must also be distinguishable from the ordinary
      // slate helper text beside it, or it is read as boilerplate and skipped.
      // No dir/text-align override: <html dir="rtl"> makes RTL the inherited default, and the
      // "ל-Anthropic" construction is the same one the chat line already ships.
      className={`text-xs leading-snug text-amber-800 ${className}`.trim()}
    >
      {aiExtractionEgressNoticeHe(providerId)}
    </p>
  );
}
