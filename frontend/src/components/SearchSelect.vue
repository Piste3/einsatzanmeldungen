<script setup>
// Auswahl mit Suche (wie bisher select[data-search]): tippen filtert die Einträge.
// Gross/klein, Umlaute und Reihenfolge der Wörter spielen keine Rolle.
import { ref, computed, watch } from 'vue';

const props = defineProps({
  modelValue: [String, Number], options: { type: Array, default: () => [] }, // [{ value, text }]
  name: String, required: Boolean, defaultValue: { type: [String, Number], default: undefined }, placeholder: { type: String, default: 'Suchen' }, id: String, ariaLabel: String, allowEmpty: Boolean,
});
const emit = defineEmits(['update:modelValue', 'change']);
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const open = ref(false);
const active = ref(-1);
const label = computed(() => (props.options.find((o) => String(o.value) === String(props.modelValue ?? '')) || {}).text || '');
const text = ref(label.value);
watch(label, (l) => { text.value = l; });
// Pflichtfeld: nur ein gewählter Eintrag zählt, getippter Text allein nicht
const input = ref(null);
watch([() => props.modelValue, input], () => {
  if (input.value) input.value.setCustomValidity(props.required && (props.modelValue ?? '') === '' ? 'Bitte einen Eintrag aus der Liste wählen.' : '');
}, { immediate: true });
const items = computed(() => {
  const words = fold(text.value === label.value ? '' : text.value).split(/\s+/).filter(Boolean);
  const base = props.allowEmpty ? [{ value: '', text: '–' }, ...props.options] : props.options;
  return base.filter((o) => { const t = fold(o.text); return words.every((w) => t.includes(w)); }).slice(0, 200);
});
function choose(o) {
  const changed = String(props.modelValue ?? '') !== String(o.value);
  emit('update:modelValue', o.value);
  text.value = o.value === '' ? '' : o.text;
  open.value = false;
  if (changed) emit('change', o.value);
}
function onKey(ev) {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    open.value = true;
    active.value = Math.max(0, Math.min(items.value.length - 1, active.value + (ev.key === 'ArrowDown' ? 1 : -1)));
  } else if (ev.key === 'Enter') {
    if (open.value && items.value.length) { ev.preventDefault(); choose(items.value[Math.max(0, active.value)]); }
  } else if (ev.key === 'Escape' && open.value) {
    ev.preventDefault(); ev.stopPropagation(); open.value = false; text.value = label.value;
  }
}
function onBlur() { open.value = false; text.value = label.value; }
</script>

<template>
  <div :class="['combo', { open }]">
    <input :id="id" ref="input" v-model="text" type="text" class="combo-input" autocomplete="off" role="combobox" aria-autocomplete="list" :aria-label="ariaLabel" :required="required" :placeholder="placeholder"
      @focus="($event.target.select(), open = true, active = -1)" @click="open = true" @input="(open = true, active = 0)" @blur="onBlur" @keydown="onKey">
    <div class="combo-list" role="listbox">
      <div v-if="!items.length" class="combo-empty">Keine Treffer</div>
      <div v-for="(o, i) in items" :key="o.value" :class="['combo-opt', { selected: String(o.value) === String(modelValue ?? ''), active: i === active }]" role="option" @mousedown.prevent="choose(o)">{{ o.text }}</div>
    </div>
    <input v-if="name" type="hidden" :name="name" :value="modelValue ?? ''" :data-default="defaultValue === undefined ? undefined : String(defaultValue ?? '')">
  </div>
</template>
