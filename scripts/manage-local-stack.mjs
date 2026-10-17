import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getLocalStackEnvironment } from './local-stack-env.mjs';

const action = process.argv[2];
if (!['start', 'stop', 'status'].includes(action)) throw new Error('Use start, stop or status');
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('C:/ProgramData/ClubRotarioSDC/bin/supabase.exe', [
  '--workdir', root, 'stack', action, '--stack', 'club-rotario',
  ...(action === 'start' ? ['--eager'] : []), '--output-format', 'json',
], { cwd: root, env: getLocalStackEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 240000 });
// CLI status/start includes credentials. Retain diagnostics only in protected logs.
if (result.status !== 0) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('C:/ProgramData/ClubRotarioSDC/secrets/last-stack-error.log', `${result.stdout || ''}\n${result.stderr || ''}\n`);
  console.error(`Local stack ${action} failed; protected diagnostic log saved.`);
  process.exitCode = result.status || 1;
} else {
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { payload = {}; }
  console.log(JSON.stringify({ action, success: true, id: payload.id, services: payload.services?.map(s => ({ service: s.service, lifecycle: s.lifecycle, health: s.health })) }));
}
