<script setup>
// Karte einer Person in der Handy-App: Stand, Antwort-Knöpfe, Schichten, Bemerkung, Zurücksetzen (wie views/handy/_person.ejs)
import { computed, ref, watch, onMounted } from 'vue';
import Icon from './Icon.vue';
import Rank from './Rank.vue';
import { channel, channelRound, cardAction, toast, ask, tel as telOf, waLink, labels, dates } from '@/lib/handy.js';

const props = defineProps({
  r: { type: Object, required: true },
  ev: { type: Object, required: true },
  mode: { type: String, default: 'einsatz' },
  shifts: { type: Array, default: () => [] },
  locked: Boolean,
  back: String,
  hidden: Boolean,
});
const emit = defineEmits(['update']);

const r = computed(() => props.r);
const byPerson = computed(() => props.mode === 'person');
const name = computed(() => `${r.value.first_name} ${r.value.last_name}`);
const tel = computed(() => telOf(r.value.mobile));
const wa = computed(() => waLink(r.value.mobile));
const last = computed(() => r.value.attempts.at(-1));
const lastText = computed(() => {
  const l = last.value;
  if (!l) return '';
  const day = l.contacted_at.slice(0, 10);
  return `${labels.CHANNEL[l.channel].short}${day === dates.today() ? '' : ` ${dates.fmtDateShort(day)}`} ${l.contacted_at.slice(11, 16)} · ${l.sent_by_name}`;
});
const viaReg = computed(() => (r.value.state === 'angemeldet' && r.value.reg_source ? `über ${labels.SOURCE[r.value.reg_source] || r.value.reg_source}` : ''));
const STATE_OF = { unsicher: 'unsicher', nicht_erreicht: 'nicht_erreicht', gesendet: 'whatsapp' };
const isOn = (key) => r.value.answer === key || (r.value.answer === 'offen' && r.value.state === STATE_OF[key]);
const RESULT_TEXT = { zugesagt: 'Kann', abgesagt: 'Kann nicht', unsicher: 'Weiss nicht', nicht_erreicht: 'Nicht erreicht', whatsapp: 'WhatsApp gesendet' };
const fromForm = computed(() => r.value.reg_id && r.value.reg_source === 'formular');
const resetText = computed(() => {
  const l = last.value;
  if (!l) return '';
  const prev = r.value.attempts.length > 1 ? r.value.attempts.at(-2) : null;
  const prevText = prev ? `«${RESULT_TEXT[prev.result]}»` : fromForm.value ? '«angemeldet über Formular»' : '«Noch nicht gefragt»';
  return `Die Antwort «${RESULT_TEXT[l.result]}» für ${name.value} wird gelöscht. Danach steht wieder ${prevText}.${l.result === 'zugesagt' && r.value.registration_id && !fromForm.value && !prev ? ' Die daraus erstellte Anmeldung wird ebenfalls gelöscht.' : ''}`;
});
// Ohne Kontaktversuch, aber von Hand eingetragen (z. B. am PC «Person hinzufügen»): Zurücksetzen löscht diese Anmeldung
const manualReg = computed(() => (!last.value && r.value.reg_id && r.value.reg_source && r.value.reg_source !== 'formular' ? r.value.reg_id : null));
const manualText = computed(() => (manualReg.value ? `Die Anmeldung «${r.value.label.text}» für ${name.value} wurde von Hand eingetragen (${labels.SOURCE[r.value.reg_source] || r.value.reg_source}). Sie wird gelöscht. Danach steht wieder «Noch nicht gefragt».` : ''));
const cardId = computed(() => (byPerson.value ? `e${props.ev.id}` : `p${r.value.person_id}`));
const backUrl = computed(() => props.back || (byPerson.value ? `/handy/personen/${r.value.person_id}` : `/handy/einsatz/${props.ev.id}`));

// Kanal: «Gefragt per» oben; Anrufen/WhatsApp in der Karte setzt ihn nur hier
const override = ref(null);
watch(channelRound, () => { override.value = null; });
const ch = computed(() => override.value || channel.value);

// Schichten wählen und zeigen, welche sich zeitlich mit den gewählten überschneiden
const shiftOpen = ref(false);
const picked = ref([]);
const clash = (s) => {
  if (picked.value.includes(String(s.id)) || !s.from) return [];
  return props.shifts.filter((o) => picked.value.includes(String(o.id)) && o.from && s.from < o.to && o.from < s.to);
};
const panel = ref(null);

const busy = ref(false);
const saved = ref(Boolean(props.r._saved));
onMounted(() => { if (saved.value) setTimeout(() => { saved.value = false; }, 1200); });

const ANSWER_TEXT = { kann: 'kann', kann_nicht: 'kann nicht', unsicher: 'weiss nicht', nicht_erreicht: 'nicht erreicht', gesendet: 'WhatsApp gesendet' };
const base = () => ({ person_id: r.value.person_id, ...(byPerson.value ? { ansicht: 'person' } : {}), back: backUrl.value });

async function send(path, body, done) {
  busy.value = true;
  const res = await cardAction(path, body);
  if (res.error) {
    busy.value = false;
    if (res.error !== true) toast(res.error, true);
    return;
  }
  emit('update', res.data.r);
  toast(done);
}

