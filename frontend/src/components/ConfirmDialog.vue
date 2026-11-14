<script setup>
import { ref, watch, nextTick } from 'vue';
import { dialogState, closeDialog } from '@/lib/dialog.js';

const el = ref(null);
const field = ref(null);
const okBtn = ref(null);
watch(() => dialogState.open, async (open) => {
  await nextTick();
  if (!el.value) return;
  if (open && !el.value.open) { el.value.showModal(); (field.value || okBtn.value)?.focus(); }
  if (!open && el.value.open) el.value.close();
});
function ok() {
  if (!dialogState.input) return closeDialog(true);
  if (!dialogState.value.trim()) { dialogState.invalid = true; field.value?.focus(); return; }
  closeDialog(dialogState.value.trim());
}
const no = () => closeDialog(dialogState.input ? null : false);
function onCancel() { if (dialogState.cancel) no(); else closeDialog(true); }
</script>

<template>
  <dialog ref="el" class="ui-dialog" @cancel.prevent="onCancel">
    <div class="card-head"><h2>{{ dialogState.title }}</h2></div>
    <div class="card-body">
      <p v-if="dialogState.message" class="ui-msg">{{ dialogState.message }}</p>
      <textarea v-if="dialogState.input" ref="field" v-model="dialogState.value" :class="['ui-input', { invalid: dialogState.invalid }]" rows="3"
        :placeholder="dialogState.placeholder" @keydown.enter.exact.prevent="ok"></textarea>
    </div>
    <div class="card-foot">
      <button v-if="dialogState.cancel" class="btn btn-ghost" type="button" @click="no">{{ dialogState.cancel }}</button>
      <button ref="okBtn" :class="['btn', dialogState.danger ? 'btn-danger' : 'btn-primary']" type="button" @click="ok">{{ dialogState.ok }}</button>
    </div>
  </dialog>
</template>
