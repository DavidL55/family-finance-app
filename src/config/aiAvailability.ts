// Spec C1 §1 (David, 15.10 — option "א"): AI features need the Cloud Functions that only the local
// emulator runs; the cloud is Spark (no Functions). A production build IS the cloud deploy — live
// mode runs the dev server — so the switch is the build mode itself. Turning AI back on in the
// cloud is a new cost decision, not a flag flip.
export const AI_ENABLED: boolean = !import.meta.env.PROD;

export const AI_UNAVAILABLE_MESSAGE = 'תכונות ה-AI זמינות רק במחשב של דויד (מצב מקומי), לא בגרסת הענן.';

export function assertAiEnabled(): void {
  if (!AI_ENABLED) throw new Error(AI_UNAVAILABLE_MESSAGE);
}
