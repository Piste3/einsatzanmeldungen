<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { liveState } from '@/lib/live.js';
import { session } from '@/lib/api.js';

const props = defineProps({ heading: String, crumbs: { type: Array, default: () => [] }, showSearch: { type: Boolean, default: true } });
// Brotkrumen: Text ohne Link und Trennzeichen als ein Textstück (wie bisher, sonst verschiebt sich die Schrift minimal)
const parts = computed(() => {
  const out = [];
  const text = (t) => { const last = out.at(-1); if (last && !last.to) last.text += t; else out.push({ text: t }); };
  props.crumbs.forEach((c, i) => { if (i) text(' › '); if (c[1]) out.push({ text: c[0], to: c[1] }); else text(c[0]); });
  return out;
});
const router = useRouter();
const q = ref('');
function search() { router.push({ path: '/suche', query: { q: q.value, go: 1 } }); }
</script>
<template>
  <div class="topbar">
    <div>
      <div v-if="crumbs.length" class="crumbs">
        <template v-for="(c, i) in parts" :key="i"><router-link v-if="c.to" :to="c.to">{{ c.text }}</router-link><template v-else>{{ c.text }}</template></template>
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
