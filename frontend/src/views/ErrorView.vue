<script setup>
// Fehlerseite (wie views/pages/error.ejs): angemeldet in der App-Hülle, sonst als einzelne Karte
import { onMounted } from 'vue';
import AppShell from '@/components/AppShell.vue';
import { session } from '@/lib/api.js';
import { pageError } from '@/lib/pageError.js';
onMounted(() => { document.title = `${pageError.data.title} · KKB-Einsatzplaner`; });
</script>
<template>
  <AppShell v-if="session.user">
    <div class="card" style="max-width:560px;margin:40px auto"><div class="card-body"><h1 class="mb-s">{{ pageError.data.title }}</h1><p>{{ pageError.data.message }}</p><router-link class="btn mt" to="/">Zum Cockpit</router-link></div></div>
  </AppShell>
  <div v-else class="auth-page"><div class="auth-card"><h1 class="mb-s">{{ pageError.data.title }}</h1><p>{{ pageError.data.message }}</p><router-link class="btn mt" to="/">Zur Startseite</router-link></div></div>
</template>
