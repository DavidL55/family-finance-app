// End-to-end smoke for the operator scripts, against the TEST emulator only (never cloud, never :8080):
//   npx firebase --config firebase.rules-test.json emulators:exec --project demo-c1-smoke --only firestore,auth \
//     "FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 npx tsx scripts/cloud/smoke-access-admin.ts"
// Every child gets `--emulator --project demo-c1-smoke` (after the subcommand — access-admin reads
// argv[0] as the command), so a missing emulator env makes the child refuse instead of reaching cloud.
import { spawnSync } from 'node:child_process';
import { openAuth, resolveTarget } from './adminApp';

const PROJECT = 'demo-c1-smoke';
const EMU = ['--emulator', '--project', PROJECT];

function run(script: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync('npx', ['tsx', `scripts/cloud/${script}.ts`, ...args, ...EMU], { env: process.env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
function expect(label: string, ok: boolean, out: string): void {
  if (!ok) throw new Error(`smoke FAILED at "${label}":\n${out}`);
  console.log(`ok  ${label}`);
}

async function main(): Promise<void> {
  // Same guard the scripts use: refuses without FIRESTORE_EMULATOR_HOST, on :8080, or a non-demo project.
  const target = resolveTarget(EMU, process.env);
  if (target.kind !== 'emulator') throw new Error('smoke must run against the emulator');
  const owner = await openAuth(target).createUser({ email: 'owner@test.local', emailVerified: true, password: 'smoke-test-pw-123' });

  await openAuth(target).createUser({ email: 'unverified@test.local', emailVerified: false, password: 'smoke-test-pw-123' });
  let r = run('bootstrap-owner', ['--email', 'unverified@test.local', '--apply']);
  expect('bootstrap-owner refuses an unverified email', r.status !== 0 && /not email-verified/.test(r.out), r.out);

  r = run('bootstrap-owner', ['--email', 'owner@test.local', '--apply']);
  expect('bootstrap-owner --apply exits 0', r.status === 0 && /bootstrap-owner: done/.test(r.out), r.out);

  r = run('bootstrap-owner', ['--email', 'owner@test.local', '--apply']);
  expect('second bootstrap-owner refuses (already exists)', r.status !== 0 && /already exists/.test(r.out), r.out);

  r = run('access-admin', ['invite', '--email', 'G@x.co', '--member', 'omer-levy', '--role', 'member', '--apply']);
  expect('invite --apply exits 0', r.status === 0 && /invite: done/.test(r.out), r.out);

  r = run('access-admin', ['list']);
  expect('list shows the invite and the owner access doc', r.status === 0 && r.out.includes('invite  g@x.co') && r.out.includes(`access  ${owner.uid}`), r.out);

  r = run('access-admin', ['revoke', '--uid', owner.uid, '--apply']);
  expect('revoking the last super-admin refuses', r.status !== 0 && /last super-admin/.test(r.out), r.out);

  console.log('smoke: ok');
}

main().catch((err: unknown) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
