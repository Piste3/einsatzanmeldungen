<script setup>
// Einstellungen › Bestätigungsmail (wie views/admin/confirmation.ejs)
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
import { dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath, { live: false });
const conf = computed(() => data.value.conf);
const round = ref(0);
const form = ref(null);
useSection(form, data);
const eventOptions = computed(() => (data.value.eventOptions || []).map((e) => ({ value: e.id, text: `${e.name} (${dates.fmtEventDate(e)})` })));
const einsatz = ref('');
watch(() => data.value.previewEvent, (e) => { einsatz.value = e ? e.id : ''; }, { immediate: true });
const to = computed(() => { const p = data.value.preview; return p.to ? `${p.person.first_name} ${p.person.last_name} <${p.to}>` : `${p.person.first_name} ${p.person.last_name}`; });

async function submit(ev) {
  const action = typeof ev === 'string' ? ev : ev?.submitter?.value || 'save';
  const res = await runAction('/verwaltung/bestaetigungsmail', { ...formBody(form.value), action }, { follow: action === 'save' });
  if (action !== 'save' && res?.data?.conf) { data.value = res.data; round.value += 1; }
}
async function previewEvent() { await nextTick(); submit('preview'); }
</script>

<template>
  <div v-if="error && !conf" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="conf">
    <Topbar heading="Anmeldebestätigung per E-Mail" :crumbs="[['Einstellungen'], ['Bestätigungsmail']]" :show-search="false">
      <template #actions><button class="btn" type="submit" form="conf-form" name="action" value="preview">Vorschau</button><button class="btn btn-primary" type="submit" form="conf-form" name="action" value="save">Speichern</button></template>
    </Topbar>
    <AdminTabs />
    <div v-if="data.unsaved" class="flash flash-info">Vorschau mit ungespeicherten Änderungen – zum Übernehmen «Speichern» klicken.</div>
    <div v-if="data.testResult" :class="['flash', data.testResult.ok ? 'flash-success' : 'flash-error']">{{ data.testResult.msg }}</div>
    <form id="conf-form" ref="form" :key="round" class="grid grid-main" @submit.prevent="submit">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Vorlage</h2>
            <label class="check"><input type="checkbox" name="enabled" value="1" :defaultChecked="Boolean(conf.enabled)"> beim Bestätigen automatisch senden</label></div>
          <div class="card-body">
            <div v-if="!data.smtp" class="callout warn mb">Es ist kein Mailserver (SMTP) eingerichtet. Bestätigungen werden im Postausgang unter «Formulare» abgelegt, aber nicht versendet. Eintragen unter <router-link to="/verwaltung/server">Einstellungen › Server</router-link>.</div>
            <p class="small muted mb">Die Mail geht an die E-Mail-Adresse der Person, sobald ihre Anmeldung auf «Bestätigt» gesetzt wird. Personen ohne E-Mail-Adresse bekommen keine.</p>
            <div class="field"><label for="subject">Betreff</label><input id="subject" type="text" name="subject" :defaultValue="conf.subject" data-token-target></div>
            <div class="field"><label for="body">Text</label>
              <RichEditor id="body" name="body" format-name="body_format" :value="data.editorValue" :rows="20" />
              <div class="field-hint">Zeilen (und Tabellenzeilen), in denen ein Baustein leer ist, werden weggelassen. Die Mail geht formatiert raus, zusätzlich mit einer Klartext-Fassung für Mailprogramme ohne HTML.</div></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Vorschau mit einem echten Einsatz</h2>
            <SearchSelect v-model="einsatz" name="einsatz" :options="eventOptions" :default-value="data.previewEvent ? String(data.previewEvent.id) : ''" style="width:auto" @change="previewEvent" /></div>
          <div class="card-body ics-preview">
            <p v-if="!data.preview" class="muted">Noch kein Einsatz vorhanden.</p>
            <template v-else>
              <div class="meta">An: {{ to }}</div>
              <div class="title">{{ data.preview.subject }}</div>
              <div v-if="data.preview.html" class="desc rich" v-html="data.preview.html"></div>
              <div v-else class="desc rich"><div style="white-space:pre-wrap">{{ data.preview.body }}</div></div>
            </template>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Testmail</h2></div>
          <div class="card-body">
            <p class="small muted mb">Schickt die Vorlage (auch ungespeichert) mit dem oben gewählten Einsatz an eine Adresse deiner Wahl. So prüfst du gleich auch, ob der Mailversand funktioniert.</p>
            <div class="row"><input type="email" name="test_to" :defaultValue="data.testTo" placeholder="deine@adresse.ch" style="max-width:320px"><button class="btn" type="submit" name="action" value="test">Testmail senden</button></div>
          </div>
        </div>
      </div>
      <TokenBlocks :groups="data.groups"><p class="small muted mt">Bei mehreren zugeteilten Schichten stehen bei «Schichtname» alle Schichten.</p></TokenBlocks>
    </form>
  </AppShell>
</template>
