<script setup>
import { pct } from '@/lib/format.js';
defineProps({ s: Object });
</script>
<template>
  <div class="occ">
    <div class="occ-head"><span>{{ s.name }}</span><strong>{{ s.ist }} / {{ s.soll ?? '–' }}</strong></div>
    <div :class="['bar', s.tone]"><span :style="{ width: pct(s.ist, s.soll) + '%' }"></span></div>
  </div>
</template>
