// task-02: evidence that the Club comes back on its own after a real Windows
// restart or sign-out/sign-in. Read-only: it never starts or stops services.
// Usage: node scripts/verify-reboot.mjs baseline|reboot|logon
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const phase = process.argv[2];
if (!['baseline', 'reboot', 'logon'].includes(phase)) throw new Error('Use baseline, reboot or logon');
const dir = 'C:/ProgramData/ClubRotarioSDC';
const docker = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const powershell = script => {
  const result = spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return JSON.parse(result.stdout || 'null');
};
const status = async (url, expected) => {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    return { url, status: response.status, ok: expected.includes(response.status) };
  } catch (error) {
    return { url, status: null, ok: false, error: error.cause?.code || error.name };
  }
};

const windows = powershell(`
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')
$tasks = Get-ScheduledTask -TaskName 'ClubRotarioSDC-Next-Web','ClubRotarioSDC-Cloudflare-Tunnel','ClubRotarioSDC-Backend' | ForEach-Object {
  $info = $_ | Get-ScheduledTaskInfo
  [pscustomobject]@{ name = $_.TaskName; state = [string]$_.State; lastRun = $info.LastRunTime.ToUniversalTime().ToString('o'); lastResult = $info.LastTaskResult }
}
$next = Get-NetTCPConnection -State Listen -LocalPort 3010 -ErrorAction SilentlyContinue | Select-Object -First 1
$owner = if ($next) { (Get-CimInstance Win32_Process -Filter "ProcessId=$($next.OwningProcess)" | Invoke-CimMethod -MethodName GetOwner).User } else { $null }
$unexpected = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41; StartTime = (Get-Date).AddDays(-1) } -ErrorAction SilentlyContinue).Count
[pscustomobject]@{ lastBoot = $boot; tasks = @($tasks); nextAddress = $next.LocalAddress; nextOwner = $owner; unexpectedShutdownsLast24h = $unexpected } | ConvertTo-Json -Depth 4 -Compress`);

const containers = spawnSync(docker, ['ps', '--filter', 'name=club-rotario', '--format', '{{.Names}}|{{.Status}}'], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
const running = (containers.stdout || '').trim().split('\n').filter(Boolean);
const volume = spawnSync(docker, ['inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}', ...running.filter(line => line.includes('-database-')).map(line => line.split('|')[0])], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
const watchdogLog = `${dir}/logs/backend-watchdog.log`;
const watchdog = existsSync(watchdogLog) ? readFileSync(watchdogLog, 'utf8').trim().split('\n').filter(line => line.slice(0, 24) >= windows.lastBoot.slice(0, 24)).slice(-6) : [];

const routes = await Promise.all([
  status('http://127.0.0.1:3010/', [200]),
  status('http://127.0.0.1:26911/auth/v1/health', [200]),
  status('https://www.clubrotariosdcolonial.org/', [200]),
  status('https://www.clubrotariosdcolonial.org/auth/sign-in', [200]),
  status('https://clubrotariosdcolonial.org/', [301, 308]),
  status('https://api.clubrotariosdcolonial.org/auth/v1/user', [401]),
]);

const baselinePath = `${dir}/reboot-baseline.json`;
const baseline = phase !== 'baseline' && existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const report = {
  phase,
  checkedAt: new Date().toISOString(),
  lastBoot: windows.lastBoot,
  rebootedSinceBaseline: baseline ? windows.lastBoot > baseline.lastBoot : null,
  tasks: windows.tasks,
  nextListener: { address: windows.nextAddress, owner: windows.nextOwner },
  containers: { running: running.length, unhealthy: running.filter(line => /unhealthy|Restarting/i.test(line)).length },
  postgresVolume: volume.stdout.trim() || null,
  sameVolumeAsBaseline: baseline ? volume.stdout.trim() === baseline.postgresVolume : null,
  watchdogSinceBoot: watchdog,
  unexpectedShutdownsLast24h: windows.unexpectedShutdownsLast24h,
  routes,
};
report.pass = routes.every(route => route.ok)
  && report.containers.running === 9 && report.containers.unhealthy === 0
  && report.nextListener.address === '127.0.0.1' && report.nextListener.owner === 'ClubRotarioWebSvc'
  && (phase === 'baseline' || report.sameVolumeAsBaseline === true)
  && (phase !== 'reboot' || report.rebootedSinceBaseline === true);
writeFileSync(phase === 'baseline' ? baselinePath : `${dir}/reboot-verification-${phase}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ phase, pass: report.pass, lastBoot: report.lastBoot, containers: report.containers, routes: routes.map(route => `${route.status} ${route.url}`) }, null, 2));
process.exitCode = report.pass ? 0 : 1;
