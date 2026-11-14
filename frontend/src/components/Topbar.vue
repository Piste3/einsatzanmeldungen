<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { liveState } from '@/lib/live.js';
import { session } from '@/lib/api.js';

defineProps({ heading: String, crumbs: { type: Array, default: () => [] }, showSearch: { type: Boolean, default: true } });
const router = useRouter();
const q = ref('');
function search() { router.push({ path: '/suche', query: { q: q.value, go: 1 } }); }
</script>
<template>
  <div class="topbar">
    <div>
      <div v-if="crumbs.length" class="crumbs">
        <template v-for="(c, i) in crumbs" :key="i"><template v-if="i"> › </template><router-link v-if="c[1]" :to="c[1]">{{ c[0] }}</router-link><template v-else>{{ c[0] }}</template></template>
      </div>
      <div class="title-row"><h1>{{ heading }}</h1><slot name="badges" /></div>
      <div v-if="$slots.subline" class="subline"><slot name="subline" /></div>
    </div>
    <div class="top-actions">
      <span v-if="session.liveTopics.length" :class="['live', { off: !liveState.connected }]">Live</span>
      <form v-if="showSearch && session.user?.role !== 'einsatzleiter'" class="search" role="search" @submit.prevent="search">
        <input v-model="q" type="search" name="q" placeholder="Suchen" aria-label="Suchen">
      </form>
      <slot name="actions" />
    </div>
  </div>
</template>
