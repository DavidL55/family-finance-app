// Live, daily-use מי selector (spec §5.3) — NOT just a flat chip row. Ofra ruling I3: this is
// the control a user touches every day, so it gets the large-family search/collapse treatment
// FIRST (the unwired ComparisonTable primitive got it before this did — that was backwards).
// Reuses the exact showAll/query pattern ComparisonTable uses below, so both large-family
// controls in this codebase behave identically.
//
// Selection-transition rules (see MemberMultiSelect.test.tsx):
//   - clicking a member while mode !== 'members' starts a fresh single-member selection.
//   - clicking a member while mode === 'members' toggles it in/out of memberIds.
//   - toggling the last selected member off falls back to mode 'all' (never an empty
//     'members' selection sitting around meaning nothing).
//   - clicking the "כולם" chip always resets to mode 'all'.
//   - clicking a group chip switches to mode 'group'; clicking the ALREADY-ACTIVE group chip
//     again returns to mode 'all' (a toggle, not a one-way switch).
import React, { useMemo, useState } from 'react';
import { MemberChip } from './MemberChip';
import { GroupChip } from './GroupChip';
import type { Member } from '../utils/seedFromBudgetConfig';
import type { Group } from '../types/permissions';
import type { MemberSelection } from '../types/filters';

export interface MemberMultiSelectProps {
  members: Member[];
  groups: Group[];
  value: MemberSelection;
  onChange: (next: MemberSelection) => void;
}

// Same threshold ComparisonTable uses as its default topN — above this, a flat chip row stops
// being usable (spec §3's 20-member success metric) and needs search + collapse.
const LARGE_FAMILY_THRESHOLD = 8;

export function MemberMultiSelect({ members, groups, value, onChange }: MemberMultiSelectProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const isLargeFamily = members.length > LARGE_FAMILY_THRESHOLD;

  const filteredMembers = useMemo(() => {
    const q = query.trim();
    if (!q) return members;
    return members.filter((m) => m.name.includes(q));
  }, [members, query]);

  const isSearching = isLargeFamily && query.trim().length > 0;
  // Small families never collapse — they stay exactly as simple as they were before this
  // large-family treatment existed. A search query bypasses the collapse entirely (the whole
  // point of searching is to see the actual match, not a truncated top-N).
  const visibleMembers = isLargeFamily && !isSearching && !showAll
    ? filteredMembers.slice(0, LARGE_FAMILY_THRESHOLD)
    : filteredMembers;
  const hiddenCount = filteredMembers.length - visibleMembers.length;

  const selectAll = () => onChange({ mode: 'all', memberIds: [], groupId: null });

  const toggleMember = (memberId: string) => {
    if (value.mode !== 'members') {
      onChange({ mode: 'members', memberIds: [memberId], groupId: null });
      return;
    }
    const alreadySelected = value.memberIds.includes(memberId);
    const nextIds = alreadySelected
      ? value.memberIds.filter((id) => id !== memberId)
      : [...value.memberIds, memberId];
    onChange(
      nextIds.length === 0
        ? { mode: 'all', memberIds: [], groupId: null }
        : { mode: 'members', memberIds: nextIds, groupId: null }
    );
  };

  const selectGroup = (groupId: string) => {
    if (value.mode === 'group' && value.groupId === groupId) {
      onChange({ mode: 'all', memberIds: [], groupId: null });
    } else {
      onChange({ mode: 'group', memberIds: [], groupId });
    }
  };

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex flex-wrap gap-2">
        <MemberChip name="כולם" color="#94A3B8" selected={value.mode === 'all'} onClick={selectAll} />
        {groups.map((g) => (
          <GroupChip
            key={g.id}
            name={g.name}
            memberCount={g.memberIds.length}
            selected={value.mode === 'group' && value.groupId === g.id}
            onClick={() => selectGroup(g.id)}
          />
        ))}
      </div>

      {isLargeFamily && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם..."
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-[44px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {visibleMembers.map((m) => (
          <MemberChip
            key={m.id}
            name={m.name}
            color={m.color}
            selected={value.mode === 'members' && value.memberIds.includes(m.id)}
            onClick={() => toggleMember(m.id)}
          />
        ))}
      </div>

      {isLargeFamily && !isSearching && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-sm text-blue-600 hover:underline min-h-[44px]"
        >
          {`הצג את כל ה־${members.length} חברים`}
        </button>
      )}
    </div>
  );
}
