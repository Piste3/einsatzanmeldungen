<script setup>
import { computed } from 'vue';
import { PATHS } from '@/lib/icons.js';
const props = defineProps({ name: { type: String, required: true }, cls: { type: String, default: 'icon' } });
const body = computed(() => PATHS[props.name] || '');
</script>
<template>
  <svg v-if="body" :class="cls" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="body"></svg>
</template>
