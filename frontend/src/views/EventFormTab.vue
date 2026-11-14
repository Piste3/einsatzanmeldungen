<script setup>
// Reiter «Formular»: so sieht der Einsatz im Anmeldeformular aus
import { computed } from 'vue';
import EventShell from '@/components/EventShell.vue';
import Badge from '@/components/Badge.vue';
import { usePage } from '@/lib/usePage.js';
import { dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath);
const ev = computed(() => data.value.event);
const preview = computed(() => `/forms/anmeldung?vorschau=1&einsatz=${ev.value.id}`);
</script>

<template>
  <div v-if="error && !ev" class="flash flash-error">{{ error.message }}</div>
  <EventShell v-if="ev" :data="data" tab="formular">
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head"><h2>So sieht der Einsatz im Anmeldeformular aus</h2><a class="btn btn-sm" :href="preview" target="_blank" rel="noopener">Vorschau öffnen</a></div>
        <div class="card-body">
          <iframe class="form-preview" :src="preview" title="Vorschau des Anmeldeformulars" loading="lazy"></iframe>
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-body">
          <dl class="kv left">
            <dt>Im Formular</dt><dd><Badge v-if="data.inForm" text="ja" tone="green" /><Badge v-else text="nein" tone="gray" /></dd>
            <dt>Anmeldefrage</dt><dd>{{ ev.question_text || '(Standard)' }}</dd>
            <dt>Schichtauswahl</dt><dd>{{ ev.shifts.length > 1 ? 'ja, automatisch aus den Schichten' : 'nein (eine Schicht)' }}</dd>
            <dt>Verschwindet</dt><dd>spätestens {{ dates.fmtLocal(data.lastEnd) }}</dd>
          </dl>
          <router-link class="btn btn-sm mt" :to="`/einsaetze/${ev.id}/bearbeiten`">Frage und Hilfetext ändern</router-link>
        </div></div>
        <div class="callout"><strong class="cap">Gut zu wissen</strong>Wie viele sich schon angemeldet haben, sehen die Mitglieder nicht. Vergangene Schichten werden nicht mehr angeboten.</div>
      </div>
    </div>
  </EventShell>
</template>
