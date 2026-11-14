<script setup>
// Teilnehmertabelle mit Verpflegungs-Zusammenfassung (Teilnehmerliste und Einsatzleiter-Ansicht)
import { computed } from 'vue';
import FnLine from './FnLine.vue';
import Rank from './Rank.vue';
import Badge from './Badge.vue';
import { dates, plural, regState } from '@/lib/format.js';

const props = defineProps({
  groupTitle: { type: String, default: '' }, list: Array, exts: Array, extTotal: Number, fnSummary: Object, showFunction: Boolean, summary: Array,
  showShift: Boolean, showStatus: Boolean, personLinks: Boolean, filters: Object, scopes: Object,
});
const cols = computed(() => 4 + (props.showFunction ? 1 : 0) + (props.showShift ? 1 : 0) + (props.showStatus ? 1 : 0));
const people = computed(() => `${props.list.length} ${props.list.length === 1 ? 'Person' : 'Personen'}${props.extTotal ? ` + ${props.extTotal} extern` : ''}`);
const stand = dates.fmtDateTime(dates.nowIso());
</script>
<template>
  <div :class="['card', 'participants', { mb: groupTitle }]">
    <div class="card-head"><h2><template v-if="groupTitle">{{ groupTitle }} <span class="hint">{{ people }}</span></template><template v-else>{{ people }} <span class="hint">{{ scopes[filters.umfang].label }} · Stand {{ stand }}</span></template></h2></div>
    <div v-if="showFunction" class="card-body fn-panel">
      <div class="fn-panel-head"><span>Funktionen Ist/Soll</span></div>
      <FnLine :fn-summary="fnSummary" />
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th class="nr"></th><th v-if="showFunction">Funktion</th><th>Name</th><th>Mobil</th><th>Essenseinschränkungen</th><th v-if="showShift">Schicht</th><th v-if="showStatus">Status</th></tr></thead>
        <tbody>
          <tr v-if="!list.length"><td :colspan="cols" class="empty">{{ groupTitle ? 'Niemand eingeteilt' : 'Noch niemand angemeldet' }}{{ filters.umfang === 'bestaetigt' ? ' und bestätigt' : '' }}.</td></tr>
          <tr v-for="(r, i) in list" :key="r.id">
            <td class="nr muted">{{ i + 1 }}</td>
            <td v-if="showFunction"><span :class="['fn-tag', { 'fn-default': r.func.is_default }]" :title="r.func.name">{{ r.func.short }}</span></td>
            <td><Rank :short="r.rank_short" /><router-link v-if="personLinks" :to="`/personen/${r.person_id}`"><strong>{{ r.first_name }} {{ r.last_name }}</strong></router-link><strong v-else>{{ r.first_name }} {{ r.last_name }}</strong></td>
            <td class="nowrap"><a v-if="r.mobile" :href="`tel:${r.mobile.replace(/[^\d+]/g, '')}`">{{ r.mobile }}</a><span v-else class="muted">–</span></td>
            <td><span v-if="!r.diet.has" class="muted">–</span><span v-else-if="!r.diet.visible" class="muted">Hinweis vorhanden</span><template v-else><strong>{{ r.diet.category }}</strong>{{ r.diet.category && r.diet.text ? ': ' : '' }}{{ r.diet.text }}</template></td>
            <td v-if="showShift">{{ r.shiftText }}</td>
            <td v-if="showStatus"><Badge v-bind="regState(r.status)" /></td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="exts.length">
      <div class="card-body ext-head"><strong>Externe Abteilungen</strong> <span class="muted small">· {{ plural(extTotal, 'Person', 'Personen') }}, ohne Namen</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Abteilung</th><th class="right">Personen</th><th v-if="showFunction">Funktion</th><th v-if="showShift">Schicht</th><th>Essenseinschränkungen</th><th>Kontakt</th><th>Bemerkung</th></tr></thead>
          <tbody>
            <tr v-for="x in exts" :key="x.id">
              <td><span class="tag tag-blue tag-ext">extern</span> <strong>{{ x.unit_name }}</strong></td>
              <td class="right"><strong>{{ x.person_count }}</strong></td>
              <td v-if="showFunction"><span :class="['fn-tag', { 'fn-default': x.func.is_default }]" :title="x.func.name">{{ x.func.short }}</span></td>
              <td v-if="showShift">{{ x.shiftText }}</td>
              <td><span v-if="!x.dietList.length" class="muted">–</span><template v-for="(d, i) in x.dietList" :key="i">{{ i ? ', ' : '' }}<strong>{{ d.count }}× {{ d.label }}</strong>{{ d.text ? `: ${d.text}` : '' }}</template></td>
              <td>{{ x.contact || '–' }}</td>
              <td>{{ x.note || '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <div v-if="list.length || extTotal" class="card-body diet-summary">
      <strong>Verpflegung:</strong>
      {{ summary.map(([label, n]) => `${n} ${label}`).join(' · ') }}
      <span v-if="summary.some(([l]) => l === 'Hinweis vorhanden')" class="sub muted small">«Hinweis vorhanden»: Nach dem Einsatz sieht die genaue Angabe nur noch ein Admin.</span>
    </div>
  </div>
</template>
