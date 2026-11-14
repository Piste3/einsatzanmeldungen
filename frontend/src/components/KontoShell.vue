<script setup>
// Konto-Seiten: auf dem Handy im Rahmen der Handy-App, sonst wie gewohnt (wie partials/head.ejs mit handyShell)
import AppShell from './AppShell.vue';
import HandyShell from './HandyShell.vue';
import { session } from '@/lib/api.js';
import { inHandy } from '@/lib/handy.js';
</script>

<template>
  <HandyShell v-if="inHandy()" :bar-title="session.title || 'Profil'" bar-sub="Profil" back-href="/handy/profil" back-label="Zurück zum Profil" nav-tab="profil"><slot /></HandyShell>
  <AppShell v-else><slot /></AppShell>
</template>
