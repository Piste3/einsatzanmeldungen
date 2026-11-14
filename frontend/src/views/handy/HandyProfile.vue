<script setup>
// Handy-App: Konto, Darstellung, Ganze Ansicht, Abmelden (wie views/handy/profil.ejs)
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import HandyShell from '@/components/HandyShell.vue';
import Icon from '@/components/Icon.vue';
import { usePage } from '@/lib/usePage.js';
import { post, request, session } from '@/lib/api.js';
import { setSteps, labels } from '@/lib/handy.js';
import { initials } from '@/lib/format.js';

const router = useRouter();
const page = usePage(() => '/handy/profil', { live: false });
const { data, error } = page;
const ready = computed(() => typeof data.value.twofaOn === 'boolean' && session.user);
watch(data, (d) => setSteps(d.handySteps));
const user = computed(() => session.user);
const themes = [['system', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']];
const theme = computed(() => (['light', 'dark'].includes(user.value.theme) ? user.value.theme : 'system'));
const local = computed(() => user.value.auth_provider === 'local');
const pwLocked = computed(() => !Number(user.value.password_login ?? 1));

async function setTheme(t) {
  await post('/konto/darstellung', { theme: t }, { follow: false });
  session.user = { ...session.user, theme: t };
}
// «Ganze Ansicht»: eine Stunde lang der normale Einsatzplaner
async function pcView() {
  await request('GET', '/handy/ganze-ansicht');
  session.pcView = true;
  router.push('/');
}
async function logout() {
  await post('/logout', {}, { follow: false });
  session.user = null;
  router.push({ name: 'login' });
}
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready" bar-title="Profil" :bar-sub="labels.ROLES[user.role]" nav-tab="profil" @reload="page.reload({ quiet: true })">
    <section class="h-profile">
      <span class="avatar h-avatar">{{ initials(user.display_name) }}</span>
      <div>
        <strong>{{ user.display_name }}</strong>
        <span class="hc-sub">{{ `${labels.ROLES[user.role]}${user.username ? ` · ${user.username}` : ''}` }}</span>
      </div>
    </section>

    <h2 class="h-section">Konto</h2>
    <ul class="h-menu">
      <li><router-link to="/konto/passwort"><Icon name="key" /><span>Passwort ändern<small v-if="!local || pwLocked">{{ pwLocked ? 'gesperrt: nur Anmeldung über Microsoft' : 'Anmeldung über Microsoft' }}</small></span><span class="h-chev">›</span></router-link></li>
      <li><router-link to="/konto/2fa"><Icon name="shield" /><span>Zwei-Faktor-Anmeldung<small>{{ data.twofaOn ? 'eingerichtet' : 'nicht eingerichtet' }}</small></span><span class="h-chev">›</span></router-link></li>
    </ul>

    <h2 class="h-section">Darstellung</h2>
    <form class="h-theme" @submit.prevent="setTheme($event.submitter.value)">
      <div class="segmented" role="group" aria-label="Darstellung">
        <button v-for="[key, label] in themes" :key="key" type="submit" name="theme" :value="key" :class="theme === key ? 'is-on' : ''" :aria-pressed="theme === key ? 'true' : 'false'">{{ label }}</button>
      </div>
    </form>

    <h2 class="h-section">Weiteres</h2>
    <ul class="h-menu">
      <li><router-link to="/handbuch"><Icon name="book" /><span>Handbuch</span><span class="h-chev">›</span></router-link></li>
      <li><a href="/handy/ganze-ansicht" @click.prevent="pcView"><Icon name="monitor" /><span>Ganze Ansicht<small>eine Stunde lang der normale Einsatzplaner</small></span><span class="h-chev">›</span></a></li>
      <li>
        <form @submit.prevent="logout">
          <button type="submit" class="h-logout"><Icon name="logout" /><span>Abmelden</span></button>
        </form>
      </li>
    </ul>
  </HandyShell>
</template>
