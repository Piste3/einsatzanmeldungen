// Anmeldeformular: Komfort ohne Pflicht – funktioniert auch ohne JavaScript
(function () {
  'use strict';
  const form = document.querySelector('[data-member-form]');
  if (!form) return;
  form.addEventListener('change', (ev) => {
    const block = ev.target.closest('[data-event-block]');
    if (!block) return;
    // «Ich kann nicht» und Schichtauswahl schliessen sich aus
    if (ev.target.matches('[data-no-check]') && ev.target.checked) block.querySelectorAll('[data-shift-check]').forEach((c) => { c.checked = false; });
    if (ev.target.matches('[data-shift-check]') && ev.target.checked) { const no = block.querySelector('[data-no-check]'); if (no) no.checked = false; }
    const answered = block.querySelector('input[type=radio]:checked, input[type=checkbox]:checked');
    block.classList.toggle('answered', Boolean(answered));
  });
  form.addEventListener('click', (ev) => {
    if (!ev.target.matches('[data-reset-block]')) return;
    const block = ev.target.closest('[data-event-block]');
    block.querySelectorAll('input[type=radio], input[type=checkbox]').forEach((i) => { i.checked = false; });
    block.classList.remove('answered');
    ev.target.remove();
  });
  // Doppeltes Absenden verhindern (der Server erkennt es zusätzlich über die Absende-ID)
  form.addEventListener('submit', () => {
    const btn = form.querySelector('button[type=submit]');
    setTimeout(() => { btn.disabled = true; btn.textContent = 'Wird gesendet …'; }, 0);
  });
  // Höhe an ClubDesk-iFrame melden (falls die Seite darauf hört)
  const post = () => { try { parent.postMessage({ type: 'kkb-form-height', height: document.documentElement.scrollHeight }, '*'); } catch (e) { /* ignorieren */ } };
  window.addEventListener('load', post);
  new ResizeObserver(post).observe(document.body);
})();
