<script setup>
// Auswahl der vorgesehenen Mannschaften einer Schicht (leer = alle). Häkchen im Klappmenü, gespeichert mit der ganzen Tabelle.
import { ref, computed, watch } from 'vue';
const props = defineProps({ fieldKey: String, selected: { type: Array, default: () => [] }, teams: { type: Array, default: () => [] }, label: String });
const opts = computed(() => props.teams.filter((t) => t.active || props.selected.includes(t.id)));
const picked = ref([...props.selected]);
watch(() => props.selected, (v) => { picked.value = [...v]; });
const names = computed(() => opts.value.filter((t) => picked.value.includes(t.id)).map((t) => t.name).join(', '));
</script>
<template>
  <details class="menu team-pick">
    <summary class="btn btn-sm" :aria-label="label"><span>{{ names || 'alle' }}</span> ▾</summary>
    <div class="menu-list team-pick-list">
      <input type="hidden" :name="`teams_shown${fieldKey}`" value="1">
      <span v-if="!opts.length" class="small muted">Noch keine Mannschaften – unter Einstellungen › Auswahllisten anlegen.</span>
      <label v-for="t in opts" :key="t.id" class="check"><input v-model="picked" type="checkbox" :defaultChecked="selected.includes(t.id)" :name="`teams${fieldKey}`" :value="t.id"> {{ t.name }}</label>
      <span class="small muted team-pick-hint">Nichts angekreuzt = alle Mannschaften.</span>
    </div>
  </details>
</template>
