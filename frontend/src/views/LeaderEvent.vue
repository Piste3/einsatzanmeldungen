<script setup>
// Einsatz für Einsatzleiter: Angaben, Schichten und Teilnehmer, nur lesen (wie views/leader/event.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import ListFilters from '@/components/ListFilters.vue';
import ParticipantsTable from '@/components/ParticipantsTable.vue';
import FunctionsCard from '@/components/FunctionsCard.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';
import { labels, dates, pct } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath);
const e = computed(() => data.value.event);
const ready = computed(() => Boolean(e.value && data.value.filters));
const base = computed(() => `/einsaetze/${e.value.id}`);
const st = computed(() => labels.EVENT_STATUS[e.value.status] || { label: e.value.status, tone: 'gray' });
const q = computed(() => {
  const f = data.value.filters;
  return { umfang: f.umfang !== 'angemeldet' ? f.umfang : undefined, schicht: f.schicht || undefined, sort: f.sort !== 'rang' ? f.sort : undefined };
});
const exportUrl = (format) => apiUrl(`${base.value}/teilnehmerliste`, q.value, { format });
const leaderLine = computed(() => (e.value.leader_last ? `${`${e.value.leader_rank || ''} ${e.value.leader_first} ${e.value.leader_last}`.trim()}${e.value.leader_mobile ? ` (${e.value.leader_mobile})` : ''}` : '–'));
const common = computed(() => ({ filters: data.value.filters, scopes: data.value.scopes, showShift: data.value.showShift, showStatus: data.value.showStatus, personLinks: false }));
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar :crumbs="[['Meine Einsätze', '/'], [e.name]]" :heading="e.name" :show-search="false">
      <template #badges><Badge :text="st.label" :tone="st.tone" /></template>
      <template #subline><strong>{{ dates.fmtEventDate(e, 'wd') }}</strong><span>Antreten {{ e.start_time || '–' }}{{ e.start_place ? ` · ${e.start_place}` : '' }}</span><span>Leitung <template v-if="e.leader_person_id"><span v-if="e.leader_rank" class="rank">{{ e.leader_rank }}</span>{{ `${e.leader_first} ${e.leader_last}` }}</template><template v-else>–</template></span></template>
      <template #actions><a class="btn btn-primary" :href="exportUrl('pdf')" target="_blank" rel="noopener" title="Teilnehmerliste als PDF in einem neuen Tab öffnen">Teilnehmerliste (PDF)</a><a class="btn" :href="exportUrl('xlsx')">Excel</a><a class="btn" :href="exportUrl('csv')">CSV</a><router-link class="btn" :to="{ path: `${base}/verpflegungsliste`, query: q }">Verpflegungsliste</router-link></template>
    </Topbar>
    <div v-if="e.status === 'abgesagt'" class="callout warn mb">Dieser Einsatz wurde abgesagt.</div>
    <div v-if="e.status === 'entwurf'" class="callout mb">Dieser Einsatz ist noch ein Entwurf – Angaben können sich noch ändern.</div>

    <div class="grid grid-main mb">
      <div class="card">
        <div class="card-head"><h2>Angaben</h2></div>
        <div class="card-body">
          <dl class="kv left">
            <dt>Datum</dt><dd>{{ dates.fmtEventDate(e, 'long') }}</dd>
            <dt>Antreten</dt><dd>{{ e.start_time || '–' }}{{ e.start_place ? ` · ${e.start_place}` : '' }}</dd>
            <dt>Abtreten</dt><dd>{{ e.end_time || '–' }}{{ (e.end_place || e.start_place) ? ` · ${e.end_place || e.start_place}` : '' }}</dd>
            <dt>Einsatzleitung</dt><dd>{{ leaderLine }}</dd>
            <dt>Tenue</dt><dd class="pre">{{ e.tenue || '–' }}</dd>
            <dt>Beschreibung</dt><dd class="pre">{{ e.description || '–' }}</dd>
            <template v-for="d in data.extraDefs" :key="d.name"><dt>{{ d.name }}</dt><dd>{{ (e.extra || {})[d.name] || '–' }}</dd></template>
          </dl>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Schichten</h2></div>
        <div class="card-body">
          <div v-for="sh in data.shifts" :key="sh.id || sh.name" class="occ">
            <div class="occ-head"><span><strong>{{ sh.name }}</strong> · {{ dates.fmtShiftWhen(sh, dates.isMultiDay(e)) || 'Zeit offen' }}{{ sh.start_place ? ` · ${sh.start_place}` : '' }}</span><strong>{{ sh.ist }} / {{ sh.soll ?? '–' }}</strong></div>
            <div :class="['bar', sh.tone]"><span :style="{ width: `${pct(sh.ist, sh.soll)}%` }"></span></div>
            <div v-if="sh.extern" class="small muted ext-split">{{ sh.intern }} eigene + {{ sh.extern }} extern</div>
          </div>
          <p class="small muted mt-s">Nur lesen. Änderungen und Rückfragen bitte an die Aufgebotsstelle.</p>
        </div>
      </div>
    </div>

    <div v-if="data.showFunction" class="mb"><FunctionsCard :event="e" :fn-summary="data.fnSummary" /></div>
    <ListFilters :scopes="data.scopes" :event="e" :filters="data.filters" />
    <template v-if="data.groups">
      <ParticipantsTable v-for="(g, i) in data.groups" :key="i" v-bind="common" :group-title="g.title" :list="g.list" :exts="g.exts" :ext-total="g.extTotal" :fn-summary="g.fnSummary" :show-function="data.showFunction && Boolean(g.fnSummary)" :summary="g.summary" />
    </template>
    <ParticipantsTable v-else v-bind="common" :list="data.list" :exts="data.exts" :ext-total="data.extTotal" :fn-summary="data.fnSummary" :show-function="data.showFunction" :summary="data.summary" />
  </AppShell>
</template>
