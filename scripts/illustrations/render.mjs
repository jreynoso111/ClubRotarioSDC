// Renderiza las ilustraciones SVG del club a WebP (1500x1000, calidad 82).
// Uso: node scripts/illustrations/render.mjs
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const scenes = ['club-fellowship', 'club-service', 'club-group'];

for (const name of scenes) {
  const svg = await readFile(join(here, `${name}.svg`));
  const output = join(root, 'public', `${name}.webp`);
  await sharp(svg)
    .resize(1500, 1000, { fit: 'fill' })
    .flatten({ background: '#e6d3a8' })
    .webp({ quality: 82 })
    .toFile(output);
  console.log(`${name}.webp escrito`);
}
