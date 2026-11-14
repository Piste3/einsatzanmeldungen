<script setup>
// Einsatz anlegen oder bearbeiten (wie views/pages/event-form.ejs)
import { computed, ref, reactive, watch, nextTick, onUnmounted } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import SearchSelect from '@/components/SearchSelect.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection } from '@/lib/section.js';
import { setEditing } from '@/lib/live.js';
import { labels, dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath, { live: false });
const e = computed(() => data.value.e);
const isNew = computed(() => Boolean(data.value.isNew));
const closed = computed(() => e.value.status === 'abgeschlossen');
const draft = computed(() => isNew.value || e.value.status === 'entwurf');
const st = computed(() => labels.EVENT_STATUS[e.value.status || 'entwurf'] || { label: e.value.status, tone: 'gray' });
const crumbs = computed(() => (isNew.value ? [['Einsätze', '/einsaetze'], ['Neuer Einsatz']] : [['Einsätze', '/einsaetze'], [e.value.name, `/einsaetze/${e.value.id}`], ['Bearbeiten']]));
const preview = computed(() => `/forms/anmeldung?vorschau=1&einsatz=${e.value.id}`);

// Wer bearbeitet gerade denselben Einsatz?
watch(e, (v) => { if (v) setEditing(isNew.value ? null : `event:${v.id}`); });
onUnmounted(() => setEditing(null));

const form = ref(null);
useSection(form, data);
const leader = ref('');
watch(e, (v) => { if (v) leader.value = v.leader_person_id ? Number(v.leader_person_id) : ''; }, { immediate: true });
const leaderOptions = computed(() => (data.value.leaders || []).map((p) => ({ value: p.id, text: `${p.rank_short ? `${p.rank_short} ` : ''}${p.first_name} ${p.last_name}` })));
watch(() => data.value.e, async (v) => { if (!v) return; await nextTick(); const n = document.getElementById('name'); if (n) n.focus(); });

// Soll pro Schicht und Funktion: Spalten = Schichten (neu: nur «Ganzer Einsatz»), Zeilen = Funktionen
const cols = computed(() => (isNew.value ? [{ id: null, name: 'Ganzer Einsatz', targets: {} }] : e.value.shifts));
const keyOf = (c, f) => (c.id ? `fn_target_${c.id}_${f.id}` : `fn_target_${f.id}`);
const valOf = (c, f) => e.value[keyOf(c, f)] ?? (c.targets || {})[f.id] ?? '';
const shownFns = computed(() => data.value.functionList.filter((f) => f.active || f.is_default || cols.value.some((c) => (c.targets || {})[f.id])));
const colTotal = (c) => shownFns.value.reduce((a, f) => a + (Number(valOf(c, f)) > 0 ? Number(valOf(c, f)) : 0), 0);
const totals = reactive({});
watch(data, () => { for (const k of Object.keys(totals)) delete totals[k]; });
function fnInput(ev) {
  const col = ev.target.dataset.fnCol;
  if (col === undefined) return;
  const grid = ev.target.closest('[data-fn-grid]');
  totals[col] = [...grid.querySelectorAll(`[data-fn-col="${col}"]`)].reduce((a, i) => a + (parseInt(i.value, 10) > 0 ? parseInt(i.value, 10) : 0), 0);
}
const defaultFn = computed(() => (data.value.functionList.find((f) => f.is_default) || {}).name || 'Einsatzteilnehmer');

// Vorlagen: Tenue einsetzen, Anmeldefrage übernehmen
function setField(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el;
}
function fill(text) { const el = setField('tenue', text); if (el) el.focus(); }
function questionTemplate(ev) {
  const q = data.value.questionTemplates.find((x) => String(x.id) === ev.target.value);
  if (!q) return;
  setField('question_text', q.question_text || '');
  setField('help_text', q.help_text || '');
}

async function save(ev) {
  const body = formBody(form.value);
  body.action = ev.submitter?.value || 'save';
  const path = isNew.value ? '/einsaetze' : `/einsaetze/${e.value.id}/bearbeiten`;
  await runAction(path, body, { follow: true });
}
const extraVal = (d) => (e.value.extra || {})[d.name] || '';
</script>

