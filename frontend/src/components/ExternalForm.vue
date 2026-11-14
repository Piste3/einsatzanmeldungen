<script setup>
// Formular für eine externe Abteilung (neu: x = null)
import { ref, computed } from 'vue';
import { labels } from '@/lib/format.js';
import { runAction, formBody } from '@/lib/actions.js';

const props = defineProps({ event: Object, x: Object, functionOptions: { type: Array, default: () => [] }, back: String });
const emit = defineEmits(['saved']);
const isNew = computed(() => !props.x);
const fid = computed(() => (isNew.value ? 'ext-new' : `ext-${props.x.id}`));
const multiShift = computed(() => props.event.shifts.length > 1);
const cur = computed(() => (isNew.value ? null : props.x.func));
const defaultFn = computed(() => (props.functionOptions.find((f) => f.is_default) || {}).name || 'Einsatzteilnehmer');
const diets = ref([...(isNew.value ? [] : props.x.dietList.map((d) => ({ ...d }))), { count: '', category: '', text: '' }]);
const form = ref(null);

function addDiet() { diets.value.push({ count: '', category: '', text: '' }); }
function removeDiet(i) {
  if (diets.value.length > 1) diets.value.splice(i, 1);
  else diets.value = [{ count: '', category: '', text: '' }];
}
async function submit() {
  const path = `/einsaetze/${props.event.id}/externe${isNew.value ? '' : `/${props.x.id}`}`;
  const body = formBody(form.value);
  if (props.back) body.back = props.back;
  const res = await runAction(path, body, { event: props.event });
  if (res) {
    if (isNew.value) { form.value.reset(); diets.value = [{ count: '', category: '', text: '' }]; }
    emit('saved');
  }
}
</script>

<template>
  <form :id="fid" ref="form" class="card-body ext-form" @submit.prevent="submit">
    <div class="fields fields-2">
      <div class="field"><label :for="`${fid}-unit`">Abteilung <span class="req">*</span></label>
        <input :id="`${fid}-unit`" type="text" name="unit_name" list="ext-units" required maxlength="120" :value="isNew ? '' : x.unit_name" placeholder="z. B. VK NWS" autocomplete="off">
        <div class="field-hint">Aus der Liste wählen oder neuen Namen eintippen – er wird für das nächste Mal gespeichert.</div></div>
      <div class="field"><label :for="`${fid}-count`">Anzahl Personen <span class="req">*</span></label>
        <input :id="`${fid}-count`" type="number" name="person_count" min="1" max="9999" step="1" required :value="isNew ? '' : x.person_count" inputmode="numeric"></div>
    </div>
    <div v-if="functionOptions.length > 1" class="field"><label :for="`${fid}-fn`">Funktion</label>
      <select :id="`${fid}-fn`" name="function_id">
        <option v-for="f in functionOptions" :key="f.id" :value="f.id" :selected="cur ? cur.id === f.id : !!f.is_default">{{ f.short }} · {{ f.name }}</option>
        <option v-if="cur && !functionOptions.some((f) => f.id === cur.id)" :value="cur.id" selected>{{ cur.short }} · {{ cur.name }}</option>
      </select>
      <div class="field-hint">Meist {{ defaultFn }}. Zählt so in «Funktionen» mit.</div></div>
    <div v-if="multiShift" class="field"><label>Schichten</label>
      <div class="row">
        <label v-for="s in event.shifts" :key="s.id" class="check"><input type="checkbox" name="shift_ids" :value="s.id" :checked="isNew || x.allShifts || x.shiftIds.includes(s.id)"> {{ s.name }}</label>
      </div></div>
    <div class="field"><label>Essenseinschränkungen <span class="muted small">(optional, nur Anzahl)</span></label>
      <div class="diet-rows">
        <div v-for="(d, i) in diets" :key="i" class="diet-row">
          <input v-model="d.count" type="number" name="diet_count" min="1" max="9999" step="1" inputmode="numeric" placeholder="Anz." aria-label="Anzahl Personen">
          <select v-model="d.category" name="diet_category" aria-label="Art"><option value="">Art wählen</option><option v-for="(v, k) in labels.DIET" :key="k" :value="k">{{ v }}</option></select>
          <input v-model="d.text" type="text" name="diet_text" maxlength="200" placeholder="Details, z. B. Nüsse" aria-label="Details">
          <button type="button" class="btn btn-sm btn-ghost" title="Zeile entfernen" aria-label="Zeile entfernen" @click="removeDiet(i)">✕</button>
        </div>
      </div>
      <button type="button" class="btn btn-sm btn-ghost" @click="addDiet">+ weitere Einschränkung</button>
      <div class="field-hint">Zum Beispiel 2 × vegetarisch, 1 × Allergie «Nüsse». Wer nicht aufgeführt ist, isst ohne Einschränkung.</div></div>
    <div class="fields fields-2">
      <div class="field"><label :for="`${fid}-contact`">Kontakt <span class="muted small">(optional)</span></label>
        <input :id="`${fid}-contact`" type="text" name="contact" maxlength="500" :value="isNew ? '' : x.contact || ''" placeholder="z. B. Hptm Muster, 079 123 45 67"></div>
      <div class="field"><label :for="`${fid}-note`">Bemerkung <span class="muted small">(optional)</span></label>
        <input :id="`${fid}-note`" type="text" name="note" maxlength="500" :value="isNew ? '' : x.note || ''"></div>
    </div>
    <div class="row">
      <button class="btn btn-sm btn-primary" type="submit">{{ isNew ? 'Hinzufügen' : 'Speichern' }}</button>
    </div>
  </form>
</template>
