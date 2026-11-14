<script setup>
// Dialog (<dialog>) mit v-model:open. Inhalt und Knöpfe kommen aus dem Slot.
import { ref, watch, nextTick, onMounted } from 'vue';
const props = defineProps({ open: Boolean, id: String });
const emit = defineEmits(['update:open']);
const el = ref(null);
async function sync() {
  await nextTick();
  if (!el.value) return;
  if (props.open && !el.value.open) {
    el.value.showModal();
    const first = el.value.querySelector('select, textarea, input:not([type=hidden])');
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
