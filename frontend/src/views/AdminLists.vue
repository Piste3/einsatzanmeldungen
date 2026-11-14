<script setup>
// Einstellungen › Auswahllisten: Ränge, Mannschaften, externe Abteilungen, Funktionen (wie views/admin/lists.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import SectionForm from '@/components/SectionForm.vue';
import { usePage } from '@/lib/usePage.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Array.isArray(data.value.ranks));
const sections = computed(() => [
  ['raenge', 'Ränge', data.value.ranks], ['mannschaften', 'Mannschaften / Kader', data.value.teams],
  ['externe', 'Externe Abteilungen', data.value.externalUnits], ['funktionen', 'Funktionen an Einsätzen', data.value.functionList],
]);
const withShort = (kind) => kind === 'raenge' || kind === 'funktionen';
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Einstellungen" :crumbs="[['Einstellungen'], ['Auswahllisten']]" :show-search="false" />
    <AdminTabs />
    <div class="grid grid-2">
      <SectionForm v-for="[kind, label, rows] in sections" :key="kind" :action="`/verwaltung/listen/${kind}`" :source="data" :reload="refresh">
        <div class="card-head"><h2>{{ label }}</h2></div>
        <div class="table-wrap">
          <table class="form-table">
            <thead><tr><th>Name</th><th v-if="withShort(kind)">Kürzel</th><th>Reihenfolge</th><th>Aktiv</th><th v-if="kind === 'funktionen'">Standard</th><th>{{ ['externe', 'funktionen'].includes(kind) ? 'Einsätze' : 'Personen' }}</th><th>Entfernen</th></tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.id">
                <td><input type="hidden" :name="`row__${r.id}`" value="1"><input type="text" :name="`name__${r.id}`" :defaultValue="r.name" required></td>
                <td v-if="withShort(kind)"><input type="text" :name="`short__${r.id}`" :defaultValue="r.short" style="width:70px"></td>
                <td><input type="number" :name="`sort__${r.id}`" :defaultValue="r.sort" style="width:70px"></td>
                <td><input type="checkbox" :name="`active__${r.id}`" value="1" :defaultChecked="Boolean(r.active)"></td>
                <td v-if="kind === 'funktionen'"><input type="radio" name="default_function" :value="r.id" :defaultChecked="Boolean(r.is_default)" aria-label="Standardfunktion"></td>
                <td>{{ r.used }}</td>
                <td><label v-if="!r.used && !r.is_default" class="check small"><input type="checkbox" :name="`delete__${r.id}`" value="1" data-delete-row> entfernen</label><span v-else class="muted small" title="Wird verwendet – stattdessen deaktivieren">–</span></td>
              </tr>
              <tr class="new-row">
                <td><input type="text" name="name__neu" placeholder="Neuer Eintrag"></td>
                <td v-if="withShort(kind)"><input type="text" name="short__neu" placeholder="Kürzel" style="width:70px"></td>
                <td><input type="number" name="sort__neu" style="width:70px"></td><td></td><td v-if="kind === 'funktionen'"></td><td></td><td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="kind === 'externe'" class="card-body small muted">Andere Abteilungen oder Vereine, die bei Einsätzen mithelfen. Beim Einsatz kann man auch direkt einen neuen Namen eintippen – er landet dann hier. Inaktive Abteilungen werden beim Einsatz nicht mehr vorgeschlagen.</div>
        <div v-if="kind === 'funktionen'" class="card-body small muted">Pro Einsatz legst du fest, wie viele es von jeder Funktion braucht, und weist sie den Angemeldeten zu. Wer keine Funktion zugewiesen hat, zählt als <strong>Standard</strong> (Einsatzteilnehmer). Kleine Zahl bei der Reihenfolge = weiter oben. Nicht zu verwechseln mit der Benutzer-Rolle «Einsatzleiter» (Login).</div>
        <div v-if="kind === 'raenge'" class="card-body small muted">Die Reihenfolge bestimmt die Sortierung: kleine Zahl = tiefer Rang. Listen zeigen die Personen standardmässig vom tiefsten zum höchsten Rang.</div>
      </SectionForm>
    </div>
  </AppShell>
</template>
