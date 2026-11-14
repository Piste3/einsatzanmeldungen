<script setup>
// Einstellungen › Vorlagen: Anmeldefragen, Tenue, Zusatzfelder (wie views/admin/templates.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import SectionForm from '@/components/SectionForm.vue';
import { usePage } from '@/lib/usePage.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Array.isArray(data.value.questions));
const withNew = (list) => list.concat([{ id: '' }]);
const TYPES = [['text', 'Text'], ['textarea', 'Mehrzeilig'], ['number', 'Zahl'], ['date', 'Datum'], ['checkbox', 'Ja/Nein']];
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Einstellungen" :crumbs="[['Einstellungen'], ['Vorlagen']]" :show-search="false" />
    <AdminTabs />
    <div class="stack">
      <SectionForm action="/verwaltung/vorlagen/fragen" :source="data" :reload="refresh">
        <div class="card-head"><h2>Anmeldefragen <span class="hint">zur Auswahl beim Einsatz</span></h2></div>
        <div class="table-wrap"><table class="form-table">
          <thead><tr><th>Name</th><th>Fragetext</th><th>Hilfetext</th><th>Reihenfolge</th><th title="Bei neuen Einsätzen vorausgewählt">Standard</th><th>Entfernen</th></tr></thead>
          <tbody>
            <tr v-for="q in withNew(data.questions)" :key="q.id || 'neu'" :class="q.id ? '' : 'new-row'">
              <td><input v-if="q.id" type="hidden" :name="`row__${q.id}`" value="1"><input type="text" :name="`name__${q.id || 'neu'}`" :defaultValue="q.name || ''" :placeholder="q.id ? '' : '+ Neue Vorlage …'" :required="Boolean(q.id)"></td>
              <td><input type="text" :name="`question_text__${q.id || 'neu'}`" :defaultValue="q.question_text || ''"></td>
              <td><input type="text" :name="`help_text__${q.id || 'neu'}`" :defaultValue="q.help_text || ''"></td>
              <td><input type="number" :name="`sort__${q.id || 'neu'}`" :defaultValue="q.sort ?? ''" style="width:70px"></td>
              <td><label class="check small"><input type="radio" name="default_question" :value="q.id || 'neu'" :defaultChecked="Boolean(q.id && q.id === data.defaultQuestion)"> Standard</label></td>
              <td><label v-if="q.id" class="check small"><input type="checkbox" :name="`delete__${q.id}`" value="1" data-delete-row> entfernen</label></td>
            </tr>
            <tr><td colspan="4" class="right small muted">Kein Standard (bei neuen Einsätzen nichts vorausgewählt)</td><td><label class="check small"><input type="radio" name="default_question" value="" :defaultChecked="!data.defaultQuestion"> keiner</label></td><td></td></tr>
          </tbody>
        </table></div>
      </SectionForm>
      <SectionForm action="/verwaltung/vorlagen/tenue" :source="data" :reload="refresh">
        <div class="card-head"><h2>Tenue-Vorlagen</h2></div>
        <div class="table-wrap"><table class="form-table">
          <thead><tr><th>Name</th><th>Text</th><th>Reihenfolge</th><th>Entfernen</th></tr></thead>
          <tbody>
            <tr v-for="t in withNew(data.tenues)" :key="t.id || 'neu'" :class="t.id ? '' : 'new-row'">
              <td><input v-if="t.id" type="hidden" :name="`row__${t.id}`" value="1"><input type="text" :name="`name__${t.id || 'neu'}`" :defaultValue="t.name || ''" :placeholder="t.id ? '' : '+ Neue Vorlage …'" :required="Boolean(t.id)"></td>
              <td><textarea :name="`text__${t.id || 'neu'}`" rows="2" :defaultValue="t.text || ''"></textarea></td>
              <td><input type="number" :name="`sort__${t.id || 'neu'}`" :defaultValue="t.sort ?? ''" style="width:70px"></td>
              <td><label v-if="t.id" class="check small"><input type="checkbox" :name="`delete__${t.id}`" value="1" data-delete-row> entfernen</label></td>
            </tr>
          </tbody>
        </table></div>
      </SectionForm>
      <SectionForm action="/verwaltung/vorlagen/zusatzfelder" :source="data" :reload="refresh">
        <div class="card-head"><h2>Zusatzfelder für Einsätze <span class="hint">z. B. «Transport» oder «Verpflegung vor Ort» – stehen automatisch als Baustein zur Verfügung</span></h2></div>
        <div class="table-wrap"><table class="form-table">
          <thead><tr><th>Feldname</th><th>Typ</th><th>Pflicht</th><th>Reihenfolge</th><th>Entfernen</th></tr></thead>
          <tbody>
            <tr v-for="f in withNew(data.extras)" :key="f.id || 'neu'" :class="f.id ? '' : 'new-row'">
              <td><input v-if="f.id" type="hidden" :name="`row__${f.id}`" value="1"><input type="text" :name="`name__${f.id || 'neu'}`" :defaultValue="f.name || ''" :placeholder="f.id ? '' : '+ Neues Feld …'" :required="Boolean(f.id)"></td>
              <td><select :name="`field_type__${f.id || 'neu'}`"><option v-for="[t, v] in TYPES" :key="t" :value="t" :defaultSelected="f.field_type === t">{{ v }}</option></select></td>
              <td><input type="checkbox" :name="`required__${f.id || 'neu'}`" value="1" :defaultChecked="Boolean(f.required)"></td>
              <td><input type="number" :name="`sort__${f.id || 'neu'}`" :defaultValue="f.sort ?? ''" style="width:70px"></td>
              <td><label v-if="f.id" class="check small"><input type="checkbox" :name="`delete__${f.id}`" value="1" data-delete-row> entfernen</label></td>
            </tr>
          </tbody>
        </table></div>
        <div class="card-body small muted">Beim Entfernen eines Zusatzfelds bleiben bereits erfasste Werte im Einsatz gespeichert.</div>
      </SectionForm>
    </div>
  </AppShell>
</template>
