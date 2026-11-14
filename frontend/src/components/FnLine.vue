<script setup>
// Raster «Funktionen Ist/Soll»: eine Spalte pro Schicht, eine Zeile pro Funktion
defineProps({ fnSummary: Object });
const title = (r, c) => `${r.name}: ${c.ist} / ${c.soll ?? '–'}${c.soll ? (c.over ? ` · ${c.over} zu viel` : c.missing ? ` · ${c.missing} ${c.missing === 1 ? 'fehlt' : 'fehlen'}` : ' · voll') : ''}`;
</script>
<template>
  <span v-if="!fnSummary.grid.rows.length" class="muted">Noch keine Funktionen eingeteilt.</span>
  <div v-else class="table-wrap fn-matrix-wrap">
    <table class="fn-matrix no-cards">
      <thead v-if="fnSummary.multi"><tr><th class="fn-matrix-label">Funktion</th><th v-for="sh in fnSummary.grid.shifts" :key="sh.id || sh.name">{{ sh.name }}</th></tr></thead>
      <tbody>
        <tr v-for="r in fnSummary.grid.rows" :key="r.id">
          <th scope="row" class="fn-matrix-label"><span :class="['fn-tag', { 'fn-default': r.is_default }]">{{ r.short }}</span> <span class="fn-matrix-name">{{ r.name }}</span></th>
          <template v-for="(c, i) in r.cells" :key="i">
            <td v-if="!c || (!c.soll && !c.ist)" class="muted">–</td>
            <td v-else :class="['fn-chip', `tone-${c.tone}`]" :title="title(r, c)">{{ c.ist }} / {{ c.soll ?? '–' }}</td>
          </template>
        </tr>
        <tr v-if="fnSummary.grid.showTotal" class="fn-matrix-total"><th scope="row" class="fn-matrix-label">Total</th><td v-for="sh in fnSummary.grid.shifts" :key="sh.id || sh.name">{{ sh.totalIst }} / {{ sh.totalSoll || '–' }}</td></tr>
      </tbody>
    </table>
  </div>
</template>
