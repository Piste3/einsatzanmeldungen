<script setup>
// Abschnitt mit einem Speichern-Knopf für die ganze Tabelle (Auswahllisten, Vorlagen): wie data-section und _section-foot.ejs.
// Nach dem Speichern wird der Abschnitt neu aufgebaut (neue Zeile leer, Markierungen weg); die Seite bleibt stehen.
import { ref } from 'vue';
import { useSection, confirmOtherSections } from '@/lib/section.js';
import { runAction, formBody } from '@/lib/actions.js';

const props = defineProps({
  action: { type: String, required: true }, source: Object, reload: Function,
  hint: { type: String, default: 'Mehrere Zeilen ändern, dann einmal speichern. Zum Löschen «entfernen» ankreuzen.' },
});
const form = ref(null);
const round = ref(0);
const { dirty } = useSection(form, () => props.source);
async function save() {
  if (!(await confirmOtherSections(form))) return;
  const res = await runAction(props.action, formBody(form.value), { onDone: props.reload });
  if (res) round.value += 1;
}
</script>
<template>
  <form ref="form" :key="round" class="card" @submit.prevent="save">
    <slot />
    <div class="section-foot">
      <span class="small muted" data-dirty-hint>{{ dirty ? 'Ungespeicherte Änderungen in diesem Abschnitt' : hint }}</span>
      <button class="btn btn-primary btn-sm" type="submit">Speichern</button>
    </div>
  </form>
</template>
