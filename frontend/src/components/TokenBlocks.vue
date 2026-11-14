<script setup>
// Karte «Bausteine»: Klick fügt den Baustein ins zuletzt benutzte Feld ein (wie in calendar.ejs und confirmation.ejs)
import { insertToken } from '@/lib/rte.js';
defineProps({ groups: Array });
const token = (key) => `{{${key}}}`;
</script>
<template>
  <div class="card blocks">
    <div class="card-head"><h2>Bausteine <span class="hint">Klick fügt ein</span></h2></div>
    <div class="card-body">
      <template v-for="g in groups" :key="g.name">
        <h4>{{ g.name }}</h4>
        <button v-for="[key, label] in g.items" :key="key" type="button" class="block-btn" :data-token="token(key)" :title="token(key)" @mousedown.prevent @click="insertToken(token(key))">{{ label }}</button>
      </template>
      <slot />
    </div>
  </div>
</template>
