<script setup>
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import { fmtEventDate, dates } from '@/lib/format.js';

const props = defineProps({ e: Object, answer: Object, question: String, disabled: Boolean });

const multi = computed(() => props.e.openShifts.length > 1);
const join = (...p) => p.filter(Boolean).join(' ');
const meta = computed(() => {
  const e = props.e;
  const antreten = (e.start_time || e.start_place) ? join('Antreten', e.start_time, e.start_place) : '';
  const endPlace = e.end_place || e.start_place; // leerer Abtretensort = gleich wie Antreten
  const abtreten = (e.end_time || endPlace) ? join('Abtreten', e.end_time, endPlace) : '';
  return [['antreten', antreten], ['abtreten', abtreten], ['tenue', e.tenue ? `Tenue ${e.tenue.split('\n')[0]}` : '']].filter(([, t]) => t);
});
const answered = computed(() => props.answer.yes || props.answer.shifts.length > 0);
const onlyRule = computed(() => props.e.openShifts[0]?.rule);
function reset() { props.answer.yes = false; props.answer.shifts = []; }
</script>

<template>
  <fieldset :class="['ev-block', { answered }]">
    <div class="ev-head">
      <legend class="ev-name">{{ e.name }}</legend>
      <span class="date-pill">{{ fmtEventDate(e, 'short') }}</span>
    </div>
    <div v-for="[ico, line] in meta" :key="ico" class="ev-meta"><Icon :name="ico" cls="ev-icon" /><span>{{ line }}</span></div>
    <div v-if="e.description" class="ev-desc">{{ e.description }}</div>
    <div class="ev-question">{{ question }}</div>
    <div v-if="e.help_text" class="ev-help">{{ e.help_text }}</div>
    <template v-if="multi">
      <label v-for="s in e.openShifts" :key="s.id" class="opt">
        <input v-model="answer.shifts" type="checkbox" :value="s.id" :disabled="disabled">
        <span>{{ s.name }}</span> <span class="time">{{ dates.fmtShiftWhen(s, dates.isMultiDay(e)) }}</span><template v-if="s.rule"> <span class="only">Nur {{ s.rule }}</span></template>
      </label>
    </template>
    <template v-else>
      <div v-if="onlyRule" class="ev-only"><span class="only">Nur {{ onlyRule }}</span></div>
      <div class="yesno">
        <input :id="`y${e.id}`" v-model="answer.yes" type="checkbox" :disabled="disabled"><label :for="`y${e.id}`">Ja, ich bin dabei</label>
      </div>
    </template>
    <input v-model="answer.remark" class="remark" type="text" placeholder="Bemerkung (optional)" maxlength="500" :disabled="disabled">
    <button v-if="answered" type="button" class="reset" @click="reset">Antwort zurücksetzen</button>
  </fieldset>
</template>
