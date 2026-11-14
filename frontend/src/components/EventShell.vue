<script setup>
// Rahmen jeder Einsatz-Seite: Kopf mit Status, Teilnehmerliste, Bearbeiten, «Mehr ▾» und die Reiter
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from './AppShell.vue';
import Topbar from './Topbar.vue';
import Badge from './Badge.vue';
import Rank from './Rank.vue';
import { fmtEventDate, eventState } from '@/lib/format.js';
import { apiUrl } from '@/lib/useFilters.js';

const props = defineProps({ data: { type: Object, required: true }, tab: { type: String, required: true } });
const route = useRoute();
const e = computed(() => props.data.event);
const base = computed(() => `/einsaetze/${e.value.id}`);
const api = (path, q = {}) => apiUrl(`${base.value}${path}`, q);
const state = computed(() => eventState(props.data.inForm === undefined ? e.value : { ...e.value, inForm: props.data.inForm }));
const multi = computed(() => e.value.shifts.length > 1);
const exportTab = computed(() => ['anmeldungen', 'anfragen', 'verlauf'].includes(props.tab));
const tabs = computed(() => [
  ['uebersicht', 'Übersicht', ''], ['anmeldungen', 'Anmeldungen', props.data.tabCounts?.registrations],
  ['anfragen', 'Anfragen', props.data.tabCounts?.inquiries], ['schichten', 'Schichten', ''], ['formular', 'Formular', ''], ['verlauf', 'Verlauf', ''],
]);
</script>

<template>
  <AppShell>
    <Topbar :crumbs="[['Einsätze', '/einsaetze'], [e.name]]" :heading="e.name" :show-search="false">
      <template #badges><Badge v-bind="state" /></template>
      <template #subline>
        <strong>{{ fmtEventDate(e, 'wd') }}</strong><span>Antreten {{ e.start_time || '–' }}{{ e.start_place ? ' · ' + e.start_place : '' }}</span><span>Leitung <template v-if="e.leader_person_id"><Rank :short="e.leader_rank" />{{ e.leader_first }} {{ e.leader_last }}</template><template v-else>–</template></span>
      </template>
      <template #actions>
        <a class="btn btn-primary" :href="api('/teilnehmerliste', { format: 'pdf' })" target="_blank" rel="noopener" title="Teilnehmerliste als PDF in einem neuen Tab öffnen">Teilnehmerliste</a><router-link class="btn" :to="`${base}/bearbeiten`">Bearbeiten</router-link><details class="menu"><summary class="btn">Mehr ▾</summary><div class="menu-list">
          <template v-if="multi">
            <div class="menu-head">Kalendertermin</div>
            <a :href="api('/kalender', { scope: 'event' })">Ein Termin für den ganzen Einsatz</a><a :href="api('/kalender', { scope: 'shifts' })">Ein Termin pro Schicht</a>
            <a v-for="s in e.shifts" :key="s.id" :href="api('/kalender', { scope: 'shift', shift: s.id })">Nur {{ s.name }}</a>
          </template>
          <a v-else :href="api('/kalender')">Kalendertermin (.ics)</a>
          <template v-if="exportTab">
            <div class="sep"></div><div class="menu-head">Diese Ansicht</div>
            <a :href="apiUrl(`${base}/${tab}`, route.query, { format: 'xlsx' })">Als Excel (.xlsx)</a><a :href="apiUrl(`${base}/${tab}`, route.query, { format: 'csv' })">Als CSV</a>
          </template>
          <div class="sep"></div><div class="menu-head">Teilnehmerliste</div>
          <a v-if="multi" :href="api('/teilnehmerliste', { format: 'pdf', schicht: 'alle' })" target="_blank" rel="noopener">Pro Schicht (PDF)</a>
          <a :href="api('/teilnehmerliste', { format: 'xlsx' })">Als Excel</a><a :href="api('/teilnehmerliste', { format: 'csv' })">Als CSV</a><router-link :to="`${base}/teilnehmerliste`">Auswahl anpassen …</router-link>
          <div class="sep"></div><div class="menu-head">Verpflegungsliste</div>
          <a :href="api('/verpflegungsliste', { format: 'pdf' })" target="_blank" rel="noopener">{{ multi ? 'Ganzer Einsatz (PDF)' : 'Als PDF' }}</a>
          <a v-if="multi" :href="api('/verpflegungsliste', { format: 'pdf', schicht: 'alle' })" target="_blank" rel="noopener">Pro Schicht (PDF)</a>
          <router-link :to="`${base}/verpflegungsliste`">Ansehen und auswählen …</router-link>
          <div class="sep"></div><button type="button" data-print>Drucken</button>
        </div></details>
      </template>
    </Topbar>
    <div v-if="e.status === 'abgeschlossen'" class="callout warn mb">Dieser Einsatz ist abgeschlossen. Die Daten sind schreibgeschützt; Änderungen nur noch durch einen Admin mit Begründung.</div>
    <div v-if="e.status === 'abgesagt'" class="callout warn mb">Dieser Einsatz wurde abgesagt. Alle Daten bleiben erhalten.</div>
    <nav class="tabs">
      <router-link v-for="[key, label, n] in tabs" :key="key" :to="key === 'uebersicht' ? base : `${base}/${key}`" :class="{ active: tab === key }">{{ label }}<template v-if="n"> <span class="n">{{ n }}</span></template></router-link>
    </nav>
    <slot />
  </AppShell>
</template>
