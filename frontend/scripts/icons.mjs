// Erzeugt src/lib/icons.js aus ../src/lib/icons.js (eine Quelle für Backend und Browser-App)
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../../src/lib/icons.js', import.meta.url), 'utf8');
const m = src.match(/const PATHS = (\{[\s\S]*?\n\});/);
fs.writeFileSync(new URL('../src/lib/icons.js', import.meta.url), `// Erzeugt von scripts/icons.mjs – nicht von Hand ändern\nexport const PATHS = ${m[1]};\n`);
