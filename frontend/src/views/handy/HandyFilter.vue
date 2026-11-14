<script setup>
// Handy-App: welche Einsätze erscheinen (wie views/handy/filter.ejs)
import { computed, ref, watch } from 'vue';
import HandyShell from '@/components/HandyShell.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { setSteps } from '@/lib/handy.js';

const page = usePage(() => '/handy/filter', { live: false });
const { data, error } = page;
const ready = computed(() => Array.isArray(data.value.ranges));
watch(data, (d) => setSteps(d.handySteps));
const form = ref(null);
const save = () => runAction('/handy/filter', formBody(form.value), { follow: true });
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <HandyShell v-if="ready" bar-title="Filter" bar-sub="Welche Einsätze erscheinen" nav-tab="filter" @reload="page.reload({ quiet: true })">
    <form ref="form" :key="`${data.f.zeit}-${data.f.entwurf}`" class="h-filterform" @submit.prevent="save">
      <h2 class="h-section">Zeitraum</h2>
      <ul class="h-menu h-choice">
        <li v-for="r in data.ranges" :key="r.key"><label><input type="radio" name="zeit" :value="r.key" :defaultChecked="data.f.zeit === r.key"><span>{{ r.label }}<small>{{ r.until ? `Beginn bis ${r.until}` : `alle ${data.total} kommenden Einsätze` }}</small></span></label></li>
      </ul>

      <h2 class="h-section">Entwürfe</h2>
      <ul class="h-menu h-choice">
        <li><label><input type="radio" name="entwurf" value="1" :defaultChecked="data.f.entwurf"><span>Anzeigen<small>mit dem Zeichen «Entwurf»</small></span></label></li>
        <li><label><input type="radio" name="entwurf" value="0" :defaultChecked="!data.f.entwurf"><span>Ausblenden<small>nur veröffentlichte Einsätze</small></span></label></li>
      </ul>

      <p class="h-note">Der Filter gilt für «Einsätze» und «Personen». Die App speichert ihn für dein Konto, also auch auf einem anderen Handy. Vergangene, abgeschlossene und abgesagte Einsätze zeigt die Handy-App nie.</p>
      <button class="btn btn-primary h-filter-save" type="submit">Filter anwenden</button>
    </form>
  </HandyShell>
</template>
