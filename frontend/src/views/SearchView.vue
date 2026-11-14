<script setup>
// Suche über Personen, Einsätze und Anmeldungen (wie views/pages/search.ejs)
import { computed, ref, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import { usePage } from '@/lib/usePage.js';
import { labels, dates } from '@/lib/format.js';

const router = useRouter();
const { data, error } = usePage((r) => r.fullPath);
const ready = computed(() => typeof data.value.q === 'string');
const q = ref('');
watch(() => data.value.q, async (v) => {
  if (typeof v !== 'string') return;
  q.value = v;
  await nextTick();
  document.getElementById('search-q')?.focus();
}, { immediate: true });
const search = () => router.push({ path: '/suche', query: { q: q.value } });
const regTo = (r) => (r.person_id ? `/einsaetze/${r.event_id}/anmeldungen` : `/klaerungen?id=${r.id}`);
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar :heading="data.q ? `Suche: «${data.q}»` : 'Suche'" :crumbs="[['Suche']]" />
    <form class="filters" @submit.prevent="search"><input id="search-q" v-model="q" type="search" name="q" placeholder="Personen, Einsätze oder Anmeldungen" style="min-width:320px"><button class="btn btn-sm" type="submit">Suchen</button></form>
    <p v-if="data.q.length < 2" class="muted">Mindestens zwei Zeichen eingeben.</p>
    <div v-else class="grid grid-3">
      <div class="card"><div class="card-head"><h2>Personen <span class="hint">{{ data.people.length }}</span></h2></div>
        <router-link v-for="p in data.people" :key="p.id" class="todo" :to="`/personen/${p.id}`"><span><Rank :short="p.rank_short" /><strong>{{ p.first_name }} {{ p.last_name }}</strong>{{ ' ' }}<Badge v-if="p.status !== 'aktiv'" :text="p.status" /></span></router-link>
        <div v-if="!data.people.length" class="empty">Keine Treffer.</div></div>
      <div class="card"><div class="card-head"><h2>Einsätze <span class="hint">{{ data.evts.length }}</span></h2></div>
        <router-link v-for="e in data.evts" :key="e.id" class="todo" :to="`/einsaetze/${e.id}`"><span><strong>{{ e.name }}</strong><span class="cell-sub">{{ dates.fmtEventDate(e, 'wd') }} · {{ labels.EVENT_STATUS[e.status].label }}</span></span></router-link>
        <div v-if="!data.evts.length" class="empty">Keine Treffer.</div></div>
      <div class="card"><div class="card-head"><h2>Anmeldungen <span class="hint">{{ data.regs.length }}</span></h2></div>
        <router-link v-for="r in data.regs" :key="r.id" class="todo" :to="regTo(r)"><span><strong>{{ r.person_id ? `${r.first_name} ${r.last_name}` : `«${r.entered_first_name} ${r.entered_last_name}»` }}</strong><span class="cell-sub">{{ r.event_name }} · {{ labels.REG_STATUS[r.status].label }}</span></span></router-link>
        <div v-if="!data.regs.length" class="empty">Keine Treffer.</div></div>
    </div>
  </AppShell>
</template>
