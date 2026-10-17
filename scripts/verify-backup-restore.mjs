import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { localDatabaseTarget } from './local-database-target.mjs';
const target = localDatabaseTarget();
const database = `club_restore_check_${Date.now()}`;
if (!/^club_restore_check_[0-9]+$/.test(database)) throw Error('Invalid isolated restore target');
// Optional argument: a dump path (e.g. the latest scheduled backup); otherwise the pre-migration snapshot.
const source = process.argv[2] ? { backup: process.argv[2] } : JSON.parse(readFileSync('C:/ProgramData/ClubRotarioSDC/security-migrations-applied.json', 'utf8'));
const expectedMigrations = process.argv[2] ? readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).length : 13;
const dump = readFileSync(source.backup);
const run = (command, input) => spawnSync('docker', ['exec', ...(input ? ['-i'] : []), target, ...command], { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
let created = false;
const report = { checkedAt: new Date().toISOString(), passed: false, source: source.backup, isolatedDatabase: database };
try {
  const create = run(['createdb', '-U', 'supabase_admin', '--template=template0', database]);
  if (create.status !== 0) throw Error('Cannot create isolated restore database'); created = true;
  const restored = run(['pg_restore', '-U', 'supabase_admin', '--exit-on-error', '--no-owner', '-d', database], dump);
  if (restored.status !== 0) { report.errors = restored.stderr; throw Error('Isolated restore failed; details saved in protected evidence'); }
  const checked = run(['psql', '-U', 'supabase_admin', '-X', '-At', '-d', database, '-c', "select json_build_object('publicTables',(select count(*) from pg_tables where schemaname='public'),'tablesWithoutRls',(select count(*) from pg_tables where schemaname='public' and not rowsecurity),'migrations',(select count(*) from supabase_migrations.schema_migrations),'authUsers',(select count(*) from auth.users),'storageMetadata',(select count(*) from storage.objects));"]);
  if (checked.status !== 0) throw Error('Cannot verify restored catalog');
  report.catalog = JSON.parse(checked.stdout.trim());
  report.passed = report.catalog.publicTables === 24 && report.catalog.tablesWithoutRls === 0 && report.catalog.migrations === expectedMigrations;
} catch (error) { report.error = error.message; }
finally {
  if (created) { const removed = run(['dropdb', '-U', 'supabase_admin', database]); report.isolatedDatabaseRemoved = removed.status === 0; report.passed &&= report.isolatedDatabaseRemoved; }
  writeFileSync(process.argv[2] ? 'C:/ProgramData/ClubRotarioSDC/backup-restore-latest-verification.json' : 'C:/ProgramData/ClubRotarioSDC/backup-restore-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, catalog: report.catalog, isolatedDatabaseRemoved: report.isolatedDatabaseRemoved, error: report.error }, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
