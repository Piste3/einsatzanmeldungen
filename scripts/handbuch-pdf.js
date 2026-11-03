'use strict';
// Erzeugt die gestalteten PDFs der Handbücher nach docs/handbuch/pdf/ – mit Titelseite,
// Inhaltsverzeichnis mit Seitenzahlen, Kapiteln auf neuen Seiten und Seitenzahlen in der Fusszeile.
// Die App liefert diese Dateien unter «Handbuch › Als PDF» aus (src/routes/handbook.js).
//
//   npm run handbuch:pdf                     beide Handbücher
//   npm run handbuch:pdf -- einsatzleiter    nur eines (voll | einsatzleiter)
//   npm run handbuch:pdf -- --kopie <ordner> zusätzlich eine Kopie mit Datum im Namen ablegen
//
// Braucht Playwright mit Chromium (nur auf dem Rechner, der die PDFs erzeugt, nicht auf dem Server):
//   npm install --no-save playwright && npx playwright install chromium
// Nach jeder Änderung an docs/handbuch (Text oder Bilder) neu erzeugen; der Test prüft das.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const handbook = require('../src/lib/handbook');

const LOGO = fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'logo.svg'), 'utf8');
const MAX_IMG_PX = 1400; // Bildbreite im PDF (reicht für ~200 dpi bei voller Seitenbreite)
const FLOW = new Set(['einsatzleiter']); // diese Handbücher ohne Seitenumbruch vor jedem Kapitel

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtShort = (d) => new Intl.DateTimeFormat('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' }).format(d).replace(',', '');
const fmtDate = (d) => new Intl.DateTimeFormat('de-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' }).format(d);

