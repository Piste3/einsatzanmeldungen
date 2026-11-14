// Text-Editor für formatierte Vorlagen (Bestätigungsmail, Kalendertermin) und Bausteine einfügen.
// Übernommen aus public/js/app.js: arbeitet direkt im DOM, die Vue-Komponente RichEditor ruft initRte auf.
import { uiDialog } from './dialog.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// ---------- Bausteine einfügen ----------
let lastTokenTarget = null;
export function insertToken(token) {
  let el = lastTokenTarget || $('.rte-area') || $('[data-token-target]');
  if (!el) return;
  if (el.matches('[data-rte-source]') && el.closest('.rte-ready:not(.rte-source-mode)')) el = el.closest('[data-rte]').querySelector('.rte-area');
  if (el.isContentEditable) { // formatierter Text: an der Cursorposition einfügen
    el._rteRestore();
    document.execCommand('insertText', false, token);
    el._rteSync();
    return;
  }
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + token + el.value.slice(end);
  el.focus();
  el.selectionStart = el.selectionEnd = start + token.length;
}

// ---------- Text-Editor für formatierte Vorlagen (Bestätigungsmail, Kalendertermin) ----------
// <div data-rte> mit einer <textarea data-rte-source> (HTML). Ohne JavaScript bleibt das Textfeld mit HTML sichtbar.
const SVG = (p) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const RTE_ICONS = {
  ul: SVG('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  ol: SVG('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 1 1 2.6 1L3.5 19h3"/>'),
  left: SVG('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  center: SVG('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  right: SVG('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  outdent: SVG('<path d="M11 6h9M11 12h9M11 18h9M7 9l-3 3 3 3"/>'),
  indent: SVG('<path d="M11 6h9M11 12h9M11 18h9M4 9l3 3-3 3"/>'),
  link: SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  table: SVG('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/>'),
  hr: SVG('<path d="M3 12h18"/>'),
  clear: SVG('<path d="M6 4h12M12 4l-4 16M15 14l6 6M21 14l-6 6"/>'),
  undo: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: SVG('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  code: SVG('<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>'),
};
const RTE_FONTS = [['Arial, Helvetica, sans-serif', 'Arial'], ['Verdana, Geneva, sans-serif', 'Verdana'], ['Tahoma, Geneva, sans-serif', 'Tahoma'],
  ['"Trebuchet MS", Helvetica, sans-serif', 'Trebuchet MS'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", Times, serif', 'Times New Roman'],
  ['"Courier New", Courier, monospace', 'Courier New']];
const RTE_SIZES = [['2', 'Klein'], ['3', 'Normal'], ['4', 'Gross'], ['5', 'Sehr gross'], ['6', 'Riesig']];
const RTE_BLOCKS = [['div', 'Normaler Text'], ['h2', 'Überschrift'], ['h3', 'Zwischentitel'], ['blockquote', 'Eingerückt']];
const RTE_COLORS = ['#000000', '#1c2333', '#6b7385', '#b8bec9', '#ffffff', '#c0392b', '#e8732a', '#d4a017', '#2e8b57', '#1f6feb', '#1d3f8f', '#7b3fb3',
  '#fde2e1', '#fdf0e6', '#fff6cc', '#e3f5ea', '#e1ecfd', '#efe5f8'];
const CELL_STYLE = 'border: 1px solid #b8bec9; padding: 4px 8px; vertical-align: top';

export function initRte(box) {
  if (box.dataset.rteReady) return;
  box.dataset.rteReady = '1';
  const src = box.querySelector('[data-rte-source]');
  const area = document.createElement('div');
  area.className = 'rte-area';
  area.contentEditable = 'true';
  area.setAttribute('role', 'textbox');
  area.setAttribute('aria-multiline', 'true');
  area.dataset.tokenTarget = '';
  if (src.id) { const lbl = document.querySelector(`label[for="${src.id}"]`); if (lbl) { area.setAttribute('aria-label', lbl.textContent.trim()); lbl.addEventListener('click', () => area.focus()); } }
  area.innerHTML = src.value.trim() || '<div><br></div>';
  if (src.rows) area.style.minHeight = `${Math.max(8, src.rows) * 1.45}em`;
  const bar = document.createElement('div');
  bar.className = 'rte-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formatierung');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const btn = (cmd, label, inner, extra = '') => `<button type="button" class="rte-btn" data-cmd="${cmd}" title="${label}" aria-label="${label}" ${extra}>${inner}</button>`;
  const swatches = (kind) => `<div class="rte-swatches">${RTE_COLORS.map((c) => `<button type="button" class="rte-swatch" data-${kind}="${c}" title="${c}" style="background:${c}"></button>`).join('')}</div>`;
  let grid = '';
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) grid += `<button type="button" data-grid="${r}x${c}" aria-label="${r} Zeilen, ${c} Spalten"></button>`;
  bar.innerHTML = `
    <select class="rte-select" data-select="formatBlock" title="Absatz" aria-label="Absatz"><option value="">Absatz</option>${RTE_BLOCKS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <select class="rte-select" data-select="fontName" title="Schriftart" aria-label="Schriftart"><option value="">Schriftart</option>${RTE_FONTS.map(([v, l]) => `<option value="${esc(v)}" style="font-family:${esc(v)}">${l}</option>`).join('')}</select>
    <select class="rte-select" data-select="fontSize" title="Schriftgrösse" aria-label="Schriftgrösse"><option value="">Grösse</option>${RTE_SIZES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    <span class="rte-group">${btn('bold', 'Fett (Strg+B)', '<b>F</b>')}${btn('italic', 'Kursiv (Strg+I)', '<i>K</i>')}${btn('underline', 'Unterstrichen (Strg+U)', '<u>U</u>')}${btn('strikeThrough', 'Durchgestrichen', '<s>S</s>')}</span>
    <span class="rte-group">
      <details class="menu rte-menu"><summary class="rte-btn" title="Schriftfarbe" aria-label="Schriftfarbe"><span class="rte-a">A<span class="rte-bar" data-color-bar style="background:#c0392b"></span></span></summary>
        <div class="menu-list rte-pop"><div class="rte-pop-title">Schriftfarbe</div>${swatches('fore')}<label class="rte-custom">Eigene Farbe <input type="color" data-fore-custom value="#c0392b"></label></div></details>
      <details class="menu rte-menu"><summary class="rte-btn" title="Hintergrund / Markieren" aria-label="Hintergrund"><span class="rte-a rte-hl">ab<span class="rte-bar" style="background:#fff6cc"></span></span></summary>
        <div class="menu-list rte-pop"><div class="rte-pop-title">Hintergrund markieren</div>${swatches('back')}<label class="rte-custom">Eigene Farbe <input type="color" data-back-custom value="#fff6cc"></label><button type="button" data-back="transparent">Keine Markierung</button></div></details>
    </span>
    <span class="rte-group">${btn('insertUnorderedList', 'Aufzählung', RTE_ICONS.ul)}${btn('insertOrderedList', 'Nummerierung', RTE_ICONS.ol)}${btn('outdent', 'Einzug verkleinern', RTE_ICONS.outdent)}${btn('indent', 'Einzug vergrössern', RTE_ICONS.indent)}</span>
    <span class="rte-group">${btn('justifyLeft', 'Linksbündig', RTE_ICONS.left)}${btn('justifyCenter', 'Zentriert', RTE_ICONS.center)}${btn('justifyRight', 'Rechtsbündig', RTE_ICONS.right)}</span>
    <span class="rte-group">${btn('link', 'Link einfügen', RTE_ICONS.link)}
      <details class="menu rte-menu"><summary class="rte-btn" title="Tabelle" aria-label="Tabelle">${RTE_ICONS.table}</summary>
        <div class="menu-list rte-pop rte-table-pop"><div class="rte-pop-title" data-grid-label>Tabelle einfügen</div><div class="rte-grid">${grid}</div>
          <div class="rte-table-actions"><div class="sep"></div>
            <button type="button" data-table="rowAbove">Zeile oberhalb einfügen</button><button type="button" data-table="rowBelow">Zeile unterhalb einfügen</button>
            <button type="button" data-table="colLeft">Spalte links einfügen</button><button type="button" data-table="colRight">Spalte rechts einfügen</button>
            <div class="sep"></div>
            <button type="button" data-table="delRow">Zeile löschen</button><button type="button" data-table="delCol">Spalte löschen</button>
            <button type="button" data-table="border">Rahmen ein/aus</button>
            <div class="rte-pop-title">Zellenfarbe</div>${swatches('cell')}<button type="button" data-cell="transparent">Keine Zellenfarbe</button>
            <div class="sep"></div><button type="button" class="btn-danger" data-table="delTable">Tabelle löschen</button>
          </div></div></details>
      ${btn('insertHorizontalRule', 'Trennlinie', RTE_ICONS.hr)}</span>
    <span class="rte-group">${btn('removeFormat', 'Formatierung entfernen', RTE_ICONS.clear)}${btn('undo', 'Rückgängig (Strg+Z)', RTE_ICONS.undo)}${btn('redo', 'Wiederholen', RTE_ICONS.redo)}</span>
    <span class="rte-group rte-right">${btn('source', 'HTML-Quelltext bearbeiten', RTE_ICONS.code, 'aria-pressed="false"')}</span>`;
  box.insertBefore(bar, src);
  box.insertBefore(area, src);
  box.classList.add('rte-ready');

  let saved = null;
  let sourceMode = false;
  const sel = () => window.getSelection();
  const inArea = (node) => node && area.contains(node.nodeType === 1 ? node : node.parentNode);
  const onSelection = () => {
    const s = sel();
    if (s.rangeCount && inArea(s.anchorNode)) { saved = s.getRangeAt(0).cloneRange(); updateState(); }
  };
  document.addEventListener('selectionchange', onSelection);
  // Beim Verlassen der Seite (Vue) den Listener wieder entfernen
  box._rteDestroy = () => { document.removeEventListener('selectionchange', onSelection); if (lastTokenTarget === area) lastTokenTarget = null; };
  const restore = () => {
    area.focus({ preventScroll: true });
    if (saved && inArea(saved.startContainer)) { const s = sel(); s.removeAllRanges(); s.addRange(saved); }
  };
  const sync = () => {
    if (sourceMode) return;
    // leere Bearbeitungsfläche: nichts speichern statt <br>
    src.value = area.textContent.trim() || area.querySelector('table, hr') ? area.innerHTML : '';
    src.dispatchEvent(new Event('input', { bubbles: true }));
  };
  area.addEventListener('input', sync);
  area._rteSync = sync;
  area._rteRestore = restore;
  const exec = (cmd, val = null) => {
    restore();
    try { document.execCommand('styleWithCSS', false, cmd !== 'formatBlock'); } catch { /* ältere Browser */ }
    try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch { /* egal */ }
    document.execCommand(cmd, false, val);
    sync();
    updateState();
  };
  function updateState() {
    for (const b of $$('[data-cmd]', bar)) {
      const c = b.dataset.cmd;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyCenter', 'justifyRight'].includes(c)) {
        let on = false;
        try { on = document.queryCommandState(c); } catch { /* egal */ }
        b.classList.toggle('on', on);
      }
    }
    bar.classList.toggle('in-table', Boolean(currentCell()));
  }
  function currentCell() {
    const n = saved && saved.startContainer;
    const el = n && (n.nodeType === 1 ? n : n.parentNode);
    const td = el && el.closest && el.closest('td, th');
    return td && area.contains(td) ? td : null;
  }
  const closeMenus = () => $$('details.menu[open]', bar).forEach((d) => d.removeAttribute('open'));

  // Knöpfe sollen die Auswahl im Text nicht verlieren
  bar.addEventListener('mousedown', (ev) => {
    if (ev.target.closest('button, summary') && !ev.target.closest('select, input')) ev.preventDefault();
  });
  bar.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.select) {
      if (t.value) exec(t.dataset.select, t.dataset.select === 'formatBlock' ? `<${t.value}>` : t.value);
      t.value = '';
    } else if (t.matches('[data-fore-custom]')) { exec('foreColor', t.value); bar.querySelector('[data-color-bar]').style.background = t.value; closeMenus(); }
    else if (t.matches('[data-back-custom]')) { backColor(t.value); closeMenus(); }
  });
  const backColor = (c) => {
    restore();
    try { document.execCommand('styleWithCSS', false, true); } catch { /* egal */ }
    if (!document.execCommand('hiliteColor', false, c)) document.execCommand('backColor', false, c);
    sync();
  };
  bar.addEventListener('mouseover', (ev) => {
    const g = ev.target.closest('[data-grid]');
    if (!g) return;
    const [r, c] = g.dataset.grid.split('x').map(Number);
    $$('[data-grid]', bar).forEach((x) => { const [xr, xc] = x.dataset.grid.split('x').map(Number); x.classList.toggle('on', xr <= r && xc <= c); });
    bar.querySelector('[data-grid-label]').textContent = `Tabelle einfügen: ${r} × ${c}`;
  });
  bar.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.cmd === 'source') return toggleSource(b);
    if (d.cmd === 'link') return makeLink();
    if (d.cmd) return exec(d.cmd);
    if (d.fore) { exec('foreColor', d.fore); bar.querySelector('[data-color-bar]').style.background = d.fore; closeMenus(); return; }
    if (d.back) { backColor(d.back); closeMenus(); return; }
    if (d.grid) { const [r, c] = d.grid.split('x').map(Number); insertTable(r, c); closeMenus(); return; }
    if (d.table || d.cell) { tableAction(d.table, d.cell); closeMenus(); }
  });

  async function makeLink() {
    const keep = saved && saved.cloneRange();
    const url = await uiDialog({ title: 'Link einfügen', message: 'Adresse (https://…) oder E-Mail-Adresse:', input: true, placeholder: 'https://www.kkb.ch', ok: 'Einfügen' });
    if (!url) return;
    saved = keep;
    let href = url.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) href = `mailto:${href}`;
    else if (!/^(https?:|mailto:|tel:|\{\{)/i.test(href)) href = `https://${href}`;
    if (!saved || saved.collapsed) {
      const label = href.replace(/^mailto:|^https?:\/\//i, '');
      exec('insertHTML', `<a href="${esc(href)}">${esc(label)}</a>`);
    } else exec('createLink', href);
  }

  const placeCaret = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    const s = sel(); s.removeAllRanges(); s.addRange(r);
    saved = r.cloneRange();
  };
  // Tabelle direkt ins Dokument setzen (insertHTML würde Stile wie border-collapse verwerfen)
  function insertTable(rows, cols) {
    restore();
    const table = document.createElement('table');
    table.setAttribute('style', 'border-collapse: collapse; min-width: 50%');
    const body = table.appendChild(document.createElement('tbody'));
    for (let r = 0; r < rows; r++) {
      const tr = body.appendChild(document.createElement('tr'));
      for (let c = 0; c < cols; c++) { const td = tr.appendChild(document.createElement('td')); td.setAttribute('style', CELL_STYLE); td.innerHTML = '<br>'; }
    }
    const after = document.createElement('div');
    after.innerHTML = '<br>';
    const n = saved && inArea(saved.startContainer) ? saved.startContainer : null;
    let block = n && (n.nodeType === 1 ? n : n.parentNode);
    while (block && block !== area && block.parentNode !== area) block = block.parentNode;
    if (!block || block === area) area.append(table, after);
    else if (!block.textContent.trim() && !block.querySelector('table, hr')) block.replaceWith(table, after);
    else block.after(table, after);
    placeCaret(table.querySelector('td'));
    sync();
    updateState();
  }
  // Tab springt in die nächste Zelle (in der letzten Zelle entsteht eine neue Zeile)
  area.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab') return;
    const td = currentCell();
    if (!td) return;
    ev.preventDefault();
    const cells = $$('td, th', td.closest('table'));
    let i = cells.indexOf(td) + (ev.shiftKey ? -1 : 1);
    if (i >= cells.length) { tableAction('rowBelow'); i = cells.length; placeCaret($$('td, th', td.closest('table'))[i]); return; }
    if (i >= 0) placeCaret(cells[i]);
  });

  function tableAction(action, cellColor) {
    const td = currentCell();
    if (!td) { uiDialog({ title: 'Tabelle', message: 'Zuerst in eine Tabellenzelle klicken.', cancel: null }); return; }
    const tr = td.parentNode;
    const table = td.closest('table');
    const col = [...tr.children].indexOf(td);
    const rows = $$('tr', table);
    const newCell = (like) => { const c = document.createElement(like ? like.tagName.toLowerCase() : 'td'); c.setAttribute('style', like ? like.getAttribute('style') || CELL_STYLE : CELL_STYLE); c.innerHTML = '<br>'; return c; };
    const newRow = () => { const r = document.createElement('tr'); [...tr.children].forEach((c) => r.append(newCell(c))); return r; };
    if (cellColor) td.style.backgroundColor = cellColor === 'transparent' ? '' : cellColor;
    else if (action === 'rowAbove') tr.before(newRow());
    else if (action === 'rowBelow') tr.after(newRow());
    else if (action === 'colLeft' || action === 'colRight') {
      rows.forEach((r) => { const ref = r.children[Math.min(col, r.children.length - 1)]; if (ref) ref[action === 'colLeft' ? 'before' : 'after'](newCell(ref)); });
    } else if (action === 'delRow') { if (rows.length > 1) tr.remove(); else table.remove(); }
    else if (action === 'delCol') {
      if (tr.children.length > 1) rows.forEach((r) => { if (r.children[col]) r.children[col].remove(); }); else table.remove();
    } else if (action === 'border') {
      const cellsAll = $$('td, th', table);
      const has = cellsAll.some((c) => c.style.borderStyle && c.style.borderStyle !== 'none');
      cellsAll.forEach((c) => { c.style.border = has ? 'none' : '1px solid #b8bec9'; });
    } else if (action === 'delTable') table.remove();
    if (!area.innerHTML.trim()) area.innerHTML = '<div><br></div>';
    sync();
  }

  function toggleSource(b) {
    if (!sourceMode) {
      sync();
      sourceMode = true;
      box.classList.add('rte-source-mode');
      src.focus();
    } else {
      sourceMode = false;
      area.innerHTML = src.value.trim() || '<div><br></div>';
      box.classList.remove('rte-source-mode');
      area.focus();
    }
    b.setAttribute('aria-pressed', String(sourceMode));
    b.classList.toggle('on', sourceMode);
  }

  // Einfügen aus Word/Outlook/Webseiten: unnötigen Ballast entfernen
  area.addEventListener('paste', (ev) => {
    const html = ev.clipboardData && ev.clipboardData.getData('text/html');
    if (!html) return;
    ev.preventDefault();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    $$('script, style, meta, link, title, xml, iframe, object, img, svg', doc).forEach((n) => n.remove());
    $$('*', doc.body).forEach((n) => {
      if (n.tagName.includes(':')) { n.replaceWith(...n.childNodes); return; }
      for (const a of [...n.attributes]) if (!['style', 'href', 'colspan', 'rowspan', 'color', 'face'].includes(a.name)) n.removeAttribute(a.name);
      if (n.getAttribute('style')) {
        const keep = n.getAttribute('style').split(';').filter((d) => /^\s*(color|background(-color)?|font-(weight|style|family|size)|text-(decoration|align)|border[\w-]*|padding[\w-]*|vertical-align)\s*:/i.test(d) && !/mso-|url\(/i.test(d));
        if (keep.length) n.setAttribute('style', keep.join(';')); else n.removeAttribute('style');
      }
    });
    exec('insertHTML', doc.body.innerHTML.replace(/<!--[\s\S]*?-->/g, ''));
  });
  area.addEventListener('focus', () => { lastTokenTarget = area; });
  // Vor dem Absenden sicher den aktuellen Inhalt übernehmen
  if (src.form) src.form.addEventListener('submit', sync, true);
}
// Letztes Feld für Bausteine merken (Titel, Ort, Betreff …)
document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches('[data-token-target]')) lastTokenTarget = ev.target; });
// Beim Seitenwechsel nicht auf ein altes Feld zeigen
export function resetTokenTarget() { lastTokenTarget = null; }
