// Boots the Functions build watcher and the Firebase emulator suite together so an edit to
// functions/src/** actually shows up in the running emulators.
//
// Why this exists: `npm run emu` used to be `npm --prefix functions run build && firebase
// emulators:start ...` — a single `tsc` build, then the emulators. Editing functions/src/** while
// the emulators were already running printed `✔ functions: Loaded functions definitions from
// source: .`, which reads like success, but functions/lib/index.js was never recompiled: the
// emulator's watcher restarts the *runtime process* on a source change, it does not invoke `tsc`.
// `functions/package.json` already had a `build:watch` script; nothing referenced it. See the
// Stage 6 Task 2 review (docs/superpowers/plans/2026-08-17-stage6-ai-provider-layer.md).
//
// This script does the same one-shot initial build `npm run emu` always did, then keeps a
// `tsc --watch` process and `firebase emulators:start` running side by side for the rest of the
// session, so `npm run emu` is still the one command a developer runs to boot everything, but a
// source edit now actually recompiles.

import { spawn, type ChildProcess } from 'child_process';

const isWindows = process.platform === 'win32';

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: isWindows });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function spawnTagged(label: string, cmd: string, args: string[], detached = false): ChildProcess {
  const child = spawn(cmd, args, { shell: isWindows, detached });
  const prefix = `[${label}] `;
  const pipe = (stream: NodeJS.ReadableStream | null, out: NodeJS.WritableStream) => {
    if (!stream) return;
    let buf = '';
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
    stream.on('end', () => {
      if (buf.length) out.write(prefix + buf + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  return child;
}

async function main() {
  console.log('[dev-emulators] running initial functions build (tsc)...');
  await run('npm', ['--prefix', 'functions', 'run', 'build']);

  console.log('[dev-emulators] starting tsc --watch and the Firebase emulators together...');
  let shuttingDown = false;
  let exitCode = 0;

  const tscWatch = spawnTagged('tsc:watch', 'npm', ['--prefix', 'functions', 'run', 'build:watch', '--', '--preserveWatchOutput']);

  // Own process group (POSIX), so a terminal Ctrl-C / window close does NOT reach the emulators
  // directly. Without this the tty's SIGINT hit the Java Firestore emulator too, its JVM shut down
  // before the CLI's export-on-exit request, and every Ctrl-C ended in "Export failed: Failed to make
  // request to http://127.0.0.1:8080/...:export" — demo data never persisted (15.10.2026). Same fix
  // as scripts/live/start-live.sh: one SIGINT to the CLI, then wait for its export to finish.
  const emulators = spawnTagged('emulators', 'firebase', [
    'emulators:start',
    '--project', 'demo-familyfinance',
    '--import=./.emulator-data',
    '--export-on-exit=./.emulator-data',
  ], !isWindows);

  const emulatorsRunning = () => emulators.exitCode === null && emulators.signalCode === null;

  // Exits only once the emulators are gone — never on a timer, which used to cut the export short.
  const shutdown = (code: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    exitCode = code;
    if (tscWatch.exitCode === null && tscWatch.signalCode === null) tscWatch.kill('SIGTERM');
    if (emulatorsRunning()) {
      console.log('[dev-emulators] stopping the emulators; waiting for export to ./.emulator-data...');
      emulators.kill('SIGINT');
    } else {
      process.exit(exitCode);
    }
  };

  // 'close', not 'exit': the CLI's last lines (the export result) must be printed before we exit.
  emulators.on('close', (code) => {
    if (shuttingDown) process.exit(exitCode);
    console.log(`[dev-emulators] emulators exited (code ${code}); stopping tsc --watch too.`);
    shutdown(code ?? 0);
  });
  tscWatch.on('exit', (code) => {
    if (shuttingDown) return;
    console.error(`[dev-emulators] tsc --watch exited unexpectedly (code ${code}); stopping emulators too.`);
    shutdown(code ?? 1);
  });

  // A second Ctrl-C is passed on as-is: the CLI treats a repeated SIGINT as "stop right now".
  // SIGHUP (terminal window closed) must be handled too — the emulators no longer share our process
  // group, so nothing else would stop them and they would linger on their ports, unexported.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (!shuttingDown) shutdown(0);
      else if (emulatorsRunning()) emulators.kill('SIGINT');
    });
  }
  // With the window closed, writing to the dead tty must not crash us mid-export (EIO/EPIPE).
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});
}

main().catch((err) => {
  console.error('[dev-emulators]', err);
  process.exit(1);
});
