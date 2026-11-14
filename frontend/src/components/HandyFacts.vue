<script setup>
// Angaben zum Einsatz: Datum, Antreten–Abtreten, Ort, Einsatzleitung (wie views/handy/_facts.ejs)
import { computed } from 'vue';
import Icon from './Icon.vue';
import { facts, dates } from '@/lib/handy.js';

const props = defineProps({ e: { type: Object, required: true }, compact: Boolean });
const f = computed(() => facts(props.e));
</script>

<template>
  <template v-if="compact">
    <span v-if="f.place || f.el" class="h-event-facts"><span v-if="f.place"><Icon name="pin" />{{ f.place }}</span><span v-if="f.el"><Icon name="user" />EL {{ f.el }}</span></span>
  </template>
  <dl v-else class="h-facts">
    <div><dt><Icon name="calendar" /><span>Datum</span></dt><dd>{{ dates.fmtEventDate(e, 'wd') }}</dd></div>
    <div><dt><Icon name="clock" /><span>Zeit</span></dt><dd>{{ f.time || 'offen' }}</dd></div>
    <div><dt><Icon name="pin" /><span>Ort</span></dt><dd>{{ f.place || 'offen' }}</dd></div>
    <div><dt><Icon name="user" /><span>EL</span></dt><dd><a v-if="f.el && f.elTel" :href="`tel:${f.elTel}`">{{ f.el }}</a><template v-else>{{ f.el || 'offen' }}</template></dd></div>
  </dl>
</template>
