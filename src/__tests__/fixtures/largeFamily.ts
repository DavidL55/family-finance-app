// Shared 20-member/multi-group fixture — spec §3's "usable with 20 members, verified with
// 20-person demo data" success metric. Reused by MemberMultiSelect.test.tsx and
// ComparisonTable.test.tsx so both are exercised against the same realistic large-family shape
// instead of each inventing its own small array.
export const LARGE_FAMILY_MEMBERS = Array.from({ length: 20 }, (_, i) => ({
  id: `m${i}`, name: `בן משפחה ${i}`, color: '#1F4E78', role: i < 4 ? 'הורה' : 'ילד',
  groups: [], createdAt: 'x', updatedAt: 'x',
})) as any[];

export const LARGE_FAMILY_GROUPS = [
  { id: 'g1', name: 'קבוצה א', memberIds: LARGE_FAMILY_MEMBERS.slice(0, 10).map((m) => m.id), createdAt: 'x', updatedAt: 'x' },
  { id: 'g2', name: 'קבוצה ב', memberIds: LARGE_FAMILY_MEMBERS.slice(10).map((m) => m.id), createdAt: 'x', updatedAt: 'x' },
];
