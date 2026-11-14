<script setup>
// Stammdaten aus ClubDesk importieren: Datei, Spalten zuordnen, Vorschau, Import (wie views/pages/import.ejs)
import { computed, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection } from '@/lib/section.js';
import { post, ApiError, setFlashes } from '@/lib/api.js';
import { dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath, { live: false });
const ready = computed(() => Boolean(data.value.fields));
const preview = ref(null);
const round = ref(0);
const busy = ref(false);
const showErrors = (e) => setFlashes((e.messages || [e.message]).map((m) => ({ type: 'error', message: m })));
function show(res) {
  if (!res?.data?.preview) return;
  preview.value = res.data.preview;
  round.value += 1;
}

// 1. Datei hochladen: es wird noch nichts gespeichert
const fileForm = ref(null);
async function upload() {
  busy.value = true;
  try { show(await post('/personen/import', new FormData(fileForm.value))); } catch (e) { if (e instanceof ApiError) showErrors(e); else throw e; } finally { busy.value = false; }
}

// 2./3. Zuordnung ändern oder Import ausführen
const mapForm = ref(null);
useSection(mapForm, preview);
async function submit(ev) {
  const body = { ...formBody(mapForm.value), commit: ev.submitter?.value || '0' };
  const res = await runAction('/personen/import', body, { follow: body.commit === '1' });
  show(res);
}
const rows = computed(() => preview.value?.rows || []);
const counts = computed(() => ({ ok: rows.value.filter((x) => x.action === 'create').length, dups: rows.value.filter((x) => x.duplicate).length, errs: rows.value.filter((x) => x.errors.length).length }));
function again() { preview.value = null; setFlashes([]); }
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Stammdaten importieren" :crumbs="[['Personen', '/personen'], ['Import']]" :show-search="false" />
    <div v-if="!preview" class="card">
      <div class="card-head"><h2>1. Datei wählen <span class="hint">ClubDesk-Export als Excel (.xlsx) oder CSV</span></h2></div>
      <form ref="fileForm" class="card-body" @submit.prevent="upload">
        <div class="field"><input type="file" name="datei" accept=".xlsx,.csv,.txt" required></div>
        <p class="small muted">Die erste Zeile muss die Spaltenüberschriften enthalten (z. B. Vorname, Nachname, Geburtsdatum, Mobil, E-Mail, Rang, Mannschaft). Nach dem Hochladen siehst du eine Vorschau mit Dublettenprüfung und Fehlerliste – es wird noch nichts gespeichert.</p>
        <button class="btn btn-primary" type="submit" :disabled="busy">Vorschau anzeigen</button>
      </form>
    </div>
    <form v-else ref="mapForm" :key="round" @submit.prevent="submit">
      <input type="hidden" name="preview_id" :value="preview.id">
      <div class="card">
        <div class="card-head"><h2>2. Spalten zuordnen</h2><button class="btn btn-sm" type="submit" name="commit" value="0">Vorschau aktualisieren</button></div>
        <div class="card-body">
          <div class="grid grid-4">
            <div v-for="(f, key) in data.fields" :key="key" class="field"><label>{{ f.label }}</label><select :name="`map_${key}`"><option value="">– nicht importieren –</option><option v-for="(hd, i) in preview.headers" :key="i" :value="i" :defaultSelected="preview.mapping[key] === i">{{ hd || `Spalte ${i + 1}` }}</option></select></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>3. Vorschau</h2><span class="row"><Badge :text="`${counts.ok} neu`" tone="green" /><Badge :text="`${counts.dups} Dubletten`" tone="yellow" /><Badge :text="`${counts.errs} Fehler`" :tone="counts.errs ? 'red' : 'gray'" /></span></div>
        <div v-if="preview.newRanks.length || preview.newTeams.length" class="card-body"><div class="callout">Neu angelegt werden: {{ [...preview.newRanks.map((x) => `Rang «${x}»`), ...preview.newTeams.map((x) => `Mannschaft «${x}»`)].join(', ') }}</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Zeile</th><th>Name</th><th>Geburtsdatum / Jahrgang</th><th>Mobil</th><th>E-Mail</th><th>Rang</th><th>Mannschaft</th><th>Prüfung</th><th>Aktion</th></tr></thead>
            <tbody>
              <tr v-for="x in rows" :key="x.line">
                <td>{{ x.line }}</td>
                <td><strong>{{ x.data.first_name }} {{ x.data.last_name }}</strong></td>
                <td>{{ x.data.birth_date ? dates.fmtDate(x.data.birth_date) : (x.data.birth_year || '–') }}</td>
                <td>{{ x.data.mobile || '–' }}</td>
                <td>{{ x.data.email || '–' }}</td>
                <td>{{ x.rankRaw || '–' }}</td>
                <td>{{ x.teamNames.join(', ') || '–' }}</td>
                <td class="small">
                  <div v-for="(e, i) in x.errors" :key="`e${i}`"><Badge :text="e" tone="red" /></div>
                  <div v-if="x.duplicate"><Badge :text="`Dublette: ${x.duplicate.text}`" tone="yellow" /></div>
                  <div v-for="(w, i) in x.warnings" :key="`w${i}`" class="muted">{{ w }}</div>
                  <Badge v-if="!x.errors.length && !x.duplicate && !x.warnings.length" text="ok" tone="green" />
                </td>
                <td>
                  <span v-if="x.errors.length" class="muted">übersprungen</span>
                  <select v-else :name="`action_${x.line}`">
                    <option value="create" :defaultSelected="x.action === 'create'">anlegen</option>
                    <option value="skip" :defaultSelected="x.action === 'skip'">überspringen</option>
                    <option v-if="x.duplicate && x.duplicate.personId" value="update">leere Felder ergänzen</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="card-body row"><button class="btn btn-primary" type="submit" name="commit" value="1">Import ausführen</button><a class="btn btn-ghost" href="/personen/import" @click.prevent="again">Andere Datei</a><span class="small muted">Neue Personen legt nur ein berechtigter Benutzer an – nie das System automatisch.</span></div>
      </div>
    </form>
  </AppShell>
</template>
