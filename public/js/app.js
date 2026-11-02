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
  // Soll pro Schicht und Funktion: Summe pro Schicht laufend nachführen
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.matches || !t.matches('[data-fn-col]')) return;
    const grid = t.closest('[data-fn-grid]');
    const col = t.getAttribute('data-fn-col');
    const sum = $$(`[data-fn-col="${col}"]`, grid).reduce((a, i) => a + (parseInt(i.value, 10) > 0 ? parseInt(i.value, 10) : 0), 0);
    const out = $(`[data-fn-total="${col}"]`, grid);
    if (out) out.textContent = sum || '–';
  });
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
      form.action = (t.dataset.addAction || '/anmeldungen/{id}/schichten').replace('{id}', encodeURIComponent(t.value));
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

  // Schichten verwalten: Soll-Summe pro Zeile mitrechnen; eine angefangene neue Zeile braucht einen Namen
  document.addEventListener('input', (ev) => {
    const row = ev.target.closest('[data-soll-row]');
    if (!row) return;
    const parts = $$('[data-soll-part]', row).map((i) => Number(i.value) || 0);
    const sum = $('[data-soll-sum]', row);
    if (sum) sum.textContent = parts.some(Boolean) ? parts.reduce((a, n) => a + n, 0) : (row.matches('[data-new-shift]') ? '' : '–');
    if (row.matches('[data-new-shift]')) {
      const name = $('input[name="name__neu"]', row);
      name.required = $$('input', row).some((i) => i !== name && i.type !== 'date' && i.value.trim());
    }
  });

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, a, [data-print]');
    if (!t) {
      if (ev.target.closest('.menu-list')) return; // Klick in ein offenes Menü (z. B. Farbwähler) lässt es offen
      $$('details.menu[open]').forEach((d) => d.removeAttribute('open'));
      return;
    }
    if (t.matches('[data-print]')) { ev.preventDefault(); window.print(); return; }
    // Essenseinschränkungen externer Abteilungen: Zeile hinzufügen / entfernen
    if (t.matches('[data-diet-add]')) {
      const field = t.closest('.field');
      const rows = $('[data-diet-rows]', field);
      rows.insertAdjacentHTML('beforeend', $('[data-diet-template]', field).innerHTML);
      $$('[data-diet-row]', rows).pop().querySelector('input').focus();
      return;
    }
    if (t.matches('[data-diet-remove]')) {
      const row = t.closest('[data-diet-row]');
      const rows = row.parentElement;
      if ($$('[data-diet-row]', rows).length > 1) row.remove();
      else { $$('input', row).forEach((i) => { i.value = ''; }); $('select', row).value = ''; }
      return;
    }
    // Schichten verwalten: «+ Hinzufügen» braucht einen Namen in der neuen Zeile
    if (t.matches('[data-add-shift]')) {
      const name = $('input[name="name__neu"]', t.closest('tr'));
      if (name) name.required = true;
      return;
    }
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
    // Editor-Menüs öffnen sich links bündig unter dem Knopf, alle anderen rechts bündig
    const x = d.classList.contains('rte-menu') ? r.left : r.right - w;
    list.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
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

  function initRte(box) {
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
    document.addEventListener('selectionchange', () => {
      const s = sel();
      if (s.rangeCount && inArea(s.anchorNode)) { saved = s.getRangeAt(0).cloneRange(); updateState(); }
    });
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
  $$('[data-rte]').forEach(initRte);

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
  // Kommt die Seite beim Zurückgehen aus dem Zwischenspeicher des Browsers (z. B. Safari), neu laden
  window.addEventListener('pageshow', (ev) => {
    if (!ev.persisted) return;
    if (document.querySelector('.app')) location.reload();
    else restoreScroll();
  });

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
    if (table.classList.contains('matrix') || table.closest('.prose, dialog, .rte-area, .rich') || table.dataset.cardsDone) return;
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
