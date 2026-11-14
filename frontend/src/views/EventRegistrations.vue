<script setup>
// Reiter «Anmeldungen» eines Einsatzes (wie views/event/anmeldungen.ejs)
import { computed, ref, reactive, watch } from 'vue';
import EventShell from '@/components/EventShell.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import FnLine from '@/components/FnLine.vue';
import SearchSelect from '@/components/SearchSelect.vue';
import AppDialog from '@/components/AppDialog.vue';
import { usePage } from '@/lib/usePage.js';
import { useFilters, apiUrl } from '@/lib/useFilters.js';
import { runAction } from '@/lib/actions.js';
import { uiAlert } from '@/lib/dialog.js';
import { labels, dates, regState } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const { f, apply, typed } = useFilters({ status: '', q: '', sort: 'rang' });
const ev = computed(() => data.value.event);
const list = computed(() => data.value.list || []);
const base = computed(() => `/einsaetze/${ev.value.id}/anmeldungen`);
const chipOrder = ['neu', 'unsicher', 'rueckfrage', 'bestaetigt', 'warteliste', 'zurueckgezogen', 'abgesagt', 'ungueltig'];
const chips = computed(() => chipOrder.filter((st) => data.value.counts[st] || ['neu', 'bestaetigt'].includes(st)));
const chipTo = (status) => ({ path: base.value, query: { status: status || undefined, q: f.q || undefined, sort: f.sort !== 'rang' ? f.sort : undefined } });
const shiftName = (id) => (ev.value.shifts.find((s) => s.id === id) || {}).name;
const who = (r) => r.person_name || r.entered_name;
const INACTIVE = ['zurueckgezogen', 'abgesagt', 'ungueltig'];
const people = computed(() => (data.value.available || []).map((p) => ({ value: p.id, text: `${p.last_name} ${p.first_name}${p.rank_short ? ` (${p.rank_short})` : ''}` })));

// Gruppen: offen, bestätigt, Rest (zugeklappt)
const groupDefs = [
  { key: 'offen', label: 'Zu bearbeiten', st: ['neu', 'unsicher', 'rueckfrage'] },
  { key: 'bestaetigt', label: 'Bestätigt', st: ['bestaetigt'] },
  { key: 'rest', label: 'Warteliste, abgemeldet, ungültig', st: null, collapsed: true },
];
const groupOf = (r) => groupDefs.find((g) => g.st && g.st.includes(r.status)) || groupDefs.at(-1);
const grouped = computed(() => !data.value.filters.status && list.value.length > 0);
const restOpen = ref(false);
const sections = computed(() => (grouped.value
  ? groupDefs.map((g) => ({ ...g, rows: list.value.filter((r) => groupOf(r) === g) })).filter((g) => g.rows.length)
  : [{ key: 'alle', rows: list.value }]));

// Auswahl für Sammelaktionen
const picked = ref([]);
watch(list, (l) => { const ids = new Set(l.map((r) => r.id)); picked.value = picked.value.filter((id) => ids.has(id)); });
const allPicked = computed({
  get: () => list.value.length > 0 && picked.value.length === list.value.length,
  set: (v) => { picked.value = v ? list.value.map((r) => r.id) : []; },
});
const bulk = reactive({ status: '', fn: '' });
async function runBulk(body) {
  if (!picked.value.length) { await uiAlert('Bitte zuerst Einträge ankreuzen.'); return; }
  const res = await runAction(`/einsaetze/${ev.value.id}/anmeldungen/sammel`, { ids: picked.value, ...body }, { onDone: refresh });
  if (res) picked.value = [];
}
async function bulkSelect(kind) {
  const v = bulk[kind];
  if (!v) return;
  await runBulk(kind === 'status' ? { status_select: v } : { function_select: v });
  bulk[kind] = '';
}

// Einzelaktionen
const setStatus = (r, status, opts = {}) => runAction(`/anmeldungen/${r.id}/status`, { status, ...(opts.expected === false ? {} : { expected: opts.expected || r.status }) }, { confirm: opts.confirm, onDone: refresh });
const setFunction = (r, id) => runAction(`/anmeldungen/${r.id}/funktion`, { function_id: id }, { onDone: refresh });
const remove = (r) => runAction(`/anmeldungen/${r.id}/loeschen`, {}, {
  confirm: `${['zurueckgezogen', 'abgesagt'].includes(r.status) ? 'Abmeldung' : 'Anmeldung'} von ${who(r)} endgültig löschen?\n\nDie Person gilt danach wieder als «ohne Rückmeldung», als wäre nie etwas eingegangen. Das lässt sich nicht rückgängig machen.`,
  onDone: refresh,
});

