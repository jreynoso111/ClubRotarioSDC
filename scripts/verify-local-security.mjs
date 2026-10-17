import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { getLocalStackEnvironment } from './local-stack-env.mjs';
import { localDatabaseTarget } from './local-database-target.mjs';
const database = localDatabaseTarget();
const tests = ['member_platform_messaging_test.sql', 'detailed_admin_audit_test.sql'].map(file => {
  const r = spawnSync('docker', ['exec', '-i', database, 'psql', '-U', 'supabase_admin', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres'], { input: readFileSync(`supabase/tests/${file}`), encoding: 'utf8' });
  return { file, passed: r.status === 0, ...(r.status ? { error: r.stderr } : {}) };
});
const state = JSON.parse(execFileSync('C:/ProgramData/ClubRotarioSDC/bin/supabase.exe', ['--workdir', process.cwd(), 'stack', 'status', '--stack', 'club-rotario', '--output-format', 'json'], { env: getLocalStackEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }));
const url = new URL(state.env.DB_URL); url.searchParams.set('sslmode', 'disable');
const advisor = spawnSync('C:/ProgramData/ClubRotarioSDC/bin/supabase.exe', ['db', 'advisors', '--db-url', url.toString(), '--type', 'security', '--fail-on', 'error', '--output-format', 'json'], { encoding: 'utf8', timeout: 90000 });
const report = { checkedAt: new Date().toISOString(), passed: tests.every(t => t.passed) && advisor.status === 0, tests, advisor: { passed: advisor.status === 0, output: advisor.stdout } };
writeFileSync('C:/ProgramData/ClubRotarioSDC/local-security-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, tests, advisorPassed: report.advisor.passed }, null, 2));
process.exitCode = report.passed ? 0 : 1;
