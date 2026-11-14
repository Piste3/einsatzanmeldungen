<script setup>
// Teilnehmerliste: wer kommt, mit Mobil und Essenseinschränkungen (wie views/pages/participants.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import ListFilters from '@/components/ListFilters.vue';
import ListSubline from '@/components/ListSubline.vue';
import ParticipantsTable from '@/components/ParticipantsTable.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';

const { data, error } = usePage((r) => r.fullPath);
const e = computed(() => data.value.event);
const base = computed(() => `/einsaetze/${e.value.id}/teilnehmerliste`);
const q = computed(() => {
  const f = data.value.filters;
  return { umfang: f.umfang !== 'angemeldet' ? f.umfang : undefined, schicht: f.schicht || undefined, sort: f.sort !== 'rang' ? f.sort : undefined };
});
const exportUrl = (format) => apiUrl(base.value, q.value, { format });
const heading = computed(() => `Teilnehmerliste${data.value.shift ? ` · ${data.value.shift.name}` : data.value.perShift ? ' pro Schicht' : ''}`);
const common = computed(() => ({ filters: data.value.filters, scopes: data.value.scopes, showShift: data.value.showShift, showStatus: data.value.showStatus, personLinks: true }));
</script>

<template>
  <div v-if="error && !e" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="e">
    <Topbar :crumbs="[['Einsätze', '/einsaetze'], [e.name, `/einsaetze/${e.id}`], ['Teilnehmerliste']]" :heading="heading" :show-search="false">
      <template #subline><ListSubline :e="e" /></template>
      <template #actions><a class="btn btn-primary" :href="exportUrl('pdf')" target="_blank" rel="noopener">PDF öffnen</a><a class="btn" :href="exportUrl('xlsx')">Excel</a><a class="btn" :href="exportUrl('csv')">CSV</a><router-link class="btn" :to="{ path: `/einsaetze/${e.id}/verpflegungsliste`, query: q }">Verpflegungsliste</router-link></template>
    </Topbar>
    <ListFilters :scopes="data.scopes" :event="e" :filters="data.filters" />
    <div v-if="data.unresolved" class="callout warn mb no-print">{{ data.unresolved === 1 ? '1 Anmeldung ist noch keiner Person zugeordnet und fehlt' : `${data.unresolved} Anmeldungen sind noch keiner Person zugeordnet und fehlen` }} deshalb in der Liste. → <router-link class="link" to="/klaerungen">Klärungen</router-link></div>
    <template v-if="data.groups">
      <ParticipantsTable v-for="(g, i) in data.groups" :key="i" v-bind="common" :group-title="g.title" :list="g.list" :exts="g.exts" :ext-total="g.extTotal" :fn-summary="g.fnSummary" :show-function="data.showFunction && Boolean(g.fnSummary)" :summary="g.summary" />
    </template>
    <ParticipantsTable v-else v-bind="common" :list="data.list" :exts="data.exts" :ext-total="data.extTotal" :fn-summary="data.fnSummary" :show-function="data.showFunction" :summary="data.summary" />
  </AppShell>
</template>
