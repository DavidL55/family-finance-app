// Task 6 (Stage 6) — D5's model switcher, built once and reused (not cloned) across every
// action's manual call sites (Task 7 reuses this same component for extraction). A labeled
// <select> matching this project's existing form-control conventions (InsurancesScreen's
// insuredMemberId select is the precedent this mirrors: plain <select>, min-h-[44px] touch
// target, aria-label). Spec §8 names a real switcher for 'chat' and 'extraction'; 'insight' has
// no UI trigger yet (D5 — no insight engine exists to trigger until Stage 8).
import React from 'react';
import { useAiModels } from '../hooks/useAiModels';
import type { AiActionId } from '../../functions/src/providers/types';

export interface ModelPickerProps {
  action: AiActionId;
  value: string;
  onChange: (modelId: string) => void;
}

export default function ModelPicker({ action, value, onChange }: ModelPickerProps): React.JSX.Element {
  const modelsState = useAiModels(action);
  const selected = modelsState.models.find((m) => m.modelId === value);
  const isMock = selected?.providerId === 'mock';

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-600 whitespace-nowrap">מודל</span>
        <select
          aria-label="בחירת מודל AI"
          data-tour-id="ai-model-picker"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={modelsState.status !== 'ready' || modelsState.models.length === 0}
          className="border border-slate-300 rounded-lg px-3 py-2 min-h-[44px] text-sm bg-white disabled:bg-slate-100 disabled:text-slate-400"
        >
          {modelsState.status === 'loading' && <option value="">טוען מודלים…</option>}
          {modelsState.status === 'ready' && modelsState.models.length === 0 && (
            <option value="">אין מודל זמין</option>
          )}
          {modelsState.models.map((m) => (
            <option key={m.modelId} value={m.modelId}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {/* D10 — a distinctly-styled badge, never plain text, so nobody mistakes a canned mock
          response for a real model's answer. */}
      {isMock && (
        <span
          data-tour-id="ai-mock-badge"
          className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-xs font-medium"
        >
          מודל דמה
        </span>
      )}
      {modelsState.status === 'error' && (
        <span className="text-xs text-slate-600">{modelsState.error ?? 'שגיאה בטעינת רשימת המודלים'}</span>
      )}
    </div>
  );
}
