<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { page, post, bootstrap, ApiError, session, navigate, flashCarry } from '@/lib/api.js';

const route = useRoute();
const state = ref(null);
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

onMounted(async () => {
  const env = await page(`/login?next=${encodeURIComponent(route.query.next || '/')}`);
  if (env.redirect) { await bootstrap({ refreshOnly: true }); flashCarry.keep = true; return navigate(env.redirect); }
  state.value = env.data;
  error.value = route.query.fehler || env.data.error || '';
  document.title = 'Anmelden · KKB-Einsatzplaner';
});

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await post('/login', { username: username.value, password: password.value, next: route.query.next || '/' }, { follow: false })
      .then(async (r) => { await bootstrap(); await navigate(r.redirect || '/'); });
  } catch (e) {
    if (e instanceof ApiError && e.body?.data) error.value = e.body.data.error || 'Anmeldung nicht möglich.';
    else error.value = e.message;
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand"><span class="logo">KKB</span><span><span class="brand-title">Einsatzplaner</span><br><span class="brand-sub">Kadetten-Korps Basel</span></span></div>
      <div v-if="error" class="flash flash-error">{{ error }}</div>
      <template v-if="state">
        <a v-for="p in state.providers.filter((x) => x.type === 'redirect')" :key="p.id" class="btn btn-dark mb" :href="`/auth/${p.id}`">{{ p.label }}</a>
        <template v-if="state.providers.some((p) => p.id === 'local')">
          <div v-if="state.providers.some((p) => p.type === 'redirect')" class="divider">oder</div>
          <form @submit.prevent="submit">
            <div class="field"><label for="username">Benutzername</label><input id="username" v-model="username" name="username" type="text" autocomplete="username" required autofocus></div>
            <div class="field"><label for="password">Passwort</label><input id="password" v-model="password" name="password" type="password" autocomplete="current-password" required></div>
            <button class="btn btn-primary mt-s" type="submit" :disabled="busy">Anmelden</button>
          </form>
          <p class="small muted mt">Passwort vergessen? Der Admin kann es zurücksetzen.</p>
        </template>
      </template>
    </div>
  </div>
</template>
