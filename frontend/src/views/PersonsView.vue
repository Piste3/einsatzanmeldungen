<script setup>
// Personenliste (wie views/pages/persons.ejs)
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import { usePage } from '@/lib/usePage.js';
import { useFilters, apiUrl } from '@/lib/useFilters.js';
import { runAction } from '@/lib/actions.js';
import { uiAlert } from '@/lib/dialog.js';
import { session } from '@/lib/api.js';
import { labels, dates } from '@/lib/format.js';

const route = useRoute();
const { data, error, refresh } = usePage((r) => r.fullPath);
const { f, apply, typed } = useFilters({ q: '', team: '', rank: '', status: 'aktiv', sort: 'rang' }, () => data.value.filters);
const isAdmin = computed(() => session.user?.role === 'admin');
const list = computed(() => data.value.list || []);
const fl = computed(() => data.value.filters || {});
const showReset = computed(() => fl.value.team || fl.value.rank || fl.value.status !== 'aktiv' || fl.value.sort !== 'rang');

// Sammelaktion: Status setzen
const picked = ref([]);
watch(list, (l) => { const ids = new Set(l.map((p) => p.id)); picked.value = picked.value.filter((id) => ids.has(id)); });
const allPicked = computed({
  get: () => list.value.length > 0 && picked.value.length === list.value.length,
  set: (v) => { picked.value = v ? list.value.map((p) => p.id) : []; },
});
const bulkStatus = ref('');
async function setBulk() {
  const status = bulkStatus.value;
  if (!status) return;
  if (!picked.value.length) { await uiAlert('Bitte zuerst Einträge ankreuzen.'); bulkStatus.value = ''; return; }
  const res = await runAction('/personen/sammel', { ids: picked.value, status }, { onDone: refresh });
  bulkStatus.value = '';
  if (res) picked.value = [];
}
</script>

<template>
  <AppShell>
    <Topbar heading="Personen" :crumbs="[['Personen']]">
      <template #actions>
        <a class="btn" :href="apiUrl('/personen', route.query, { format: 'xlsx' })">Excel</a><a class="btn" :href="apiUrl('/personen', route.query, { format: 'csv' })">CSV</a>
        <template v-if="isAdmin"><router-link class="btn" to="/personen/import">Import</router-link><router-link class="btn btn-primary" to="/personen/neu">+ Neue Person</router-link></template>
      </template>
    </Topbar>
    <div v-if="error" class="flash flash-error">{{ error.message }}</div>
    <template v-if="data.filters">
      <form class="filters" @submit.prevent="apply()">
        <input v-model="f.q" type="search" name="q" placeholder="Name, E-Mail oder Mobil" @input="typed()">
        <select v-model="f.team" name="team" @change="apply()"><option value="">Mannschaft: alle</option><option v-for="t in data.teams" :key="t.id" :value="String(t.id)">{{ t.name }}</option></select>
        <select v-model="f.rank" name="rank" @change="apply()"><option value="">Rang: alle</option><option v-for="r in data.ranks" :key="r.id" :value="String(r.id)">{{ r.name }}</option></select>
        <select v-model="f.status" name="status" @change="apply()"><option value="aktiv">aktiv</option><option value="inaktiv">inaktiv</option><option value="ausgetreten">ausgetreten</option><option value="alle">alle</option></select>
        <select v-model="f.sort" name="sort" aria-label="Sortierung" @change="apply()"><option value="rang">Rang: tief → hoch</option><option value="rang_ab">Rang: hoch → tief</option><option value="name">nach Name</option></select>
        <router-link v-if="showReset" class="btn btn-sm btn-ghost" to="/personen?filter=zuruecksetzen" title="Alle Filter auf den Standard zurücksetzen">Filter zurücksetzen</router-link>
      </form>
      <div class="card">
        <form v-if="isAdmin" class="bulkbar" @submit.prevent>
          <label class="check"><input v-model="allPicked" type="checkbox"> <span class="count">{{ picked.length }} ausgewählt</span></label>
          <select v-model="bulkStatus" aria-label="Status setzen" @change="setBulk"><option value="">Status setzen …</option><option value="aktiv">aktiv</option><option value="inaktiv">inaktiv</option><option value="ausgetreten">ausgetreten</option></select>
        </form>
        <div class="table-wrap">
          <table>
            <thead><tr><th v-if="isAdmin" class="check-col"></th><th>Person</th><th>Mannschaft / Kader</th><th>Jahrgang</th><th>Mobil</th><th>E-Mail</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-if="!list.length"><td colspan="7" class="empty">Keine Personen gefunden.<template v-if="isAdmin"> <router-link class="link" to="/personen/import">Stammdaten importieren</router-link></template></td></tr>
              <tr v-for="p in list" :key="p.id" :data-row-id="`p${p.id}-${p.version}`">
                <td v-if="isAdmin" class="check-col"><input v-model="picked" type="checkbox" :value="p.id" aria-label="Auswählen"></td>
                <td><Rank :short="p.rank_short" /><router-link :to="`/personen/${p.id}`"><strong>{{ p.last_name }} {{ p.first_name }}</strong></router-link></td>
                <td>{{ p.teams || '–' }}</td>
                <td>{{ dates.birthYear(p) || '–' }}</td>
                <td class="nowrap">{{ p.mobile || '–' }}</td>
                <td>{{ p.email || '–' }}</td>
                <td><Badge :text="labels.PERSON_STATUS[p.status].label" :tone="labels.PERSON_STATUS[p.status].tone" /></td>
              </tr>
            </tbody>
            <tfoot><tr><td :colspan="isAdmin ? 7 : 6">{{ list.length }} Personen</td></tr></tfoot>
          </table>
        </div>
      </div>
    </template>
  </AppShell>
</template>