const FONT_DIR = path.join(__dirname, '..', 'public', 'fonts');
const CSS = `
@font-face { font-family: "Geist"; src: url("file://${FONT_DIR}/geist.woff2") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist Mono"; src: url("file://${FONT_DIR}/geist-mono.woff2") format("woff2"); font-weight: 100 900; }
@page {
  size: A4;
  margin: 18mm 18mm 20mm 18mm;
  @top-left { content: "KKB-Einsatzplaner"; font: 600 7.5pt Geist, sans-serif; color: #18181b; vertical-align: bottom; padding-bottom: 4mm; }
  @top-right { content: "__BOOK__"; font: 7.5pt Geist, sans-serif; color: #6b6b70; vertical-align: bottom; padding-bottom: 4mm; }
  @bottom-left { content: "Kadetten-Korps Basel"; font: 7.5pt Geist, sans-serif; color: #6b6b70; vertical-align: top; padding-top: 5mm; }
  @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 7.5pt Geist, sans-serif; color: #6b6b70; vertical-align: top; padding-top: 5mm; }
}
@page cover { margin: 0; @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
/* Gleicher Stil wie die App: helle Flächen, feine Linien, Orange nur als Akzent */
:root { --ink: #18181b; --signal: #e8732a; --shelf: #f6f6f4; --line: #e7e7e4;
  --text: #18181b; --text-2: #3f3f46; --muted: #6b6b70; --border: #e7e7e4; --soft: #fafaf9; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Geist, "Segoe UI", Arial, sans-serif; font-size: 10pt; line-height: 1.55; color: var(--text);
  hyphens: auto; -webkit-hyphens: auto; }

/* Titelseite */
.cover { page: cover; height: 297mm; width: 210mm; background: var(--shelf); color: var(--ink); position: relative; overflow: hidden; break-after: page; }
.cover .band { position: absolute; left: 0; right: 0; bottom: 0; height: 74mm; background: #fff; border-top: 1px solid var(--line); }
.cover .stripe { display: none; }
.cover .head { position: absolute; left: 24mm; top: 26mm; display: flex; align-items: center; gap: 5mm; }
.cover .head svg { width: 16mm; height: 16mm; }
.cover .head .org { font-size: 10.5pt; line-height: 1.35; color: var(--muted); }
.cover .head .org b { display: block; color: var(--ink); font-size: 12.5pt; font-weight: 600; }
.cover .title { position: absolute; left: 24mm; right: 24mm; top: 100mm; }
.cover .kicker { font-size: 10pt; font-weight: 500; color: var(--signal); margin-bottom: 6mm; }
.cover h1 { font-size: 42pt; line-height: 1.02; font-weight: 600; letter-spacing: -.035em; margin: 0 0 7mm; }
.cover .sub { font-size: 13pt; color: var(--text-2); max-width: 125mm; line-height: 1.45; }
.cover .meta { position: absolute; left: 24mm; right: 24mm; bottom: 26mm; display: grid; grid-template-columns: repeat(3, auto); justify-content: start; gap: 0 16mm; font-size: 9pt; color: var(--muted); }
.cover .meta b { display: block; color: var(--ink); font-size: 11pt; font-weight: 600; margin-top: 1mm; font-variant-numeric: tabular-nums; }

/* Inhaltsverzeichnis */
.front { break-after: page; }
.front .intro { font-size: 10.5pt; color: var(--text-2); margin: 0 0 6mm; }
.front .intro blockquote { margin: 4mm 0 0; }
.front h2.toc-title { font-size: 20pt; font-weight: 600; letter-spacing: -.03em; margin: 0 0 5mm; padding-bottom: 3mm; border-bottom: 1px solid var(--line); }
.toc { list-style: none; margin: 0; padding: 0; }
.toc li { break-inside: avoid; }
.toc a { color: inherit; text-decoration: none; display: flex; align-items: baseline; gap: 2mm; }
.toc a .dots { flex: 1; border-bottom: 1px dotted #c8c8c4; transform: translateY(-1mm); min-width: 6mm; }
.toc a .pg { font-variant-numeric: tabular-nums; min-width: 7mm; text-align: right; color: var(--muted); }
.toc .l2 { margin-top: 2.6mm; font-weight: 600; font-size: 10.5pt; }
.toc .l2 .n { display: inline-block; width: 8mm; color: var(--muted); font-family: "Geist Mono", monospace; font-weight: 500; font-size: 9.5pt; }
.toc .l3 { padding-left: 8mm; font-size: 9pt; color: var(--text-2); margin-top: .6mm; }
.toc.compact .l3 { display: none; }

/* Kapitel */
.chapter { break-before: page; }
/* Kurze Handbücher: Kapitel laufen weiter statt jedes Mal eine neue Seite */
.flow .chapter { break-before: auto; margin-top: 11mm; }
.flow .front + .chapter { margin-top: 0; }
.chapter > h2 { display: flex; align-items: baseline; gap: 4mm; margin: 0 0 6mm; padding-bottom: 4mm; border-bottom: 1px solid var(--line); font-size: 20pt; font-weight: 600; letter-spacing: -.03em; line-height: 1.15; break-after: avoid; }
.chapter > h2 .n { flex: none; font-family: "Geist Mono", monospace; font-weight: 500; font-size: 13pt; color: var(--signal); letter-spacing: 0; }
h3 { font-size: 12.5pt; font-weight: 600; letter-spacing: -.015em; color: var(--ink); margin: 7mm 0 2.5mm; line-height: 1.25; break-after: avoid; }
h4 { font-size: 10.5pt; font-weight: 600; margin: 5mm 0 2mm; break-after: avoid; }
p { margin: 0 0 2.6mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0 0 1.3mm; }
li::marker { color: var(--muted); }
li > ul, li > ol { margin: 1.3mm 0 0; }
strong { font-weight: 600; }
a { color: var(--ink); text-decoration: underline; text-decoration-color: #c8c8c4; text-underline-offset: .6mm; }
.applink { font-weight: 600; }
code { font-family: "Geist Mono", Consolas, monospace; font-size: 8.4pt; background: var(--soft); border: 1px solid var(--border); padding: 0 1.2mm; border-radius: 1mm; }
pre { background: var(--ink); color: #ededed; border-radius: 2mm; padding: 3.5mm 4mm; font-size: 8.4pt; line-height: 1.5; break-inside: avoid; white-space: pre-wrap; }
pre code { background: none; border: 0; padding: 0; color: inherit; }
blockquote { margin: 3mm 0 4mm; padding: 3mm 4mm 3mm 5mm; background: var(--soft); border: 1px solid var(--line); border-radius: 2mm; break-inside: avoid; color: var(--text-2); position: relative; }
blockquote::before { content: ""; position: absolute; left: 2mm; top: 3.6mm; width: 1.4mm; height: 1.4mm; border-radius: 50%; background: var(--signal); }
blockquote p:last-child { margin: 0; }
table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 2mm 0 4.5mm; font-size: 8.8pt; line-height: 1.45; border: 1px solid var(--border); border-radius: 2mm; overflow: hidden; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { background: var(--shelf); color: var(--muted); text-align: left; font-weight: 500; padding: 2mm 3mm; font-size: 8.2pt; border-bottom: 1px solid var(--border); }
td { padding: 1.8mm 3mm; vertical-align: top; border-top: 1px solid var(--border); }
tbody tr:first-child td { border-top: 0; }
td:first-child { font-weight: 600; }
.keep { break-inside: avoid; }
figure { margin: 3mm 0 5mm; break-inside: avoid; text-align: center; }
figure img { display: block; margin: 0 auto; max-width: 100%; max-height: 118mm; width: auto; height: auto; border: 1px solid var(--line); border-radius: 2mm; }
figure img.small { max-width: 60%; }
figure img.tall { max-height: 175mm; }
figcaption { font-size: 8.2pt; color: var(--muted); margin-top: 2mm; }
figcaption::before { content: "Bild " counter(fig) " · "; font-weight: 600; color: var(--ink); }
body { counter-reset: fig; }
figure { counter-increment: fig; }
hr { border: 0; border-top: 1px solid var(--border); margin: 5mm 0; }
`;

