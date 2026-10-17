import { readFileSync } from 'node:fs';

export const localStackSecretsPath = 'C:/ProgramData/ClubRotarioSDC/secrets/stack-environment.json';

// This file is readable only by the backend operator, SYSTEM and Administrators.
// Next's service identity must never receive the signing or privileged API keys.
export function getLocalStackEnvironment(base = process.env) {
  const stored = JSON.parse(readFileSync(localStackSecretsPath, 'utf8'));
  const names = ['SUPABASE_AUTH_JWT_SECRET', 'SUPABASE_AUTH_SECRET_KEY', 'SUPABASE_AUTH_PUBLISHABLE_KEY'];
  for (const name of names) {
    if (typeof stored[name] !== 'string' || stored[name].length < 24) {
      throw new Error(`Missing protected backend setting: ${name}`);
    }
  }
  const optional = ['SUPABASE_AUTH_CAPTCHA_SECRET'];
  return { ...base, ...Object.fromEntries([...names, ...optional.filter(name => typeof stored[name] === 'string')].map(name => [name, stored[name]])) };
}
