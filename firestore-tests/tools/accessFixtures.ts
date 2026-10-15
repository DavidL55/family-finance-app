// Spec C1 §5/§7: rules read role/memberId from access/{uid}. Every fixture identity that carries
// role+memberId claims must ALSO have an access doc, or its deny-assertions pass vacuously (no
// access → denied for the wrong reason). ctx() makes forgetting one a loud error, not a green.
import type { RulesTestEnvironment, RulesTestContext } from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

export interface FixtureIdentity {
  uid: string;
  memberId: string;
  role: 'super-admin' | 'parent' | 'member';
}

export function accessDocFor(id: FixtureIdentity): Record<string, unknown> {
  return {
    uid: id.uid,
    memberId: id.memberId,
    role: id.role,
    email: `${id.uid}@fixture.test`,
    grantedAt: Timestamp.fromMillis(0),
    grantedVia: 'test-fixture',
  };
}

export function createAccessFixtures(getEnv: () => RulesTestEnvironment) {
  const seeded = new Set<string>();
  return {
    /** Call right after clearFirestore() in the file's top-level beforeEach. */
    async seed(ids: readonly FixtureIdentity[]): Promise<void> {
      seeded.clear();
      await getEnv().withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const id of ids) await setDoc(doc(db, 'access', id.uid), accessDocFor(id));
      });
      for (const id of ids) seeded.add(id.uid);
    },
    ctx(uid: string, claims: Record<string, unknown>): RulesTestContext {
      if (typeof claims.role === 'string' && typeof claims.memberId === 'string' && !seeded.has(uid)) {
        throw new Error(
          `fixture ${uid} has role+memberId claims but no access/${uid} doc — add it to this file's ` +
            'ACCESS_IDENTITIES (a missing doc turns every deny-assertion for it into a vacuous pass).',
        );
      }
      return getEnv().authenticatedContext(uid, claims);
    },
  };
}