function build(key, { version, pages = {} } = {}) {
  const { date, commit } = version;
  const book = handbook.BOOKS[key];
  const { html, toc } = handbook.render(key, {
    imageSrc: (src) => {
      const ext = path.extname(src).slice(1).toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext;
      return `data:image/${mime};base64,${fs.readFileSync(path.join(handbook.DIR, src)).toString('base64')}`;
    },
    // Links innerhalb des Handbuchs bleiben, Webadressen auch; App-Links gibt es im PDF nicht
    linkHref: (href) => (/^(https?:|mailto:|#)/.test(href) ? href : null),
  });

  // Vor dem ersten Kapitel: Titel (kommt auf die Titelseite) und Einleitung (kommt vor das Inhaltsverzeichnis)
  const parts = html.replace(/ loading="lazy"/g, '').split(/(?=<h2 id=)/);
  const intro = parts.shift().replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '').trim();
  const chapters = parts.map((chunk) => chunk.replace(/^<h2 id="([^"]+)">(?:(\d+)\s*·\s*)?([\s\S]*?)<\/h2>/,
    (m, id, n, title) => `<h2 id="${id}">${n ? `<span class="n">${n}</span>` : ''}<span>${title}</span></h2>`));

  const pg = (id) => `<span class="pg">${pages[id] || ''}</span>`;
  const entries = toc.filter((t) => t.depth === 2 || t.depth === 3).map((t) => {
    const m = t.depth === 2 && t.text.match(/^(\d+)\s*·\s*(.*)$/);
    const label = m ? `<span class="n">${m[1]}</span>${esc(m[2])}` : esc(t.text);
    return `<li class="l${t.depth}"><a href="#${t.id}"><span>${label}</span><span class="dots"></span>${pg(t.id)}</a></li>`;
  }).join('');
  const compact = toc.filter((t) => t.depth === 3).length > 60;

  return `<!doctype html><html lang="de-CH"><head><meta charset="utf-8">
<title>${esc(book.title)} · KKB-Einsatzplaner</title>
<style>${CSS.replace('__BOOK__', book.title.replace(/"/g, ''))}</style></head><body class="${FLOW.has(key) ? 'flow' : ''}">
<section class="cover">
  <div class="stripe"></div><div class="band"></div>
  <div class="head">${LOGO}<div class="org"><b>Kadetten-Korps Basel</b>KKB-Einsatzplaner</div></div>
  <div class="title">
    <div class="kicker">KKB-Einsatzplaner</div>
    <h1>${esc(book.title)}</h1>
    <div class="sub">${esc(book.subtitle)}</div>
  </div>
  <div class="meta">
    <div>Stand<b>${esc(fmtDate(date))}</b></div>
    <div>Version (Push)<b>${commit ? `${esc(commit)} · ${esc(fmtShort(date))}` : 'nicht committet'}</b></div>
    <div>Online<b>Menü «Handbuch»</b></div>
  </div>
</section>
<section class="front">
  <div class="intro">${intro}</div>
  <h2 class="toc-title">Inhalt</h2>
  <ul class="toc${compact ? ' compact' : ''}">${entries}</ul>
</section>
${chapters.map((c) => `<section class="chapter">${c}</section>`).join('\n')}
</body></html>`;
}

