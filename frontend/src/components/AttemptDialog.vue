<script setup>
// Fenster «Kontaktversuch erfassen» (wie partials/attempt-dialog.ejs).
// Öffnen mit open({ person, event, who, channel, shift, current, currentLink, bulk: [ids] }).
import { ref, reactive, computed, watch } from 'vue';
import AppDialog from './AppDialog.vue';
import SearchSelect from './SearchSelect.vue';
import StatusHistory from './StatusHistory.vue';
import { runAction } from '@/lib/actions.js';
import { page, session } from '@/lib/api.js';
import { resetPerson, clearHistory, clash } from '@/lib/attempts.js';

const props = defineProps({
  action: { type: String, required: true }, // z. B. /einsaetze/1/anfragen/versuch oder /anfragen/versuch
  eventChoice: Boolean, // Einsatz kommt pro Aufruf mit (Rückmeldungen, Personenseite)
  allUsers: { type: Array, default: () => [] }, shiftChoices: { type: Object, default: () => ({}) },
});
const emit = defineEmits(['done']);
const isOpen = ref(false);
const ctx = reactive({ person: '', event: '', who: '', bulk: [], current: '', currentLink: '' });
const pad = (n) => String(n).padStart(2, '0');
const f = reactive({ channel: 'telefon', date: '', time: '', sent_by_user_id: '', result: 'nicht_erreicht', shift_ids: [], note: '' });
const hist = reactive({ loading: false, failed: false, data: null });
const users = computed(() => props.allUsers.map((u) => ({ value: u.id, text: u.display_name })));
const shifts = computed(() => props.shiftChoices[ctx.event] || []);
const showShifts = computed(() => shifts.value.length > 0 && f.result === 'zugesagt');
const RESULTS = [['nicht_erreicht', 'Nicht erreicht', ['telefon', 'whatsapp']], ['whatsapp', 'Nachricht gesendet, Antwort offen', ['whatsapp']], ['zugesagt', 'Zugesagt – Anmeldung erstellen'], ['unsicher', 'Unsicher – weiss es noch nicht'], ['abgesagt', 'Abgesagt']];
const allowed = (r) => !r[2] || r[2].includes(f.channel);

// Ergebnisse, die zum Kanal nicht passen, entfallen (mündlich: kein «nicht erreicht», keine Nachricht)
function fitResult(ch) {
  if (ch === 'muendlich' && ['nicht_erreicht', 'whatsapp'].includes(f.result)) f.result = 'unsicher';
  else if (['nicht_erreicht', 'whatsapp'].includes(f.result)) f.result = ch === 'whatsapp' ? 'whatsapp' : 'nicht_erreicht';
}
watch(() => f.channel, fitResult);
const clashText = (sh) => {
  if (f.shift_ids.includes(sh.id)) return '';
  const hit = shifts.value.filter((o) => f.shift_ids.includes(o.id) && clash(sh, o));
  return hit.length ? ` – gleiche Zeit wie ${hit.map((o) => o.name).join(', ')}` : '';
};

async function loadHistory() {
  hist.data = null; hist.failed = false;
  if (ctx.bulk.length || !ctx.person || !ctx.event) return;
  hist.loading = true;
  const want = `${ctx.person}:${ctx.event}`;
  try {
    const e = await page(`/rueckmeldungen/verlauf?person=${encodeURIComponent(ctx.person)}&event=${encodeURIComponent(ctx.event)}`);
    if (`${ctx.person}:${ctx.event}` === want) hist.data = e.data;
  } catch { hist.failed = true; } finally { hist.loading = false; }
}

function open(o = {}) {
  Object.assign(ctx, { person: o.person || '', event: o.event || '', who: o.who || '', bulk: o.bulk || [], current: o.current || '', currentLink: o.currentLink || '' });
  if (o.bulk) ctx.who = `${o.bulk.length} Person${o.bulk.length === 1 ? '' : 'en'}`;
  const now = new Date();
  Object.assign(f, {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    sent_by_user_id: session.user?.id || '', note: '', result: f.result || 'nicht_erreicht',
    shift_ids: o.shift ? [Number(o.shift)] : [],
  });
  if (o.channel) { f.channel = o.channel; fitResult(o.channel); }
  isOpen.value = true;
  loadHistory();
}
defineExpose({ open });

