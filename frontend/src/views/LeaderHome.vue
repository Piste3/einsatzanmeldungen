<script setup>
// «Meine Einsätze» für Einsatzleiter: nur freigegebene Einsätze, nur lesen (wie views/leader/home.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';
import { labels, dates } from '@/lib/format.js';

const { data, error } = usePage(() => '/');
const ready = computed(() => Array.isArray(data.value.upcoming));
const st = (e) => labels.EVENT_STATUS[e.status] || { label: e.status, tone: 'gray' };
const blocks = computed(() => [
  { key: 'up', title: 'Anstehend', list: data.value.upcoming, empty: 'Zurzeit ist kein anstehender Einsatz für dich freigegeben.', cls: 'card mb' },
  ...(data.value.past.length ? [{ key: 'past', title: 'Vergangen', list: data.value.past, empty: '', cls: 'card' }] : []),
]);
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Meine Einsätze" :show-search="false">
      <template #subline>Einsätze, die die Aufgebotsstelle für dich freigegeben hat. Nur lesen – Änderungen macht die Aufgebotsstelle.</template>
    </Topbar>
    <div v-for="b in blocks" :key="b.key" :class="b.cls">
      <div class="card-head"><h2>{{ b.title }}</h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Datum</th><th>Einsatz</th><th>Antreten</th><th>Status</th><th class="center">Angemeldet</th><th class="center">Bestätigt</th><th></th></tr></thead>
          <tbody>
            <tr v-if="!b.list.length"><td colspan="7" class="empty">{{ b.empty }}</td></tr>
            <tr v-for="e in b.list" :key="e.id" :data-row-id="`ev${e.id}`">
              <td class="nowrap">{{ dates.fmtEventDate(e, 'wd') }}</td>
              <td><router-link :to="`/einsaetze/${e.id}`"><strong>{{ e.name }}</strong></router-link></td>
              <td>{{ [e.start_time, e.start_place].filter(Boolean).join(' · ') || '–' }}</td>
              <td><Badge :text="st(e).label" :tone="st(e).tone" /></td>
              <td class="center">{{ e.angemeldet || '–' }}</td>
              <td class="center">{{ e.bestaetigt || '–' }}</td>
              <td class="nowrap right"><a class="btn btn-sm" :href="apiUrl(`/einsaetze/${e.id}/teilnehmerliste`, {}, { format: 'pdf' })" target="_blank" rel="noopener">Teilnehmerliste</a> <a class="btn btn-sm" :href="apiUrl(`/einsaetze/${e.id}/verpflegungsliste`, {}, { format: 'pdf' })" target="_blank" rel="noopener">Verpflegung</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppShell>
</template>
