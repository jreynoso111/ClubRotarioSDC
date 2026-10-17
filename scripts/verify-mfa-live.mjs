import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { getLocalStackEnvironment } from './local-stack-env.mjs';
import { localDatabaseTarget } from './local-database-target.mjs';

const root = process.cwd();
const status = JSON.parse(execFileSync('C:/ProgramData/ClubRotarioSDC/bin/supabase.exe', ['--workdir', root, 'stack', 'status', '--stack', 'club-rotario', '--output-format', 'json'], { env: getLocalStackEnvironment(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }));
const env = status.env;
const local = 'http://127.0.0.1:26911';
const publicApi = 'https://api.clubrotariosdcolonial.org';
const adminHeaders = { apikey: env.SECRET_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const headers = { apikey: env.PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
const results = [];
const database = localDatabaseTarget();
let userId, token, deleted = false;
const request = (base, path, options = {}) => fetch(base + path, { headers, ...options, signal: AbortSignal.timeout(20000) });
function check(name, pass, status) { results.push({ name, passed: Boolean(pass), ...(status === undefined ? {} : { status }) }); if (!pass) throw new Error(name); }
const query = sql => execFileSync('docker', ['exec', '-i', database, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase().replace(/=+$/, '')].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
const rpc = (name, body = {}) => request(local, `/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
try {
  const email = `mfa-${randomUUID()}@example.invalid`, password = randomBytes(32).toString('base64url') + 'aA9!';
  const created = await request(local, '/auth/v1/admin/users', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { security_audit: true } }) });
  check('create technical account without email', created.status === 200, created.status);
  userId = (await created.json()).id;
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new Error('Invalid technical account identifier');
  query(`update public.memberships set membership_status='active', membership_role='admin' where user_id='${userId}';`);
  const login = await request(publicApi, '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
  check('password login over public API', login.status === 200, login.status); token = (await login.json()).access_token;
  const before = await rpc('has_privileged_session');
  check('password alone has no privileged session', before.ok && (await before.json()) === false);
  const finances = await rpc('create_finance_entry', { _direction: 'income', _category: 'donation', _amount: 1, _occurred_on: '2000-01-01', _description: 'Prueba técnica MFA' });
  check('password alone cannot write finances', [401, 403].includes(finances.status), finances.status);
  const enrolled = await request(publicApi, '/auth/v1/factors', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Verificación técnica temporal', issuer: 'Club Rotario' }) });
  check('TOTP enrollment reachable publicly', enrolled.ok, enrolled.status); const factor = await enrolled.json();
  const challenge = await request(publicApi, `/auth/v1/factors/${factor.id}/challenge`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: '{}' });
  check('TOTP challenge reachable publicly', challenge.ok, challenge.status); const challengeId = (await challenge.json()).id;
  const verified = await request(publicApi, `/auth/v1/factors/${factor.id}/verify`, { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ challenge_id: challengeId, code: totp(factor.totp.secret) }) });
  check('valid technical TOTP accepted publicly', verified.ok, verified.status); token = (await verified.json()).access_token;
  const after = await rpc('has_privileged_session'); check('recent TOTP and live session accepted by database', after.ok && (await after.json()) === true);
  const secondFactorToken = token;
  const generated = await request(local, '/auth/v1/admin/generate_link', { method: 'POST', headers: adminHeaders, body: JSON.stringify({ type: 'recovery', email }) });
  check('generate controlled MFA-account recovery without sending email', generated.ok, generated.status);
  const recoveryLink = await generated.json();
  const recovery = await request(publicApi, '/auth/v1/verify', { method: 'POST', body: JSON.stringify({ type: 'recovery', token_hash: recoveryLink.hashed_token }) });
  check('MFA account can recover over public API', recovery.ok, recovery.status);
  token = (await recovery.json()).access_token;
  const recoveryPrivileges = await rpc('has_privileged_session');
  check('recovery does not bypass the required second factor', recoveryPrivileges.ok && (await recoveryPrivileges.json()) === false);
  token = secondFactorToken;
  const logout = await request(publicApi, '/auth/v1/logout?scope=global', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` } });
  check('technical sessions revoked', logout.status === 204, logout.status);
  const revoked = await rpc('has_privileged_session'); check('old AAL2 JWT loses privileges immediately after logout', revoked.ok && (await revoked.json()) === false);
  check('session records removed', query(`select count(*) from auth.sessions where user_id='${userId}'`) === '0');
} catch (error) { results.push({ name: 'probe outcome', passed: false, error: error.message }); }
finally {
  if (token) await request(local, '/auth/v1/logout?scope=global', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` } });
  if (userId) { const removed = await request(local, `/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders }); deleted = removed.ok; results.push({ name: 'technical account removed', passed: deleted, status: removed.status }); }
  const report = { checkedAt: new Date().toISOString(), passed: results.every(r => r.passed), temporaryUserDeleted: deleted, realEmailsSent: false, results };
  writeFileSync('C:/ProgramData/ClubRotarioSDC/mfa-live-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1;
}
