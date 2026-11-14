<script setup>
// Verlauf einer Person bei einem Einsatz, neueste zuerst (im Kontaktversuch-Fenster)
import { computed } from 'vue';
import Icon from './Icon.vue';

const props = defineProps({ entries: { type: Array, default: () => [] }, cleared: Object, personId: [Number, String], eventId: [Number, String] });
defineEmits(['clear']);
const SYM = { an: '✓', ab: '✕', unsicher: '?', offen: '' };
const DICON = { warteliste: 'clock', whatsapp: 'chat', telefon: 'phone', muendlich: 'voice' };
const DTEXT = { bestaetigt: '✓', rueckfrage: '!' };
const cur = computed(() => props.entries.findIndex((e) => e.state));
</script>

<template>
  <div class="hist-head">
    <strong>Verlauf</strong> <span class="muted">{{ entries.length ? `${entries.length} Eintr${entries.length === 1 ? 'ag' : 'äge'}, neueste zuerst` : '' }}</span>
    <button v-if="entries.length > 1" type="button" class="btn btn-ghost btn-sm btn-danger hist-clear" title="Alle Einträge ausser dem neuesten löschen – Rückmeldung und Anmeldung bleiben" @click="$emit('clear')">Verlauf löschen</button>
  </div>
  <div v-if="!entries.length" class="muted small">{{ cleared ? `Verlauf am ${cleared.atText} von ${cleared.by} gelöscht. Seither nichts Neues.` : 'Noch nichts erfasst: keine Rückmeldung und kein Kontakt.' }}</div>
  <template v-else>
    <ol class="hist-list">
      <li v-for="(e, i) in entries" :key="i" :class="['hist-row', { 'hist-latest': i === cur }]">
        <span :class="['fb', 'fb-sm', e.state ? `fb-${e.state}` : 'fb-none', e.detail ? `fb-d-${e.detail}` : '']" aria-hidden="true"><Icon v-if="e.detail && DICON[e.detail]" :name="DICON[e.detail]" cls="fb-ico" /><template v-else-if="e.detail">{{ DTEXT[e.detail] || '' }}</template><template v-else>{{ e.state ? SYM[e.state] : '·' }}</template></span>
        <span class="hist-main">
          <span class="hist-text">{{ e.text }}<template v-if="i === cur"> <span class="hist-now">aktueller Stand</span></template></span>
          <span class="hist-meta">{{ e.by }} · {{ e.atText }}<template v-if="e.enteredBy"> · erfasst von {{ e.enteredBy }}</template></span>
          <span v-if="e.note" class="hist-note">«{{ e.note }}»</span>
        </span>
      </li>
    </ol>
    <div v-if="cleared" class="muted small hist-cleared">Ältere Einträge am {{ cleared.atText }} von {{ cleared.by }} gelöscht.</div>
  </template>
</template>
