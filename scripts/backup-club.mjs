// task-08: periodic Club database backup. Writes a custom-format dump to the
// protected local folder and a copy to the ADATA USB drive, checks both by
// SHA-256 and prunes old copies. The dump holds Auth data (password hashes):
// keep both folders restricted and the USB drive physically secured.
// Usage: node scripts/backup-club.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { localDatabaseTarget } from './local-database-target.mjs';

const localDir = 'C:/ProgramData/ClubRotarioSDC/backups';
const usbDir = process.env.CLUB_BACKUP_USB_DIR || 'D:/ClubRotarioSDC-backups';
const keep = 14;
const log = message => appendFileSync('C:/ProgramData/ClubRotarioSDC/logs/backup.log', `${new Date().toISOString()} ${message}\n`);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const name = `scheduled-${stamp}.dump`;

const prune = dir => readdirSync(dir).filter(file => /^scheduled-\d{8}T\d{6}Z\.dump$/.test(file)).sort().slice(0, -keep)
  .forEach(file => { rmSync(`${dir}/${file}`); rmSync(`${dir}/${file}.sha256`, { force: true }); });

const report = { startedAt: new Date().toISOString(), file: name, passed: false };
try {
  const dump = spawnSync('docker', ['exec', localDatabaseTarget(), 'pg_dump', '-U', 'supabase_admin', '-Fc', '-d', 'postgres'], { maxBuffer: 1024 * 1024 * 1024, windowsHide: true, timeout: 300000 });
  if (dump.status !== 0 || !dump.stdout?.length) throw new Error(`pg_dump failed (status ${dump.status})`);
  report.bytes = dump.stdout.length;
  report.sha256 = sha256(dump.stdout);
  for (const [label, dir] of [['local', localDir], ['usb', usbDir]]) {
    try {
      if (label === 'usb' && !existsSync(usbDir.slice(0, 3))) throw new Error('USB drive not connected');
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/${name}`, dump.stdout);
      writeFileSync(`${dir}/${name}.sha256`, `${report.sha256}  ${name}\n`);
      const written = sha256(readFileSync(`${dir}/${name}`));
      if (written !== report.sha256) throw new Error('checksum mismatch after write');
      prune(dir);
      report[label] = { dir, ok: true };
    } catch (error) {
      report[label] = { dir, ok: false, error: error.message };
    }
  }
  report.passed = report.local.ok && report.usb.ok;
} catch (error) {
  report.error = error.message;
}
report.finishedAt = new Date().toISOString();
writeFileSync('C:/ProgramData/ClubRotarioSDC/backup-last-run.json', `${JSON.stringify(report, null, 2)}\n`);
log(`${report.passed ? 'OK' : 'ERROR'} ${name} ${report.bytes ?? 0} bytes local=${report.local?.ok ?? false} usb=${report.usb?.ok ?? false}${report.error ? ` ${report.error}` : ''}${report.usb?.error ? ` usb: ${report.usb.error}` : ''}`);
console.log(JSON.stringify({ passed: report.passed, file: name, bytes: report.bytes, local: report.local, usb: report.usb, error: report.error }, null, 2));
process.exitCode = report.passed ? 0 : 1;
