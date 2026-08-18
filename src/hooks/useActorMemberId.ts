// Stage 6 batch 9 (closing review I3) — WHO APPROVED THIS IMPORT, without handing the caller a role.
//
// commitExtractionDraft now writes an audit_log entry, so its four call sites — FolderLogic,
// SyncButton, AssetCard and InvestmentsImportModal — need the acting member's id. Those are
// exactly the four files that batch 7's role-axis guard forbids from mentioning `useAuthSession`,
// `useResolvedPermissions`, `super-admin` or `isSuperAdmin`, and that guard is right to: F4's
// mechanism was a role gate quietly swallowing the egress disclosure on precisely these surfaces,
// and the structural fact keeping the disclosure unconditional is that they cannot see a role.
//
// The need is legitimate but it is NOT a need for a role, so the resolution is a narrower
// accessor rather than a wider guard. This hook's return type is `string | null`. There is no
// role in it to gate on, no `status` to branch on, and no shape a future edit can widen without
// changing this file — which is reviewable in a way that adding an exemption comment to the guard
// would not be. That preference is the project's own recorded lesson from batch 8's replacement
// of the `role-guard-allow` comment hatch with a structural check: guard changes are reviewable,
// comments are not.
//
// AiExtractionEgressNotice.surfaces.test.tsx keeps its four forbidden patterns unchanged AND now
// asserts that this file itself carries no role concept, so the narrow accessor cannot quietly
// become a wide one.
import { useAuthSession } from './useAuthSession';

/**
 * The signed-in member's id, or null when it is not (yet) known — loading, signed out, or an
 * account with no memberId claim provisioned.
 *
 * Callers must treat null as "cannot attribute this action" and refuse rather than substitute a
 * placeholder: firestore.rules binds `audit_log.actorMemberId` to the caller's own token claim,
 * so an invented value fails the write anyway, and commitExtractionDraft refuses up front.
 */
export function useActorMemberId(): string | null {
  return useAuthSession().memberId;
}