// Dialoge
const addOpen = ref(false);
const add = reactive({ person_id: '', source: 'manuell', shift_ids: [], remark: '' });
function openAdd() { Object.assign(add, { person_id: '', source: 'manuell', shift_ids: [], remark: '' }); addOpen.value = true; }
async function saveAdd() {
  const res = await runAction(`/einsaetze/${ev.value.id}/anmeldungen`, { ...add }, { onDone: refresh });
  if (res) addOpen.value = false;
}
const note = reactive({ open: false, r: null, text: '' });
function openNote(r) { Object.assign(note, { open: true, r, text: r.internal_note || '' }); }
async function saveNote() {
  const res = await runAction(`/anmeldungen/${note.r.id}/notiz`, { internal_note: note.text, version: note.r.version }, { onDone: refresh });
  if (res) note.open = false;
}
const re = reactive({ open: false, r: null, person_id: '', keep: true });
function openReassign(r) { Object.assign(re, { open: true, r, person_id: '', keep: true }); }
async function saveReassign() {
  const res = await runAction(`/anmeldungen/${re.r.id}/zuordnen`, { person_id: re.person_id, keep_shifts: re.keep ? '1' : '0' }, { onDone: refresh });
  if (res) re.open = false;
}

const subline = (r) => [r.match_type !== 'auto' ? labels.MATCH_TYPE[r.match_type] : '', r.teams].filter(Boolean).join(' · ')
  + (r.entered_name && r.match_type !== 'auto' && r.entered_name !== `${r.first_name} ${r.last_name}` && r.source === 'formular' ? ` · eingegeben «${r.entered_name}»` : '');
</script>

