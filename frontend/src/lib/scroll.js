// Scrollposition immer behalten (wie bisher public/js/scroll.js).
// - Eine neue Meldung oben schiebt den Inhalt nicht weg: die Seite scrollt um ihre Höhe mit.
//   Ist die Meldung oben nicht sichtbar, erscheint sie kurz unten rechts.
// - Schliesst ein Dialog, bleibt die Seite stehen (der Browser würde sonst zum auslösenden Knopf springen).
function selectorOf(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const cls = [...el.classList].filter((c) => !/^(flash-new|is-|open$)/.test(c)).map((c) => `.${CSS.escape(c)}`).join('');
  return el.tagName.toLowerCase() + cls;
}

export function flashHeight() {
  return [...document.querySelectorAll('#content > .flash')].reduce((sum, f) => {
    const cs = getComputedStyle(f);
    return cs.position === 'fixed' || cs.position === 'absolute' ? sum : sum + f.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
  }, 0);
}

export function snapshot(skip) {
  const boxes = [];
  for (const el of document.body.getElementsByTagName('*')) {
    if (!el.scrollTop && !el.scrollLeft) continue;
    if (skip && skip.contains(el)) continue;
    const sel = selectorOf(el);
    const i = [...document.querySelectorAll(sel)].indexOf(el);
    if (i >= 0) boxes.push([sel, i, el.scrollTop, el.scrollLeft]);
  }
  return { x: window.scrollX, y: window.scrollY, flash: flashHeight(), boxes };
}

export function apply(st, { flashShift = false } = {}) {
  if (!st) return;
  for (const [sel, i, top, left] of st.boxes || []) {
    let el = null;
    try { el = document.querySelectorAll(sel)[i]; } catch { /* ungültig */ }
    if (!el) continue;
    if (el.scrollTop !== top) el.scrollTop = top;
    if (el.scrollLeft !== left) el.scrollLeft = left;
  }
  const y = st.y > 0 && flashShift ? st.y + (flashHeight() - (st.flash || 0)) : st.y;
  if (window.scrollX !== st.x || window.scrollY !== y) window.scrollTo(st.x, Math.max(0, y));
}

// Meldung kurz unten einblenden, wenn die Meldung oben nicht sichtbar ist
export function toastFlashes() {
  document.querySelectorAll('.inline-toast').forEach((t) => t.remove());
  const list = [...document.querySelectorAll('#content > .flash')];
  if (!list.length || list[0].getBoundingClientRect().bottom > 0) return;
  const box = document.createElement('div');
  box.className = 'inline-toast no-print';
  box.setAttribute('role', 'status');
  list.forEach((f) => { const c = f.cloneNode(true); c.classList.remove('flash-new'); box.append(c); });
  document.body.append(box);
  setTimeout(() => box.remove(), 4500);
}

export function installDialogScroll() {
  if (typeof HTMLDialogElement === 'undefined') return;
  const proto = HTMLDialogElement.prototype;
  if (proto.kkbPatched) return;
  proto.kkbPatched = true;
  const hold = (dlg) => {
    const st = dlg.kkbScroll;
    if (!st) return;
    apply(st);
    requestAnimationFrame(() => apply(st));
  };
  for (const name of ['showModal', 'show']) {
    const orig = proto[name];
    proto[name] = function (...args) {
      this.kkbScroll = snapshot(this);
      if (!this.kkbScrollHooked) { this.kkbScrollHooked = true; this.addEventListener('close', () => hold(this)); }
      const r = orig.apply(this, args);
      apply(this.kkbScroll); // Fokus im Dialog darf die Seite dahinter nicht verschieben
      return r;
    };
  }
  const close = proto.close;
  proto.close = function (...args) {
    const r = close.apply(this, args);
    hold(this);
    return r;
  };
}
