<script setup>
import { ref, reactive, onMounted } from 'vue';
import EventBlock from './EventBlock.vue';

// Gleiche Felder wie das bisherige Formular, damit der Server sie unverändert prüft
const state = ref('loading'); // loading | form | thanks | error
const data = ref(null);
const errors = ref([]);
const first = ref('');
const last = ref('');
const website = ref(''); // Falle für Bots, bleibt leer
const answers = reactive({});
const thanks = ref(null);
const message = ref('');
const sending = ref(false);

const params = new URLSearchParams(location.search);
const preview = !!params.get('vorschau');

function applyValues(values = {}) {
  first.value = values.first_name || first.value;
  last.value = values.last_name || last.value;
  for (const e of data.value.form.events) {
    answers[e.id] = answers[e.id] || {
      yes: values[`answer_${e.id}`] === 'ja',
      shifts: [].concat(values[`shifts_${e.id}`] || []).map(Number),
      remark: values[`remark_${e.id}`] || '',
    };
  }
}

async function load() {
  const qs = new URLSearchParams();
  if (preview) qs.set('vorschau', '1');
  if (params.get('einsatz')) qs.set('einsatz', params.get('einsatz'));
  const res = await fetch(`/api/v1/forms/anmeldung${qs.size ? `?${qs}` : ''}`, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (json.redirect) { location.href = json.redirect; return; }
  data.value = { ...json.data, title: json.title };
  document.title = `${json.title} · ${json.data.verein}`;
  applyValues(json.data.values);
  state.value = 'form';
}

async function submit() {
  if (preview || sending.value) return;
  sending.value = true;
  const body = { submission_uid: data.value.form.uid, website: website.value, first_name: first.value, last_name: last.value, event_ids: [] };
  for (const e of data.value.form.events) {
    const a = answers[e.id];
    body.event_ids.push(String(e.id));
    if (a.yes) body[`answer_${e.id}`] = 'ja';
    if (a.shifts.length) body[`shifts_${e.id}`] = a.shifts.map(String);
    if (a.remark) body[`remark_${e.id}`] = a.remark;
  }
  try {
    const res = await fetch('/api/v1/forms/anmeldung', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!json) throw new Error('Keine Antwort');
    if (json.view === 'form/danke') { thanks.value = json.data; state.value = 'thanks'; window.scrollTo(0, 0); return; }
    if (json.view === 'form/error') { message.value = json.data.message; state.value = 'error'; return; }
    // Eingabefehler: Formular mit Meldungen und neuer Absende-ID
    data.value = { ...json.data, title: json.title };
    errors.value = json.data.errors || [];
    window.scrollTo(0, 0);
  } catch {
    message.value = 'Anmeldung nicht gespeichert, bitte erneut versuchen.';
    state.value = 'error';
  } finally {
    sending.value = false;
  }
}

function again() { location.reload(); }

onMounted(() => load().catch(() => { message.value = 'Das Formular konnte nicht geladen werden. Bitte später erneut versuchen.'; state.value = 'error'; }));
</script>

<template>
  <header class="f-header"><span class="logo">KKB</span><div><div class="f-title">{{ state === 'form' ? data.title : 'Einsatzanmeldung' }}</div><div class="f-sub">{{ data?.verein || 'Kadetten-Korps Basel' }}</div></div></header>

  <main v-if="state === 'form'" class="f-main">
    <div v-if="preview" class="f-note">Vorschau – Absenden ist hier deaktiviert. {{ data.form.events.some((e) => e.status === 'entwurf') ? 'Entwürfe sind nur in der Vorschau sichtbar.' : '' }}</div>
    <div v-if="errors.length" class="f-error" role="alert"><div v-for="err in errors" :key="err">{{ err }}</div></div>
    <div v-if="!data.form.events.length" class="f-card f-empty">Zurzeit sind keine Einsätze zur Anmeldung offen.</div>
    <form v-else novalidate @submit.prevent="submit">
      <div class="hp" aria-hidden="true"><label>Website <input v-model="website" name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      <div v-if="data.intro" class="f-card f-intro">{{ data.intro }}</div>
      <fieldset class="f-card">
        <legend class="f-q">Wer bist du?</legend>
        <div class="two">
          <label>Vorname<input v-model="first" name="first_name" type="text" required autocomplete="given-name" maxlength="80"></label>
          <label>Nachname<input v-model="last" name="last_name" type="text" required autocomplete="family-name" maxlength="80"></label>
        </div>
      </fieldset>
      <EventBlock v-for="e in data.form.events" :key="e.id" :e="e" :answer="answers[e.id]" :question="data.questions[e.id]" :disabled="preview" />
      <p class="f-hint">Kreuze nur an, wo du dabei bist – alles andere bleibt einfach leer. Du kannst dich in einem Durchgang für mehrere Einsätze anmelden.</p>
      <button class="f-submit" type="submit" :disabled="preview || sending">{{ sending ? 'Wird gesendet …' : 'Anmeldung absenden' }}</button>
    </form>
  </main>

  <main v-else-if="state === 'thanks'" class="f-main f-thanks">
    <div class="check-circle" aria-hidden="true">✓</div>
    <h1>Danke, {{ thanks.firstName }}!</h1>
    <p class="muted">Deine Anmeldung ist eingegangen.</p>
    <div class="f-card f-list">
      <div v-for="i in thanks.items" :key="i.name + i.date" class="f-item">
        <div><strong>{{ i.name }}</strong><div class="muted small">{{ i.date }} · {{ i.detail }}</div></div>
        <span v-if="i.answer === 'nein'" class="pill gray">Abmeldung erfasst</span><span v-else class="pill">noch nicht bestätigt</span>
      </div>
    </div>
    <p class="muted small center">Die Aufgebotsstelle prüft deine Anmeldung. Sobald du eingeteilt bist, erhältst du die Bestätigung mit allen Informationen.</p>
    <a class="f-back" href="" @click.prevent="again">Zurück zum Formular</a>
  </main>

  <main v-else-if="state === 'error'" class="f-main f-thanks">
    <div class="check-circle err" aria-hidden="true">!</div>
    <h1>{{ message }}</h1>
    <a class="f-back" href="" @click.prevent="again">Zurück zum Formular</a>
  </main>
</template>
