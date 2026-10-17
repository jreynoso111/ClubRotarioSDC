import assert from 'node:assert/strict';

process.loadEnvFile('.env.local');
const site = 'https://www.clubrotariosdcolonial.org';
const api = 'https://api.clubrotariosdcolonial.org';
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const request = (url, options = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...options });
const headers = { apikey: key };
let checks = 0;
async function check(name, run) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

for (const path of ['/', '/nosotros', '/revista', '/eventos', '/solicitar-membresia', '/auth/sign-in', '/auth/sign-up', '/auth/forgot-password', '/auth/complete']) {
  await check(`public ${path}`, async () => {
    const response = await request(site + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    assert.ok(response.headers.get('strict-transport-security')?.includes('max-age='));
    assert.equal(response.headers.get('x-powered-by'), null);
    const policyHeader = process.env.CLUB_CSP_ENFORCE === 'true' ? 'content-security-policy' : 'content-security-policy-report-only';
    assert.match(response.headers.get(policyHeader) ?? '', /script-src 'self' 'nonce-[A-Za-z0-9+/=]{16,64}' 'strict-dynamic'/);
  });
}
await check('anonymous MFA page requires sign-in', async () => {
  const response = await request(site + '/auth/mfa');
  assert.equal(response.status, 307);
  assert.ok(response.headers.get('location')?.includes('/auth/sign-in'));
});
await check('direct anonymous membership application insert denied', async () => {
  const response = await request(`${api}/rest/v1/membership_applications`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ full_name: 'Verificación', email: 'verify@example.invalid', phone: '+1 809 555 0100', motivation: 'Comprobación automática sin almacenamiento.', consented_to_member_sharing: true }),
  });
  assert.ok([401, 403].includes(response.status), `Unexpected direct insert status ${response.status}`);
});
await check('apex canonical redirect', async () => {
  const response = await request('https://clubrotariosdcolonial.org/auth/sign-in?next=%2Fplataforma');
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), site + '/auth/sign-in?next=%2Fplataforma');
});
await check('anonymous platform denied', async () => {
  const response = await request(site + '/plataforma');
  assert.equal(response.status, 307);
  assert.ok(response.headers.get('location')?.includes('/auth/sign-in?next='));
});
await check('invalid confirmation stays on the public site', async () => {
  const response = await request(site + '/auth/confirm?type=recovery');
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), site + '/auth/sign-in?error=confirmation');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(response.headers.get('cache-control')?.includes('no-store'));
});
for (const table of ['memberships', 'profiles', 'audit_log', 'finance_entries', 'internal_messages', 'membership_applications']) {
  await check(`anonymous ${table} denied`, async () => {
    const response = await request(`${api}/rest/v1/${table}?select=*&limit=1`, { headers });
    assert.ok([401, 403].includes(response.status), `Unexpected anonymous status ${response.status}`);
  });
}
await check('public agenda API', async () => {
  const response = await request(api + '/rest/v1/events?select=id&limit=1', { headers });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(await response.json()));
});
for (const path of ['/auth/v1/admin/users', '/', '/pg', '/rest/v1/rpc/claim_initial_admin', '/rest/v1/rpc/auth_recovery_email_exists', '/rest/v1/rpc/submit_membership_application']) {
  await check(`unpublished API route ${path}`, async () => {
    assert.equal((await request(api + path, { headers })).status, 404);
  });
}
for (const action of ['token', 'signup', 'recover', 'user', 'verify']) {
  await check(`Auth CORS ${action}`, async () => {
    const response = await request(`${api}/auth/v1/${action}`, {
      method: 'OPTIONS', headers: { Origin: site, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'apikey,content-type' },
    });
    assert.equal(response.status, 204);
    assert.ok([site, '*'].includes(response.headers.get('access-control-allow-origin')));
  });
}
await check('public MFA requires a user session', async () => {
  const response = await request(`${api}/auth/v1/factors`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ factor_type: 'totp' }) });
  assert.ok([401, 403].includes(response.status), `Unexpected anonymous MFA status ${response.status}`);
});
await check('published assets', async () => {
  const html = await (await request(site)).text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(match => match[1]))];
  assert.ok(assets.length > 2);
  for (const asset of assets) assert.equal((await request(new URL(asset, site), { method: 'HEAD' })).status, 200);
});
console.log(`${checks} deployment checks passed`);
