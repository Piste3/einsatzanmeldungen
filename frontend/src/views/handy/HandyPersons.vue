<script setup>
// Handy-App: Personenliste mit Zahl der Anmeldungen (wie views/handy/personen.ejs)
import { computed, ref, watch } from 'vue';
import HandyShell from '@/components/HandyShell.vue';
import Rank from '@/components/Rank.vue';
import { usePage } from '@/lib/usePage.js';
import { matches } from '@/lib/handyList.js';
import { setSteps, plural } from '@/lib/handy.js';

const page = usePage(() => '/handy/personen');
const { data, error } = page;
const ready = computed(() => Array.isArray(data.value.list));
watch(data, (d) => setSteps(d.handySteps));
const q = ref('');
const key = (p) => `${p.first_name} ${p.last_name} ${p.rank_short || ''}`.toLowerCase();
const shown = computed(() => (data.value.list || []).filter((p) => matches(q.value, key(p))).length);
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready" bar-title="Personen" :bar-sub="`${plural(data.eventCount, 'Einsatz', 'Einsätze')} · ${data.f.label}`" nav-tab="personen" @reload="page.reload({ quiet: true })">
    <div class="h-tools">
      <div class="h-filter">
        <input v-model="q" type="search" placeholder="Name suchen" aria-label="Name suchen" autocomplete="off">
      </div>
    </div>
    <ul class="h-people">
      <li v-for="p in data.list" :key="p.id" class="hc" :hidden="!matches(q, key(p))">
        <router-link class="h-person" :to="`/handy/personen/${p.id}`">
          <span class="h-person-name"><Rank :short="p.rank_short" /><strong>{{ p.first_name }} {{ p.last_name }}</strong><span v-if="p.teams" class="hc-sub">{{ p.teams }}</span></span>
          <span :class="['h-person-count', p.angemeldet ? 'has' : '']">{{ p.angemeldet }}<small>angemeldet</small></span>
        </router-link>
      </li>
      <li class="h-empty" :hidden="!(q.trim() && !shown)"><p>Kein Name passt zur Suche.</p></li>
    </ul>
  </HandyShell>
</template>
