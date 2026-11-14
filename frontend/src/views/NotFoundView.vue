<script setup>
// Unbekannte Adresse: Fehlerseite wie bisher («Diese Seite gibt es nicht.»)
import { onMounted } from 'vue';
import { showPageError } from '@/lib/pageError.js';
onMounted(() => showPageError({ title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' }));
</script>
<template><div></div></template>
