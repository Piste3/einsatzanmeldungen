// Scrollposition immer behalten (ganze App, PC und Handy)
// - Lädt eine Aktion die Seite neu (Speichern, Löschen, Zurücksetzen, Filter, Neuladen), springt die Ansicht
//   an dieselbe Stelle zurück: die Seite und jeder Bereich mit eigenem Scrollbalken (z. B. Tabellen).
// - Schliesst ein Dialog, bleibt die Seite stehen (der Browser würde sonst zum auslösenden Knopf springen).
// - Die Live-Aktualisierung (app.js) nutzt dieselben Funktionen: window.kkbScroll.snapshot() / .apply().
(function () {
  'use strict';
  const KEY = 'kkb:scroll:v2';
  const MAX_AGE = 2 * 60 * 1000;

  // Beschreibung eines Elements, die nach dem Neuladen wieder dasselbe Element findet
  function selectorOf(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = [...el.classList].filter((c) => !/^(flash-new|is-|open$)/.test(c)).map((c) => `.${CSS.escape(c)}`).join('');
    return el.tagName.toLowerCase() + cls;
  }

  // Höhe der Meldungen oben («Gespeichert» …): verschiebt den Inhalt nach unten
  function flashHeight() {
    return [...document.querySelectorAll('.flash:not(#stale-hint)')].reduce((sum, f) => {
      const cs = getComputedStyle(f);
      return cs.position === 'fixed' || cs.position === 'absolute' ? sum : sum + f.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }, 0);
  }

  // Alle gescrollten Bereiche und die Seite festhalten (skip: Element, dessen Inhalt nicht zählt, z. B. ein neuer Dialog)
  function snapshot(skip) {
    const boxes = [];
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (const el of all) {
      if (!el.scrollTop && !el.scrollLeft) continue;
      if (skip && skip.contains(el)) continue;
      const sel = selectorOf(el);
      const i = [...document.querySelectorAll(sel)].indexOf(el);
      if (i >= 0) boxes.push([sel, i, el.scrollTop, el.scrollLeft]);
    }
    return { x: window.scrollX, y: window.scrollY, flash: flashHeight(), boxes };
  }

  function apply(st, { flashShift = false } = {}) {
    if (!st) return;
    for (const [sel, i, top, left] of st.boxes || []) {
      let el = null;
      try { el = document.querySelectorAll(sel)[i]; } catch { /* ungültig */ }
      if (!el) continue;
      if (el.scrollTop !== top) el.scrollTop = top;
      if (el.scrollLeft !== left) el.scrollLeft = left;
    }
    // Neue Meldung oben: um ihre Höhe weiter scrollen, damit derselbe Inhalt sichtbar bleibt
    const y = st.y > 0 && flashShift ? st.y + Math.max(0, flashHeight() - (st.flash || 0)) : st.y;
    if (window.scrollX !== st.x || window.scrollY !== y) window.scrollTo(st.x, y);
  }

  // ---------- Vor dem Verlassen der Seite speichern ----------
  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname, at: Date.now(), ...snapshot() })); } catch { /* ohne Speicher */ }
  }
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);

  // ---------- Nach dem Laden derselben Seite wiederherstellen ----------
  function restore() {
    let st = null;
    try { st = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY); } catch { return; }
    if (!st || st.path !== location.pathname || Date.now() - st.at > MAX_AGE) return;
    if (location.hash) return; // Sprungmarke: der Browser springt selbst dorthin
    const nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
    if (nav.type === 'back_forward') return; // Zurück/Vor: das macht der Browser selbst
    let stop = false;
    const run = () => { if (!stop) apply(st, { flashShift: true }); };
    // Scrollt die Person selbst, nicht mehr eingreifen
    const quit = () => { stop = true; ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((t) => window.removeEventListener(t, quit, true)); };
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((t) => window.addEventListener(t, quit, { capture: true, passive: true }));
    run();
    requestAnimationFrame(run);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    if (document.readyState !== 'complete') window.addEventListener('load', () => { run(); requestAnimationFrame(run); }, { once: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run).catch(() => {});
    setTimeout(quit, 3000);
  }
  restore();
  // Seite aus dem Zwischenspeicher des Browsers (Zurück): nichts tun, der Stand ist schon da
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) { try { sessionStorage.removeItem(KEY); } catch { /* egal */ } } });

  // ---------- Dialoge: beim Schliessen nicht springen ----------
  if (typeof HTMLDialogElement !== 'undefined') {
    const proto = HTMLDialogElement.prototype;
    const hold = (dlg) => {
      const st = dlg.kkbScroll;
      if (!st) return;
      apply(st);
      requestAnimationFrame(() => apply(st));
    };
    for (const name of ['showModal', 'show']) {
      const orig = proto[name];
      if (typeof orig !== 'function') continue;
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

  window.kkbScroll = { snapshot, apply, save };
})();
