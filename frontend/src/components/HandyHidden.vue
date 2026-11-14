<script setup>
// Hinweis: Einsätze, die der Filter ausblendet (wie views/handy/_hidden.ejs)
import Icon from './Icon.vue';
import { plural } from '@/lib/handy.js';

defineProps({ hidden: Number });
</script>

<template>
  <router-link v-if="hidden" class="h-hidden" to="/handy/filter"><Icon name="filter" /><span>{{ `${plural(hidden, 'weiterer Einsatz', 'weitere Einsätze')} ausgeblendet` }}<small>Filter ändern</small></span><span class="h-chev">›</span></router-link>
</template>
