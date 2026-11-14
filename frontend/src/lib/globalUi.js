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

export function installGlobalUi() {
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
