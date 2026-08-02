import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });

/**
 * Frees PORT before `nest start --watch` binds it. Dev only.
 *
 * `nest start --watch` does not exit when its child dies of EADDRINUSE — the
 * supervisor keeps watching, and every save respawns a child that collides
 * again. Left alone these accumulate (nine of them in one afternoon), and each
 * one is invisible until the next port fight. Claiming the port up front makes
 * the newest `pnpm dev:api` authoritative, which is what you want in dev.
 */
const port = process.env.PORT ?? '3001';

let out = '';
try {
  out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  });
} catch {
  // lsof exits non-zero when nothing is listening — the common case.
  process.exit(0);
}

const pids = [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
if (pids.length === 0) process.exit(0);

for (const pid of pids) {
  // Walk up to the `nest start --watch` supervisor, if this child has one.
  // Killing only the child leaves the watcher alive to respawn and collide.
  let target = pid;
  try {
    const ppid = execFileSync('ps', ['-o', 'ppid=', '-p', pid], { encoding: 'utf8' }).trim();
    const parent = execFileSync('ps', ['-o', 'command=', '-p', ppid], { encoding: 'utf8' });
    if (parent.includes('nest.js start')) target = ppid;
  } catch {
    // Process vanished between lsof and ps; kill below is best-effort anyway.
  }

  try {
    process.kill(Number(target), 'SIGTERM');
    console.log(`free-port: released :${port} from pid ${target}`);
  } catch {
    // Already gone.
  }
}
