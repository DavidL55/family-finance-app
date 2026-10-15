// @vitest-environment node
// Pins the member/permission doc shapes shared by bootstrap-live (Task 4) and bootstrap-owner
// (Task 10): one definition, so the two scripts cannot drift apart (ruling F12).
import { describe, expect, it } from 'vitest';
import { FAMILY, MODULES, emailOf, memberDoc, permissionDoc } from '../live/family';

const NOW = '2026-10-15T00:00:00.000Z';
const byId = (id: string) => FAMILY.find((m) => m.memberId === id)!;

describe('family — shared bootstrap data', () => {
  it('has the five approved members with their emails', () => {
    expect(FAMILY.map((m) => m.memberId)).toEqual(['david-levy', 'lilit-levy', 'omer-levy', 'shaked-levy', 'lior-levy']);
    expect(emailOf(byId('david-levy'))).toBe('david-levy@familyfinance.local');
  });
  it('memberDoc mirrors the demo members schema', () => {
    expect(memberDoc(byId('omer-levy'), NOW)).toEqual({
      id: 'omer-levy', name: 'עומר', role: 'ילד', color: '#16A085', createdAt: NOW, updatedAt: NOW,
    });
  });
  it('permissionDoc: children view-only (edit none), parents edit family', () => {
    const kid = permissionDoc(byId('omer-levy'), NOW);
    expect(kid).toMatchObject({ id: 'member__omer-levy', scope: 'member', targetId: 'omer-levy', updatedAt: NOW, updatedBy: 'david-levy' });
    expect(Object.keys(kid.modules)).toEqual([...MODULES]);
    for (const mod of MODULES) expect(kid.modules[mod]).toEqual({ view: 'family', edit: 'none' });
    for (const mod of MODULES) expect(permissionDoc(byId('lilit-levy'), NOW).modules[mod]).toEqual({ view: 'family', edit: 'family' });
  });
});
