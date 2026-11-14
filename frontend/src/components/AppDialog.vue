<script setup>
// Dialog (<dialog>) mit v-model:open. Inhalt und Knöpfe kommen aus dem Slot.
import { ref, watch, nextTick, onMounted } from 'vue';
const props = defineProps({ open: Boolean, id: String, focus: String });
const emit = defineEmits(['update:open']);
const el = ref(null);
async function sync() {
  await nextTick();
  if (!el.value) return;
  if (props.open && !el.value.open) {
    el.value.showModal();
    // wie bisher: erstes sichtbares Auswahl-, Text- oder Eingabefeld (keine Häkchen und Knöpfe)
    const first = (props.focus && el.value.querySelector(props.focus))
      || [...el.value.querySelectorAll('select, textarea, input[type=text], input[type=search]')].find((x) => !x.disabled && x.offsetParent !== null);
    if (first) first.focus();
  }
  if (!props.open && el.value.open) el.value.close();
}
watch(() => props.open, sync);
onMounted(sync);
</script>
<template>
  <dialog :id="id" ref="el" @close="emit('update:open', false)" @cancel="emit('update:open', false)"><slot /></dialog>
</template>
