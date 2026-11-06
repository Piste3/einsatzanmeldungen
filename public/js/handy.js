// Handy-App «Anfragen»: Antworten ohne Neuladen speichern, Kanal merken, Suche, Hinweis «Als App speichern»
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* privates Fenster */ } },
  };

  // ---------- Kurze Meldung unten ----------
  let toastTimer = null;
  function toast(text, isError = false) {
    const t = $('#h-toast');
    if (!t) return;
    t.textContent = text;
    t.classList.toggle('is-error', isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 2500);
  }

  // ---------- Eigene Rückfrage statt confirm() ----------
  function ask(text, { title = '', ok = 'Ja' } = {}) {
    return new Promise((resolve) => {
      if (typeof HTMLDialogElement === 'undefined') return resolve(window.confirm(text));
      const d = document.createElement('dialog');
      d.className = 'h-dialog';
      const p = document.createElement('p'); p.textContent = text;
      const h = document.createElement('h2'); h.textContent = title;
      const row = document.createElement('div');
      const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn-ghost'; no.textContent = 'Abbrechen';
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn btn-danger'; yes.textContent = ok;
      const close = (v) => { d.close(); d.remove(); resolve(v); };
      no.addEventListener('click', () => close(false));
      yes.addEventListener('click', () => close(true));
      d.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
      row.append(no, yes); if (title) d.append(h); d.append(p, row); document.body.append(d);
      d.showModal(); yes.focus();
    });
  }

  // ---------- Kanal: «Gefragt per» gilt für alle Karten; Anrufen/WhatsApp in einer Karte setzt den Kanal nur dort ----------
  const radios = $$('input[name="h-channel"]');
  const globalChannel = () => (radios.find((r) => r.checked) || {}).value || 'muendlich';
  function applyChannel(card) {
    const ch = card.dataset.override || globalChannel();
    card.dataset.ch = ch;
    const inp = $('[data-channel-input]', card);
    if (inp) inp.value = ch;
  }
  const applyAll = () => $$('.hc').forEach(applyChannel);
  if (radios.length) {
    const saved = store.get('h-channel');
    const r = radios.find((x) => x.value === saved);
    if (r) r.checked = true;
    radios.forEach((x) => x.addEventListener('change', () => { store.set('h-channel', globalChannel()); $$('.hc').forEach((c) => delete c.dataset.override); applyAll(); }));
  }
  applyAll();

  document.addEventListener('click', (ev) => {
    const set = ev.target.closest('[data-set-channel]');
    const setAll = ev.target.closest('[data-set-channel-all]');
    if (setAll) {
      const r = radios.find((x) => x.value === setAll.dataset.setChannelAll);
      if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event('change')); }
      return;
    }
    if (set) {
      const card = set.closest('.hc');
      if (card) { card.dataset.override = set.dataset.setChannel; applyChannel(card); }
      return;
    }
    if (ev.target.closest('[data-reload]')) { location.reload(); return; }
    const cancel = ev.target.closest('[data-shift-cancel]');
    if (cancel) { cancel.closest('[data-shift-panel]').hidden = true; }
  });

  // ---------- Suche nach Namen (sofort, ohne Neuladen) ----------
  const search = $('[data-h-search]');
  if (search) {
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      $$('.hc').forEach((c) => { const hit = !q || c.dataset.name.includes(q); c.hidden = !hit; if (hit) shown += 1; });
      const none = $('[data-h-nohit]');
      if (none) none.hidden = !(q && !shown);
    };
    search.addEventListener('input', filter);
    if (search.form) search.form.addEventListener('submit', (e) => { if (document.activeElement === search) { e.preventDefault(); search.blur(); } });
  }
  $$('[data-h-autosubmit]').forEach((s) => s.addEventListener('change', () => s.form.submit()));

  // ---------- Antwort speichern: nur die Karte neu zeichnen ----------
  const ANSWER_TEXT = { kann: 'kann', kann_nicht: 'kann nicht', unsicher: 'weiss nicht', nicht_erreicht: 'nicht erreicht', gesendet: 'WhatsApp gesendet' };
  document.addEventListener('submit', async (ev) => {
    const form = ev.target.closest('[data-h-form]');
    if (!form || !window.fetch) return;
    ev.preventDefault();
    const btn = ev.submitter;
    const card = form.closest('.hc');
    // Einsatz mit Schichten: bei «Kann» zuerst die Schichten zeigen
    if (btn && btn.hasAttribute('data-shift-ask')) {
      const panel = $('[data-shift-panel]', form);
      if (panel) { panel.hidden = false; panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    }
    if (form.dataset.confirm && !(await ask(form.dataset.confirm, { title: form.dataset.confirmTitle, ok: form.dataset.confirmOk || 'Ja' }))) return;
    const body = new URLSearchParams();
    for (const [k, v] of new FormData(form)) body.append(k, v);
    if (btn && btn.name) body.append(btn.name, btn.value);
    const who = card.dataset.who || '';
    card.classList.add('is-busy');
    try {
      const res = await fetch(form.action, {
        method: 'POST', body, credentials: 'same-origin',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (res.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
      if (!res.ok) {
        const text = res.headers.get('content-type')?.includes('text/plain') ? await res.text() : 'Speichern ging nicht. Bitte oben neu laden.';
        card.classList.remove('is-busy');
        toast(text, true);
        return;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = (await res.text()).trim();
      const fresh = tpl.content.firstElementChild;
      if (!fresh) { location.reload(); return; }
      card.replaceWith(fresh);
      const undoLabel = res.headers.get('X-H-Undo');
      if (undoLabel) setUndo(decodeURIComponent(undoLabel));
      if (redoForm) redoForm.hidden = true; // neue Aktion: nichts mehr zum Wiederholen
      applyChannel(fresh);
      fresh.classList.add('is-saved');
      setTimeout(() => fresh.classList.remove('is-saved'), 1200);
      const ans = btn && btn.name === 'antwort' ? btn.value : null;
      if (form.dataset.hKind === 'note') { toast(`${who}: Bemerkung gespeichert`); return; }
      if (form.dataset.hKind === 'reg') { toast(`${who}: ${(btn && btn.dataset.doneText) || 'gespeichert'}`); return; }
      toast(ans ? `${who}: ${ANSWER_TEXT[ans] || 'gespeichert'}` : `${who}: zurückgesetzt`);
      updateCounts();
    } catch {
      card.classList.remove('is-busy');
      toast('Keine Verbindung. Bitte nochmals tippen.', true);
    }
  });

  // Zähler in den Reitern nachführen (Karten bleiben bis zum Neuladen am Platz)
  const startAnswer = new Map($$('.hc[data-person]').map((c) => [c.dataset.person, answerOf(c)]));
  function answerOf(c) { return c.classList.contains('hc-kann') ? 'kann' : c.classList.contains('hc-kann_nicht') ? 'kann_nicht' : 'offen'; }
  function updateCounts() {
    const tabs = Object.fromEntries($$('.h-tabs a').map((a) => [new URL(a.href).searchParams.get('zeige') || 'offen', a.querySelector('span')]));
    if (!tabs.offen || !radios.length || !$('.hc[data-person]')) return;
    const delta = { offen: 0, kann: 0, kann_nicht: 0 };
    for (const c of $$('.hc[data-person]')) {
      const before = startAnswer.get(c.dataset.person);
      const now = answerOf(c);
      if (before && before !== now) { delta[before] -= 1; delta[now] += 1; }
    }
    for (const k of Object.keys(delta)) {
      const el = tabs[k];
      if (!el) continue;
      if (!el.dataset.base) el.dataset.base = el.textContent;
      el.textContent = String(Number(el.dataset.base) + delta[k]);
    }
  }

  // ---------- Als App speichern ----------
  const box = $('[data-install]');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (box && !standalone && store.get('h-install-zu') !== '1') {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) $('[data-install-text]', box).textContent = 'In Safari unten auf «Teilen» tippen, dann «Zum Home-Bildschirm».';
    box.hidden = false;
    $('[data-install-close]', box).addEventListener('click', () => { box.hidden = true; store.set('h-install-zu', '1'); });
  }
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    const b = box && $('[data-install-btn]', box);
    if (!b || box.hidden) return;
    $('[data-install-text]', box).textContent = 'Die App direkt auf den Startbildschirm legen.';
    b.hidden = false;
    b.onclick = async () => { installEvent.prompt(); await installEvent.userChoice; box.hidden = true; };
  });

  // Knöpfe «Rückgängig» und «Wiederholen» oben: eigene Aktionen spurlos zurücknehmen bzw. wiederherstellen, mit Rückfrage
  const undoForm = $('[data-h-step="undo"]');
  const redoForm = $('[data-h-step="redo"]');
  function setUndo(label) {
    if (!undoForm) return;
    undoForm.dataset.label = label;
    undoForm.hidden = false;
  }
  const STEP_TEXT = {
    undo: ['Die Änderung wird ganz entfernt, auch aus dem Verlauf.', 'Ja, rückgängig'],
    redo: ['Die rückgängig gemachte Änderung wird wiederhergestellt.', 'Ja, wiederholen'],
  };
  for (const form of [undoForm, redoForm]) {
    if (!form) continue;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const [text, ok] = STEP_TEXT[form.dataset.hStep];
      if (!(await ask(`${form.dataset.label}. ${text}`, { title: form.dataset.confirmTitle, ok }))) return;
      form.querySelector('input[name=back]').value = location.pathname + location.search;
      form.submit();
    });
  }

  // Reiter merken sich die letzte Seite für 5 Minuten (z. B. eine offene Person unter «Personen»).
  // Ein Tipp auf den Reiter, in dem man schon ist, führt zur Übersicht.
  const TAB_OF = { einsaetze: 'einsaetze', anfragen: 'einsaetze', anmeldungen: 'einsaetze', personen: 'personen' };
  const KEEP_MS = 5 * 60 * 1000;
  const pageTab = TAB_OF[document.body.dataset.hPage];
  let toRoot = false;
  const remember = () => { if (pageTab && !toRoot) store.set(`h-tab-${pageTab}`, JSON.stringify({ path: location.pathname + location.search, t: Date.now() })); };
  remember();
  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') remember(); });
  document.querySelectorAll('.h-nav a[data-h-tab]').forEach((a) => {
    const tab = a.dataset.hTab;
    if (!['einsaetze', 'personen'].includes(tab)) return;
    a.addEventListener('click', (e) => {
      if (pageTab === tab) { toRoot = true; store.set(`h-tab-${tab}`, ''); return; }
      let saved = null;
      try { saved = JSON.parse(store.get(`h-tab-${tab}`) || 'null'); } catch { saved = null; }
      if (saved && saved.path && Date.now() - saved.t < KEEP_MS && saved.path.startsWith('/handy')) {
        e.preventDefault();
        location.href = saved.path;
      }
    });
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
