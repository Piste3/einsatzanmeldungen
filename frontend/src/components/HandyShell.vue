<script setup>
// Rahmen der Handy-App: Kopfleiste, Inhalt, Meldung unten, Leiste mit Reitern (wie views/handy/_head.ejs und _foot.ejs)
import { computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from './Icon.vue';
import { session, post, setFlashes } from '@/lib/api.js';
import { steps, toastState, ask, store } from '@/lib/handy.js';

const props = defineProps({
  barTitle: String,
  barSub: String,
  backHref: String,
  backLabel: { type: String, default: 'Einsatz wechseln' },
  navTab: { type: String, default: '' },
  event: Object,
});
const emit = defineEmits(['reload']);
const route = useRoute();
const router = useRouter();

// Ausserhalb eines Einsatzes: Einsätze, Personen und Filter. Innerhalb: Anfragen und Anmeldungen dieses Einsatzes.
const inEvent = computed(() => ['anfragen', 'anmeldungen'].includes(props.navTab) && props.event);
const tabs = computed(() => (inEvent.value ? [
  ['anfragen', `/handy/einsatz/${props.event.id}`, 'Anfragen', 'phone'],
  ['anmeldungen', `/handy/einsatz/${props.event.id}/anmeldungen`, 'Anmeldungen', 'inbox'],
  ['profil', '/handy/profil', 'Profil', 'user'],
] : [
  ['einsaetze', '/handy', 'Einsätze', 'calendar'],
  ['personen', '/handy/personen', 'Personen', 'users'],
  ['filter', '/handy/filter', 'Filter', 'filter'],
  ['profil', '/handy/profil', 'Profil', 'user'],
]));

// Rückgängig / Wiederholen: eigene Aktionen der letzten 30 Minuten, mit Rückfrage
const STEP = {
  undo: ['/handy/rueckgaengig', 'Letzte Aktion rückgängig machen?', 'Die Änderung wird ganz entfernt, auch aus dem Verlauf.', 'Ja, rückgängig'],
  redo: ['/handy/wiederholen', 'Wiederholen?', 'Die rückgängig gemachte Änderung wird wiederhergestellt.', 'Ja, wiederholen'],
};
async function step(kind) {
  const [path, title, text, ok] = STEP[kind];
  if (!(await ask(`${steps[kind]}. ${text}`, { title, ok }))) return;
  const res = await post(path, { back: route.fullPath }, { follow: false });
  setFlashes(res.flashes);
  emit('reload');
}

// Stylesheet der Handy-App nur in der Handy-App
let mounted = 0;
function sheet(on) {
  let link = document.getElementById('handy-css');
  if (!link && on) {
    // Gleiche Version wie app.css (der Server setzt sie in die Adresse)
    const v = (document.querySelector('link[href*="/static/css/app.css"]')?.getAttribute('href') || '').split('?')[1] || '';
    link = Object.assign(document.createElement('link'), { id: 'handy-css', rel: 'stylesheet', href: `/static/css/handy.css${v ? `?${v}` : ''}` });
    document.head.append(link);
    document.head.append(Object.assign(document.createElement('link'), { id: 'handy-manifest', rel: 'manifest', href: '/manifest.webmanifest' }));
  }
  if (link) link.disabled = !on;
}

// Reiter merken sich die letzte Seite für 5 Minuten (z. B. eine offene Person unter «Personen»).
// Ein Tipp auf den Reiter, in dem man schon ist, führt zur Übersicht.
const TAB_OF = { einsaetze: 'einsaetze', anfragen: 'einsaetze', anmeldungen: 'einsaetze', personen: 'personen' };
const KEEP_MS = 5 * 60 * 1000;
const pageTab = computed(() => TAB_OF[props.navTab]);
let toRoot = false;
const remember = () => { if (pageTab.value && !toRoot) store.set(`h-tab-${pageTab.value}`, JSON.stringify({ path: myPath, t: Date.now() })); };
function tabClick(tab, href) {
  let target = href;
  if (['einsaetze', 'personen'].includes(tab)) {
    if (pageTab.value === tab) { toRoot = true; store.set(`h-tab-${tab}`, ''); } else {
      let saved = null;
      try { saved = JSON.parse(store.get(`h-tab-${tab}`) || 'null'); } catch { saved = null; }
      if (saved && saved.path && Date.now() - saved.t < KEEP_MS && saved.path.startsWith('/handy')) target = saved.path;
    }
  }
  router.push(target);
}
const onHide = () => { if (document.visibilityState === 'hidden') remember(); };
// Nur Wechsel innerhalb derselben Seite (z. B. anderer Reiter oben); beim Verlassen gilt die Adresse dieser Seite
const myRoute = route.name;
let myPath = route.fullPath;
watch(() => route.fullPath, (p) => { if (route.name === myRoute) { myPath = p; toRoot = false; remember(); } });

watch(() => session.user?.theme, (t) => {
  if (['light', 'dark'].includes(t)) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}, { immediate: true });

onMounted(() => {
  mounted += 1;
  sheet(true);
  document.body.classList.add('handy');
  remember();
  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', onHide);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
});
onUnmounted(() => {
  window.removeEventListener('pagehide', remember);
  document.removeEventListener('visibilitychange', onHide);
  mounted -= 1;
  // Nächste Seite ist wieder eine Handy-Seite? Dann bleibt alles, sonst zurück zur PC-Ansicht.
  setTimeout(() => { if (!document.querySelector('.h-bar')) { document.body.classList.remove('handy'); sheet(false); } }, 0);
});
</script>

<template>
  <header class="h-bar">
    <router-link v-if="backHref" class="h-bar-btn" :to="backHref" :aria-label="backLabel">‹</router-link>
    <span v-else class="logo">KKB</span>
    <div class="h-bar-title">{{ barTitle || 'Anfragen' }}<span v-if="barSub">{{ barSub }}</span></div>
    <form class="h-undo" data-h-step="undo" :hidden="!steps.undo" @submit.prevent="step('undo')">
      <button class="h-bar-btn" type="submit" aria-label="Letzte Aktion rückgängig machen" title="Rückgängig"><Icon name="undo" /></button>
    </form>
    <form class="h-undo" data-h-step="redo" :hidden="!steps.redo" @submit.prevent="step('redo')">
      <button class="h-bar-btn" type="submit" aria-label="Rückgängig gemachte Aktion wiederholen" title="Wiederholen"><Icon name="redo" /></button>
    </form>
    <button class="h-bar-btn" type="button" data-reload aria-label="Neu laden" title="Neu laden" @click="emit('reload')">↻</button>
  </header>
  <main class="h-main">
    <div v-if="session.offline" class="flash flash-error">Der Server ist kurz nicht erreichbar. Die App versucht es selbst wieder.</div>
    <div v-for="f in session.flashes" :key="f.id || f.message" :class="['flash', `flash-${f.type}`]">{{ f.message }}</div>
    <slot />
  </main>
  <div id="h-toast" :class="['h-toast', { 'is-error': toastState.error }]" role="status" aria-live="polite" :hidden="!toastState.shown">{{ toastState.text }}</div>
  <nav class="h-nav" :aria-label="inEvent ? 'Ansichten im Einsatz' : 'Ansichten'">
    <a v-for="[key, href, label, ico] in tabs" :key="key" :href="router.resolve(href).href" :data-h-tab="key" :class="navTab === key ? 'active' : ''" :aria-current="navTab === key ? 'page' : undefined" @click.prevent="tabClick(key, href)"><Icon :name="ico" /><span>{{ label }}</span></a>
  </nav>
</template>

<style>
/* Wie bisher: Kopfleiste, Inhalt und Reiter liegen direkt im body (Spalte über die ganze Höhe) */
body.handy #app { display: contents; }
</style>
