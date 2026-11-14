<script setup>
// Unterzeile der Listen: Einsatz, Datum, Antreten, Leitung
import { fmtEventDate } from '@/lib/format.js';
defineProps({ e: Object });
</script>
<template>
  <strong>{{ e.name }}</strong><span>{{ fmtEventDate(e, 'wd') }}</span><span>Antreten {{ e.start_time || '–' }}{{ e.start_place ? ' · ' + e.start_place : '' }}</span><span>Leitung <template v-if="e.leader_person_id">{{ e.leader_rank ? `${e.leader_rank} ` : '' }}{{ e.leader_first }} {{ e.leader_last }}</template><template v-else>–</template></span>
</template>
