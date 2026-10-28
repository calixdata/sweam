// SweamTV dev stack. Runs wrangler and the TV app's Vite server on their own
// ports (8790 / 5320) with their own local D1/R2 state, so it can run beside
// the main `npm run dev` stack (8787 / 5173) without port or SQLite-lock
// fights. First time (or after new migrations), prepare the isolated state:
//
//   cd apps/api
//   npx wrangler d1 migrations apply sweam-db --local --persist-to .wrangler/state-tv
//   npx wrangler d1 execute sweam-db --local --persist-to .wrangler/state-tv --file seed.sql
//
// Then: npm run dev:tv  →  http://localhost:5320/tv/
import { spawn } from 'node:child_process';
import console from 'node:console';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(here, '..', 'apps', 'api');
const tvDir = path.join(here, '..', 'apps', 'tv');
const apiPort = process.env.SWEAM_API_PORT ?? '8790';

const children = [];
let shuttingDown = false;

function run(name, cwd, args, extraEnv = {}) {
  const child = spawn('npx', args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[dev:tv] ${name} exited (${code ?? 'signal'}); stopping the other process.`);
    for (const other of children) {
      if (other !== child) other.kill();
    }
    process.exit(code ?? 0);
  });
  children.push(child);
}

run('api', apiDir, ['wrangler', 'dev', '--port', apiPort, '--persist-to', '.wrangler/state-tv']);
run('tv', tvDir, ['vite'], { SWEAM_API_PORT: apiPort });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    for (const child of children) child.kill();
    process.exit(0);
  });
}
