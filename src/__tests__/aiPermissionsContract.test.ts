import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { resolveOwnedModuleScope as clientResolve } from '../utils/ownedModuleScope';
import { resolveOwnedModuleScope as functionsResolve } from '../../functions/src/shared/permissions';
import type { PermissionLevel, PermissionRole } from '../types/permissions';

const ROLES: PermissionRole[] = ['super-admin', 'parent', 'member'];
const LEVELS: (PermissionLevel | undefined)[] = ['none', 'own', 'family', undefined];

describe('functions/src/shared/permissions mirrors src/utils/ownedModuleScope (D2)', () => {
  it('agrees with the client implementation for every (role, level) pair', () => {
    for (const role of ROLES) {
      for (const level of LEVELS) {
        expect(functionsResolve(role, level)).toBe(clientResolve(role, level));
      }
    }
  });
});

describe('functions/src never reads Member.role for an authorization decision (D2/D8 regression guard)', () => {
  it('no committed handler/context file accesses `.role` on anything except `token.role` or the mirrored permissions module', () => {
    const forbidden = /(?<!token)\.role\b/;
    const roots = ['functions/src/handlers', 'functions/src/context'];
    for (const root of roots) {
      const dir = join(process.cwd(), root);
      let files: string[] = [];
      try { files = readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')); } catch { continue; }
      for (const f of files) {
        const src = readFileSync(join(dir, f), 'utf8');
        const lines = src.split('\n').filter(l => forbidden.test(l) && !l.includes('token.role'));
        expect(lines, `${root}/${f} appears to read a non-token .role — the exact bug D8 fixed`).toEqual([]);
      }
    }
  });
});
