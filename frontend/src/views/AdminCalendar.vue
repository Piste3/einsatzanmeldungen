<script setup>
// Einstellungen › Kalendertermin: Vorlage für das Aufgebot (wie views/admin/calendar.ejs)
import { computed, ref, watch, nextTick } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import RichEditor from '@/components/RichEditor.vue';
import TokenBlocks from '@/components/TokenBlocks.vue';
import SearchSelect from '@/components/SearchSelect.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection } from '@/lib/section.js';
import { dates, initials } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath, { live: false });
const tpl = computed(() => data.value.tpl);
const round = ref(0); // Editor nach neuer Antwort vom Server neu aufbauen
const form = ref(null);
useSection(form, data);
const eventOptions = computed(() => (data.value.eventOptions || []).map((e) => ({ value: e.id, text: `${e.name} (${dates.fmtEventDate(e)})` })));
const einsatz = ref('');
watch(() => data.value.previewEvent, (e) => { einsatz.value = e ? e.id : ''; }, { immediate: true });
const REMINDERS = [[0, 'keine'], [60, '1 Stunde vorher'], [180, '3 Stunden vorher'], [1440, '1 Tag vorher'], [2880, '2 Tage vorher'], [10080, '1 Woche vorher']];

async function submit(ev) {
  const body = formBody(form.value);
  const preview = ev?.submitter?.value === '1' || ev === 'preview';
  if (preview) body.preview = '1';
  const res = await runAction('/verwaltung/kalendertermin', body, { follow: !preview });
  if (preview && res?.data?.tpl) { data.value = res.data; round.value += 1; }
}
// Anderer Einsatz für die Vorschau: Vorschau mit dem aktuellen (ungespeicherten) Stand
async function previewEvent() { await nextTick(); submit('preview'); }
</script>

<template>
  <div v-if="error && !tpl" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="tpl">
    <Topbar heading="Vorlage für das Aufgebot" :crumbs="[['Einstellungen'], ['Kalendertermin']]" :show-search="false">
      <template #actions><button class="btn" type="submit" form="cal-form" name="preview" value="1">Vorschau</button><button class="btn btn-primary" type="submit" form="cal-form">Speichern</button></template>
    </Topbar>
    <AdminTabs />
    <div v-if="data.unsaved" class="flash flash-info">Vorschau mit ungespeicherten Änderungen – zum Übernehmen «Speichern» klicken.</div>
    <form id="cal-form" ref="form" :key="round" class="grid grid-main" @submit.prevent="submit">
      <div class="stack">
        <div class="card">
          <div class="card-body">
            <div class="field"><label for="title">Titel des Termins</label><input id="title" type="text" name="title" :defaultValue="tpl.title" data-token-target></div>
            <div class="fields fields-2">
              <div class="field"><label for="location">Ort</label><input id="location" type="text" name="location" :defaultValue="tpl.location" data-token-target></div>
              <div class="field"><label>Termin von – bis</label><input type="text" value="Antreten (Beginn) bis Abtreten (Ende)" disabled></div>
            </div>
            <div class="field"><label for="description">Beschreibung</label>
              <RichEditor id="description" name="description" format-name="description_format" :value="data.editorValue" :rows="22" /></div>
            <div class="row">
              <label class="check"><input type="checkbox" name="omit_empty_lines" value="1" :defaultChecked="Boolean(tpl.omit_empty_lines)"> Zeilen mit leerem Baustein weglassen</label>
              <label class="check"><input type="checkbox" name="attendees" value="1" :defaultChecked="Boolean(tpl.attendees)"> Angemeldete als Kalender-Teilnehmende eintragen</label>
              <label class="row small">Erinnerung
                <select name="reminder_minutes" style="width:auto"><option v-for="[v, l] in REMINDERS" :key="v" :value="v" :defaultSelected="Number(tpl.reminder_minutes) === v">{{ l }}</option></select></label>
            </div>
            <div class="field mt">
              <label for="html_mode">Formatierung im Kalender</label>
              <select id="html_mode" name="html_mode" style="width:auto;max-width:100%">
                <option value="alt" :defaultSelected="tpl.html_mode !== 'description'">Normal: Klartext + formatierte Fassung (Outlook zeigt die Formatierung)</option>
                <option value="description" :defaultSelected="tpl.html_mode === 'description'">HTML direkt in der Beschreibung (z. B. Google Kalender, ClubDesk)</option>
              </select>
              <div class="field-hint">Nicht jeder Kalender zeigt Formatierungen an. Apple Kalender zeigt immer den Klartext. Falls nach dem Import HTML-Zeichen wie &lt;div&gt; erscheinen, «Normal» wählen.</div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Vorschau mit einem echten Einsatz</h2>
            <SearchSelect v-model="einsatz" name="einsatz" :options="eventOptions" :default-value="data.previewEvent ? String(data.previewEvent.id) : ''" style="width:auto" @change="previewEvent" /></div>
          <div class="card-body ics-preview">
            <p v-if="!data.preview" class="muted">Noch kein Einsatz vorhanden.</p>
            <template v-else>
              <div class="title">{{ data.preview.summary }}</div>
              <div class="meta">{{ data.preview.start ? `${dates.fmtDateLong(data.preview.start.slice(0, 10))} · ${data.preview.start.slice(11, 16)}–${(data.preview.end || '').slice(11, 16)}` : '' }}<br>{{ data.preview.location }}<br>{{ tpl.reminder_minutes ? 'Erinnerung aktiv' : '' }}</div>
              <div class="grid grid-main">
                <div v-if="data.preview.descriptionHtml" class="desc rich" v-html="data.preview.descriptionHtml"></div>
                <div v-else class="desc rich"><div style="white-space:pre-wrap">{{ data.preview.description }}</div></div>
                <div class="small"><strong class="muted">TEILNEHMENDE · {{ data.preview.people.length }}</strong>
                  <div v-for="p in data.preview.people" :key="p.id || `${p.first_name}${p.last_name}`" class="row mt-s"><span class="avatar">{{ initials(`${p.first_name} ${p.last_name}`) }}</span>{{ p.rank_short || '' }} {{ p.first_name }} {{ p.last_name }}{{ p.email ? '' : ' (keine E-Mail)' }}</div>
                  <p v-if="!data.preview.people.length" class="muted">Noch keine bestätigten Anmeldungen.</p>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
      <TokenBlocks :groups="data.groups"><p class="small muted mt">Leere Bausteine: Ist ein Baustein für einen Einsatz leer, wird die ganze Zeile weggelassen (abschaltbar).</p></TokenBlocks>
    </form>
  </AppShell>
</template>
