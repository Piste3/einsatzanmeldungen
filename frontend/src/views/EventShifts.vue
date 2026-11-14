<script setup>
// Reiter «Schichten» eines Einsatzes (wie views/event/schichten.ejs)
import { computed, ref, reactive, watch } from 'vue';
import EventShell from '@/components/EventShell.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import TeamPick from '@/components/TeamPick.vue';
import SearchSelect from '@/components/SearchSelect.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection } from '@/lib/section.js';
import { flash } from '@/lib/api.js';
import { labels, dates, pct, plural } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const ev = computed(() => data.value.event);
const multi = computed(() => ev.value.shifts.length > 1);
const multiDay = computed(() => dates.isMultiDay(ev.value));
const closed = computed(() => ev.value.status === 'abgeschlossen');
const fullName = (r) => `${r.rank_short ? `${r.rank_short} ` : ''}${r.first_name} ${r.last_name}`;
const overlapNames = computed(() => new Set((data.value.overlaps || []).map((o) => o.person)));
const notPlanned = (r, col) => Boolean(data.value.notPlannedMap?.[`${r.id}:${col.id}`]);
const current = (r) => r.assigned.map((a) => a.id).join(',');
const fnRows = (col) => {
  const fx = data.value.fnSummary.shifts.find((x) => x.id === col.id);
  return fx && fx.rows.some((r) => r.soll || (!r.is_default && r.ist)) ? fx.rows.filter((r) => r.soll || r.ist) : null;
};
const fnTitle = (f) => `${f.name}: ${f.ist} / ${f.soll ?? '–'}${f.soll ? (f.over ? ` · ${f.over} zu viel` : f.missing ? ` · ${f.missing} ${f.missing === 1 ? 'fehlt' : 'fehlen'}` : ' · voll') : ''}`;
const addable = (col) => {
  const ids = new Set(col.regs.map((r) => r.id));
  return data.value.regs.filter((r) => !ids.has(r.id)).map((r) => ({ value: r.id, text: `${r.last_name} ${r.first_name} (${labels.REG_STATUS[r.status].short}${notPlanned(r, col) ? ', nicht vorgesehen' : ''})` }));
};

// Zuteilen, umteilen, hinzufügen
async function setShifts(r, value) {
  const res = await runAction(`/anmeldungen/${r.id}/schichten`, { shift_ids: value }, { onDone: refresh });
  if (res && res.ok) flash('success', 'Schichtzuteilung gespeichert.');
}
async function addToShift(col, regId) {
  if (!regId) return;
  const res = await runAction(`/anmeldungen/${regId}/schichten`, { add_shift: col.id }, { onDone: refresh });
  if (res && res.ok) flash('success', 'Schichtzuteilung gespeichert.');
}
const setFunction = (r, id) => runAction(`/anmeldungen/${r.id}/funktion`, { function_id: id }, { onDone: refresh });

// Tabelle «Schichten bearbeiten»: ein Speichern für alle Zeilen
const form = ref(null);
const { dirty } = useSection(form, data);
const sums = reactive({});
watch(data, () => { for (const k of Object.keys(sums)) delete sums[k]; });
const newNameRequired = ref(false);
function sollInput(ev) {
  const row = ev.target.closest('[data-soll-row]');
  if (!row) return;
  const parts = [...row.querySelectorAll('[data-soll-part]')].map((i) => Number(i.value) || 0);
  sums[row.dataset.key] = parts.some(Boolean) ? parts.reduce((a, n) => a + n, 0) : (row.dataset.key === '__neu' ? '' : '–');
  if (row.dataset.key === '__neu') {
    const name = row.querySelector('input[name="name__neu"]');
    newNameRequired.value = [...row.querySelectorAll('input')].some((i) => i !== name && i.type !== 'date' && i.type !== 'hidden' && i.type !== 'checkbox' && i.value.trim());
  }
}
const newRow = ref(0); // neue Zeile nach dem Speichern leeren (neu aufbauen)
async function save() {
  const body = formBody(form.value);
  const res = await runAction(`/einsaetze/${data.value.event.id}/schichten/speichern`, body, { event: data.value.event, onDone: refresh });
  if (res) { newNameRequired.value = false; newRow.value += 1; delete sums.__neu; }
}
function addShift(ev) {
  newNameRequired.value = true;
  // Pflichtfeld erst nach dem Setzen prüfen lassen
  setTimeout(() => { if (form.value.reportValidity()) save(); });
  ev.preventDefault();
}
const removeShift = (s) => runAction(`/schichten/${s.id}/loeschen`, {}, { confirm: `Schicht «${s.name}» löschen? Zuteilungen gehen verloren.`, event: data.value.event, onDone: refresh });
</script>

