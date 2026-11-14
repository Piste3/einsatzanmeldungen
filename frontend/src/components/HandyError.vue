<script setup>
// Fehlerseite der Handy-App (wie views/handy/fehler.ejs)
import HandyShell from './HandyShell.vue';

defineProps({ title: String, message: String });
</script>

<template>
  <HandyShell :bar-title="title" back-href="/handy">
    <div class="h-empty"><p>{{ message }}</p><router-link class="btn btn-primary" to="/handy">Zu den Einsätzen</router-link></div>
  </HandyShell>
</template>
