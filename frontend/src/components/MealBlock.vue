<script setup>
// Ein Block der Verpflegungsliste: Anzahl Essen (eine Spalte oder pro Schicht), Personen mit Einschränkung, externe Abteilungen
import { computed } from 'vue';
import Rank from './Rank.vue';
import { plural } from '@/lib/format.js';
const props = defineProps({ block: Object, blockTitle: String, matrix: Object, showShiftCol: Boolean, personLinks: Boolean });
const b = computed(() => props.block);
const ext = computed(() => [...b.value.extDiets, ...b.value.extNoInfo]);
const strongLabel = (l) => l !== 'ohne Einschränkung';
</script>
<template>
  <div class="card participants meals mb">
    <div class="card-head"><h2>{{ blockTitle }} <span class="hint">{{ b.total }} Essen{{ b.extTotal ? ` · ${plural(b.persons, 'Person', 'Personen')} + ${b.extTotal} extern` : '' }}</span></h2></div>
    <div class="table-wrap">
      <table class="meal-sum">
        <template v-if="matrix">
          <thead><tr><th>Essen</th><th v-for="(c, i) in matrix.cols" :key="i" class="right">{{ c.label }}<span v-if="c.when" class="sub muted">{{ c.when }}</span></th><th class="right">Ganzer Einsatz</th></tr></thead>
          <tbody>
            <tr v-for="r in matrix.rows" :key="r.label"><td><strong v-if="strongLabel(r.label)">{{ r.label }}</strong><template v-else>{{ r.label }}</template></td><td v-for="(n, i) in r.values" :key="i" class="right"><template v-if="n">{{ n }}</template><span v-else class="muted">–</span></td><td class="right"><strong>{{ r.total }}</strong></td></tr>
            <tr class="total"><td>Total Essen</td><td v-for="(n, i) in matrix.totals" :key="i" class="right">{{ n }}</td><td class="right">{{ matrix.total }}</td></tr>
          </tbody>
        </template>
        <template v-else>
          <thead><tr><th>Essen</th><th class="right">Anzahl</th></tr></thead>
          <tbody>
            <tr v-for="[l, n] in b.summary" :key="l"><td><strong v-if="strongLabel(l)">{{ l }}</strong><template v-else>{{ l }}</template></td><td class="right">{{ n }}</td></tr>
            <tr class="total"><td>Total Essen</td><td class="right">{{ b.total }}</td></tr>
          </tbody>
        </template>
      </table>
    </div>
    <div v-if="matrix && matrix.overlap" class="card-body small muted">Wer in mehreren Schichten eingeteilt ist, zählt in jeder dieser Schichten. In «Ganzer Einsatz» zählt jede Person einmal.</div>
    <div class="card-body ext-head"><strong>Personen mit Essenseinschränkungen</strong> <span class="muted small">· {{ b.people.length }}</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th class="nr"></th><th>Name</th><th>Essenseinschränkung</th><th>Details</th><th v-if="showShiftCol">Schicht</th></tr></thead>
        <tbody>
          <tr v-if="!b.people.length"><td :colspan="showShiftCol ? 5 : 4" class="empty">Keine eigenen Personen mit Essenseinschränkungen.</td></tr>
          <tr v-for="(r, i) in b.people" :key="r.id">
            <td class="nr muted">{{ i + 1 }}</td>
            <td><Rank :short="r.rank_short" /><router-link v-if="personLinks" :to="`/personen/${r.person_id}`"><strong>{{ r.first_name }} {{ r.last_name }}</strong></router-link><strong v-else>{{ r.first_name }} {{ r.last_name }}</strong></td>
            <td><strong v-if="r.diet.visible">{{ r.diet.category || 'andere' }}</strong><span v-else class="muted">Hinweis vorhanden</span></td>
            <td>{{ r.diet.text }}</td>
            <td v-if="showShiftCol">{{ r.shiftText }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="ext.length">
      <div class="card-body ext-head"><strong>Externe Abteilungen</strong> <span class="muted small">· {{ plural(b.extTotal, 'Person', 'Personen') }}, ohne Namen</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Abteilung</th><th class="right">Personen</th><th>Essenseinschränkungen</th><th v-if="showShiftCol">Schicht</th></tr></thead>
          <tbody>
            <tr v-for="x in ext" :key="x.id">
              <td><span class="tag tag-blue tag-ext">extern</span> <strong>{{ x.unit_name }}</strong></td>
              <td class="right"><strong>{{ x.person_count }}</strong></td>
              <td><span v-if="!x.dietList.length" class="muted">keine Angaben</span><template v-for="(d, i) in x.dietList" :key="i">{{ i ? ', ' : '' }}<strong>{{ d.count }}× {{ d.label }}</strong>{{ d.text ? `: ${d.text}` : '' }}</template></td>
              <td v-if="showShiftCol">{{ x.shiftText }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
