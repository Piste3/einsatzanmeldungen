<script setup>
import ConfirmDialog from './components/ConfirmDialog.vue';
import ErrorView from './views/ErrorView.vue';
import { pageError } from './lib/pageError.js';
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { session } from './lib/api.js';
import { inHandy } from './lib/handy.js';

// Fenstertitel wie bisher: «Seite · KKB-Einsatzplaner», in der Handy-App «Seite · KKB Anfragen»
const route = useRoute();
watch(() => [session.title, route.path, session.phone, session.pcView], ([t, path]) => {
  if (route.meta.public || pageError.data) return;
  const app = path.startsWith('/handy') || (/^\/konto/.test(path) && inHandy()) ? 'KKB Anfragen' : 'KKB-Einsatzplaner';
  document.title = `${t ? `${t} · ` : ''}${app}`;
});
</script>
<template>
  <ErrorView v-if="pageError.data" />
  <router-view v-else />
  <ConfirmDialog />
</template>
