import { writeFileSync } from 'node:fs';
process.loadEnvFile('.env.local');
const origin = 'https://api.clubrotariosdcolonial.org';
const headers = { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
const results = [];
for (const path of ['token?grant_type=password', 'signup', 'recover']) {
  for (const badToken of [null, 'invalid-security-probe-token']) {
    const payload = { email: 'security-captcha-probe@example.invalid', password: 'Synthetic-probe-only-0123456789!' };
    if (badToken) payload.gotrue_meta_security = { captcha_token: badToken };
    const response = await fetch(`${origin}/auth/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    const code = body.error_code || body.code;
    results.push({ endpoint: path.split('?')[0], token: badToken ? 'invalid' : 'absent', status: response.status, code, passed: !response.ok && code === 'captcha_failed' });
  }
}
const report = { checkedAt: new Date().toISOString(), passed: results.every(r => r.passed), results, realEmailsSent: false };
writeFileSync('C:/ProgramData/ClubRotarioSDC/abuse-live-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1;
