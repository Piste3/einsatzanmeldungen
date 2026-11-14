<script setup>
// Klärungen: Anmeldungen ohne gesicherte Personenzuordnung (wie views/pages/clarifications.ejs)
import { computed, ref, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import Icon from '@/components/Icon.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction } from '@/lib/actions.js';
import { session } from '@/lib/api.js';
import { labels, dates } from '@/lib/format.js';

const router = useRouter();
const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Array.isArray(data.value.list));
const isAdmin = computed(() => session.user?.role === 'admin');
const list = computed(() => data.value.list || []);
const r = computed(() => data.value.selected);
const people = computed(() => data.value.searchResults || data.value.candidates || []);
const multi = (info) => /Personen/.test(info || '');

// Suche: Eingabe wie bisher mit Enter; Feld bekommt beim Öffnen eines Eintrags den Fokus
const q = ref('');
watch(() => [r.value?.id, data.value.q], async ([id]) => {
  if (!id) return;
  q.value = data.value.q || r.value.entered_last_name;
  await nextTick();
  document.getElementById('q')?.focus();
}, { immediate: true });
const search = () => router.push({ path: '/klaerungen', query: { id: r.value.id, q: q.value } });

// Schreibweise als Namensvariante speichern (Vorgabe: ja, ausser bei mehreren gleichnamigen Personen)
const saveAlias = ref(true);
watch(() => r.value?.id, () => { if (r.value) saveAlias.value = !multi(r.value.match_info); }, { immediate: true });
const assign = (p) => runAction(`/anmeldungen/${r.value.id}/zuordnen`, { person_id: p.id, back: '/klaerungen', save_alias: saveAlias.value ? '1' : '0' }, { follow: true });
const invalid = () => runAction(`/klaerungen/${r.value.id}/ungueltig`, {}, { confirm: 'Als ungültig markieren (Test, Unsinn, doppelt)?', follow: true });
const newPerson = computed(() => ({ path: '/personen/neu', query: { first_name: r.value.entered_first_name || '', last_name: r.value.entered_last_name || '', from: r.value.id } }));
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Anmeldungen zuordnen" :crumbs="[['Klärungen']]" />
    <div v-if="!list.length" class="card empty-state">
      <span class="empty-state-icon"><Icon name="check" /></span>
      <h2>Keine offenen Klärungen</h2>
      <p>Alle Anmeldungen sind einer Person zugeordnet. Kommt ein Name, der nicht eindeutig passt, erscheint er hier.</p>
    </div>
    <div v-else class="grid grid-side">
      <div class="card">
        <div class="card-head"><h2>Offen <Badge :text="list.length" :tone="list.length ? 'yellow' : 'gray'" /></h2></div>
        <div class="card-body">
          <router-link v-for="it in list" :key="it.id" :class="['list-item', { active: r && r.id === it.id }]" :to="`/klaerungen?id=${it.id}`" :data-row-id="`k${it.id}`">
            <strong>«{{ it.entered_name }}»</strong>
            <span class="muted">{{ it.event_name }} · {{ dates.fmtRelative(it.registered_at) }}</span>
            <div class="mt-s"><Badge :text="it.match_info || 'keine passende Person'" :tone="multi(it.match_info) ? 'yellow' : 'blue'" /></div>
          </router-link>
        </div>
      </div>
      <div v-if="r" class="card">
        <div class="card-head"><h2>«{{ r.entered_name }}» <span class="hint">angemeldet für {{ r.event_name }}{{ r.assigned.length ? ` · ${r.assigned.map((a) => a.name).join(', ')}` : '' }}</span></h2></div>
        <div class="card-body">
          <div class="list-item">
            <div class="grid grid-3">
              <div><span class="muted small">Eingegeben</span><br><strong>Vorname: {{ r.entered_first_name }} · Nachname: {{ r.entered_last_name }}</strong></div>
              <div><span class="muted small">Quelle</span><br>{{ labels.SOURCE[r.source] }}, {{ dates.fmtRelative(r.registered_at) }}</div>
              <div><span class="muted small">Bemerkung</span><br>{{ r.remark || '–' }}<template v-if="r.answer === 'nein'"><br><Badge text="Antwort: Nein" tone="red" /></template></div>
            </div>
          </div>
          <form class="mt" @submit.prevent="search">
            <label for="q">Person in den Stammdaten suchen</label>
            <input id="q" v-model="q" type="search" name="q" placeholder="Name">
          </form>
          <div class="table-wrap mt-s">
            <table>
              <thead><tr><th>Person</th><th>Jahrgang</th><th>Mannschaft</th><th></th></tr></thead>
              <tbody>
                <tr v-if="!people.length"><td colspan="4" class="empty">{{ data.searchResults ? 'Keine Treffer.' : 'Keine Vorschläge – bitte oben suchen.' }}</td></tr>
                <tr v-for="(p, i) in people" :key="p.id" :class="{ selected: i === 0 && !data.searchResults }">
                  <td><Rank :short="p.rank_short" /><strong>{{ p.first_name }} {{ p.last_name }}</strong></td>
                  <td>{{ dates.birthYear(p) || '–' }}</td>
                  <td>{{ p.teams || '–' }}</td>
                  <td class="right"><form class="inline" @submit.prevent="assign(p)"><button :class="['btn', 'btn-sm', { 'btn-primary': i === 0 && !data.searchResults }]" type="submit">Zuordnen</button></form></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="callout mt">
            <label class="check"><input v-model="saveAlias" type="checkbox"> <span><strong>«{{ r.entered_name }}» als Namensvariante speichern</strong><br><span class="small">Beim nächsten Mal wird diese Schreibweise automatisch der gewählten Person zugeordnet.</span></span></label>
          </div>
          <div class="row mt">
            <router-link v-if="isAdmin" class="btn btn-sm" :to="newPerson">Neue Person anlegen</router-link>
            <button v-else class="btn btn-sm" disabled title="Neue Personen legt nur der Admin an">Neue Person anlegen <Badge text="nur Admin" /></button>
            <form class="inline" @submit.prevent="invalid"><button class="btn btn-sm btn-ghost" type="submit">Als ungültig markieren</button></form>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
