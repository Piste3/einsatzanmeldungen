<script setup>
// Seiten, die noch nicht in der Browser-App stehen, öffnet der Browser in der bisherigen Ansicht.
// Der Pfad ist derselbe, nur ohne das Präfix «/neu».
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();
onMounted(() => { location.replace(route.fullPath); });
</script>
<template><div class="empty">Seite wird geöffnet …</div></template>