<template>
  <div v-if="error && !ev" class="flash flash-error">{{ error.message }}</div>
  <EventShell v-if="ev" :data="data" tab="anmeldungen">
    <div class="row-between mb">
      <div class="chips">
        <router-link :class="['chip', 'badge-gray', { active: !data.filters.status }]" :to="chipTo('')">Alle · {{ data.total }}</router-link>
        <router-link v-for="st in chips" :key="st" :class="['chip', `badge-${labels.REG_STATUS[st].tone}`, { active: data.filters.status === st }]" :to="chipTo(st)">{{ labels.REG_STATUS[st].label }} · {{ data.counts[st] || 0 }}</router-link>
      </div>
      <div class="row">
        <select v-model="f.sort" aria-label="Sortierung" style="width:auto" @change="apply()"><option value="rang">Rang: tief → hoch</option><option value="rang_ab">Rang: hoch → tief</option><option value="funktion">Funktion, dann Rang</option><option value="neu">neueste zuerst</option></select>
        <form class="search" @submit.prevent="apply()"><input v-model="f.q" type="search" placeholder="Filtern" @input="typed"></form>
        <button class="btn btn-sm" type="button" @click="openAdd">+ Anmeldung erfassen</button>
      </div>
    </div>

    <div class="card">
      <form class="bulkbar" @submit.prevent>
        <label class="check"><input v-model="allPicked" type="checkbox"> <span class="count">{{ picked.length ? `${picked.length} ausgewählt` : 'Alle auswählen' }}</span></label>
        <template v-if="picked.length">
          <button class="btn btn-sm btn-primary" type="button" @click="runBulk({ status_button: 'bestaetigt' })">Bestätigen</button>
          <select v-model="bulk.status" aria-label="Status ändern" @change="bulkSelect('status')">
            <option value="">Status ändern …</option>
            <option v-for="st in labels.REG_STATUS_MANUAL" :key="st" :value="st">{{ labels.REG_STATUS[st].label }}</option>
          </select>
          <select v-model="bulk.fn" aria-label="Funktion zuweisen" @change="bulkSelect('fn')">
            <option value="">Funktion zuweisen …</option>
            <option v-for="fo in data.functionOptions" :key="fo.id" :value="fo.id">{{ fo.short }} · {{ fo.name }}</option>
          </select>
          <a class="btn btn-sm" :href="apiUrl(base, {}, { format: 'xlsx' })">Exportieren</a>
        </template>
      </form>
      <div v-if="data.fnSummary.usesFunctions" class="card-body fn-panel">
        <div class="fn-panel-head"><span>Funktionen Ist/Soll</span><router-link class="link small no-print" :to="`/einsaetze/${ev.id}/schichten#funktionen`">Einteilen →</router-link></div>
        <FnLine :fn-summary="data.fnSummary" />
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="check-col"></th><th>Person</th><th>Eingang</th><th>Schicht</th><th>Funktion</th><th>Bemerkung</th><th>Status</th><th class="actions-col"></th></tr></thead>
          <tbody>
            <tr v-if="!list.length"><td colspan="8" class="empty">Keine Anmeldungen{{ data.filters.status || data.filters.q ? ' mit diesem Filter' : '' }}.</td></tr>
            <template v-for="g in sections" :key="g.key">
              <tr v-if="grouped" class="group-row" :data-group-head="g.key"><td colspan="8">
                <button v-if="g.collapsed" type="button" class="group-toggle" :aria-expanded="String(restOpen)" @click="restOpen = !restOpen"><span class="chev" aria-hidden="true">▸</span> {{ g.label }} · {{ g.rows.length }}</button>
                <template v-else><strong>{{ g.label }}</strong> <span class="muted">· {{ g.rows.length }}</span></template>
              </td></tr>
              <tr v-for="r in g.rows" v-show="!grouped || !g.collapsed || restOpen" :key="r.id" :data-row-id="`r${r.id}`" :class="{ highlight: r.status === 'neu' }" :data-group="grouped ? g.key : undefined">
                <td class="check-col"><input v-model="picked" type="checkbox" :value="r.id" aria-label="Auswählen"></td>
                <td>
                  <template v-if="r.person_id">
                    <Rank :short="r.rank_short" /><router-link :to="`/personen/${r.person_id}`"><strong>{{ r.first_name }} {{ r.last_name }}</strong></router-link>
                    <span class="sub">{{ subline(r) }}</span>
                  </template>
                  <template v-else>
                    <strong class="link">«{{ r.entered_name }}»</strong>
                    <span class="sub warn">{{ r.match_info || 'keine sichere Zuordnung' }} → <router-link class="link" :to="`/klaerungen?id=${r.id}`">Klärungen</router-link></span>
                  </template>
                  <span v-if="r.duplicate_count" class="sub"><Badge :text="`${r.duplicate_count + 1}× abgeschickt`" tone="gray" /></span>
                </td>
                <td class="nowrap">{{ labels.SOURCE[r.source] }}<span class="sub">{{ dates.fmtRelative(r.registered_at) }}</span></td>
                <td>
                  <span v-if="r.answer === 'nein'" class="muted">–</span>
                  <template v-else-if="r.assigned.length">{{ r.assigned.map((a) => a.name).join(' + ') }}</template>
                  <span v-else-if="r.wishes.length" class="muted">Wunsch: {{ r.wishes.map(shiftName).filter(Boolean).join(' + ') }}</span>
                  <span v-else class="muted">–</span>
                </td>
                <td>
                  <form v-if="r.person_id && !INACTIVE.includes(r.status)" class="fn-select" @submit.prevent>
                    <select :value="r.func.id" :aria-label="`Funktion von ${r.person_name}`" :class="{ 'fn-is-default': r.func.is_default }" @change="setFunction(r, $event.target.value)">
                      <option v-for="fo in data.functionOptions" :key="fo.id" :value="fo.id" :title="fo.name">{{ fo.short }}</option>
                      <option v-if="!data.functionOptions.some((fo) => fo.id === r.func.id)" :value="r.func.id">{{ r.func.short }}</option>
                    </select>
                  </form>
                  <span v-else class="muted">–</span>
                </td>
                <td class="small">
                  {{ r.remark || '' }}<span v-if="!r.remark && !r.internal_note && !data.diets[r.id]" class="muted">–</span>
                  <span v-if="r.internal_note" class="sub">Intern: {{ r.internal_note }}</span>
                  <span v-if="data.diets[r.id]" class="sub">Verpflegung: {{ data.diets[r.id] }}</span>
                </td>
                <td><Badge v-bind="regState(r.status)" /></td>
                <td class="actions-col right nowrap">
                  <router-link v-if="r.status === 'unsicher' && !r.person_id" class="btn btn-sm" :to="`/klaerungen?id=${r.id}`">Zuordnen</router-link>
                  <form v-else-if="r.status === 'neu'" class="inline" @submit.prevent="setStatus(r, 'bestaetigt', { expected: 'neu' })"><button class="btn btn-sm" type="submit">Bestätigen</button></form>{{ ' ' }}<details class="menu">
                    <summary class="btn btn-sm btn-ghost" aria-label="Weitere Aktionen">⋯</summary>
                    <div class="menu-list">
                      <template v-if="r.person_id">
                        <form v-for="st in labels.REG_STATUS_MANUAL.filter((x) => x !== r.status)" :key="st" @submit.prevent="setStatus(r, st)"><button type="submit">→ {{ labels.REG_STATUS[st].label }}</button></form>
                        <div class="sep"></div>
                      </template>
                      <button type="button" @click="openNote(r)">Interne Bemerkung …</button>
                      <button type="button" @click="openReassign(r)">Andere Person zuordnen …</button>
                      <form @submit.prevent="setStatus(r, 'ungueltig', { expected: false, confirm: 'Als ungültig markieren (z. B. doppelt oder Test)?' })"><button type="submit">Als ungültig markieren</button></form>
                      <div class="sep"></div>
                      <form @submit.prevent="remove(r)"><button type="submit" class="btn-danger">Löschen (zurücksetzen)</button></form>
                    </div>
                  </details>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppDialog id="add-reg" v-model:open="addOpen">
      <form @submit.prevent="saveAdd">
        <div class="card-head"><h2>Anmeldung erfassen</h2></div>
        <div class="card-body">
          <div class="field"><label>Person</label><SearchSelect v-model="add.person_id" :options="people" required aria-label="Person" /></div>
          <div class="field"><label>Quelle</label><select v-model="add.source"><option value="manuell">Manuell</option><option value="telefon">Telefon</option><option value="whatsapp">WhatsApp</option><option value="muendlich">Mündlich</option></select></div>
          <div v-if="ev.shifts.length > 1" class="field"><label>Schichten</label><label v-for="s in ev.shifts" :key="s.id" class="check"><input v-model="add.shift_ids" type="checkbox" :value="s.id"> {{ s.name }} <span class="muted">{{ dates.fmtShiftWhen(s, dates.isMultiDay(ev)) }}</span></label></div>
          <div class="field"><label>Bemerkung</label><input v-model="add.remark" type="text"></div>
        </div>
        <div class="card-foot"><button class="btn btn-ghost" type="button" @click="addOpen = false">Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button></div>
      </form>
    </AppDialog>

    <AppDialog id="note" v-model:open="note.open">
      <form v-if="note.r" @submit.prevent="saveNote">
        <div class="card-head"><h2>Interne Bemerkung <span class="hint">{{ who(note.r) }}</span></h2></div>
        <div class="card-body"><textarea v-model="note.text" rows="4"></textarea></div>
        <div class="card-foot"><button class="btn btn-ghost" type="button" @click="note.open = false">Abbrechen</button><button class="btn btn-primary" type="submit">Speichern</button></div>
      </form>
    </AppDialog>

    <AppDialog id="reassign" v-model:open="re.open">
      <form v-if="re.r" @submit.prevent="saveReassign">
        <div class="card-head"><h2>Andere Person zuordnen <span class="hint">{{ who(re.r) }}</span></h2></div>
        <div class="card-body">
          <div class="field"><label>Neue Person</label><SearchSelect v-model="re.person_id" :options="people" required aria-label="Neue Person" /></div>
          <label class="check"><input v-model="re.keep" type="checkbox"> Schichtzuteilungen mitnehmen</label>
          <p class="small muted mt-s">Die Umhängung wird im Verlauf festgehalten (vorherige und neue Person, wer, wann).</p>
        </div>
        <div class="card-foot"><button class="btn btn-ghost" type="button" @click="re.open = false">Abbrechen</button><button class="btn btn-primary" type="submit">Zuordnen</button></div>
      </form>
    </AppDialog>
  </EventShell>
</template>
