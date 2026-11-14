<script setup>
// Zweite Stufe beim Anmelden: Code aus der Authenticator-App (wie views/auth/twofa.ejs)
import { ref, onMounted, nextTick } from 'vue';
import { page, post, bootstrap, ApiError, navigate, setFlashes, flashCarry } from '@/lib/api.js';

const state = ref(null);
const error = ref('');
const code = ref('');
const remember = ref(false);
const busy = ref(false);

onMounted(async () => {
  const env = await page('/login/2fa');
  if (env.redirect) return navigate(env.redirect);
  state.value = env.data;
  error.value = env.data.error || '';
  document.title = 'Bestätigungscode · KKB-Einsatzplaner';
  await nextTick();
  document.getElementById('code')?.focus();
});

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const r = await post('/login/2fa', { code: code.value, ...(remember.value ? { remember: '1' } : {}) }, { follow: false });
    await bootstrap();
    // Hinweis zum Wiederherstellungscode auf der nächsten Seite zeigen
    setFlashes(r.flashes);
    flashCarry.keep = true;
    await navigate(r.redirect || '/');
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // Abgelaufen: zurück zum Login, mit derselben Meldung
    if (e.body?.view === 'auth/login') return navigate({ path: '/login', query: { fehler: e.body.data.error } });
    error.value = e.body?.data?.error || e.message;
    code.value = '';
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand"><span class="logo">KKB</span><span><span class="brand-title">Einsatzplaner</span><br><span class="brand-sub">Kadetten-Korps Basel</span></span></div>
      <div v-if="error" class="flash flash-error">{{ error }}</div>
      <template v-if="state">
        <p class="small">Gib den 6-stelligen Code aus deiner Authenticator-App ein.</p>
        <form @submit.prevent="submit">
          <div class="field"><label for="code">Bestätigungscode</label>
            <input id="code" v-model="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="11" required class="code-input" placeholder="123 456"></div>
          <label v-if="state.rememberDays" class="check small"><input v-model="remember" type="checkbox" name="remember" value="1"> Auf diesem Gerät {{ state.rememberDays === 1 ? 'einen Tag' : `${state.rememberDays} Tage` }} lang nicht mehr fragen</label>
          <button class="btn btn-primary mt-s" type="submit" :disabled="busy">Bestätigen</button>
        </form>
        <p class="small muted mt">Kein Zugriff auf die App? Gib stattdessen einen deiner Wiederherstellungscodes ein (z. B. <code>abcde-fghjk</code>). <router-link class="link" to="/login">Zurück zum Login</router-link></p>
      </template>
    </div>
  </div>
</template>