<template>
  <div v-if="error && !e" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="e">
    <form id="event-form" ref="form" @submit.prevent="save" @input="fnInput">
      <input v-if="!isNew" type="hidden" name="version" :value="e.version">
      <Topbar :crumbs="crumbs" :heading="isNew ? (e.name || 'Neuer Einsatz') : e.name" :show-search="false">
        <template #badges><Badge :text="st.label" :tone="st.tone" /></template>
        <template #actions>
          <a v-if="!isNew" class="btn" :href="preview" target="_blank" rel="noopener">Formular-Vorschau</a><button class="btn" type="submit" name="action" value="save">{{ isNew ? 'Als Entwurf speichern' : 'Speichern' }}</button><button v-if="draft" class="btn btn-primary" type="submit" name="action" value="publish">Veröffentlichen</button>
        </template>
      </Topbar>
      <div v-if="closed" class="callout warn mb"><strong class="cap">Abgeschlossen</strong>Dieser Einsatz ist schreibgeschützt. Als Admin kannst du ihn mit Begründung ändern.
        <div class="field mt-s"><input type="text" name="reason" required placeholder="Begründung der Änderung"></div></div>

      <div class="grid grid-main">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Grunddaten <span class="hint">Nur der Name ist Pflicht – alles andere kann später ergänzt werden.</span></h2></div>
            <div class="card-body">
              <div class="fields fields-2">
                <div class="field"><label for="name">Name des Einsatzes <span class="req">*</span></label><input id="name" name="name" type="text" required :defaultValue="e.name || ''"></div>
                <div class="field"><label for="date">Datum</label><input id="date" name="date" type="date" :defaultValue="e.date || ''" aria-describedby="date-hint">
                  <div id="date-hint" class="small muted mt-s">Leer lassen, wenn die Schichten an verschiedenen Tagen sind. Dann bekommt jede Schicht ihr eigenes Datum.</div></div>
              </div>
              <div class="fields fields-3e">
                <div class="field"><label for="start_time">Beginn (Antreten)</label><input id="start_time" name="start_time" type="time" :defaultValue="e.start_time || ''"></div>
                <div class="field"><label for="end_time">Ende (Abtreten)</label><input id="end_time" name="end_time" type="time" :defaultValue="e.end_time || ''"></div>
                <div class="field"><label for="leader">Einsatzleitung</label>
                  <SearchSelect id="leader" v-model="leader" name="leader_person_id" :options="leaderOptions" allow-empty :default-value="e.leader_person_id ? Number(e.leader_person_id) : ''" /></div>
              </div>
              <div class="fields fields-2">
                <div class="field"><label for="start_place">Antretensort</label><input id="start_place" name="start_place" type="text" :defaultValue="e.start_place || ''"></div>
                <div class="field"><label for="end_place">Abtretensort</label><input id="end_place" name="end_place" type="text" :defaultValue="e.end_place || ''" placeholder="leer = wie Antretensort"></div>
              </div>
              <div class="field">
                <label for="tenue">Tenue</label>
                <div class="template-chips">
                  <button v-for="(t, i) in data.tenueTemplates" :key="t.id" type="button" :class="{ primary: i === 0 }" @click="fill(t.text)">Vorlage: {{ t.name }}</button>
                </div>
                <textarea id="tenue" name="tenue" rows="2" :defaultValue="e.tenue || ''"></textarea>
              </div>
              <div class="field"><label for="description">Beschreibung (für Mitglieder sichtbar)</label><textarea id="description" name="description" rows="2" :defaultValue="e.description || ''"></textarea></div>
              <div class="field"><label for="internal_note">Interne Bemerkung</label><textarea id="internal_note" name="internal_note" rows="2" placeholder="nur für Aufgebotsstelle sichtbar" :defaultValue="e.internal_note || ''"></textarea></div>
              <div v-if="data.extraDefs.length" class="fields fields-2">
                <div v-for="d in data.extraDefs" :key="d.id" class="field">
                  <label :for="`extra_${d.id}`">{{ d.name }}<template v-if="d.required"> <span class="req">*</span></template></label>
                  <textarea v-if="d.field_type === 'textarea'" :id="`extra_${d.id}`" :name="`extra_${d.id}`" rows="2" :defaultValue="extraVal(d)"></textarea>
                  <label v-else-if="d.field_type === 'checkbox'" class="check"><input :id="`extra_${d.id}`" type="checkbox" :name="`extra_${d.id}`" value="1" :defaultChecked="Boolean(extraVal(d))"> Ja</label>
                  <input v-else :id="`extra_${d.id}`" :name="`extra_${d.id}`" :type="d.field_type === 'number' ? 'number' : d.field_type === 'date' ? 'date' : 'text'" :defaultValue="extraVal(d)">
                </div>
              </div>
            </div>
          </div>

          <div id="funktionen" class="card">
            <div class="card-head"><h2>Schichten und Soll <span class="hint">wie viele braucht es?</span></h2><router-link v-if="!isNew" class="small" :to="`/einsaetze/${e.id}/schichten#schichten-bearbeiten`">Schichten hinzufügen oder ändern →</router-link></div>
            <div class="table-wrap">
              <table class="form-table fn-grid no-cards" data-fn-grid>
                <thead>
                  <tr><th>Funktion</th><th v-for="c in cols" :key="c.id || 'ganz'" class="fn-cell">{{ c.name }}<span v-if="c.starts_at" class="sub muted">{{ dates.fmtShiftWhen(c, dates.isMultiDay(e)) }}</span></th></tr>
                </thead>
                <tbody>
                  <tr v-for="f in shownFns" :key="f.id">
                    <td class="nowrap"><span :class="['fn-tag', { 'fn-default': f.is_default }]">{{ f.short }}</span> {{ f.name }}</td>
                    <td v-for="(c, i) in cols" :key="c.id || 'ganz'" class="fn-cell"><input :name="keyOf(c, f)" type="number" min="0" max="9999" step="1" inputmode="numeric" :defaultValue="valOf(c, f)" placeholder="–" :data-fn-col="i" :aria-label="`${f.short} ${c.name}`"></td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr><th>Soll der Schicht <span class="muted">(Personen)</span></th><th v-for="(c, i) in cols" :key="c.id || 'ganz'" class="fn-cell"><span class="fn-sum">{{ (totals[i] ?? colTotal(c)) || '–' }}</span></th></tr>
                </tfoot>
              </table>
            </div>
            <div class="card-body small muted">
              Leer lassen, was es nicht braucht. Das Soll der Schicht ist die Summe. Wer keine Funktion hat, zählt als {{ defaultFn }}. Die Funktion einer Person wählst du im Reiter «Schichten» oder «Anmeldungen».
              <template v-if="isNew">Weitere Schichten kannst du nach dem Speichern im Reiter «Schichten» hinzufügen.</template>
            </div>
          </div>
        </div>
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Anmeldeformular</h2></div>
            <div class="card-body">
              <div class="field"><label for="question_template_id">Anmeldefrage (aus Vorlage)</label>
                <select id="question_template_id" name="question_template_id" @change="questionTemplate">
                  <option value="" :defaultSelected="!e.question_template_id">–</option>
                  <option v-for="q in data.questionTemplates" :key="q.id" :value="q.id" :defaultSelected="Number(e.question_template_id) === q.id">{{ q.name }}</option>
                </select></div>
              <div class="field"><label for="question_text">Fragetext</label><input id="question_text" name="question_text" type="text" :defaultValue="e.question_text || ''" :placeholder="e.name ? `Kannst du am ${e.name} teilnehmen?` : 'Kannst du teilnehmen?'"></div>
              <div class="field"><label for="help_text">Hilfetext</label><input id="help_text" name="help_text" type="text" :defaultValue="e.help_text || ''" placeholder="optional"></div>
              <p class="small muted">Bei mehreren Schichten entsteht die Schichtauswahl automatisch.</p>
            </div>
          </div>
          <div class="card">
            <div class="card-body">
              <div class="switch">
                <input type="checkbox" disabled :checked="Boolean(e.show_in_form)" aria-label="Im Formular anzeigen">
                <div><strong>Im Formular anzeigen</strong><div class="small muted">wird beim Veröffentlichen automatisch eingeschaltet<template v-if="!isNew">; umschalten in der Übersicht des Einsatzes</template></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="form-foot">
        <span class="small muted" data-dirty-hint>Änderungen werden erst mit «Speichern» übernommen.</span>
        <router-link v-if="!isNew" class="btn btn-ghost" :to="`/einsaetze/${e.id}`">Abbrechen</router-link>
        <button :class="['btn', { 'btn-primary': !draft }]" type="submit" name="action" value="save">{{ isNew ? 'Als Entwurf speichern' : 'Speichern' }}</button>
        <button v-if="draft" class="btn btn-primary" type="submit" name="action" value="publish">Veröffentlichen</button>
      </div>
    </form>
  </AppShell>
</template>
