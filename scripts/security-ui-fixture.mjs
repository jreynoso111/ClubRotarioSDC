import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { getLocalStackEnvironment } from './local-stack-env.mjs';
import { localDatabaseTarget } from './local-database-target.mjs';
const destination = 'C:/ProgramData/ClubRotarioSDC/secrets/security-ui-fixture.json';
const status = JSON.parse(execFileSync('C:/ProgramData/ClubRotarioSDC/bin/supabase.exe', ['--workdir', process.cwd(), 'stack', 'status', '--stack', 'club-rotario', '--output-format', 'json'], { env: getLocalStackEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }));
const env = status.env;
const headers = { apikey: env.SECRET_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const api = 'http://127.0.0.1:26911/auth/v1/admin/users';
if (process.argv[2] === 'create') {
  const fixture = { email: `ui-${randomUUID()}@example.invalid`, password: randomBytes(32).toString('base64url') + 'aA9!' };
  const response = await fetch(api, { method: 'POST', headers, body: JSON.stringify({ ...fixture, email_confirm: true, user_metadata: { security_audit: true } }) });
  if (!response.ok) throw Error('Cannot create UI fixture');
  fixture.id = (await response.json()).id;
  if (!/^[0-9a-f-]{36}$/.test(fixture.id)) throw Error('Invalid fixture');
  execFileSync('docker', ['exec', '-i', localDatabaseTarget(), 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: `update public.memberships set membership_role='admin',membership_status='active' where user_id='${fixture.id}';`, stdio: ['pipe', 'ignore', 'pipe'] });
  writeFileSync(destination, JSON.stringify(fixture));
  console.log('Technical UI fixture ready; credentials in protected temporary file.');
} else if (process.argv[2] === 'cleanup') {
  const fixture = JSON.parse(readFileSync(destination, 'utf8'));
  const response = await fetch(`${api}/${fixture.id}`, { method: 'DELETE', headers });
  if (!response.ok) throw Error('Cannot remove UI fixture');
  unlinkSync(destination);
  console.log('Technical UI account and temporary credential file removed.');
} else throw Error('Use create or cleanup');
