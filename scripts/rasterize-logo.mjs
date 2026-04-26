import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svgPath = resolve(root, 'public/logo.svg');
const sizes = [16, 32, 48, 128];

const svg = await readFile(svgPath);

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0, 0, 0, 0)',
  });
  const png = resvg.render().asPng();
  const outPath = resolve(root, `public/logo-${size}.png`);
  await writeFile(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes)`);
}
