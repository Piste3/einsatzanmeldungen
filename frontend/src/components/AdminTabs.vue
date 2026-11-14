<script setup>
// Reiter der Einstellungen (wie views/admin/_tabs.ejs)
import { useRoute } from 'vue-router';
const route = useRoute();
const tabGroups = [
  ['Inhalte', [['/verwaltung/listen', 'Auswahllisten'], ['/verwaltung/vorlagen', 'Vorlagen'], ['/verwaltung/kalendertermin', 'Kalendertermin'], ['/verwaltung/bestaetigungsmail', 'Bestätigungsmail']]],
  ['Betrieb', [['/verwaltung/einstellungen', 'Allgemein'], ['/verwaltung/benutzer', 'Benutzer'], ['/verwaltung/server', 'Server'], ['/verwaltung/system', 'System']]],
];
</script>
<template>
  <nav class="tabs tabs-grouped" aria-label="Einstellungen">
    <template v-for="([groupLabel, items], gi) in tabGroups" :key="groupLabel">
      <span :class="['tab-group-label', { 'tab-group-sep': gi }]">{{ groupLabel }}</span>
      <router-link v-for="[href, label] in items" :key="href" :to="href" :class="{ active: route.path.startsWith(href) }">{{ label }}</router-link>
    </template>
  </nav>
</template>
