import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { localDatabaseTarget } from './local-database-target.mjs';

const container = localDatabaseTarget();
const files = ['20261017013000_privileged_roles_require_recent_mfa.sql', '20261017014500_membership_application_intake_throttle.sql'];
const run = (args, input) => {
  const result = spawnSync('docker', ['exec', ...(input ? ['-i'] : []), container, ...args], { input, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Local database operation failed; no credential output retained.');
  return result.stdout;
};
const report = JSON.parse(readFileSync('C:/ProgramData/ClubRotarioSDC/security-db-verification.json', 'utf8'));
if (!report.passed || report.report.length !== 11) throw new Error('Run all candidate SQL suites first.');
const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
const backup = `C:/ProgramData/ClubRotarioSDC/backups/before-security-closure-${stamp}.dump`;
const dump = run(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '-Fc']);
if (dump.length < 10000 || dump.subarray(0, 5).toString() !== 'PGDMP') throw new Error('Invalid database backup.');
writeFileSync(backup, dump);
const migrations = files.map(file => ({ file, sql: readFileSync(`supabase/migrations/${file}`, 'utf8') }));
const sql = `begin;
do $$ begin
  assert current_database() = 'postgres';
  assert (select count(*) = 24 from pg_tables where schemaname = 'public');
  assert not exists(select 1 from supabase_migrations.schema_migrations where version in ('20261017013000', '20261017014500'));
end $$;
${migrations.map(({ file, sql }) => `${sql}\ninsert into supabase_migrations.schema_migrations(version, name) values('${file.slice(0,14)}', '${file.slice(15,-4)}');`).join('\n')}
notify pgrst, 'reload schema';
commit;`;
run(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], Buffer.from(sql));
const evidence = { checkedAt: new Date().toISOString(), target: 'local club-rotario only', applied: true, backup, backupSha256: createHash('sha256').update(dump).digest('hex'), migrations: migrations.map(({ file, sql }) => ({ file, sha256: createHash('sha256').update(sql).digest('hex') })) };
writeFileSync('C:/ProgramData/ClubRotarioSDC/security-migrations-applied.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ applied: true, migrations: files, backup }, null, 2));
