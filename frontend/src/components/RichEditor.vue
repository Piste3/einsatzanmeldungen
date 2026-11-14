<script setup>
// Formatierter Text (HTML) mit Editor (wie partials/rich-editor.ejs). Der Editor selbst kommt aus lib/rte.js.
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { initRte } from '@/lib/rte.js';
defineProps({ id: String, name: String, formatName: String, value: String, rows: { type: Number, default: 16 } });
const box = ref(null);
onMounted(() => initRte(box.value));
onBeforeUnmount(() => box.value?._rteDestroy?.());
</script>
<template>
  <div ref="box" class="rte" data-rte>
    <textarea :id="id" :name="name" :rows="rows" data-rte-source data-token-target spellcheck="false" :defaultValue="value"></textarea>
    <input type="hidden" :name="formatName" value="html">
  </div>
</template>
