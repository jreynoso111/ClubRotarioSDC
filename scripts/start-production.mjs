import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const pointer = 'C:/ProgramData/ClubRotarioSDC/current-release.json';
const buildDir = existsSync(pointer) ? JSON.parse(readFileSync(pointer, 'utf8').replace(/^\uFEFF/, '')).buildDir : '.next';
if (buildDir !== '.next' && !/^\.next-releases\/[0-9-]+$/.test(buildDir)) throw new Error('Invalid production build directory');
if (!existsSync(resolve(root, buildDir, 'BUILD_ID'))) throw new Error('Production build is missing');
const result = spawnSync(process.execPath, [resolve(root,'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3010'], {
  cwd: root, env: { ...process.env, NODE_ENV:'production', NEXT_BUILD_DIR:buildDir }, stdio:'inherit', windowsHide:true,
});
process.exit(result.status ?? 1);
