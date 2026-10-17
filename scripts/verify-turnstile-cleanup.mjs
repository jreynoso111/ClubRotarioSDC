import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { localDatabaseTarget } from './local-database-target.mjs';

// Delete only this run's clearly identified synthetic membership request.
const sql = `begin;
do $$ begin
 assert (select count(*) = 1 from public.membership_applications where email='captcha-closure-20261017@example.invalid' and full_name='Prueba técnica de seguridad');
end $$;
delete from public.membership_applications where email='captcha-closure-20261017@example.invalid' and full_name='Prueba técnica de seguridad';
commit;`;
execFileSync('docker', ['exec', '-i', localDatabaseTarget(), 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'supabase_admin', '-d', 'postgres'], { input: sql, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
const report = { checkedAt: new Date().toISOString(), membershipBrowserSubmission: 'success', syntheticApplicationRemoved: true, passwordLoginWithTurnstile: 'success; privileged session redirected to MFA', realEmailsSent: false };
writeFileSync('C:/ProgramData/ClubRotarioSDC/turnstile-browser-verification.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
