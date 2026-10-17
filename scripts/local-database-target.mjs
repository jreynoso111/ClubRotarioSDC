import { execFileSync } from 'node:child_process';

export function localDatabaseTarget() {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)
    .filter(name => /^supabase-ClubrotarioSDC-club-rotario-database-[a-f0-9]+$/.test(name));
  if (names.length !== 1) throw new Error('Expected exactly one running database for the local Club stack.');
  return names[0];
}
