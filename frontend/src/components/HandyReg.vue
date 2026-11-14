<script setup>
// Karte einer Anmeldung in der Handy-App: lesen und bestätigen (wie views/handy/_registration.ejs)
import { computed, ref, onMounted } from 'vue';
import Icon from './Icon.vue';
import Rank from './Rank.vue';
import { cardAction, toast, tel as telOf, waLink, labels, dates } from '@/lib/handy.js';

const props = defineProps({
  r: { type: Object, required: true },
  locked: Boolean,
  statusOptions: { type: Array, default: () => [] },
  back: String,
  hidden: Boolean,
});
const emit = defineEmits(['update']);

const r = computed(() => props.r);
const known = computed(() => Boolean(r.value.person_id));
const name = computed(() => (known.value ? `${r.value.first_name} ${r.value.last_name}` : `«${r.value.entered_name}»`));
const tel = computed(() => telOf(r.value.mobile));
const wa = computed(() => waLink(r.value.mobile));
const inactive = computed(() => ['zurueckgezogen', 'abgesagt', 'ungueltig'].includes(r.value.status));
const others = computed(() => (known.value && !props.locked ? props.statusOptions.filter((st) => st !== r.value.status && st !== 'bestaetigt') : []));
const tone = computed(() => (inactive.value ? 'kann_nicht' : r.value.status === 'bestaetigt' ? 'kann' : 'offen'));
const reg = computed(() => labels.REG_STATUS[r.value.status] || { label: r.value.status, tone: 'gray' });
const who = computed(() => (known.value ? name.value : r.value.entered_name));

const busy = ref(false);
const saved = ref(Boolean(props.r._saved));
onMounted(() => { if (saved.value) setTimeout(() => { saved.value = false; }, 1200); });

async function setStatus(status, doneText) {
  busy.value = true;
  const res = await cardAction(`/handy/einsatz/${r.value.event_id}/anmeldung/${r.value.id}/status`, { status, expected: r.value.status, back: props.back || `/handy/einsatz/${r.value.event_id}/anmeldungen` });
  if (res.error) {
    busy.value = false;
    if (res.error !== true) toast(res.error, true);
    return;
  }
  emit('update', res.data.r);
  toast(`${who.value}: ${doneText || 'gespeichert'}`);
}
</script>

<template>
  <article :id="`r${r.id}`" :class="['hc', `hc-${tone}`, { 'is-busy': busy, 'is-saved': saved }]" :data-name="`${name} ${r.entered_name || ''} ${r.rank_short || ''}`.toLowerCase()" :data-who="who" :hidden="hidden">
    <div class="hc-top">
      <div class="hc-who">
        <template v-if="known">
          <router-link class="hc-person-link" :to="`/handy/personen/${r.person_id}`"><strong><Rank :short="r.rank_short" />{{ name }}</strong></router-link>
          <span v-if="r.teams" class="hc-sub">{{ r.teams }}</span>
        </template>
        <template v-else>
          <strong>{{ name }}</strong>
          <span class="hc-sub hc-warn">{{ r.match_info || 'keine sichere Zuordnung' }} · am PC unter «Klärungen» zuordnen</span>
        </template>
      </div>
      <div class="hc-contact">
        <a v-if="tel" class="h-round" :href="`tel:${tel}`" :aria-label="`${name} anrufen`" title="Anrufen"><Icon name="phone" /></a>
        <a v-if="wa" class="h-round" :href="wa" target="_blank" rel="noopener" :aria-label="`${name} per WhatsApp schreiben`" title="WhatsApp"><Icon name="chat" /></a>
      </div>
    </div>
    <div class="hc-state">
      <span :class="['badge', `badge-${reg.tone}`]">{{ reg.label }}</span>
      <span class="hc-last">{{ `${labels.SOURCE[r.source]} · ${dates.fmtRelative(r.registered_at)}` }}</span>
    </div>
    <dl class="hc-facts">
      <div v-if="r.shiftText"><dt>Schicht</dt><dd>{{ r.shiftText }}</dd></div>
      <div v-if="known && !inactive && r.func"><dt>Funktion</dt><dd>{{ `${r.func.short} · ${r.func.name}` }}</dd></div>
      <div v-if="r.remark"><dt>Bemerkung</dt><dd>{{ r.remark }}</dd></div>
      <div v-if="r.internal_note"><dt>Intern</dt><dd>{{ r.internal_note }}</dd></div>
      <div v-if="r.dietText"><dt>Verpflegung</dt><dd>{{ r.dietText }}</dd></div>
    </dl>
    <div v-if="known && !locked" class="hc-reg-actions">
      <form v-if="['neu', 'rueckfrage', 'warteliste', 'unsicher'].includes(r.status)" @submit.prevent="setStatus('bestaetigt', 'bestätigt')">
        <button class="h-ans h-ans-kann" type="submit">Bestätigen</button>
      </form>
      <details v-if="others.length" class="hc-more">
        <summary>Status ändern</summary>
        <div class="hc-more-list">
          <form v-for="st in others" :key="st" @submit.prevent="setStatus(st, labels.REG_STATUS[st].label)">
            <button type="submit">→ {{ labels.REG_STATUS[st].label }}</button>
          </form>
        </div>
      </details>
    </div>
  </article>
</template>
