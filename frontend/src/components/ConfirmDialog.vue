<script setup>
import { ref, watch, nextTick } from 'vue';
import { dialogState, closeDialog } from '@/lib/dialog.js';
const el = ref(null);
watch(() => dialogState.open, async (open) => {
  await nextTick();
  if (open && el.value && !el.value.open) el.value.showModal();
  if (!open && el.value && el.value.open) el.value.close();
});
</script>
<template>
  <dialog ref="el" class="ui-dialog" @cancel.prevent="closeDialog(false)">
    <div class="card-head"><h2>{{ dialogState.title }}</h2></div>
    <div v-if="dialogState.message" class="card-body"><p class="ui-msg">{{ dialogState.message }}</p></div>
    <div class="card-foot">
      <button class="btn" type="button" @click="closeDialog(false)">Abbrechen</button>
      <button :class="['btn', 'btn-primary', { 'btn-danger': dialogState.danger }]" type="button" @click="closeDialog(true)">{{ dialogState.ok }}</button>
    </div>
  </dialog>
</template>
