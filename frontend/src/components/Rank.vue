<script setup>
defineProps({ short: String });
</script>
<template><span v-if="short" class="rank">{{ short }}</span></template>
