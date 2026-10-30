// KKB-Einsatzplaner – Bedienung im Browser (ohne Framework, Ereignisse delegiert)
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- Formulare ----------
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.matches('[data-submit-on-change]')) {
      if (t.tagName === 'SELECT' && t.value === '' && t.closest('[data-bulk]')) return;
      if (t.closest('[data-bulk]') && !$$(`input[form="${t.form.id}"]:checked`).length) {
        alert('Bitte zuerst Einträge ankreuzen.');
        t.value = '';
        return;
      }
      t.form.requestSubmit();
      return;
    }
    const auto = t.closest('form[data-autosubmit]');
    if (auto && (t.tagName === 'SELECT' || ['checkbox', 'date', 'radio'].includes(t.type))) auto.requestSubmit();
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

  function updateSelected(form) {
    const n = $$(`input[type=checkbox][form="${form.id}"]:checked`).length;
    const el = form.querySelector('[data-selected-count]');
    if (el) el.textContent = `${n} ausgewählt`;
  }

  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    const msg = form.getAttribute('data-confirm');
    if (msg && !confirm(msg)) { ev.preventDefault(); return; }
    const reason = form.querySelector('[data-reason]') || (form.id && $(`[data-reason][form="${form.id}"]`));
    if (reason && !reason.value) {
      const r = prompt('Der Einsatz ist abgeschlossen. Begründung der Änderung:');
      if (!r) { ev.preventDefault(); return; }
      reason.value = r;
    }
    if (form.matches('[data-bulk]') && ev.submitter && ev.submitter.type === 'submit' && !$$(`input[form="${form.id}"]:checked`).length) {
      ev.preventDefault();
      alert('Bitte zuerst Einträge ankreuzen.');
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
    list.style.position = 'fixed';
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
  const closeMenus = () => $$('details.menu[open]').forEach((d) => d.removeAttribute('open'));
  window.addEventListener('resize', closeMenus);
  document.addEventListener('scroll', (ev) => {
    if (!ev.target.closest || !ev.target.closest('.menu-list')) closeMenus();
  }, true);

  document.addEventListener('focusin', (ev) => {
    if (ev.target.matches('[data-token-target]')) lastTokenTarget = ev.target;
    if (ev.target.matches('[data-select-on-focus]')) ev.target.select();
  });

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
    if (btn.dataset.channel) {
      const radio = form.querySelector(`input[name=channel][value="${btn.dataset.channel}"]`);
      if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    $$('details.menu[open]').forEach((d) => d.removeAttribute('open'));
    dlg.showModal();
    const first = dlg.querySelector('select, textarea, input[type=text]');
    if (first) first.focus();
  }

  // ---------- Live-Aktualisierung (WebSocket) ----------
  const topics = (document.body.dataset.liveTopics || '').split(',').filter(Boolean);
  const editKey = document.body.dataset.editKey || null;
  const indicator = () => $('#live-indicator');
  let ws = null;
  let retry = 1000;
  let dirty = false;

  document.addEventListener('input', (ev) => { if (ev.target.closest('#content form')) dirty = true; });

  function isBusy() {
    const active = document.activeElement;
    return dirty || $$('dialog[open]').length > 0 || $$('details.menu[open]').length > 0
      || (active && active.closest('#content') && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
  }

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
      // Meldungen nicht erneut anzeigen
      $$('.flash', next).forEach((f) => f.remove());
      cur.innerHTML = next.innerHTML;
      const nav = doc.querySelector('.nav');
      if (nav) $('.nav').innerHTML = nav.innerHTML;
      window.scrollTo(0, scroll);
      $$('[data-row-id]', cur).forEach((e) => { if (!before.has(e.dataset.rowId)) e.classList.add('flash-new'); });
      const ind = indicator(); if (ind && ws && ws.readyState === 1) ind.classList.remove('off');
    } catch { /* nächster Versuch beim nächsten Ereignis */ }
  }

  function showStaleHint() {
    if ($('#stale-hint')) return;
    const div = document.createElement('div');
    div.id = 'stale-hint';
    div.className = 'flash flash-info no-print';
    div.innerHTML = 'Es gibt neue Daten. <a class="link" href="">Neu laden</a>';
    $('#content').prepend(div);
  }

  connect();
})();
