// Fetches OFL fonts into assets/fonts. Run once; the fonts are committed.
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://github.com/google/fonts/raw/main/ofl';
const FILES = [
  [`${BASE}/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf`, 'NotoSansDevanagari.ttf'],
  [`${BASE}/notosansdevanagari/OFL.txt`, 'OFL-NotoSansDevanagari.txt'],
  [`${BASE}/inter/Inter%5Bopsz,wght%5D.ttf`, 'Inter.ttf'],
  [`${BASE}/inter/OFL.txt`, 'OFL-Inter.txt'],
];

await mkdir('assets/fonts', { recursive: true });
for (const [url, name] of FILES) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (name.endsWith('.ttf') && buf.length < 100_000) throw new Error(`${name}: suspiciously small (${buf.length} B)`);
  await writeFile(`assets/fonts/${name}`, buf);
  console.log(`${name}: ${(buf.length / 1024).toFixed(0)} KB`);
}
