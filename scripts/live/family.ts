// scripts/live/family.ts — the five family members and the doc shapes bootstrapped for them.
// Shared by bootstrap-live.ts (emulator REST) and cloud/bootstrap-owner.ts (Admin SDK), so the
// two cannot drift apart: this file owns the data contract, each script only owns its transport.

export interface FamilyMember {
  memberId: string;
  first: string;
  nameHe: string;
  role: 'super-admin' | 'parent' | 'member';
  memberRoleHe: 'הורה' | 'ילד';
  color: string;
}

// The five members David approved (29.08.2026). Colors follow the demo palette family.
export const FAMILY: FamilyMember[] = [
  { memberId: 'david-levy', first: 'david', nameHe: 'דויד', role: 'super-admin', memberRoleHe: 'הורה', color: '#1F4E78' },
  { memberId: 'lilit-levy', first: 'lilit', nameHe: 'לילית', role: 'parent', memberRoleHe: 'הורה', color: '#8E44AD' },
  { memberId: 'omer-levy', first: 'omer', nameHe: 'עומר', role: 'member', memberRoleHe: 'ילד', color: '#16A085' },
  { memberId: 'shaked-levy', first: 'shaked', nameHe: 'שקד', role: 'member', memberRoleHe: 'ילד', color: '#D35400' },
  { memberId: 'lior-levy', first: 'lior', nameHe: 'ליאור', role: 'member', memberRoleHe: 'ילד', color: '#2C7FB8' },
];

export const MODULES = ['expenses', 'income', 'investments', 'goals'] as const;

export function emailOf(m: FamilyMember): string {
  return `${m.first}-levy@familyfinance.local`;
}

export interface MemberDoc { id: string; name: string; role: string; color: string; createdAt: string; updatedAt: string }
export interface PermissionDoc {
  id: string;
  scope: 'member';
  targetId: string;
  updatedAt: string;
  updatedBy: string;
  modules: Record<(typeof MODULES)[number], { view: 'family'; edit: 'family' | 'none' }>;
}

/** members/{id} — mirrors the demo schema. */
export function memberDoc(m: FamilyMember, now: string): MemberDoc {
  return { id: m.memberId, name: m.nameHe, role: m.memberRoleHe, color: m.color, createdAt: now, updatedAt: now };
}

/** permissions/member__{id} — children get view-only family scope (the demo's member__omer-levy shape); parents get edit. */
export function permissionDoc(m: FamilyMember, now: string): PermissionDoc {
  const level = m.role === 'member' ? 'none' : 'family';
  return {
    id: `member__${m.memberId}`,
    scope: 'member',
    targetId: m.memberId,
    updatedAt: now,
    updatedBy: 'david-levy',
    modules: Object.fromEntries(MODULES.map((mod) => [mod, { view: 'family', edit: level }])) as PermissionDoc['modules'],
  };
}
