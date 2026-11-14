<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import OccBar from '@/components/OccBar.vue';
import { usePage } from '@/lib/usePage.js';
import { useFilters, apiUrl } from '@/lib/useFilters.js';
import { fmtEventDate, labels, eventState } from '@/lib/format.js';

const route = useRoute();
const { data, loading, error } = usePage((r) => r.fullPath);
const { f, apply, typed } = useFilters({ status: 'aktiv', from: '', to: '', q: '' }, () => data.value.filters);
const list = computed(() => data.value.list || []);
const filtered = computed(() => f.from || f.to || f.q || f.status !== 'aktiv');
const leader = (e) => (e.leader_last ? `${e.leader_rank || ''} ${e.leader_first} ${e.leader_last}`.trim() : '–');
</script>

<template>
  <AppShell>
    <Topbar heading="Einsätze">
      <template #actions>
        <a class="btn" :href="apiUrl('/einsaetze', route.query, { format: 'xlsx' })">Excel</a><a class="btn" :href="apiUrl('/einsaetze', route.query, { format: 'csv' })">CSV</a><router-link class="btn btn-primary" to="/einsaetze/neu">+ Neuer Einsatz</router-link>
      </template>
    </Topbar>
    <form class="filters" @submit.prevent>
      <select v-model="f.status" name="status" @change="apply()">
        <option value="aktiv">Entwürfe und veröffentlichte</option>
        <option value="">Alle Status</option>
        <option v-for="(v, k) in labels.EVENT_STATUS" :key="k" :value="k">{{ v.label }}</option>
      </select>
      <label class="row small muted">von <input v-model="f.from" type="date" name="from" @change="apply()"></label>
      <label class="row small muted">bis <input v-model="f.to" type="date" name="to" @change="apply()"></label>
      <input v-model="f.q" type="search" name="q" placeholder="Name filtern" @input="typed()">
      <router-link v-if="filtered" class="btn btn-sm btn-ghost" to="/einsaetze?filter=zuruecksetzen" title="Alle Filter auf den Standard zurücksetzen">Filter zurücksetzen</router-link>
    </form>
    <div v-if="error" class="flash flash-error">{{ error.message }}</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Datum</th><th>Einsatz</th><th>Antreten</th><th>Status</th><th>Besetzung</th><th class="center">Neu</th><th class="center">Bestätigt</th><th>Einsatzleitung</th></tr></thead>
          <tbody>
            <tr v-if="!loading && !list.length"><td colspan="8" class="empty">Keine Einsätze gefunden.</td></tr>
            <tr v-for="e in list" :key="e.id">
              <td class="nowrap">{{ fmtEventDate(e, 'wd') }}</td>
              <td><router-link :to="`/einsaetze/${e.id}`"><strong>{{ e.name }}</strong></router-link></td>
              <td>{{ [e.start_time, e.start_place].filter(Boolean).join(' · ') || '–' }}</td>
              <td><Badge v-bind="eventState(e)" /></td>
              <td><OccBar v-for="s in e.stats.shifts" :key="s.id || s.name" :s="s" /></td>
              <td class="center">{{ e.stats.neu || '–' }}</td>
              <td class="center">{{ e.stats.bestaetigt || '–' }}</td>
              <td>{{ leader(e) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppShell>
</template>
