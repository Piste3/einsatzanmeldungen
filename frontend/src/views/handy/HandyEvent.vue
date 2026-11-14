<script setup>
// Handy-App: Personen für einen Einsatz anfragen (wie views/handy/einsatz.ejs)
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import HandyShell from '@/components/HandyShell.vue';
import HandyFacts from '@/components/HandyFacts.vue';
import HandyCard from '@/components/HandyCard.vue';
import HandyChannel from '@/components/HandyChannel.vue';
import HandyError from '@/components/HandyError.vue';
import { usePage } from '@/lib/usePage.js';
import { useCards, matches } from '@/lib/handyList.js';
import { eventSub, withQuery, labels } from '@/lib/handy.js';

const router = useRouter();
const page = usePage((r) => r.fullPath);
const { data, error } = page;
const e = computed(() => data.value.event);
const ready = computed(() => Boolean(e.value && data.value.list));
const { cards, update, hardReload, delta } = useCards(page, { domId: (c) => `p${c.person_id}` });

const base = computed(() => `/handy/einsatz/${e.value.id}`);
const keep = computed(() => ({ team: data.value.filters.team || undefined, sort: data.value.filters.sort !== 'rang' ? data.value.filters.sort : undefined }));
const here = computed(() => withQuery(base.value, { ...keep.value, zeige: data.value.show !== 'offen' ? data.value.show : undefined }));
const tabs = computed(() => {
  const c = data.value.counts;
  const d = delta();
  return [['offen', 'Noch offen', c.offen + d.offen], ['kann', 'Kann', c.kann + d.kann], ['kann_nicht', 'Kann nicht', c.kann_nicht + d.kann_nicht], ['alle', 'Alle', data.value.total]];
});
const tabHref = (key) => withQuery(base.value, { ...keep.value, zeige: key !== 'offen' ? key : undefined });

const q = ref('');
const shown = computed(() => cards.value.filter((c) => matches(q.value, `${c.first_name} ${c.last_name} ${c.rank_short || ''}`.toLowerCase())).length);
// Wie das bisherige Formular: «team» geht immer mit (leer = alle Mannschaften, der Server merkt sich die Wahl)
const setTeam = (ev) => router.push({ path: base.value, query: { ...(data.value.show !== 'offen' ? { zeige: data.value.show } : {}), team: ev.target.value } });
const fehler = computed(() => (error.value?.body?.view === 'handy/fehler' ? error.value.body : null));
</script>

<template>
  <HandyError v-if="fehler" :title="fehler.title" :message="fehler.data?.message" />
  <div v-else-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready && !fehler" :bar-title="e.name" :bar-sub="eventSub(e)" back-href="/handy" nav-tab="anfragen" :event="e" @reload="hardReload">
    <HandyFacts :e="e" />
    <div v-if="data.locked" class="flash flash-info">Der Einsatz ist {{ labels.EVENT_STATUS[e.status].label.toLowerCase() }}. Antworten lassen sich nur noch ansehen.</div>

    <div class="h-tools">
      <HandyChannel v-if="!data.locked" />
      <nav class="h-tabs" aria-label="Anzeigen">
        <router-link v-for="[key, label, n] in tabs" :key="key" :class="data.show === key ? 'active' : ''" :to="tabHref(key)" :aria-current="data.show === key ? 'page' : undefined" active-class="" exact-active-class="">{{ label }} <span>{{ n }}</span></router-link>
      </nav>
      <form class="h-filter" @submit.prevent="$event.target.querySelector('[type=search]').blur()">
        <input v-model="q" type="search" placeholder="Name suchen" aria-label="Name suchen" autocomplete="off">
        <select name="team" aria-label="Mannschaft" @change="setTeam"><option value="">Alle Mannschaften</option><option v-for="t in data.teams" :key="t.id" :value="t.id" :defaultSelected="Number(data.filters.team) === t.id">{{ t.name }}</option></select>
      </form>
    </div>

    <div class="h-list">
      <div v-if="!cards.length" class="h-empty"><p>{{ data.show === 'offen' ? (data.total ? 'Alle haben geantwortet.' : 'Es gibt keine aktiven Mitglieder.') : 'Hier steht noch niemand.' }}</p></div>
      <HandyCard v-for="(c, i) in cards" :key="`${c.person_id}-${c._v}`" :r="c" :ev="e" :shifts="data.shifts" :locked="data.locked" :back="here"
        :hidden="!matches(q, `${c.first_name} ${c.last_name} ${c.rank_short || ''}`.toLowerCase())" @update="(n) => update(i, n)" />
      <div class="h-empty" :hidden="!(q.trim() && !shown)"><p>Kein Name passt zur Suche.</p></div>
    </div>
  </HandyShell>
</template>
