<script setup>
// Reiter «Anfragen» / «Anmeldungen» ohne Einsatz: der Server nennt den gemerkten oder nächsten Einsatz
import { usePage } from '@/lib/usePage.js';

usePage((r) => r.fullPath, { live: false });
</script>

<template><div></div></template>
