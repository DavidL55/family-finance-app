// src/components/NavGroup.tsx — Stage 8 S2. One collapsible section of the nav menu.
//
// Controlled: open/onToggle belong to the CALLER (App decides which groups are open, persists
// the choice, and keeps the active screen's group open). This component only renders — a real
// <button> header with aria-expanded, chevron as decoration, children only while open.
import React from 'react';
import { ChevronDown } from 'lucide-react';

export function NavGroup({
  labelHe,
  open,
  onToggle,
  children,
}: {
  labelHe: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors"
      >
        <span>{labelHe}</span>
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="space-y-1">{children}</div>}
    </div>
  );
}
