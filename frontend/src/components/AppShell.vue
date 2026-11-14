<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Icon from './Icon.vue';
import ConflictView from './ConflictView.vue';
import { conflict } from '@/lib/conflict.js';
import { snapshot, apply as applyScroll, toastFlashes } from '@/lib/scroll.js';
import { session, post } from '@/lib/api.js';
import { liveState } from '@/lib/live.js';
import { initials, labels } from '@/lib/format.js';

const route = useRoute();
const router = useRouter();
const navOpen = ref(false);
const user = computed(() => session.user);
const isAdmin = computed(() => user.value?.role === 'admin');
const isLeader = computed(() => user.value?.role === 'einsatzleiter');
const path = computed(() => route.path);

const items = computed(() => (isLeader.value
  ? [['/', 'Meine Einsätze', (p) => p === '/' || p.startsWith('/einsaetze'), 0, 'calendar']]
  : [
    ['/', 'Cockpit', (p) => p === '/', 0, 'cockpit'],
    ['/einsaetze', 'Einsätze', (p) => p.startsWith('/einsaetze'), 0, 'calendar'],
    ['/rueckmeldungen', 'Rückmeldungen', (p) => p.startsWith('/rueckmeldungen'), 0, 'inbox'],
    ['/klaerungen', 'Klärungen', (p) => p.startsWith('/klaerungen'), session.nav.klaerungen, 'help'],
    ['/personen', 'Personen', (p) => p.startsWith('/personen'), 0, 'users'],
  ]));

const themeNext = { system: ['light', 'sun', 'Darstellung: wie System – klicken für Hell'], light: ['dark', 'moon', 'Darstellung: Hell – klicken für Dunkel'], dark: ['system', 'monitor', 'Darstellung: Dunkel – klicken für «wie System»'] };
const theme = computed(() => themeNext[user.value?.theme] || themeNext.system);
const themeIcon = computed(() => ({ system: 'monitor', light: 'sun', dark: 'moon' }[user.value?.theme] || 'monitor'));

async function setTheme() {
  await post('/konto/darstellung', { theme: theme.value[0] }, { follow: false });
  session.user = { ...session.user, theme: theme.value[0] };
}
async function logout() {
  await post('/logout', {}, { follow: false });
  session.user = null;
  router.push({ name: 'login' });
}
function go() { navOpen.value = false; }

// Das Stylesheet schaltet das Menü über Klassen am body und am html-Element
watch(navOpen, (open) => document.body.classList.toggle('nav-open', open), { immediate: true });
watch(() => user.value?.theme, (t) => {
  if (['light', 'dark'].includes(t)) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}, { immediate: true });
const onKey = (e) => { if (e.key === 'Escape') navOpen.value = false; };
onMounted(() => document.addEventListener('keydown', onKey));

// Neue Meldung oben: Stelle halten (die Seite scrollt um die Höhe der Meldung mit), sonst unten rechts zeigen
let flashSnap = null;
watch(() => session.flashes.map((f) => f.id).join(','), () => { flashSnap = snapshot(); }, { flush: 'pre' });
watch(() => session.flashes.map((f) => f.id).join(','), (ids) => {
  if (flashSnap) applyScroll(flashSnap, { flashShift: true });
  flashSnap = null;
  if (ids) requestAnimationFrame(toastFlashes);
}, { flush: 'post' });
onUnmounted(() => { document.removeEventListener('keydown', onKey); document.body.classList.remove('nav-open'); });
</script>

<template>
  <div class="app">
    <header class="mobile-bar">
      <button class="mobile-menu" type="button" aria-label="Menü öffnen" :aria-expanded="navOpen" @click="navOpen = !navOpen">
        <Icon name="menu" /><span v-if="session.nav.klaerungen" class="dot"></span>
      </button>
      <router-link class="mobile-brand" to="/"><span class="logo">KKB</span><span>Einsatzplaner</span></router-link>
      <router-link v-if="!isLeader" class="mobile-menu" to="/suche" aria-label="Suchen"><Icon name="search" /></router-link>
    </header>
    <div class="nav-backdrop" @click="navOpen = false"></div>
    <aside id="sidebar" class="sidebar">
      <router-link class="brand" to="/" @click="go">
        <span class="logo">KKB</span>
        <span><span class="brand-title">Einsatzplaner</span><br><span class="brand-sub">Kadetten-Korps Basel</span></span>
      </router-link>
      <nav class="nav">
        <router-link v-for="[href, label, active, count, ico] in items" :key="href" :to="href" :class="{ active: active(path) }" @click="go">
          <Icon :name="ico" cls="nav-icon" />{{ label }}<span v-if="count" class="count">{{ count }}</span>
        </router-link>
        <div class="nav-sep"></div>
        <template v-if="isAdmin">
          <router-link to="/formulare" :class="{ active: path.startsWith('/formulare') }" @click="go"><Icon name="forms" cls="nav-icon" />Formulare<span v-if="session.nav.formErrors" class="count red">{{ session.nav.formErrors }}</span></router-link>
          <router-link to="/verwaltung" :class="{ active: path.startsWith('/verwaltung') }" @click="go"><Icon name="settings" cls="nav-icon" />Einstellungen</router-link>
        </template>
        <a v-else-if="!isLeader" href="/forms/anmeldung?vorschau=1" target="_blank" rel="noopener"><Icon name="eye" cls="nav-icon" />Formular-Vorschau</a>
        <a v-if="!isLeader" href="/handy"><Icon name="phone" cls="nav-icon" />Handy-App</a>
        <router-link to="/handbuch" :class="{ active: path.startsWith('/handbuch') }" @click="go"><Icon name="book" cls="nav-icon" />Handbuch</router-link>
      </nav>
      <div v-if="user" class="sidebar-user">
        <router-link to="/konto/passwort" class="row" title="Konto: Passwort und Zwei-Faktor" @click="go">
          <span class="avatar">{{ initials(user.display_name) }}</span>
          <span><span class="name">{{ user.display_name }}</span><br><span class="role">{{ labels.ROLES[user.role] }}</span></span>
        </router-link>
        <form class="theme-form" @submit.prevent="setTheme"><button class="theme-toggle" type="submit" :title="theme[2]" :aria-label="theme[2]"><Icon :name="themeIcon" /></button></form>
        <form @submit.prevent="logout"><button type="submit" title="Abmelden">Abmelden</button></form>
      </div>
    </aside>
    <main id="content" class="main">
      <div v-if="session.offline" class="flash flash-error">Der Server ist kurz nicht erreichbar. Die App versucht es selbst wieder.</div>
      <div v-for="f in session.flashes" :key="f.id || f.message" :class="['flash', `flash-${f.type}`]">{{ f.message }}</div>
      <div id="presence" :class="['hint-bar', 'presence', { show: liveState.editors.length }]"><span class="tag tag-yellow">Hinweis</span><span id="presence-text">{{ liveState.editors.length ? `Wird gerade von ${liveState.editors.join(', ')} bearbeitet.` : '' }}</span></div>
      <ConflictView v-if="conflict.data" />
      <slot v-else />
    </main>
  </div>
</template>
