// Small presentational primitive — a per-member color dot + name (spec §5.4, stable per-member
// color from the member's own `color` field, never recomputed here). Renders as a plain, static
// `<span>` when no `onClick` is given (not interactive when not needed), or a `<button
// aria-pressed>` when the caller wants it clickable/selectable — matches PermissionsManager's
// existing member-row markup (color dot + name) but factored into a reusable component so every
// screen that needs to show "a member" stops inventing its own chip markup.
import React from 'react';

export interface MemberChipProps {
  name: string;
  color: string;
  selected?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export function MemberChip({ name, color, selected = false, onClick, size = 'md' }: MemberChipProps): React.JSX.Element {
  const sizeClasses = size === 'sm' ? 'text-xs px-2 py-1 gap-1' : 'text-sm px-3 py-1.5 gap-1.5';
  const dotSizeClasses = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';

  const content = (
    <>
      <span className={`${dotSizeClasses} rounded-full flex-shrink-0`} style={{ backgroundColor: color }} />
      <span className="font-medium">{name}</span>
    </>
  );

  const baseClasses = `inline-flex items-center rounded-full border ${sizeClasses}`;

  if (!onClick) {
    return (
      <span className={`${baseClasses} bg-slate-50 border-slate-200 text-slate-700`}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      // Touch target >= 44px per the brief's binding requirement — the visual chip stays
      // compact, but the tappable area (padding) is expanded via min-height/min-width so this
      // still works comfortably on a phone in a dense member list.
      className={`${baseClasses} min-h-[44px] transition-colors ${
        selected
          ? 'bg-blue-50 border-blue-400 text-blue-800'
          : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {content}
    </button>
  );
}
