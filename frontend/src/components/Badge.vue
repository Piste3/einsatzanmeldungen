<script setup>
defineProps({ text: [String, Number], tone: { type: String, default: 'gray' }, title: String });
</script>
<template><span :class="['badge', `badge-${tone}`]" :title="title || undefined">{{ text }}</span></template>
