<script setup>
// Handy-App Startseite: laufende und kommende Einsätze (wie views/handy/start.ejs)
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import HandyShell from '@/components/HandyShell.vue';
import HandyFacts from '@/components/HandyFacts.vue';
import HandyHidden from '@/components/HandyHidden.vue';
import { usePage } from '@/lib/usePage.js';
import { setSteps, store, dates } from '@/lib/handy.js';

const page = usePage(() => '/handy');
const { data, error } = page;
const ready = computed(() => Array.isArray(data.value.list));
watch(data, (d) => setSteps(d.handySteps));
const f = computed(() => data.value.f || {});
const when = (e) => {
  const t = data.value.todayYmd;
  const w = e.date_from === t ? 'Heute' : e.date_from < t ? 'Läuft' : dates.fmtDaysUntil(e.date_from).replace(/^./, (c) => c.toUpperCase());
  return `${w} · ${dates.fmtEventDate(e, 'wd')}${e.start_time ? ` · ${[e.start_time, e.end_time].filter(Boolean).join('–')}` : ''}`;
};

// Hinweis «Als App speichern»
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const showInstall = ref(!standalone && store.get('h-install-zu') !== '1');
const installText = ref(ios ? 'In Safari unten auf «Teilen» tippen, dann «Zum Home-Bildschirm».' : 'Im Browser-Menü «Zum Startbildschirm hinzufügen» wählen.');
const installEvent = ref(null);
function closeInstall() { showInstall.value = false; store.set('h-install-zu', '1'); }
function onPrompt(e) {
  e.preventDefault();
  installEvent.value = e;
  if (showInstall.value) installText.value = 'Die App direkt auf den Startbildschirm legen.';
}
async function install() { installEvent.value.prompt(); await installEvent.value.userChoice; showInstall.value = false; }
onMounted(() => window.addEventListener('beforeinstallprompt', onPrompt));
onUnmounted(() => window.removeEventListener('beforeinstallprompt', onPrompt));
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready" bar-title="Einsätze" :bar-sub="f.label" nav-tab="einsaetze" @reload="page.reload({ quiet: true })">
    <div class="h-install" :hidden="!showInstall">
      <p><strong>Als App speichern:</strong> <span>{{ installText }}</span></p>
      <button class="btn btn-sm" type="button" :hidden="!installEvent" @click="install">Installieren</button>
      <button class="h-x" type="button" aria-label="Hinweis schliessen" @click="closeInstall">×</button>
    </div>
    <div v-if="!data.list.length" class="h-empty"><p>{{ data.hidden ? 'Im gewählten Zeitraum gibt es keinen Einsatz.' : 'Es gibt keinen laufenden oder kommenden Einsatz.' }}</p></div>
    <ul class="h-events">
      <li v-for="e in data.list" :key="e.id">
        <router-link :class="['h-event', { 'is-current': e.id === data.currentEventId }]" :to="`/handy/einsatz/${e.id}`">
          <span class="h-event-when">{{ when(e) }}</span>
          <span class="h-event-name">{{ e.status === 'entwurf' ? `${e.name} ` : e.name }}<span v-if="e.status === 'entwurf'" class="badge badge-gray">Entwurf</span></span>
          <HandyFacts :e="e" compact />
          <span class="h-event-counts"><span class="dot dot-green"></span>{{ e.counts.angemeldet }} angemeldet · <strong>{{ e.counts.offen }} noch offen</strong></span>
        </router-link>
      </li>
    </ul>
    <div><HandyHidden :hidden="data.hidden" /></div>
  </HandyShell>
</template>