// ---- Seitenzahlen der Überschriften aus dem PDF lesen -----------------------------------------
// Chromium legt für jedes Sprungziel (#id) einen benannten Zielpunkt an.
function pageNumbers(buf) {
  const pdf = buf.toString('latin1');
  const objects = new Map();
  for (const m of pdf.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(m[1], m[2]);
  // Seitenreihenfolge über den Seitenbaum
  const root = pdf.match(/\/Root (\d+) 0 R/)[1];
  const pagesRoot = objects.get(root).match(/\/Pages (\d+) 0 R/)[1];
  const order = [];
  const walk = (id) => {
    const o = objects.get(id);
    if (/\/Type\s*\/Pages\b/.test(o)) {
      const kids = o.match(/\/Kids\s*\[([^\]]*)\]/)[1];
      for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(k[1]);
    } else order.push(id);
  };
  walk(pagesRoot);
  const pageOf = new Map(order.map((id, i) => [id, i + 1]));
  const result = {};
  // Einträge im /Dests-Verzeichnis: /name [Seite 0 R /XYZ …] (Sonderzeichen als #xx)
  const decode = (s) => s.replace(/#([0-9a-fA-F]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
  for (const m of pdf.matchAll(/\/([^\s[\]/<>()]+)\s*\[\s*(\d+) 0 R\s*\/XYZ/g)) {
    const n = pageOf.get(m[2]);
    if (n) result[decode(m[1])] = n;
  }
  return result;
}

async function makePdf(browser, key, version) {
  const page = await browser.newPage();
  const tmp = path.join(os.tmpdir(), `kkb-handbuch-${key}-${process.pid}.html`);
  const load = async (html) => {
    fs.writeFileSync(tmp, html);
    await page.goto(`file://${tmp}`, { waitUntil: 'load' });
    await page.evaluate(async (maxPx) => {
      await document.fonts.ready;
      // Zwischentitel nie allein unten auf einer Seite: mit dem folgenden Block zusammenhalten
      // (Bilder stehen in Markdown in einem eigenen Absatz; der Browser lässt davon leere <p> zurück)
      for (const p of document.querySelectorAll('p')) if (!p.textContent.trim() && !p.children.length) p.remove();
      for (const h of document.querySelectorAll('.chapter h3, .chapter h4')) {
        const next = h.nextElementSibling;
        if (!next || /^H[1-4]$/.test(next.tagName)) continue;
        const group = [h, next];
        // kurzer Text vor einem Bild: das Bild gehört auch noch dazu
        const after = next.nextElementSibling;
        if (next.tagName !== 'FIGURE' && after && after.tagName === 'FIGURE' && next.offsetHeight < 120) group.push(after);
        const keep = document.createElement('div');
        keep.className = 'keep';
        h.before(keep);
        keep.append(...group);
      }
      for (const img of document.images) {
        await img.decode().catch(() => {});
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (w / h < 0.9) img.classList.add('tall');       // Hochformat (Handy, lange Seiten) darf höher werden
        if (w < 700) img.classList.add('small');          // kleine Ausschnitte nicht aufblasen
        if (w <= maxPx || !img.src.startsWith('data:image/jpeg')) continue;
        const c = document.createElement('canvas');
        c.width = maxPx; c.height = Math.round(h * maxPx / w);
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        img.src = c.toDataURL('image/jpeg', 0.8);
        await img.decode().catch(() => {});
      }
    }, MAX_IMG_PX);
  };
  const opts = { format: 'A4', printBackground: true, preferCSSPageSize: true, outline: true, tagged: true };
  // 1. Durchgang: wo landet welche Überschrift? 2. Durchgang: mit Seitenzahlen im Inhaltsverzeichnis
  await load(build(key, { version }));
  const pages = pageNumbers(await page.pdf(opts));
  await load(build(key, { version, pages }));
  const buf = await page.pdf(opts);
  await page.close();
  fs.rmSync(tmp, { force: true });
  const count = (buf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
  return { buf, count, found: Object.keys(pages).length };
}

async function main() {
  const args = process.argv.slice(2);
  const copyIdx = args.indexOf('--kopie');
  const copyDir = copyIdx >= 0 ? args.splice(copyIdx, 2)[1] : null;
  const keys = args.length ? args : Object.keys(handbook.BOOKS);
  for (const k of keys) if (!handbook.BOOKS[k]) throw new Error(`Unbekanntes Handbuch «${k}» (voll | einsatzleiter)`);

  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.error('Playwright fehlt. Einmalig: npm install --no-save playwright && npx playwright install chromium');
    process.exit(1);
  }
  const browser = await chromium.launch();
  const date = new Date();
  // Auf dem Titelblatt steht der Push, aus dem das PDF stammt: Änderungen also zuerst committen
  const draft = args.includes('--entwurf');
  if (draft) args.splice(args.indexOf('--entwurf'), 1);
  if (!draft && handbook.sourcesDirty()) {
    console.error('Am Handbuch gibt es Änderungen, die noch nicht committet sind. Zuerst committen, dann die PDFs erzeugen und separat committen.\n(Zum Anschauen ohne Commit: npm run handbuch:pdf -- --entwurf)');
    process.exit(1);
  }
  const version = draft && handbook.sourcesDirty() ? { commit: null, date } : handbook.sourceVersion();
  if (!version.date) Object.assign(version, { date });
  const stand = handbook.readStand();
  fs.mkdirSync(handbook.PDF_DIR, { recursive: true });
  try {
    for (const key of keys) {
      const { buf, count, found } = await makePdf(browser, key, version);
      const file = handbook.pdfPath(key);
      fs.writeFileSync(file, buf);
      stand[key] = { quelle: handbook.sourceHash(key), version: version.commit, erzeugt: date.toISOString(), seiten: count };
      console.log(`${path.relative(process.cwd(), file)}: ${count} Seiten, ${(buf.length / 1048576).toFixed(1)} MB, ${found} Sprungziele`);
      if (copyDir) {
        const name = handbook.BOOKS[key].pdf.replace(/\.pdf$/, `_${date.toISOString().slice(0, 10)}.pdf`);
        fs.copyFileSync(file, path.join(copyDir, name));
        console.log(`  Kopie: ${path.join(copyDir, name)}`);
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(handbook.STAND_FILE, `${JSON.stringify(stand, null, 2)}\n`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = { build, pageNumbers };