<template>
  <div v-if="error && !ev" class="flash flash-error">{{ error.message }}</div>
  <EventShell v-if="ev" :data="data" tab="schichten">
    <div v-for="(o, i) in data.overlaps" :key="i" class="hint-bar"><span class="tag tag-yellow">Hinweis</span><span><strong>{{ o.person }}</strong> ist beiden Schichten zugeteilt ({{ o.shifts.join(', ') }}) – die Schichten überschneiden sich von {{ o.from }} bis {{ o.to }}.</span></div>
    <div v-if="!ev.date_from" class="callout mb">Dieser Einsatz hat noch kein Datum. Trage unten bei jeder Schicht ihren Tag ein. In der untersten Zeile kommt eine weitere Schicht dazu, auch an einem anderen Tag.</div>
    <div v-else-if="!multi" class="callout mb">Dieser Einsatz hat eine Schicht. Jede Anmeldung gilt automatisch für diese Schicht – es gibt nichts zu verteilen.</div>
    <div v-if="multi && data.unassigned.length" class="card mb">
      <div class="card-head"><h2>Noch keiner Schicht zugeteilt <span class="hint">{{ data.unassigned.length }} Anmeldungen</span></h2></div>
      <div v-for="r in data.unassigned" :key="r.id" class="shift-row">
        <span class="name"><Rank :short="r.rank_short" /><router-link :to="`/personen/${r.person_id}`">{{ r.first_name }} {{ r.last_name }}</router-link><template v-if="!r.func.is_default">{{ ' ' }}<span class="fn-tag" :title="r.func.name">{{ r.func.short }}</span></template></span>
        <Badge :text="labels.REG_STATUS[r.status].label" :tone="labels.REG_STATUS[r.status].tone" />
        <form @submit.prevent>{{ ' ' }}<select aria-label="Schicht zuteilen" @change="setShifts(r, $event.target.value)"><option value="">zuteilen …</option><option v-for="c in data.combos" :key="c.value" :value="c.value">{{ c.label }}</option></select></form>
      </div>
    </div>
    <div id="funktionen" class="shift-cols">
      <div v-for="col in data.columns" :key="col.id" class="card">
        <div class="card-head">
          <div><h2>{{ col.name }}</h2><span class="small muted">{{ dates.fmtShiftWhen(col, multiDay) || 'Zeit offen' }}{{ col.start_place ? ` · ${col.start_place}` : '' }}</span><template v-if="col.rule">{{ ' ' }}<span class="tag tag-blue team-tag" title="Einschränkung der Schicht. Andere Personen können sich trotzdem anmelden.">nur {{ col.rule }}</span></template></div>
          <div class="occ"><div class="occ-head"><span>Besetzung{{ col.extern ? ` · davon ${col.extern} extern` : '' }}</span><strong>{{ col.ist }} / {{ col.soll ?? '–' }}{{ col.soll ? (col.ist >= col.soll ? ' · voll' : ` · ${col.missing} fehlen`) : '' }}</strong></div><div :class="['bar', col.tone]"><span :style="{ width: `${pct(col.ist, col.soll)}%` }"></span></div></div>
          <div v-if="fnRows(col)" class="fn-line small fn-line-shift"><span v-for="f in fnRows(col)" :key="f.id" :class="['fn-chip', `tone-${f.tone}`]" :title="fnTitle(f)"><span :class="['fn-tag', { 'fn-default': f.is_default }]">{{ f.short }}</span> {{ f.ist }}/{{ f.soll ?? '–' }}</span></div>
        </div>
        <div v-if="!col.regs.length && !col.exts.length" class="empty">Noch niemand zugeteilt.</div>
        <div v-for="r in col.regs" :key="r.id" :class="['shift-row', { overlap: overlapNames.has(fullName(r)) }]" :data-row-id="`s${col.id}-${r.id}-${r.func.id}`">
          <span class="name"><Rank :short="r.rank_short" /><router-link :to="`/personen/${r.person_id}`">{{ r.first_name }} {{ r.last_name }}</router-link><template v-if="notPlanned(r, col)">{{ ' ' }}<span class="tag tag-gray tag-np" :title="`${r.teams ? `Mannschaft: ${r.teams}` : 'Keine Mannschaft'} · vorgesehen: ${col.rule}`">nicht vorgesehen</span></template></span>
          <Badge :text="labels.REG_STATUS[r.status].short" :tone="labels.REG_STATUS[r.status].tone" />
          <form class="fn-select" @submit.prevent>
            <select :value="r.func.id" :aria-label="`Funktion von ${r.first_name} ${r.last_name}`" title="Funktion (gilt für alle Schichten der Person)" :class="{ 'fn-is-default': r.func.is_default }" @change="setFunction(r, $event.target.value)">
              <option v-for="fo in data.functionOptions" :key="fo.id" :value="fo.id" :title="fo.name">{{ fo.short }}</option>
              <option v-if="!data.functionOptions.some((fo) => fo.id === r.func.id)" :value="r.func.id">{{ r.func.short }}</option>
            </select></form>
          <form v-if="multi" @submit.prevent>
            <select :value="current(r)" aria-label="Umteilen" @change="setShifts(r, $event.target.value)">
              <option v-for="c in data.combos" :key="c.value" :value="c.value">{{ c.label }}</option>
              <option v-if="!data.combos.some((c) => c.value === current(r))" :value="current(r)">{{ r.assigned.map((a) => a.name).join(' + ') }}</option>
              <option value="">aus allen Schichten entfernen</option>
            </select></form>
        </div>
        <div v-for="x in col.exts" :key="x.id" class="shift-row ext" :data-row-id="`x${col.id}-${x.id}`">
          <span class="name"><router-link :to="`/einsaetze/${ev.id}#externe`"><strong>{{ x.unit_name }}</strong></router-link><template v-if="!x.func.is_default">{{ ' ' }}<span class="fn-tag" :title="x.func.name">{{ x.func.short }}</span></template>{{ x.contact ? ` · ${x.contact}` : '' }}</span>
          <span class="tag tag-blue tag-ext">extern · {{ plural(x.person_count, 'Person', 'Personen') }}</span>
        </div>
        <form v-if="multi && addable(col).length" class="card-body row" @submit.prevent>
          <SearchSelect :model-value="''" :options="addable(col)" placeholder="+ Person aus Anmeldungen hinzufügen" aria-label="Person aus Anmeldungen hinzufügen" @change="addToShift(col, $event)" />
        </form>
      </div>
    </div>

    <p class="small muted mt-s">Die Funktion ({{ data.functionOptions.map((fo) => fo.short).join(', ') }}) wählst du direkt in der Zeile. Sie gilt für alle Schichten der Person. Es zählen Anmeldungen mit Status Neu, Rückfrage oder Bestätigt sowie <router-link class="link" :to="`/einsaetze/${ev.id}#externe`">externe Abteilungen</router-link>. Wer keine Funktion hat, zählt als {{ data.fnSummary.def.name }}.</p>

    <details id="schichten-bearbeiten" class="card mt no-print shifts-fold" data-remember="schichten-bearbeiten" :open="!ev.date_from">
      <summary class="card-head"><h2>Schichten bearbeiten <span class="hint">Name, Tag, Zeit, Soll pro Funktion, Mannschaften, Alter und Rang</span></h2><span class="btn btn-sm">Öffnen</span></summary>
      <form id="shifts-form" ref="form" @submit.prevent="save" @input="sollInput">
        <div class="table-wrap">
          <table class="form-table">
            <thead><tr><th>Name</th><th>Datum</th><th>Beginn</th><th>Ende</th><th v-for="fo in data.fnCols" :key="fo.id" class="fn-col" :title="`Soll ${fo.name}`"><span :class="['fn-tag', { 'fn-default': fo.is_default }]">{{ fo.short }}</span></th><th class="fn-col" title="Summe der Funktionen">Soll</th><th title="Für welche Mannschaften die Schicht gedacht ist. Leer = alle.">Mannschaften</th><th title="Mindestalter am Tag der Schicht. Alle = keine Grenze.">Alter</th><th title="Mindestrang, z. B. ab KS (Kaderschüler). Alle = keine Grenze.">Rang</th><th title="Leer = Antretensort des Einsatzes">Antretensort</th><th class="th-wrap">Interne Bemerkung</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in ev.shifts" :key="s.id" data-soll-row :data-key="`__${s.id}`">
                <td><input type="text" :name="`name__${s.id}`" :defaultValue="s.name" required aria-label="Name"></td>
                <td><input type="date" :name="`date__${s.id}`" :defaultValue="(s.starts_at || ev.date || '').slice(0, 10)" aria-label="Datum"></td>
                <td><input type="time" :name="`start__${s.id}`" :defaultValue="s.starts_at ? s.starts_at.slice(11, 16) : ''" aria-label="Beginn"></td>
                <td><input type="time" :name="`end__${s.id}`" :defaultValue="s.ends_at ? s.ends_at.slice(11, 16) : ''" aria-label="Ende"></td>
                <td v-for="fo in data.fnCols" :key="fo.id" class="fn-col"><input type="number" min="0" max="9999" :name="`fn_target_${fo.id}__${s.id}`" :defaultValue="s.targets[fo.id] ?? ''" placeholder="–" :aria-label="`Soll ${fo.short}`" data-soll-part></td>
                <td class="fn-col"><strong>{{ sums[`__${s.id}`] ?? (s.target_count ?? '–') }}</strong></td>
                <td><TeamPick :field-key="`__${s.id}`" :selected="s.teams" :teams="data.teamList" :label="`Mannschaften für ${s.name}`" /></td>
                <td><select :name="`min_age__${s.id}`" :aria-label="`Mindestalter für ${s.name}`" class="age-pick"><option value="" :defaultSelected="!s.min_age">alle</option><option value="16" :defaultSelected="s.min_age === 16">16+</option><option value="18" :defaultSelected="s.min_age === 18">18+</option></select></td>
                <td><select :name="`min_rank_id__${s.id}`" :aria-label="`Mindestrang für ${s.name}`" class="age-pick" title="Mindestrang: dieser Rang und höher"><option value="" :defaultSelected="!s.min_rank_id">alle</option><option v-for="rk in data.rankList.filter((x) => x.active || x.id === s.min_rank_id)" :key="rk.id" :value="String(rk.id)" :defaultSelected="rk.id === s.min_rank_id" :title="rk.name">ab {{ rk.short }}</option></select></td>
                <td><input type="text" :name="`start_place__${s.id}`" :defaultValue="s.start_place || ''" placeholder="wie Einsatz" aria-label="Antretensort"></td>
                <td><input type="text" :name="`internal_note__${s.id}`" :defaultValue="s.internal_note || ''" aria-label="Interne Bemerkung"></td>
                <td class="nowrap"><button v-if="multi" class="btn btn-sm btn-ghost btn-danger" type="button" @click="removeShift(s)">Löschen</button></td>
              </tr>
              <tr :key="`neu${newRow}`" class="new-row" data-soll-row data-key="__neu">
                <td><input type="text" name="name__neu" placeholder="+ Neue Schicht" aria-label="Name der neuen Schicht" :required="newNameRequired"></td>
                <td><input type="date" name="date__neu" :defaultValue="ev.date || ev.date_to || ''" aria-label="Datum der neuen Schicht"></td>
                <td><input type="time" name="start__neu" aria-label="Beginn der neuen Schicht"></td>
                <td><input type="time" name="end__neu" aria-label="Ende der neuen Schicht"></td>
                <td v-for="fo in data.fnCols" :key="fo.id" class="fn-col"><input type="number" min="0" max="9999" :name="`fn_target_${fo.id}__neu`" placeholder="–" :aria-label="`Soll ${fo.short}`" data-soll-part></td>
                <td class="fn-col"><strong>{{ sums.__neu ?? '' }}</strong></td>
                <td><TeamPick field-key="__neu" :selected="[]" :teams="data.teamList" label="Mannschaften für die neue Schicht" /></td>
                <td><select name="min_age__neu" aria-label="Mindestalter für die neue Schicht" class="age-pick"><option value="">alle</option><option value="16">16+</option><option value="18">18+</option></select></td>
                <td><select name="min_rank_id__neu" aria-label="Mindestrang für die neue Schicht" class="age-pick" title="Mindestrang: dieser Rang und höher"><option value="">alle</option><option v-for="rk in data.rankList.filter((x) => x.active)" :key="rk.id" :value="String(rk.id)" :title="rk.name">ab {{ rk.short }}</option></select></td>
                <td><input type="text" name="start_place__neu" placeholder="wie Einsatz" aria-label="Antretensort der neuen Schicht"></td>
                <td><input type="text" name="internal_note__neu" aria-label="Interne Bemerkung der neuen Schicht"></td>
                <td class="nowrap"><button class="btn btn-sm" type="submit" title="Neue Schicht hinzufügen und alle Änderungen speichern" @click="addShift">Hinzufügen</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="closed" class="card-body small muted">Abgeschlossen: Änderungen nur durch Admins mit Begründung (wird beim Speichern abgefragt).</div>
        <div class="section-foot">
          <span class="small muted" data-dirty-hint>{{ dirty ? 'Ungespeicherte Änderungen in diesem Abschnitt' : 'Das Soll der Schicht ist die Summe der Funktionen. Mannschaften, Alter und Rang: leer = alle; andere können sich trotzdem anmelden. Mehrere Schichten ändern, dann einmal speichern. Neue Schicht: unterste Zeile ausfüllen.' }}</span>
          <button class="btn btn-primary btn-sm" type="submit">Speichern</button>
        </div>
      </form>
    </details>
  </EventShell>
</template>
