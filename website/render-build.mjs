import { existsSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';

const root = resolve('website');
const output = resolve(root, 'site');
if (dirname(output) !== root || basename(output) !== 'site') throw new Error('Unsafe output path');
const marker = join(output, '.generated-by-render-build');
if (existsSync(output)) {
  if (!existsSync(marker)) throw new Error('Refusing to replace an unrecognized output directory');
  rmSync(output, { recursive: true });
}
mkdirSync(output, { recursive: true });
writeFileSync(marker, 'Generated static build only. No hotel data.\n');

if (process.env.SITE_MODE === 'withdrawn') {
  const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Demostración fuera de línea</title><body><h1>Demostración temporalmente fuera de línea.</h1><p>Hotel Panama Canal · Propuesta para revisión.</p></body></html>\n';
  writeFileSync(join(output, 'index.html'), html);
  writeFileSync(join(output, '404.html'), html);
  console.log('WITHDRAWN: tiny HTML only. No images, scripts, PMS links or external requests.');
} else if (process.env.SITE_MODE === 'full') {
  await import('./build.mjs');
  const files = ['index.html', 'nosotros.html', 'contacto.html', 'area.html', 'creditos.html', 'style.css', 'app.js'];
  for (const file of files) cpSync(join(root, file), join(output, file));
  mkdirSync(join(output, 'assets'));
  for (const file of ['lake.jpg', 'gatun.jpg']) cpSync(join(root, 'assets', file), join(output, 'assets', file));
  console.log('FULL: five public pages and two verified licensed originals. Internal source files excluded.');
} else {
  throw new Error('Explicit SITE_MODE=withdrawn or full required');
}
