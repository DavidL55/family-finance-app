// Analogous to MemberChip, for a Group: name + member count, optional ₪ amount, static `<span>`
// unless an `onClick` is given (then a `<button aria-pressed>`).
import React from 'react';

export interface GroupChipProps {
  name: string;
  memberCount: number;
  amount?: number;
  selected?: boolean;
  onClick?: () => void;
}

export function GroupChip({ name, memberCount, amount, selected = false, onClick }: GroupChipProps): React.JSX.Element {
  const content = (
    <>
      <span className="font-medium">{name}</span>
      <span className="text-slate-400">({memberCount})</span>
      {amount !== undefined && <span className="text-slate-500">₪{amount.toLocaleString('he-IL')}</span>}
    </>
  );

  const baseClasses = 'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm';

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
      // Touch target >= 44px, same rationale as MemberChip.
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
