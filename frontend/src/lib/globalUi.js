// Allgemeines Verhalten wie bisher in app.js: Menüs («Mehr ▾») als Overlay platzieren und schliessen, Drucken.
const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const closeMenu = (d) => { d.open = false; };

function placeMenu(d) {
  const list = d.querySelector('.menu-list');
  if (!list) return;
  const r = d.querySelector('summary').getBoundingClientRect();
  list.style.right = 'auto';
  list.style.bottom = 'auto';
  list.style.maxHeight = '';
  const h = list.offsetHeight;
  const w = list.offsetWidth;
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  let top = r.bottom + 4;
  if (h > below && above > below) top = Math.max(8, r.top - 4 - h);
  const room = top >= r.bottom ? below : above;
  if (h > room) list.style.maxHeight = `${room}px`;
  list.style.top = `${top}px`;
  const x = d.classList.contains('rte-menu') ? r.left : r.right - w;
  list.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
}

// Handy: Tabellen als Karten. Jede Zelle bekommt den Spaltentitel als Beschriftung (wie bisher).
// Nur Attribute, Vue verwaltet die Elemente weiter.
function labelRows(table, labels, main) {
  for (const tr of all('tbody tr, tfoot tr', table)) {
    let col = 0;
    for (const td of tr.children) {
      if (!td.hasAttribute('data-label')) {
        td.setAttribute('data-label', td.colSpan > 1 ? '' : labels[col] || '');
        if (col === main && td.colSpan === 1 && !td.classList.contains('cell-main')) td.classList.add('cell-main');
      }
      col += td.colSpan || 1;
    }
  }
}
function cardTable(table) {
  if (table.classList.contains('matrix') || table.classList.contains('no-cards') || table.closest('.prose, dialog, .rte-area, .rich')) return;
  const heads = all('thead th', table);
  if (!heads.length) return;
  // Nur setzen, wenn es fehlt: auch ein gleicher Wert löst sonst eine neue Meldung des Beobachters aus
  if (!table.classList.contains('cards')) table.classList.add('cards');
  labelRows(table, heads.map((th) => th.textContent.trim()), heads.findIndex((th) => !th.classList.contains('check-col') && th.textContent.trim()));
}
const cardAll = (root) => (root.matches && root.matches('table') ? [root] : all('table', root)).forEach(cardTable);

// Aufklappbare Bereiche mit data-remember merken sich den Zustand (nur in diesem Browser)
function rememberFold(root) {
  [...(root.matches && root.matches('details[data-remember]') ? [root] : []), ...all('details[data-remember]', root)].forEach((d) => {
    if (d.dataset.rememberDone) return;
    d.dataset.rememberDone = '1';
    const key = `fold:${d.dataset.remember}`;
    try { const v = localStorage.getItem(key); if (v === 'zu') d.open = false; else if (v === 'auf') d.open = true; } catch { /* ohne Speicher: Vorgabe */ }
    const sum = d.querySelector(':scope > summary');
    if (sum) sum.addEventListener('click', () => { try { localStorage.setItem(key, d.open ? 'zu' : 'auf'); } catch { /* egal */ } });
  });
}

// Fenster beim längeren Darüberfahren (data-tip). Der Inhalt ist serverseitig escaped.
function installTips() {
  if (!window.matchMedia('(hover: hover)').matches) return;
  let tip = null; let timer = null; let cur = null;
  const hide = () => { clearTimeout(timer); timer = null; cur = null; if (tip) tip.hidden = true; };
  const show = (el) => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'hover-tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.innerHTML = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth; const hgt = tip.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 6;
    if (top + hgt > window.innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top = `${top + window.scrollY}px`;
  };
  document.addEventListener('mouseover', (ev) => {
    const el = ev.target.closest('[data-tip]');
    if (el === cur) return;
    hide();
    if (!el || !el.dataset.tip) return;
    cur = el;
    timer = setTimeout(() => show(el), 450);
  });
  document.addEventListener('mouseleave', hide);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('mousedown', hide);
  document.addEventListener('keydown', hide);
}

// Sprungadresse (#schichten-bearbeiten) auf einen zugeklappten Bereich: aufklappen
function openHashTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  const d = id && document.getElementById(id);
  if (d && d.tagName === 'DETAILS') d.open = true;
}

export function installGlobalUi() {
  installTips();
  const enhance = (root) => { rememberFold(root); cardAll(root.closest ? (root.closest('table') || root) : root); };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes') { if (m.target.matches('table')) cardTable(m.target); continue; }
      for (const n of m.addedNodes) if (n.nodeType === 1) enhance(n);
    }
    openHashTarget();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('hashchange', openHashTarget);

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, a, [data-print]');
    if (!t) {
      if (ev.target.closest('.menu-list')) return; // Klick in ein offenes Menü lässt es offen
      all('details.menu[open]').forEach(closeMenu);
      return;
    }
    if (t.matches('[data-print]')) { ev.preventDefault(); window.print(); }
    // Eintrag im Menü gewählt oder woanders geklickt: offene Menüs schliessen
    all('details.menu[open]').forEach((d) => {
      if (!d.contains(t) || t.closest('.menu-list')) closeMenu(d);
    });
  });
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (d.matches && d.matches('details.menu') && d.open) placeMenu(d);
  }, true);
  const replaceMenus = () => all('details.menu[open]').forEach(placeMenu);
  window.addEventListener('resize', replaceMenus);
  document.addEventListener('scroll', (ev) => {
    if (!(ev.target.closest && ev.target.closest('.menu-list'))) replaceMenus();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') all('details.menu[open]').forEach(closeMenu); });
  document.addEventListener('focusin', (ev) => { if (ev.target.matches && ev.target.matches('[data-select-on-focus]')) ev.target.select(); });
}
