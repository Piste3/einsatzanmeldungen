// KKB-Einsatzplaner – Bedienung im Browser (ohne Framework, Ereignisse delegiert)
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Eigene Rückfragen statt der Browser-Dialoge (confirm, alert, prompt) ----------
  // uiDialog liefert ein Promise: true/false, bei input den eingegebenen Text oder null
  function uiDialog({ title = 'Bitte bestätigen', message = '', input = false, placeholder = '', ok = 'OK', cancel = 'Abbrechen', danger = false }) {
    return new Promise((resolve) => {
      const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
      const d = el('dialog', 'ui-dialog');
      const head = el('div', 'card-head'); head.append(el('h2', '', title));
      const body = el('div', 'card-body');
      if (message) body.append(el('p', 'ui-msg', message));
      let field = null;
      if (input) { field = el('textarea', 'ui-input'); field.rows = 3; field.placeholder = placeholder; body.append(field); }
      const foot = el('div', 'card-foot');
      const okBtn = el('button', `btn ${danger ? 'btn-danger' : 'btn-primary'}`, ok); okBtn.type = 'button';
      const close = (v) => { d.close(); d.remove(); resolve(v); };
      const no = () => close(field ? null : false);
      if (cancel) { const c = el('button', 'btn btn-ghost', cancel); c.type = 'button'; c.addEventListener('click', no); foot.append(c); }
      foot.append(okBtn);
      okBtn.addEventListener('click', () => {
        if (!field) return close(true);
        if (!field.value.trim()) { field.classList.add('invalid'); field.focus(); return; }
        close(field.value.trim());
      });
      if (field) field.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); okBtn.click(); } });
      d.addEventListener('cancel', (e) => { e.preventDefault(); if (cancel) no(); else close(true); });
      d.append(head, body, foot);
      document.body.append(d);
      d.showModal();
      (field || okBtn).focus();
    });
  }
  const uiAlert = (message, title = 'Hinweis') => uiDialog({ title, message, cancel: false });
  // Text aus data-confirm: erster Absatz = Frage (Titel), Rest = Erklärung
  function uiConfirm(text, opts = {}) {
    const [first, ...rest] = String(text).split(/\n\s*\n/);
    const danger = /lösch|entfern|zurücksetzen|zurücknehmen|verwerfen|absagen/i.test(text);
    return uiDialog({ title: rest.length ? first : 'Bitte bestätigen', message: rest.length ? rest.join('\n\n') : first, ok: danger ? 'Ja, ausführen' : 'Ja', danger, ...opts });
  }

  // ---------- Formulare ----------
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('[data-submit-on-change]')) {
      if (t.tagName === 'SELECT' && t.value === '' && t.closest('[data-bulk]')) return;
      if (t.closest('[data-bulk]') && !$$(`input[form="${t.form.id}"]:checked`).length) {
        uiAlert('Bitte zuerst Einträge ankreuzen.');
        t.value = '';
        return;
      }
      t.form.requestSubmit();
      return;
    }
    const auto = t.closest('form[data-autosubmit]') || (t.form && t.form.matches('[data-autosubmit]') ? t.form : null);
    if (auto && (t.tagName === 'SELECT' || ['checkbox', 'date', 'radio'].includes(t.type))) liveFilter(auto, 0);
    if (t.matches('[data-select-all]')) {
      const name = t.getAttribute('data-select-all');
      const form = t.form;
      $$(`input[type=checkbox][name="${name}"][form="${form.id}"]`).forEach((c) => { c.checked = t.checked; });
      updateSelected(form);
    }
    if (t.matches('input[type=checkbox][form]')) {
      const form = document.getElementById(t.getAttribute('form'));
      if (form && form.matches('[data-bulk]')) updateSelected(form);
    }
    if (t.matches('[data-question-template]')) {
      const opt = t.selectedOptions[0];
      if (opt && opt.dataset.question !== undefined) {
        const q = $('#question_text');
        const hlp = $('#help_text');
        if (q) q.value = opt.dataset.question || '';
        if (hlp) hlp.value = opt.dataset.help || '';
      }
    }
    if (t.matches('[data-alias-toggle]')) {
      $$('[data-alias-mirror]').forEach((i) => { i.value = t.checked ? '1' : '0'; });
    }
    if (t.matches('[data-add-select]') && t.value) {
      const form = t.closest('form');
      form.action = `/anmeldungen/${t.value}/schichten`;
      saveScroll();
      form.submit();
    }
    if (t.matches('[data-preview-event]')) {
      const form = t.form;
      const flag = document.createElement('input');
      flag.type = 'hidden'; flag.name = 'preview'; flag.value = '1';
      form.appendChild(flag);
      form.submit();
    }
    if (t.matches('input[name=channel]')) {
      const res = t.form.querySelector('select[name=result]');
      if (res && ['nicht_erreicht', 'whatsapp'].includes(res.value)) res.value = t.value === 'whatsapp' ? 'whatsapp' : 'nicht_erreicht';
    }
  });

  // ---------- Suchen und Filtern ohne Enter ----------
  // Suchfelder und Filter in GET-Formularen laden die Liste beim Tippen nach, ohne die Seite neu zu laden.
  const isFilterForm = (form) => form && form.closest('#content') && !form.closest('.topbar') && (form.getAttribute('method') || 'get').toLowerCase() === 'get';
  let filterTimer = null;
  let filterSeq = 0;
  function liveFilter(form, delay) {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => loadFiltered(form), delay);
  }
  async function loadFiltered(form) {
    const url = new URL(form.getAttribute('action') || location.pathname, location.href);
    url.search = new URLSearchParams(new FormData(form)).toString();
    const seq = ++filterSeq;
    try {
      const res = await fetch(url, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin' });
      if (seq !== filterSeq) return;
      if (!res.ok || res.redirected || new URL(res.url).pathname !== location.pathname) { location.href = url; return; }
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const next = doc.getElementById('content');
      const cur = document.getElementById('content');
      if (!next || !cur) { location.href = url; return; }
      // Fokus und Eingabe im Suchfeld erhalten (es kann während des Ladens weitergetippt worden sein)
      const active = document.activeElement;
      const keep = active && active.name && cur.contains(active) ? { name: active.name, value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
      $$('.flash', next).forEach((f) => f.remove());
      const boxLeft = $$('.table-wrap, .fb-wrap', cur).map((b) => b.scrollLeft);
      cur.innerHTML = next.innerHTML;
      $$('.table-wrap, .fb-wrap', cur).forEach((b, i) => { if (boxLeft[i]) b.scrollLeft = boxLeft[i]; });
      history.replaceState(null, '', url.pathname + url.search);
      if (keep) {
        const el = $$('[name]', cur).find((e) => e.name === keep.name && e.closest('form') && isFilterForm(e.closest('form')));
        if (el) {
          if ('value' in el && el.type !== 'checkbox' && el.tagName !== 'SELECT') el.value = keep.value;
          el.focus();
          try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch { /* nicht jedes Feld kann das */ }
        }
      }
    } catch { location.href = url; }
  }
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.tagName !== 'INPUT' || !['search', 'text'].includes(t.type)) return;
    if (isFilterForm(t.form)) liveFilter(t.form, 300);
  });
  document.addEventListener('submit', (ev) => {
    if (isFilterForm(ev.target) && !ev.defaultPrevented) { ev.preventDefault(); liveFilter(ev.target, 0); }
  });

  function updateSelected(form) {
    const n = $$(`input[type=checkbox][form="${form.id}"]:checked`).length;
    const el = form.querySelector('[data-selected-count]');
    if (el) el.textContent = `${n} ausgewählt`;
  }

  // Rückfragen vor dem Absenden. Das Absenden wird angehalten, die Fragen nacheinander gestellt
  // und danach mit demselben Knopf erneut ausgelöst.
  function submitChecks(form) {
    const checks = [];
    const msg = form.getAttribute('data-confirm');
    if (msg) checks.push(() => uiConfirm(msg));
    const reason = form.querySelector('[data-reason]') || (form.id && $(`[data-reason][form="${form.id}"]`));
    if (reason && !reason.value) {
      checks.push(async () => {
        const r = await uiDialog({ title: 'Einsatz ist abgeschlossen', message: 'Bitte die Änderung kurz begründen. Die Begründung erscheint im Verlauf.', input: true, placeholder: 'Begründung', ok: 'Weiter' });
        if (r) reason.value = r;
        return Boolean(r);
      });
    }
    if ((form.getAttribute('method') || 'get').toLowerCase() === 'post') {
      const others = guardedForms().filter((f) => f !== form && formDirty(f));
      if (others.length) {
        const names = others.map((f) => (f.querySelector('.card-head h2, h2') || {}).firstChild?.textContent?.trim()).filter(Boolean);
        checks.push(() => uiDialog({
          title: 'Ungespeicherte Änderungen',
          message: `In ${names.length ? `«${names.join('», «')}»` : 'einem anderen Abschnitt'} gibt es ungespeicherte Änderungen. Sie gehen verloren, wenn du jetzt nur diesen Teil speicherst.`,
          ok: 'Trotzdem speichern', danger: true,
        }));
      }
    }
    return checks;
  }
  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    if (form.matches('[data-bulk]') && ev.submitter && ev.submitter.type === 'submit' && !$$(`input[form="${form.id}"]:checked`).length) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      uiAlert('Bitte zuerst Einträge ankreuzen.');
      return;
    }
    if (form.dataset.confirmed) delete form.dataset.confirmed;
    else {
      const checks = submitChecks(form);
      if (checks.length) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        const submitter = ev.submitter && ev.submitter.form === form ? ev.submitter : undefined;
        (async () => {
          for (const check of checks) if (!(await check())) return;
          form.dataset.confirmed = '1';
          form.requestSubmit(submitter);
        })();
        return;
      }
    }
    // Doppelklick verhindern
    if (!ev.defaultPrevented) setTimeout(() => $$('button[type=submit]', form).forEach((b) => { b.disabled = true; }), 0);
  }, true);

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, a, [data-print]');
    if (!t) {
      $$('details.menu[open]').forEach((d) => d.removeAttribute('open'));
      return;
    }
    if (t.matches('[data-print]')) { ev.preventDefault(); window.print(); return; }
    if (t.matches('[data-fill]')) {
      const target = document.getElementById(t.dataset.fill);
      if (target) { target.value = t.dataset.text; target.focus(); }
      return;
    }
    if (t.matches('[data-token]')) { insertToken(t.dataset.token); return; }
    if (t.matches('[data-open-dialog]')) { openDialog(t); return; }
    if (t.matches('[data-close-dialog]')) { t.closest('dialog').close(); return; }
    // offene Menüs schliessen, wenn woanders geklickt wird
    $$('details.menu[open]').forEach((d) => { if (!d.contains(t)) d.removeAttribute('open'); });
  });

  // Menüs als Overlay platzieren, damit Tabellen mit Scrollbereich sie nicht abschneiden.
  // Reicht der Platz unten nicht, öffnet sich das Menü nach oben.
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
    list.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  }
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (d.matches && d.matches('details.menu') && d.open) placeMenu(d);
  }, true);
  // Beim Scrollen oder Ändern der Fenstergrösse mitwandern statt zu schliessen
  const replaceMenus = () => $$('details.menu[open]').forEach(placeMenu);
  window.addEventListener('resize', replaceMenus);
  document.addEventListener('scroll', (ev) => {
    if (!(ev.target.closest && ev.target.closest('.menu-list'))) replaceMenus();
  }, true);

  document.addEventListener('focusin', (ev) => {
    if (ev.target.matches('[data-token-target]')) lastTokenTarget = ev.target;
    if (ev.target.matches('[data-select-on-focus]')) ev.target.select();
  });

  // ---------- Update / Neustart (Verwaltung › System) ----------
  const updateLog = $('[data-update-log]');
  if (updateLog && updateLog.dataset.running === '1') {
    let sawDown = false;
    const stateEl = $('#update-state');
    const poll = async () => {
      try {
        const res = await fetch('/verwaltung/system/status', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok || res.redirected || !(res.headers.get('content-type') || '').includes('json')) throw new Error('nicht bereit');
        const st = await res.json();
        if (st.lines.length) updateLog.textContent = st.lines.join('\n');
        updateLog.scrollTop = updateLog.scrollHeight;
        if (stateEl) stateEl.textContent = st.running ? `läuft: ${st.step || ''}` : st.restarting ? 'Neustart …' : '';
        if (!st.running && !st.restarting) { location.replace('/verwaltung/system'); return; }
      } catch {
        sawDown = true;
        if (stateEl) stateEl.textContent = 'Server startet neu …';
      }
      setTimeout(poll, sawDown ? 2000 : 1200);
    };
    setTimeout(poll, 800);
  }

  // ---------- Bausteine einfügen ----------
  let lastTokenTarget = null;
  function insertToken(token) {
    const el = lastTokenTarget || $('[data-token-target]');
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + token.length;
  }

  // ---------- Dialoge ----------
  // Kontaktversuch-Fenster: alles für diese Person bei diesem Einsatz zurücksetzen
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-reset-person]');
    if (!b) return;
    // im Kontaktversuch-Fenster oder direkt aus einer Tabellenzeile (data-person, data-event)
    const dlg = b.closest('dialog') || document.getElementById('attempt');
    const form = dlg.querySelector('form');
    const inDialog = Boolean(b.closest('dialog'));
    const val = (n) => {
      if (!inDialog && n === 'person_id') return b.dataset.person;
      if (!inDialog && n === 'event_id') return b.dataset.event || dlg.dataset.event || '';
      return (form.querySelector(`[name="${n}"]`) || {}).value || '';
    };
    const who = (inDialog ? (dlg.querySelector('[data-who]') || {}).textContent : b.dataset.who) || 'diese Person';
    const ok = await uiDialog({
      title: 'Alles zurücksetzen?',
      message: `${who}\n\nAlle Kontaktversuche, die Rückmeldung bzw. Anmeldung und die Schichtzuteilung für diesen Einsatz werden gelöscht. Die Person gilt danach wieder als offen. Ein Formular-Eingang bleibt unter «Formulare» gespeichert.`,
      ok: 'Zurücksetzen', danger: true,
    });
    if (!ok) return;
    const f = document.createElement('form');
    f.method = 'post'; f.action = '/anfragen/zuruecksetzen';
    for (const [n, v] of [['_csrf', val('_csrf')], ['person_id', val('person_id')], ['event_id', val('event_id') || dlg.dataset.event || ''], ['back', val('back')]]) {
      const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.append(i);
    }
    document.body.append(f);
    if (dlg.open) dlg.close();
    f.submit();
  });
  function toggleShiftField(dlg) {
    const field = dlg.querySelector('[data-shift-field]');
    const result = dlg.querySelector('select[name=result]');
    if (field) field.hidden = !(dlg.dataset.hasShifts && result && result.value === 'zugesagt');
  }
  document.addEventListener('change', (ev) => { if (ev.target.matches('dialog select[name=result]')) toggleShiftField(ev.target.closest('dialog')); });
  function openDialog(btn) {
    const dlg = document.getElementById(btn.dataset.openDialog);
    if (!dlg) return;
    const form = dlg.querySelector('form');
    if (btn.dataset.action) form.action = btn.dataset.action;
    const set = (name, value) => { const i = form.querySelector(`[name="${name}"]`); if (i && value !== undefined) i.value = value; };
    set('version', btn.dataset.version);
    set('internal_note', btn.dataset.note);
    set('person_id', btn.dataset.person);
    set('event_id', btn.dataset.event);
    const who = dlg.querySelector('[data-who]');
    if (who) who.textContent = btn.dataset.who || '';
    // Für mehrere Ausgewählte auf einmal erfassen
    $$('input[data-bulk-id]', form).forEach((i) => i.remove());
    if (btn.dataset.bulkDialog) {
      const ids = $$(`input[type=checkbox][form="${btn.dataset.bulkDialog}"]:checked`).map((c) => c.value).filter((v) => v && v !== 'on');
      if (!ids.length) { uiAlert('Bitte zuerst Personen ankreuzen.'); return; }
      set('person_id', '');
      for (const id of ids) {
        const i = document.createElement('input');
        i.type = 'hidden'; i.name = 'person_ids'; i.value = id; i.dataset.bulkId = '1';
        form.appendChild(i);
      }
      if (who) who.textContent = `${ids.length} Person${ids.length === 1 ? '' : 'en'}`;
    }
    // Datum und Uhrzeit auf jetzt setzen (die Seite kann schon länger offen sein)
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const d = form.querySelector('input[name=date]');
    const tm = form.querySelector('input[name=time]');
    if (d && tm) { d.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; tm.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`; }
    const note = form.querySelector('input[name=note]');
    if (note && form.matches('[data-attempt-form]')) note.value = '';
    if (btn.dataset.channel) {
      const radio = form.querySelector(`input[name=channel][value="${btn.dataset.channel}"]`);
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    // Schichtauswahl für Zusagen (nur bei Einsätzen mit mehreren Schichten)
    const shiftBox = dlg.querySelector('[data-shift-options]');
    if (shiftBox) {
      let map = {};
      try { map = JSON.parse(dlg.dataset.shifts || '{}'); } catch { /* keine */ }
      const list = map[btn.dataset.event || dlg.dataset.event] || [];
      shiftBox.textContent = '';
      for (const sh of list) {
        const l = document.createElement('label'); l.className = 'check';
        const c = document.createElement('input'); c.type = 'checkbox'; c.name = 'shift_ids'; c.value = sh.id; c.checked = String(sh.id) === btn.dataset.shift;
        l.append(c, ` ${sh.name}${sh.time ? ` (${sh.time})` : ''}`);
        shiftBox.append(l);
      }
      dlg.dataset.hasShifts = list.length ? '1' : '';
      toggleShiftField(dlg);
    }
    const cur = dlg.querySelector('[data-current-box]');
    if (cur) {
      cur.hidden = !btn.dataset.current;
      cur.querySelector('[data-current-text]').textContent = btn.dataset.current || '';
      const link = cur.querySelector('[data-current-link]');
      link.hidden = !btn.dataset.currentLink;
      if (btn.dataset.currentLink) link.href = btn.dataset.currentLink;
    }
    const resetBtn = dlg.querySelector('[data-reset-person]');
    if (resetBtn) resetBtn.hidden = Boolean(btn.dataset.bulkDialog);
    $$('details.menu[open]').forEach((d) => d.removeAttribute('open'));
    dlg.showModal();
    const first = dlg.querySelector('select[name=result]') || $$('select, textarea, input[type=text]', dlg).find((el) => !el.hidden && !el.disabled);
    if (first) first.focus();
  }

  // ---------- Live-Aktualisierung (WebSocket) ----------
  const topics = (document.body.dataset.liveTopics || '').split(',').filter(Boolean);
  const editKey = document.body.dataset.editKey || null;
  const indicator = () => $('#live-indicator');
  let ws = null;
  let retry = 1000;
  // Ungespeicherte Eingaben in Formularen (Text geändert, Häkchen gesetzt, Auswahl geändert)
  function hasUnsavedInput() {
    return $$('#content form[method=post] input, #content form[method=post] textarea, #content form[method=post] select, #content input[form], #content select[form]').some((el) => {
      if (el.type === 'hidden' || el.disabled) return false;
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
      if (el.tagName === 'SELECT') {
        if (el.multiple) return [...el.options].some((o) => o.selected !== o.defaultSelected);
        const def = [...el.options].findIndex((o) => o.defaultSelected);
        return el.selectedIndex !== (def === -1 ? 0 : def);
      }
      return el.value !== el.defaultValue;
    });
  }

  function isBusy() {
    const active = document.activeElement;
    return hasUnsavedInput() || $$('dialog[open]').length > 0 || $$('details.menu[open]').length > 0
      || (active && active.closest('#content') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
  }

  // Wurde eine Aktualisierung wegen laufender Eingabe aufgeschoben, sobald möglich nachholen
  let deferred = false;
  setInterval(() => {
    if (deferred && !isBusy()) { deferred = false; refresh(); }
  }, 1500);

  function connect() {
    if (!topics.length && !editKey) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/live`);
    ws.addEventListener('open', () => {
      retry = 1000;
      const ind = indicator(); if (ind) ind.classList.remove('off');
      ws.send(JSON.stringify({ type: 'subscribe', topics: [...topics, editKey ? `presence:${editKey}` : null].filter(Boolean) }));
      if (editKey) ws.send(JSON.stringify({ type: 'editing', key: editKey }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'changed' && msg.topics.length) scheduleRefresh();
      else if (msg.type === 'changed' && msg.nav) refreshNav();
      if (msg.type === 'presence') showPresence(msg.editors);
    });
    ws.addEventListener('close', () => {
      const ind = indicator(); if (ind) ind.classList.add('off');
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    });
  }

  function showPresence(editors) {
    const bar = $('#presence');
    if (!bar) return;
    if (editors && editors.length) {
      $('#presence-text').textContent = `Wird gerade von ${editors.join(', ')} bearbeitet.`;
      bar.classList.add('show');
    } else bar.classList.remove('show');
  }

  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
  }

  // Nur die Zähler in der Navigation auffrischen
  async function refreshNav() {
    try {
      const res = await fetch(location.href, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin' });
      if (!res.ok || res.redirected) return;
      const nav = new DOMParser().parseFromString(await res.text(), 'text/html').querySelector('.nav');
      if (nav && $('.nav')) $('.nav').innerHTML = nav.innerHTML;
    } catch { /* egal */ }
  }

  async function refresh() {
    if (editKey) return; // Bearbeitungsseiten nicht austauschen
    if (isBusy()) { showStaleHint(); return; }
    try {
      const res = await fetch(location.href, { headers: { 'X-Live-Refresh': '1' }, credentials: 'same-origin' });
      if (!res.ok || res.redirected) return;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const next = doc.getElementById('content');
      const cur = document.getElementById('content');
      if (!next || !cur || isBusy()) { showStaleHint(); return; }
      const before = new Set($$('[data-row-id]', cur).map((e) => e.dataset.rowId));
      const scroll = window.scrollY;
      const boxPos = $$('.table-wrap, .fb-wrap', cur).map((b) => [b.scrollTop, b.scrollLeft]);
      // Meldungen nicht erneut anzeigen
      $$('.flash', next).forEach((f) => f.remove());
      deferred = false;
      cur.innerHTML = next.innerHTML;
      $$('.table-wrap, .fb-wrap', cur).forEach((b, i) => { if (boxPos[i]) { b.scrollTop = boxPos[i][0]; b.scrollLeft = boxPos[i][1]; } });
      const nav = doc.querySelector('.nav');
      if (nav) $('.nav').innerHTML = nav.innerHTML;
      window.scrollTo(0, scroll);
      $$('[data-row-id]', cur).forEach((e) => { if (!before.has(e.dataset.rowId)) e.classList.add('flash-new'); });
      const ind = indicator(); if (ind && ws && ws.readyState === 1) ind.classList.remove('off');
    } catch { /* nächster Versuch beim nächsten Ereignis */ }
  }

  function showStaleHint() {
    deferred = true;
    if ($('#stale-hint')) return;
    const div = document.createElement('div');
    div.id = 'stale-hint';
    div.className = 'flash flash-info no-print';
    div.innerHTML = 'Es gibt neue Daten. <a class="link" href="">Neu laden</a>';
    $('#content').prepend(div);
  }

  connect();

  // ---------- Scrollposition erhalten ----------
  // Nach dem Absenden eines Formulars kommt man meist auf dieselbe Seite zurück: dann an die alte Stelle scrollen,
  // auch in Tabellen mit eigenem Scrollbereich.
  const SCROLL_KEY = 'kkb:scroll';
  const scrollBoxes = () => $$('.table-wrap, .fb-wrap');
  function saveScroll() {
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({
        path: location.pathname, at: Date.now(), y: window.scrollY,
        boxes: scrollBoxes().map((b) => [b.scrollTop, b.scrollLeft]),
      }));
    } catch { /* ohne Speicher eben nicht */ }
  }
  function restoreScroll() {
    let st = null;
    try { st = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || 'null'); sessionStorage.removeItem(SCROLL_KEY); } catch { return; }
    if (!st || st.path !== location.pathname || Date.now() - st.at > 30000) return;
    const apply = () => {
      const boxes = scrollBoxes();
      (st.boxes || []).forEach(([top, left], i) => { if (boxes[i]) { boxes[i].scrollTop = top; boxes[i].scrollLeft = left; } });
      window.scrollTo(0, st.y);
    };
    apply();
    // nach dem Laden von Schriften und Bildern stimmt die Höhe erst ganz
    if (document.readyState !== 'complete') window.addEventListener('load', apply, { once: true });
    requestAnimationFrame(apply);
  }
  document.addEventListener('submit', (ev) => {
    if (!ev.defaultPrevented && (ev.target.getAttribute('method') || 'get').toLowerCase() === 'post') saveScroll();
  });
  restoreScroll();
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) restoreScroll(); });

  // ---------- Ungespeicherte Änderungen schützen ----------
  // Ein Feld gilt als geändert, wenn es vom Stand beim Laden abweicht.
  function fieldChanged(el) {
    if (el.type === 'hidden' || el.disabled || !el.name || el.closest('dialog')) return false;
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
    if (el.tagName === 'SELECT') {
      if (el.multiple) return [...el.options].some((o) => o.selected !== o.defaultSelected);
      const def = [...el.options].findIndex((o) => o.defaultSelected);
      return el.selectedIndex !== (def === -1 ? 0 : def);
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return el.value !== el.defaultValue;
    return false;
  }
  const guardedForms = () => $$('#content form').filter((f) => (f.getAttribute('method') || 'get').toLowerCase() === 'post'
    && !f.closest('dialog') && !f.matches('[data-bulk], [data-autosubmit]'));
  const formDirty = (f) => [...f.elements].some(fieldChanged);

  // Abschnitte (Auswahllisten, Vorlagen …): geänderte Zeilen und den Abschnitt markieren
  function markSection(form) {
    const dirty = formDirty(form);
    form.classList.toggle('dirty', dirty);
    const hint = form.querySelector('[data-dirty-hint]');
    if (hint) {
      if (!hint.dataset.text) hint.dataset.text = hint.textContent;
      hint.textContent = dirty ? 'Ungespeicherte Änderungen in diesem Abschnitt' : hint.dataset.text;
    }
    $$('tr', form).forEach((tr) => {
      tr.classList.toggle('changed', $$('input, select, textarea', tr).some(fieldChanged));
      const d = tr.querySelector('[data-delete-row]');
      tr.classList.toggle('to-delete', !!(d && d.checked));
    });
  }
  ['input', 'change'].forEach((type) => document.addEventListener(type, (ev) => {
    const f = ev.target.form || ev.target.closest('form');
    if (f && f.matches('[data-section]')) markSection(f);
  }));

  // Beim Speichern eines Abschnitts warnen, wenn andere Abschnitte ungespeicherte Änderungen haben
  let submitting = false;
  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    if (ev.defaultPrevented || (form.getAttribute('method') || 'get').toLowerCase() !== 'post') return;
    submitting = true;
    setTimeout(() => { submitting = false; }, 3000);
  }, true);
  // Link in der App bei ungespeicherten Änderungen: eigene Rückfrage. Beim Schliessen des Tabs oder
  // Neuladen kann nur der Browser selbst fragen (beforeunload).
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
    if (!guardedForms().some(formDirty)) return;
    ev.preventDefault();
    document.body.classList.remove('nav-open');
    uiDialog({ title: 'Ungespeicherte Änderungen', message: 'Auf dieser Seite gibt es Änderungen, die noch nicht gespeichert sind. Wenn du die Seite verlässt, gehen sie verloren.', ok: 'Verwerfen und weiter', cancel: 'Bleiben', danger: true })
      .then((go) => { if (go) { submitting = true; location.href = a.href; } });
  });
  window.addEventListener('beforeunload', (ev) => {
    if (submitting) return;
    if (guardedForms().some(formDirty)) { ev.preventDefault(); ev.returnValue = ''; }
  });

  // ---------- Durchsuchbare Auswahlfelder ----------
  // <select data-search> wird zu einem Eingabefeld mit Vorschlagsliste: tippen filtert die Einträge
  // (Gross/klein, Umlaute und Reihenfolge der Wörter egal). Das echte <select> bleibt im Formular und wird gesetzt.
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
  function enhanceSelect(sel) {
    if (sel.dataset.enhanced) return;
    sel.dataset.enhanced = '1';
    const wrap = document.createElement('div');
    wrap.className = 'combo';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'combo-input';
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    if (sel.id) { input.id = sel.id; sel.removeAttribute('id'); }
    if (sel.getAttribute('aria-label')) input.setAttribute('aria-label', sel.getAttribute('aria-label'));
    if (sel.required) { input.required = true; sel.required = false; }
    if (sel.style.width) wrap.style.width = sel.style.width;
    const placeholderOpt = [...sel.options].find((o) => o.value === '');
    input.placeholder = placeholderOpt && placeholderOpt.text.trim() !== '–' ? placeholderOpt.text : 'Tippen zum Suchen …';
    const list = document.createElement('div');
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(input, list, sel);
    sel.hidden = true;
    sel.tabIndex = -1;
    const label = () => (sel.value ? sel.selectedOptions[0].text.trim() : '');
    input.value = label();
    input.defaultValue = input.value;
    let items = [];
    let active = -1;
    function render() {
      const words = fold(input.value === label() ? '' : input.value).split(/\s+/).filter(Boolean);
      // Leeren Eintrag nur anbieten, wenn das Feld geleert werden darf (Platzhalter «–»)
      items = [...sel.options].filter((o) => !o.disabled && (o.value !== '' || (!input.required && o.text.trim() === '–')))
        .filter((o) => { const t = fold(o.text); return words.every((w) => t.includes(w)); }).slice(0, 200);
      list.innerHTML = '';
      if (!items.length) { list.innerHTML = '<div class="combo-empty">Keine Treffer</div>'; }
      items.forEach((o, i) => {
        const div = document.createElement('div');
        div.className = `combo-opt${o.value === sel.value ? ' selected' : ''}${i === active ? ' active' : ''}`;
        div.textContent = o.value === '' ? '– keine Auswahl –' : o.text.trim();
        div.setAttribute('role', 'option');
        div.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(o); });
        list.appendChild(div);
      });
      const act = list.children[active];
      if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
    }
    function open() { wrap.classList.add('open'); active = -1; render(); }
    function close() { wrap.classList.remove('open'); }
    function choose(o) {
      const changed = sel.value !== o.value;
      sel.value = o.value;
      input.value = label();
      close();
      if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('click', open);
    input.addEventListener('input', () => { wrap.classList.add('open'); active = 0; render(); });
    input.addEventListener('blur', () => { close(); if (input.value.trim() === '' && !input.required) { if (sel.value !== '' && placeholderOpt) choose(placeholderOpt); } input.value = label(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!wrap.classList.contains('open')) open();
        active = Math.max(0, Math.min(items.length - 1, active + (ev.key === 'ArrowDown' ? 1 : -1)));
        render();
      } else if (ev.key === 'Enter') {
        if (wrap.classList.contains('open') && items.length) { ev.preventDefault(); choose(items[Math.max(0, active)]); }
      } else if (ev.key === 'Escape') {
        if (wrap.classList.contains('open')) { ev.preventDefault(); ev.stopPropagation(); close(); input.value = label(); }
      }
    });
    // Wird das <select> von aussen gesetzt (z. B. Dialog vorbelegt), Anzeige nachziehen
    sel.addEventListener('change', () => { if (document.activeElement !== input) input.value = label(); });
    new MutationObserver(() => { if (document.activeElement !== input) input.value = label(); }).observe(sel, { attributes: true, childList: true, subtree: true });
  }
  // Handy: Navigation ein-/ausklappen
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-nav-toggle]');
    if (!t) return;
    const open = document.body.classList.toggle('nav-open');
    $$('button[data-nav-toggle]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.body.classList.remove('nav-open'); });

  // Handy: Tabellen als Karten. Jede Zelle bekommt den Spaltentitel als Beschriftung; die erste Inhaltsspalte ist der Titel der Karte.
  function cardTable(table) {
    if (table.classList.contains('matrix') || table.closest('.prose, dialog') || table.dataset.cardsDone) return;
    const heads = $$('thead th', table);
    if (!heads.length) return;
    const labels = heads.map((th) => th.textContent.trim());
    const main = heads.findIndex((th) => !th.classList.contains('check-col') && th.textContent.trim());
    table.dataset.cardsDone = '1';
    table.classList.add('cards');
    labelRows(table, labels, main);
  }
  function labelRows(table, labels, main) {
    for (const tr of $$('tbody tr, tfoot tr', table)) {
      let col = 0;
      for (const td of tr.children) {
        if (!td.hasAttribute('data-label')) {
          td.setAttribute('data-label', td.colSpan > 1 ? '' : labels[col] || '');
          if (col === main && td.colSpan === 1) td.classList.add('cell-main');
        }
        col += td.colSpan || 1;
      }
    }
  }
  const cardAll = (root = document) => (root.matches && root.matches('table') ? [root] : $$('table', root)).forEach((t) => {
    if (t.dataset.cardsDone) { // neu geladene Zeilen nachtragen
      const heads = $$('thead th', t);
      labelRows(t, heads.map((th) => th.textContent.trim()), heads.findIndex((th) => !th.classList.contains('check-col') && th.textContent.trim()));
    } else cardTable(t);
  });

  const enhanceAll = (root = document) => { $$('select[data-search]', root).forEach(enhanceSelect); cardAll(root.closest ? (root.closest('table') || root) : root); };
  enhanceAll();
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches('select[data-search]')) enhanceSelect(n); else enhanceAll(n); }
  }).observe(document.body, { childList: true, subtree: true });
})();
