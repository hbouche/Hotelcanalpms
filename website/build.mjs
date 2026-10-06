import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Licensed regional originals, pinned to the visually reviewed bytes.
const images = [
  ['lake.jpg', 'https://upload.wikimedia.org/wikipedia/commons/7/72/Gatun_Lake_-_50088345977.jpg', 'd47d631168419a6f4a9b9d02f970114a790ecf68d2071167f3de8d12ef008684'],
  ['gatun.jpg', 'https://upload.wikimedia.org/wikipedia/commons/4/4f/Panama%2C_Gatun_Lake_1.jpg', '42a9a0c3d7ef2247d58183b0bd5eb83f31b855c6cc8c687b2b8e7a28258b82b4'],
];
mkdirSync('website/assets', { recursive: true });
for (const [name, url, hash] of images) {
  const path = `website/assets/${name}`;
  if (!existsSync(path)) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'HotelPanamaCanalProposal/1.0 (licensed regional image build)' } });
    if (!response.ok) throw new Error(`Image unavailable: ${name}`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  }
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== hash) throw new Error(`Image hash mismatch: ${name}`);
}
const pages = ['index.html', 'nosotros.html', 'contacto.html', 'area.html', 'creditos.html'];
for (const page of pages) {
  if (!existsSync(`website/${page}`)) throw new Error(`Missing ${page}`);
  const html = readFileSync(`website/${page}`, 'utf8');
  if (!html.includes('lang="es"') || !html.includes('viewport')) throw new Error(`Invalid ${page}`);
}
console.log('Five static pages validated. No dependencies or build artifacts required.');
