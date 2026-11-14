<script setup>
// Karte «Funktionen» nur zum Lesen: Ist/Soll pro Schicht und Funktion, wer welche Funktion hat (wie views/event/_functions.ejs ohne editable)
import { dates, pct } from '@/lib/format.js';
defineProps({ event: Object, fnSummary: Object });
</script>
<template>
  <div id="funktionen" class="card">
    <div class="card-head">
      <h2>Funktionen <span class="hint">{{ fnSummary.multi ? 'pro Schicht' : 'Ist / Soll' }}{{ fnSummary.hasTargets ? '' : ' · noch kein Soll' }}</span></h2>
    </div>
    <div class="card-body">
      <div v-for="sh in fnSummary.shifts" :key="sh.id" class="fn-shift">
        <div v-if="fnSummary.multi" class="fn-shift-head"><strong>{{ sh.name }} <span class="muted small">{{ dates.fmtShiftWhen(sh, dates.isMultiDay(event)) || '' }}</span></strong><strong class="small">{{ sh.totalIst }} / {{ sh.totalSoll || '–' }}</strong></div>
        <div v-else-if="sh.hasTargets" class="fn-shift-head"><span class="small muted">Total</span><strong class="small">{{ sh.totalIst }} / {{ sh.totalSoll }}</strong></div>
        <div v-if="!sh.rows.length" class="small muted">Kein Soll und noch niemand zugeteilt.</div>
        <div v-for="f in sh.rows" :key="f.id" class="occ fn-occ" :data-row-id="`fn${sh.id}-${f.id}`">
          <div class="occ-head">
            <span><span :class="['fn-tag', { 'fn-default': f.is_default }]">{{ f.short }}</span> <strong>{{ f.name }}</strong>{{ f.extern ? ` · davon ${f.extern} extern` : '' }}</span>
            <strong>{{ f.ist }} / {{ f.soll ?? '–' }}{{ f.soll ? (f.over ? ` · ${f.over} zu viel` : f.missing ? ` · ${f.missing} ${f.missing === 1 ? 'fehlt' : 'fehlen'}` : ' · voll') : '' }}</strong>
          </div>
          <div :class="['bar', f.tone]"><span :style="{ width: `${pct(f.ist, f.soll)}%` }"></span></div>
          <div v-if="!f.is_default && (f.people.length || f.units.length)" class="fn-people">
            <span v-for="g in f.people" :key="g.id" class="fn-person"><span v-if="g.rank_short" class="rank">{{ g.rank_short }}</span>{{ g.first_name }} {{ g.last_name }}</span>
            <span v-for="x in f.units" :key="`u${x.id}`" class="fn-person"><span class="tag tag-blue tag-ext">extern</span> {{ x.unit_name }} · {{ x.person_count }}</span>
          </div>
          <div v-else-if="f.is_default && f.ist" class="small muted">{{ f.intern }} {{ f.intern === 1 ? 'Person' : 'Personen' }} ohne andere Funktion{{ f.extern ? ` + ${f.extern} extern` : '' }}</div>
        </div>
      </div>
      <p class="small muted mt-s">Es zählen Anmeldungen mit Status Neu, Rückfrage oder Bestätigt, die der Schicht zugeteilt sind, sowie externe Abteilungen. Die Funktion einer Person gilt für alle ihre Schichten. Wer keine Funktion hat, zählt als {{ fnSummary.def.name }}.</p>
    </div>
  </div>
</template>