async function answer(key, shiftAsk) {
  // Einsatz mit Schichten: bei «Kann» zuerst die Schichten zeigen
  if (shiftAsk) {
    shiftOpen.value = true;
    requestAnimationFrame(() => panel.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return;
  }
  await send(`/handy/einsatz/${props.ev.id}/antwort`, { ...base(), channel: ch.value, shift_ids: picked.value, antwort: key }, `${name.value}: ${ANSWER_TEXT[key] || 'gespeichert'}`);
}
function onAnswer(ev) {
  const btn = ev.submitter;
  if (btn?.value) answer(btn.value, btn.hasAttribute('data-shift-ask'));
}

const noteBox = ref(null);
async function saveNote() {
  await send(`/handy/einsatz/${props.ev.id}/notiz`, { ...base(), attempt_id: last.value.id, note: noteBox.value.value }, `${name.value}: Bemerkung gespeichert`);
}

async function reset() {
  const text = last.value ? resetText.value : manualText.value;
  const title = last.value ? 'Antwort zurücksetzen?' : 'Anmeldung zurücksetzen?';
  if (!(await ask(text, { title, ok: 'Ja, zurücksetzen' }))) return;
  await send(`/handy/einsatz/${props.ev.id}/zuruecknehmen`, { ...base(), ...(last.value ? { attempt_id: last.value.id } : { reg_id: manualReg.value }) }, `${name.value}: zurückgesetzt`);
}

const btns = [['kann', 'Kann', ''], ['kann_nicht', 'Kann nicht', ''], ['unsicher', 'Weiss nicht', ''], ['nicht_erreicht', 'Nicht erreicht', 'only-tel'], ['gesendet', 'Gesendet', 'only-wa']];
</script>

<template>
  <article :id="cardId" :class="['hc', `hc-${r.answer}`, { 'is-busy': busy, 'is-saved': saved }]" :data-name="`${name} ${r.rank_short || ''}`.toLowerCase()" :data-person="r.person_id" :data-who="name" :data-ch="ch" :hidden="hidden">
    <div class="hc-top">
      <div v-if="byPerson" class="hc-who">
        <router-link class="hc-event-link" :to="`/handy/einsatz/${ev.id}`"><strong>{{ ev.name }}</strong></router-link>
        <span class="hc-sub">{{ dates.fmtEventDate(ev, 'wd') }}{{ ev.start_time ? ` · ${[ev.start_time, ev.end_time].filter(Boolean).join('–')}` : '' }}{{ ev.start_place ? ` · ${ev.start_place}` : '' }}{{ ev.status === 'entwurf' ? ' · Entwurf' : '' }}</span>
      </div>
      <template v-else>
        <div class="hc-who">
          <strong><Rank :short="r.rank_short" />{{ name }}</strong>
          <span v-if="r.teams" class="hc-sub">{{ r.teams }}</span>
          <span v-if="r.plan" :class="['hc-plan', { 'hc-plan-none': r.plan.none }]" :title="r.plan.title">{{ r.plan.text }}</span>
        </div>
        <div class="hc-contact">
          <a v-if="tel" class="h-round" :href="`tel:${tel}`" :aria-label="`${name} anrufen`" title="Anrufen" @click="override = 'telefon'"><Icon name="phone" /></a>
          <a v-if="wa" class="h-round" :href="wa" target="_blank" rel="noopener" :aria-label="`${name} per WhatsApp schreiben`" title="WhatsApp" @click="override = 'whatsapp'"><Icon name="chat" /></a>
        </div>
      </template>
    </div>
    <div class="hc-state">
      <span :class="['badge', `badge-${r.label.tone}`]">{{ r.label.text }}</span>
      <span v-if="lastText" class="hc-last">{{ lastText }}</span><span v-else-if="viaReg" class="hc-last">{{ viaReg }}</span>
    </div>
    <form v-if="!locked" class="hc-form" @submit.prevent="onAnswer">
      <div class="hc-answers">
        <button v-for="[key, text, cls] in btns" :key="key" :class="['h-ans', `h-ans-${key}`, cls, { 'is-on': isOn(key) }]" type="submit" name="antwort" :value="key" :data-shift-ask="key === 'kann' && shifts.length ? '' : undefined">{{ text }}</button>
      </div>
      <fieldset v-if="shifts.length" ref="panel" class="hc-shifts" :hidden="!shiftOpen">
        <legend>Für welche Schichten?</legend>
        <label v-for="s in shifts" :key="s.id" :class="['check', { 'is-clash': clash(s).length }]"><input v-model="picked" type="checkbox" name="shift_ids" :value="String(s.id)"> <span>{{ s.time ? `${s.name} ` : s.name }}<span v-if="s.time" class="muted">{{ s.time }}</span><span class="hc-clash" :hidden="!clash(s).length">{{ clash(s).length ? `gleiche Zeit wie ${clash(s).map((o) => o.name).join(', ')}` : '' }}</span></span></label>
        <p class="hc-hint">Leer lassen, wenn die Schicht noch offen ist.</p>
        <div class="hc-shift-foot"><button class="btn btn-ghost" type="button" @click="shiftOpen = false">Abbrechen</button><button class="btn btn-primary" type="submit" name="antwort" value="kann">Kann – speichern</button></div>
      </fieldset>
    </form>
    <details v-if="last && !locked" class="hc-note">
      <summary><Icon name="chat" /><span><template v-if="last.note"><small>Interne Bemerkung</small>{{ last.note }}</template><template v-else>Interne Bemerkung schreiben</template></span></summary>
      <form @submit.prevent="saveNote">
        <textarea ref="noteBox" name="note" :aria-label="`Interne Bemerkung für ${name}`" rows="2" maxlength="500" placeholder="z. B. kommt erst ab 10 Uhr" :defaultValue="last.note || ''"></textarea>
        <button type="submit" class="btn btn-primary">Bemerkung speichern</button>
      </form>
    </details>
    <form v-if="(last || manualReg) && !locked" class="hc-reset" @submit.prevent="reset">
      <button type="submit" class="hc-reset-btn" title="Falsch getippt? Die letzte Antwort zurücksetzen"><Icon name="undo" /> Zurücksetzen</button>
    </form>
  </article>
</template>
