<script setup>
// Symbol in einer Rückmeldungen-Zelle (wie DSYM/SYM in views/pages/feedback.ejs)
import Icon from './Icon.vue';
defineProps({ state: String, detail: String });
const SYM = { an: '✓', ab: '✕', unsicher: '?', offen: '', andere: '·', schicht_offen: '✓' };
const ICON = { warteliste: 'clock', whatsapp: 'chat', telefon: 'phone', muendlich: 'voice' };
const TEXT = { bestaetigt: '✓', rueckfrage: '!', ueberschneidung: '–' };
</script>
<template>
  <Icon v-if="detail && ICON[detail]" :name="ICON[detail]" cls="fb-ico" />
  <span v-else-if="detail === 'frei'" class="fb-ring"></span>
  <template v-else-if="detail">{{ TEXT[detail] || '' }}</template>
  <Icon v-else-if="state === 'nicht_vorgesehen'" name="ban" cls="fb-ico" />
  <template v-else>{{ SYM[state] }}</template>
</template>
