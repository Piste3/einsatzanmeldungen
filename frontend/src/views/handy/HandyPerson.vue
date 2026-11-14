<script setup>
// Handy-App: eine Person mit allen kommenden Einsätzen (wie views/handy/person.ejs)
import { computed } from 'vue';
import HandyShell from '@/components/HandyShell.vue';
import HandyCard from '@/components/HandyCard.vue';
import HandyChannel from '@/components/HandyChannel.vue';
import HandyHidden from '@/components/HandyHidden.vue';
import HandyError from '@/components/HandyError.vue';
import Icon from '@/components/Icon.vue';
import { usePage } from '@/lib/usePage.js';
import { useCards } from '@/lib/handyList.js';
import { tel as telOf, waLink, channel, setChannel } from '@/lib/handy.js';

const page = usePage((r) => r.fullPath);
const { data, error } = page;
const p = computed(() => data.value.p);
const ready = computed(() => Boolean(p.value && data.value.cards));
const { cards, update, hardReload } = useCards(page, { list: (d) => d.cards || [], domId: (c) => `e${c.e.id}`, answerOf: (c) => c.r.answer });
const name = computed(() => `${p.value.first_name} ${p.value.last_name}`);
const tel = computed(() => telOf(p.value.mobile));
const wa = computed(() => waLink(p.value.mobile));
const anyOpen = computed(() => cards.value.some((c) => !c.locked));
const setAll = (v) => { if (channel.value !== v) setChannel(v); };
const fehler = computed(() => (error.value?.body?.view === 'handy/fehler' ? error.value.body : null));
</script>

<template>
  <HandyError v-if="fehler" :title="fehler.title" :message="fehler.data?.message" />
  <div v-else-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready && !fehler" :bar-title="`${p.rank_short ? `${p.rank_short} ` : ''}${name}`" :bar-sub="p.teams || 'Alle kommenden Einsätze'" back-href="/handy/personen" back-label="Zurück zu den Personen" nav-tab="personen" @reload="hardReload">
    <div class="h-tools">
      <div v-if="tel || wa" class="h-contact-row">
        <a v-if="tel" class="btn h-contact-btn" :href="`tel:${tel}`" @click="setAll('telefon')"><Icon name="phone" /> Anrufen</a>
        <a v-if="wa" class="btn h-contact-btn" :href="wa" target="_blank" rel="noopener" @click="setAll('whatsapp')"><Icon name="chat" /> WhatsApp</a>
      </div>
      <HandyChannel v-if="anyOpen" />
    </div>
    <div class="h-list">
      <div v-if="!cards.length" class="h-empty"><p>{{ data.hidden ? 'Im gewählten Zeitraum gibt es keinen Einsatz.' : 'Es gibt keinen laufenden oder kommenden Einsatz.' }}</p></div>
      <HandyCard v-for="(c, i) in cards" :key="`${c.e.id}-${c._v}`" :r="{ ...c.r, _saved: c._saved }" :ev="c.e" mode="person" :shifts="c.shifts" :locked="c.locked" @update="(n) => update(i, { ...c, r: n })" />
      <div><HandyHidden :hidden="data.hidden" /></div>
    </div>
  </HandyShell>
</template>
