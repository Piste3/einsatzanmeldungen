// Browser-App bauen, ohne die laufende App zu stören:
// erst in «dist-neu» bauen, dann tauschen. Schlägt der Build fehl, bleibt die alte App unverändert.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const next = path.join(root, 'dist-neu');
const old = path.join(root, 'dist-alt');

await import('./icons.mjs');
fs.rmSync(next, { recursive: true, force: true });
await build({ root, logLevel: process.env.CI ? 'warn' : 'info', build: { outDir: next, emptyOutDir: true } });
fs.rmSync(old, { recursive: true, force: true });
if (fs.existsSync(dist)) fs.renameSync(dist, old);
fs.renameSync(next, dist);
// Alte Skripte 7 Tage aufheben: Offene Seiten laden sonst beim nächsten Klick ein fehlendes Skript
const assets = path.join(old, 'assets');
const KEEP_MS = 7 * 24 * 3600 * 1000;
if (fs.existsSync(assets)) {
  for (const f of fs.readdirSync(assets)) {
    const from = path.join(assets, f);
    const target = path.join(dist, 'assets', f);
    const st = fs.statSync(from);
    if (fs.existsSync(target) || Date.now() - st.mtimeMs > KEEP_MS) continue;
    fs.copyFileSync(from, target);
    fs.utimesSync(target, st.atime, st.mtime);
  }
}
fs.rmSync(old, { recursive: true, force: true });
console.log('Browser-App gebaut (frontend/dist).');
