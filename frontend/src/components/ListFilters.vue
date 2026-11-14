<script setup>
// Auswahl für Teilnehmer- und Verpflegungsliste: Umfang, Schicht (ganzer Einsatz, pro Schicht, eine Schicht), Sortierung
import { useFilters } from '@/lib/useFilters.js';
import { dates } from '@/lib/format.js';
const props = defineProps({ scopes: Object, event: Object, filters: Object });
const { f, apply } = useFilters({ umfang: 'angemeldet', schicht: '', sort: 'rang' }, () => props.filters);
</script>
<template>
  <form class="filters" @submit.prevent="apply()">
    <select v-model="f.umfang" aria-label="Wer steht auf der Liste?" @change="apply()">
      <option v-for="(s, k) in scopes" :key="k" :value="k">{{ s.label }}</option>
    </select>
    <select v-if="event.shifts.length > 1" v-model="f.schicht" aria-label="Schicht" @change="apply()">
      <option value="">Ganzer Einsatz</option>
      <option value="alle">Pro Schicht (je ein Block)</option>
      <option v-for="s in event.shifts" :key="s.id" :value="String(s.id)">Nur {{ s.name }}{{ dates.isMultiDay(event) && s.starts_at ? ` (${dates.fmtShiftWhen(s, true)})` : '' }}</option>
    </select>
    <select v-model="f.sort" aria-label="Sortierung" @change="apply()">
      <option v-for="[k, l] in [['rang', 'Rang: tief → hoch'], ['rang_ab', 'Rang: hoch → tief'], ['funktion', 'Funktion, dann Rang']]" :key="k" :value="k">{{ l }}</option>
    </select>
  </form>
</template>
