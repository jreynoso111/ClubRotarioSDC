import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { localDatabaseTarget } from './local-database-target.mjs';

// All fixtures and candidate migrations are reverted, including audit entries.
const target = localDatabaseTarget();
const output = process.argv[2] || 'C:/ProgramData/ClubRotarioSDC/security-db-verification.json';
const suites = ['admin_committee_management_test.sql', 'admin_committee_flow_test.sql',
  'proposal_voting_rls_test.sql', 'club_finance_management_rls_test.sql',
  'club_membership_applications_rls_test.sql', 'membership_application_rules_test.sql',
  'membership_photo_gallery_rls_test.sql',
  'finance_selected_dues_test.sql', 'club_leadership_org_chart_test.sql',
  'club_backend_rls_test.sql', 'privileged_mfa_test.sql',
  'membership_application_intake_throttle_test.sql'];
const generated = 'C:/ProgramData/ClubRotarioSDC/security-db-verification.sql';
const available = suites.filter(file => {
  try { readFileSync(`supabase/tests/${file}`); return true; } catch { return false; }
});
const prep = spawnSync(process.execPath, ['scripts/prepare-db-verification.mjs', generated, ...available], { encoding: 'utf8' });
if (prep.status !== 0) throw new Error(prep.stderr);
const migrations = ['20261017013000_privileged_roles_require_recent_mfa.sql', '20261017014500_membership_application_intake_throttle.sql'];
const sql = `begin;\n${migrations.map(file => readFileSync(`supabase/migrations/${file}`, 'utf8')).join('\n')}\n${readFileSync(generated, 'utf8')}\nrollback;`;
const result = spawnSync('docker', ['exec', '-i', target, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres', '-Atq'], { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const report = result.stdout.split(/\r?\n/).filter(line => line.startsWith('[')).flatMap(line => JSON.parse(line));
const passed = result.status === 0 && report.length === available.length && report.every(row => !row.error && row.expected === row.passed && !row.failures.length);
writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), passed, reverted: true, report, errors: result.stderr }, null, 2));
console.log(JSON.stringify({ passed, suites: report.length, assertions: report.reduce((n, row) => n + (row.passed || 0), 0), problems: report.filter(row => row.error || row.failures?.length || row.expected !== row.passed), output }, null, 2));
process.exitCode = passed ? 0 : 1;
