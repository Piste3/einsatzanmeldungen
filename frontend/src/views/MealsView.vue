<script setup>
// Verpflegungsliste: Anzahl Essen und Essenseinschränkungen (wie views/pages/meals.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import ListFilters from '@/components/ListFilters.vue';
import ListSubline from '@/components/ListSubline.vue';
import MealBlock from '@/components/MealBlock.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';
import { dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath);
const e = computed(() => data.value.event);
const base = computed(() => `/einsaetze/${e.value.id}/verpflegungsliste`);
const q = computed(() => {
  const f = data.value.filters;
  return { umfang: f.umfang !== 'angemeldet' ? f.umfang : undefined, schicht: f.schicht || undefined, sort: f.sort !== 'rang' ? f.sort : undefined };
});
const exportUrl = (format) => apiUrl(base.value, q.value, { format });
const leaderView = computed(() => Boolean(data.value.leaderView));
const tnUrl = computed(() => ({ path: leaderView.value ? `/einsaetze/${e.value.id}` : `/einsaetze/${e.value.id}/teilnehmerliste`, query: q.value }));
const crumbs = computed(() => (leaderView.value ? [['Meine Einsätze', '/'], [e.value.name, `/einsaetze/${e.value.id}`], ['Verpflegungsliste']] : [['Einsätze', '/einsaetze'], [e.value.name, `/einsaetze/${e.value.id}`], ['Verpflegungsliste']]));
const heading = computed(() => `Verpflegungsliste${data.value.shift ? ` · ${data.value.shift.name}` : data.value.perShift ? ' pro Schicht' : ''}`);
const hint = computed(() => data.value.all.summary.some(([l]) => l === 'Hinweis vorhanden'));
const allTitle = computed(() => {
  const s = data.value.shift;
  if (!s) return 'Ganzer Einsatz';
  const when = dates.fmtShiftWhen(s, dates.isMultiDay(e.value));
  return when ? `${s.name} · ${when}` : s.name;
});
const stand = dates.fmtDateTime(dates.nowIso());
</script>

<template>
  <div v-if="error && !e" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="e">
    <Topbar :crumbs="crumbs" :heading="heading" :show-search="false">
      <template #subline><ListSubline :e="e" /></template>
      <template #actions><a class="btn btn-primary" :href="exportUrl('pdf')" target="_blank" rel="noopener">PDF öffnen</a><a class="btn" :href="exportUrl('xlsx')">Excel</a><a class="btn" :href="exportUrl('csv')">CSV</a><router-link class="btn" :to="tnUrl">Teilnehmerliste</router-link></template>
    </Topbar>
    <ListFilters :scopes="data.scopes" :event="e" :filters="data.filters" />
    <div v-if="data.unresolved && !leaderView" class="callout warn mb no-print">{{ data.unresolved === 1 ? '1 Anmeldung ist noch keiner Person zugeordnet und fehlt' : `${data.unresolved} Anmeldungen sind noch keiner Person zugeordnet und fehlen` }} deshalb in der Liste. → <router-link class="link" to="/klaerungen">Klärungen</router-link></div>
    <template v-if="data.groups">
      <MealBlock v-for="(g, i) in data.groups" :key="i" :block="g" :block-title="g.title" :matrix="null" :show-shift-col="false" :person-links="!leaderView" />
    </template>
    <MealBlock v-else :block="data.all" :block-title="allTitle" :matrix="data.matrix" :show-shift-col="data.showShift" :person-links="!leaderView" />
    <p class="small muted">Gezählt: {{ data.scopes[data.filters.umfang].label }}. Stand {{ stand }}.<template v-if="hint"> «Hinweis vorhanden»: Nach dem Einsatz sieht die genaue Angabe nur noch ein Admin.</template></p>
  </AppShell>
</template>
