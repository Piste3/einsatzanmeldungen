<script setup>
// Handy-App: Anmeldungen eines Einsatzes lesen und bestätigen (wie views/handy/anmeldungen.ejs)
import { computed, ref } from 'vue';
import HandyShell from '@/components/HandyShell.vue';
import HandyFacts from '@/components/HandyFacts.vue';
import HandyReg from '@/components/HandyReg.vue';
import HandyError from '@/components/HandyError.vue';
import { usePage } from '@/lib/usePage.js';
import { useCards, matches } from '@/lib/handyList.js';
import { apiUrl } from '@/lib/useFilters.js';
import { eventSub, withQuery, labels } from '@/lib/handy.js';

const page = usePage((r) => r.fullPath);
const { data, error } = page;
const e = computed(() => data.value.event);
const ready = computed(() => Boolean(e.value && data.value.list));
const { cards, update, hardReload } = useCards(page, { domId: (c) => `r${c.id}`, answerOf: (c) => c.status });

const base = computed(() => `/handy/einsatz/${e.value.id}/anmeldungen`);
const here = computed(() => withQuery(base.value, { zeige: data.value.show !== 'alle' ? data.value.show : undefined }));
const tabs = computed(() => {
  const c = data.value.counts;
  return [['alle', 'Angemeldet', c.offen + c.bestaetigt], ['offen', 'Zu bearbeiten', c.offen], ['bestaetigt', 'Bestätigt', c.bestaetigt], ['uebrige', 'Übrige', c.uebrige]];
});
const tabHref = (key) => withQuery(base.value, { zeige: key !== 'alle' ? key : undefined });
const nameOf = (r) => `${r.person_id ? `${r.first_name} ${r.last_name}` : `«${r.entered_name}»`} ${r.entered_name || ''} ${r.rank_short || ''}`.toLowerCase();
const q = ref('');
const shown = computed(() => cards.value.filter((c) => matches(q.value, nameOf(c))).length);
const fehler = computed(() => (error.value?.body?.view === 'handy/fehler' ? error.value.body : null));
</script>

<template>
  <HandyError v-if="fehler" :title="fehler.title" :message="fehler.data?.message" />
  <div v-else-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready && !fehler" :bar-title="e.name" :bar-sub="eventSub(e)" back-href="/handy" nav-tab="anmeldungen" :event="e" @reload="hardReload">
    <HandyFacts :e="e" />
    <div v-if="data.locked" class="flash flash-info">Der Einsatz ist {{ labels.EVENT_STATUS[e.status].label.toLowerCase() }}. Anmeldungen lassen sich nur noch ansehen.</div>

    <div class="h-tools">
      <div v-if="data.shifts.length" class="h-occ" aria-label="Besetzung">
        <span v-for="s in data.shifts" :key="s.id" :class="['h-occ-item', `h-occ-${s.tone}`]"><span>{{ s.name }}</span><strong>{{ `${s.ist}${s.soll ? ` / ${s.soll}` : ''}` }}</strong></span>
      </div>
      <nav class="h-tabs" aria-label="Anzeigen">
        <router-link v-for="[key, label, n] in tabs" :key="key" :class="data.show === key ? 'active' : ''" :to="tabHref(key)" :aria-current="data.show === key ? 'page' : undefined" active-class="" exact-active-class="">{{ label }} <span>{{ n }}</span></router-link>
      </nav>
      <div class="h-filter">
        <input v-model="q" type="search" placeholder="Name suchen" aria-label="Name suchen" autocomplete="off">
        <a class="btn h-pdf" :href="apiUrl(`/einsaetze/${e.id}/teilnehmerliste`, { format: 'pdf' })" target="_blank" rel="noopener">Teilnehmerliste PDF</a>
      </div>
    </div>

    <div class="h-list">
      <div v-if="!cards.length" class="h-empty"><p>{{ data.total ? 'Hier steht niemand.' : 'Noch keine Anmeldungen.' }}</p></div>
      <HandyReg v-for="(r, i) in cards" :key="`${r.id}-${r._v}`" :r="r" :locked="data.locked" :status-options="data.statusOptions" :back="here" :hidden="!matches(q, nameOf(r))" @update="(n) => update(i, n)" />
      <div class="h-empty" :hidden="!(q.trim() && !shown)"><p>Kein Name passt zur Suche.</p></div>
    </div>
  </HandyShell>
</template>
