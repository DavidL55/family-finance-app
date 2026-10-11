import { describe, it, expect } from 'vitest';
import { BOARDS } from '../config/boards';
import { GLOSSARY } from '../config/glossary';
import { resolveBankBoard } from '../lib/boards/resolveBank';

describe('BOARDS registry — the structural guard of spec §8', () => {
  it('every declared explainId has a GLOSSARY entry with all four required fields', () => {
    for (const b of BOARDS) for (const s of b.sections) for (const id of s.explainIds) {
      const e = GLOSSARY[id];
      expect(e, `${b.id}/${s.id}: missing glossary entry ${id}`).toBeTruthy();
      for (const k of ['title', 'explanation', 'howComputed', 'source'] as const) expect(e[k].length, `${id}.${k}`).toBeGreaterThan(0);
    }
  });
  it('section ids are unique across boards', () => {
    const ids = BOARDS.flatMap((b) => b.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('the bank resolver never emits an explainId the registry did not declare', () => {
    const declared = new Set(BOARDS.find((b) => b.id === 'bank')!.sections.flatMap((s) => s.explainIds));
    const acct = { id: 'acc-poalim-joint', ownerId: 'david-levy', name: 'משותף', type: 'bank' as const, balance: 0, balanceUpdatedAt: '', status: 'active' as const, createdAt: '', updatedAt: '' };
    for (const sec of resolveBankBoard([], [acct], '2026-10-10')) for (const f of sec.figures) expect(declared.has(f.explainId), f.explainId).toBe(true);
  });
  it('visibleFor: parents always, a member only with accounts.view ≠ none', () => {
    const bank = BOARDS.find((b) => b.id === 'bank')!;
    expect(bank.visibleFor('parent', undefined)).toBe(true);
    expect(bank.visibleFor('member', 'own')).toBe(true);
    expect(bank.visibleFor('member', 'none')).toBe(false);
    expect(bank.visibleFor('member', undefined)).toBe(false);
  });
});
