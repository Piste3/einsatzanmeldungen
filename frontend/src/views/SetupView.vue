<script setup>
// Ersteinrichtung: erstes Admin-Konto anlegen (wie views/auth/setup.ejs)
import { ref, reactive, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { page, post, bootstrap, ApiError, navigate, flashCarry } from '@/lib/api.js';

const route = useRoute();
const state = ref(null);
const errors = ref([]);
const missing = ref('');
const v = reactive({ display_name: '', username: '', email: '', password: '', password_confirm: '' });

onMounted(async () => {
  document.title = 'Einrichtung · KKB-Einsatzplaner';
  try {
    const env = await page(`/setup?token=${encodeURIComponent(route.query.token || '')}`);
    state.value = env.data;
  } catch (e) {
    if (e instanceof ApiError) missing.value = e.body?.data?.message || 'Die Einrichtung ist bereits abgeschlossen oder der Link ist ungültig.';
    else throw e;
  }
});

async function submit() {
  errors.value = [];
  try {
    const r = await post('/setup', { ...v, token: state.value.token }, { follow: false });
    if (r.view === 'auth/setup') { errors.value = r.data.errors; return; }
    await bootstrap();
    flashCarry.keep = true;
    await navigate(r.redirect || '/');
  } catch (e) {
    if (e instanceof ApiError) errors.value = e.messages; else throw e;
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="brand"><span class="logo">KKB</span><span><span class="brand-title">Einrichtung</span><br><span class="brand-sub">Erstes Admin-Konto anlegen</span></span></div>
      <div v-if="missing" class="flash flash-error">{{ missing }}</div>
      <div v-if="errors.length" class="flash flash-error">{{ errors.join(' ') }}</div>
      <form v-if="state" @submit.prevent="submit">
        <div class="field"><label for="display_name">Name</label><input id="display_name" v-model="v.display_name" name="display_name" type="text" placeholder="Vorname Nachname" required></div>
        <div class="field"><label for="username">Benutzername</label><input id="username" v-model="v.username" name="username" type="text" autocomplete="username" required></div>
        <div class="field"><label for="email">E-Mail (optional, für späteres Microsoft-Login)</label><input id="email" v-model="v.email" name="email" type="email"></div>
        <div class="field"><label for="password">Passwort</label><input id="password" v-model="v.password" name="password" type="password" autocomplete="new-password" minlength="10" required><div class="field-hint">mindestens 10 Zeichen</div></div>
        <div class="field"><label for="password_confirm">Passwort wiederholen</label><input id="password_confirm" v-model="v.password_confirm" name="password_confirm" type="password" autocomplete="new-password" required></div>
        <button class="btn btn-primary" type="submit">Admin-Konto anlegen</button>
      </form>
    </div>
  </div>
</template>
