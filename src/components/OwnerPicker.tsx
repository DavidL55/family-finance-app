// D7 — shared by all four (eventually five) owned-collection create/edit forms. Only a
// 'family'-level editor can create/edit a record for someone other than themselves —
// ownedModuleAllowed() denies anything else server-side — so an 'own'/'none'-level editor is
// never shown a control that lies about what submitting it will do; they get a fixed, read-only
// identity chip instead.
//
// Binding requirement (Stage 5 Task 3 dispatch, overriding the plan's own illustrative snippet):
// a bare `<select>` loses the color/identity system the rest of the app trained users on
// (MemberChip — see MemberMultiSelect.tsx's identical reuse of the same primitive for the מי
// filter). This renders one MemberChip per member instead, reusing the exact selectable-chip
// pattern already established there rather than inventing a second one.
import React from 'react';
import { MemberChip } from './MemberChip';
import type { Member } from '../utils/seedFromBudgetConfig';

export interface OwnerPickerProps {
  members: Member[];
  value: string; // current ownerId
  onChange: (ownerId: string) => void;
  editLevel: 'own' | 'family' | 'none'; // resolveOwnedModuleScope's own output, reused directly
  actingMemberId: string;
}

export function OwnerPicker({ members, value, onChange, editLevel, actingMemberId }: OwnerPickerProps): React.JSX.Element {
  const actingMember = members.find((m) => m.id === actingMemberId);

  if (editLevel !== 'family') {
    // D7 — an 'own'/'none'-level editor can only ever create/edit for themselves; the Rules layer
    // would deny any other ownerId on write. A static (non-clickable) MemberChip — the identity
    // system's own read-only shape, per its own doc comment — names who the record belongs to
    // without offering a choice that would silently fail on submit.
    return (
      <div dir="rtl" className="space-y-1.5">
        <span className="text-sm text-slate-600 block">בעלים</span>
        <MemberChip name={actingMember?.name ?? ''} color={actingMember?.color ?? '#94A3B8'} />
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-1.5" role="group" aria-label="בעלים">
      <span className="text-sm text-slate-600 block">בעלים</span>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <MemberChip
            key={m.id}
            name={m.name}
            color={m.color}
            selected={m.id === value}
            onClick={() => onChange(m.id)}
          />
        ))}
      </div>
    </div>
  );
}