async function save() {
  const body = { channel: f.channel, date: f.date, time: f.time, sent_by_user_id: f.sent_by_user_id, result: f.result, note: f.note };
  if (showShifts.value) body.shift_ids = f.shift_ids;
  if (ctx.bulk.length) body.person_ids = ctx.bulk; else body.person_id = ctx.person;
  if (props.eventChoice) body.event_id = ctx.event;
  const res = await runAction(props.action, body);
  if (res) { isOpen.value = false; emit('done'); }
}
async function reset() {
  isOpen.value = false;
  await resetPerson({ personId: ctx.person, eventId: ctx.event, who: ctx.who, onDone: () => emit('done') });
}
async function clearHist() {
  isOpen.value = false;
  await clearHistory({ personId: ctx.person, eventId: ctx.event, who: ctx.who, onDone: () => emit('done') });
}
</script>

<template>
  <AppDialog id="attempt" v-model:open="isOpen" focus="#att-result">
    <form @submit.prevent="save">
      <div class="card-head"><h2>Kontaktversuch erfassen <span class="hint">{{ ctx.who }}</span></h2></div>
      <div class="card-body">
        <div v-if="ctx.current" class="dlg-current small"><strong>Aktuell:</strong> <span>{{ ctx.current }}</span> <router-link v-if="ctx.currentLink" class="link" :to="ctx.currentLink">Anmeldung öffnen →</router-link></div>
        <div v-if="!ctx.bulk.length && ctx.person && ctx.event" class="hist small">
          <div v-if="hist.loading && !hist.data" class="muted">Verlauf wird geladen …</div>
          <div v-else-if="hist.failed" class="muted">Verlauf konnte nicht geladen werden.</div>
          <StatusHistory v-else-if="hist.data" v-bind="hist.data" @clear="clearHist" />
        </div>
        <div class="field"><label>Kanal</label>
          <div class="segmented">
            <input id="ch-tel" v-model="f.channel" type="radio" value="telefon"><label for="ch-tel">Telefon</label>
            <input id="ch-wa" v-model="f.channel" type="radio" value="whatsapp"><label for="ch-wa">WhatsApp</label>
            <input id="ch-md" v-model="f.channel" type="radio" value="muendlich"><label for="ch-md">Mündlich</label>
          </div>
        </div>
        <div class="fields fields-2">
          <div class="field"><label for="att-date">Datum</label><input id="att-date" v-model="f.date" type="date"></div>
          <div class="field"><label for="att-time">Uhrzeit</label><input id="att-time" v-model="f.time" type="time"></div>
        </div>
        <div class="field"><label for="att-by">Gesendet von</label>
          <SearchSelect id="att-by" v-model="f.sent_by_user_id" :options="users" />
          <div class="field-hint">vorausgefüllt mit dir – änderbar, falls jemand anderes angerufen oder geschrieben hat</div>
        </div>
        <div class="field"><label for="att-result">Ergebnis</label>
          <select id="att-result" v-model="f.result" required>
            <option v-for="r in RESULTS" :key="r[0]" :value="r[0]" :hidden="!allowed(r)" :disabled="!allowed(r)">{{ r[1] }}</option>
          </select>
        </div>
        <div v-if="showShifts" class="field"><label>Für welche Schichten?</label>
          <div class="check-list" data-shift-options>
            <label v-for="sh in shifts" :key="sh.id" class="check"><input v-model="f.shift_ids" type="checkbox" :value="sh.id"> {{ sh.name }}{{ sh.time ? ` (${sh.time})` : '' }}<span v-if="clashText(sh)" class="shift-clash">{{ clashText(sh) }}</span></label>
          </div>
          <div class="field-hint">Leer lassen, wenn die Schicht noch offen ist. Zuteilen geht auch später unter «Schichten».</div>
        </div>
        <div class="field"><label for="att-note">Notiz</label><input id="att-note" v-model="f.note" type="text" placeholder="optional"></div>
      </div>
      <div class="card-foot"><button v-if="!ctx.bulk.length" class="btn btn-ghost btn-danger mr-auto" type="button" title="Kontaktversuche, Rückmeldung und Schichten für diese Person bei diesem Einsatz löschen" @click="reset">Alles zurücksetzen</button><button class="btn btn-ghost" type="button" @click="isOpen = false">Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button></div>
    </form>
  </AppDialog>
</template>
