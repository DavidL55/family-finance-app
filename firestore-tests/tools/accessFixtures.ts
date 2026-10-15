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
  const seeded = new Map<string, FixtureIdentity>();
  return {
    /** Call right after clearFirestore() in the file's top-level beforeEach. */
    async seed(ids: readonly FixtureIdentity[]): Promise<void> {
      seeded.clear();
      await getEnv().withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        for (const id of ids) await setDoc(doc(db, 'access', id.uid), accessDocFor(id));
      });
      for (const id of ids) seeded.set(id.uid, id);
    },
    ctx(uid: string, claims: Record<string, unknown>): RulesTestContext {
      const id = seeded.get(uid);
      if (typeof claims.role === 'string' && typeof claims.memberId === 'string' && !id) {
        throw new Error(
          `fixture ${uid} has role+memberId claims but no access/${uid} doc — add it to this file's ` +
            'ACCESS_IDENTITIES (a missing doc turns every deny-assertion for it into a vacuous pass).',
        );
      }
      // Rules read role/memberId from the access doc, not the token: claims that disagree with the
      // seeded doc would silently test the DOC's identity while the test reads as the claims'.
      // Absent claims are fine — that is the prod shape (access doc, no custom claims).
      if (id && (('role' in claims && claims.role !== id.role) || ('memberId' in claims && claims.memberId !== id.memberId))) {
        throw new Error(
          `fixture ${uid} claims role=${String(claims.role)} memberId=${String(claims.memberId)} but its ` +
            `access/${uid} doc says role=${id.role} memberId=${id.memberId} — rules use the doc; make them agree.`,
        );
      }
      return getEnv().authenticatedContext(uid, claims);
    },
  };
}
