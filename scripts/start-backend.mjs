// Docker's restart policy restores containers; the CLI must also restore the
// stable-port gateway in the signed-in user's session.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { getLocalStackEnvironment } from './local-stack-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const docker = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const log = message => appendFileSync('C:/ProgramData/ClubRotarioSDC/logs/backend-watchdog.log',`${new Date().toISOString()} ${message}\n`);
// One recovery at a time: a cold boot can take longer than the 5-minute
// trigger interval, and overlapping `stack start` calls fail each other.
const lock = 'C:/ProgramData/ClubRotarioSDC/logs/backend-watchdog.lock';
const acquireLock = () => {
 try { writeFileSync(lock, String(Date.now()), { flag: 'wx' }); return true; } catch {}
 try { if (Date.now() - Number(readFileSync(lock, 'utf8')) < 20 * 60000) return false; } catch {}
 writeFileSync(lock, String(Date.now()));
 return true;
};
const healthy = async () => {try{return (await fetch('http://127.0.0.1:26911/auth/v1/health',{signal:AbortSignal.timeout(5000)})).status===200;}catch{return false;}};
const dockerReady = () => spawnSync(docker, ['info','--format','{{.ServerVersion}}'], {stdio:'ignore',windowsHide:true,timeout:8000}).status === 0;
try {
 if (await healthy()) {log('Healthy; no restart required.');process.exit(0);}
 if (!acquireLock()) {log('Recovery already in progress; skipping this run.');process.exit(0);}
 log('Backend unavailable; starting bounded recovery.');
 if (!dockerReady()) {
  const bootstrap=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./start-docker-safely.ps1',import.meta.url))],{stdio:'ignore',windowsHide:true,timeout:30000});
  if(bootstrap.status!==0)throw new Error('Docker bootstrap failed');
 }
 let ready=false;
 const deadline=Date.now()+600000;
 while(Date.now()<deadline){if(dockerReady()){ready=true;break;}await setTimeout(3000);}
 if(!ready)throw new Error('Docker did not become ready within ten minutes');
 const result=spawnSync('C:/ProgramData/ClubRotarioSDC/bin/supabase.exe',['--workdir',root,'stack','start','--stack','club-rotario','--eager'],{cwd:root,env:getLocalStackEnvironment(),stdio:'ignore',windowsHide:true,timeout:420000});
 if(result.status!==0)throw new Error(`Club Rotario backend startup failed or timed out (status ${result.status}, signal ${result.signal}, ${result.error?.code ?? 'no spawn error'})`);
 for(let attempt=0;attempt<12;attempt++){if(await healthy()){log('Recovered; Auth readiness HTTP 200.');console.log('Club Rotario backend ready');rmSync(lock,{force:true});process.exit(0);}await setTimeout(3000);}
 throw new Error('Club Rotario Auth readiness failed');
}catch(error){log(`ERROR ${error.message}`);process.exitCode=1;}
finally{try{rmSync(lock,{force:true});}catch{}}
