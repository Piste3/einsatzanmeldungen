<script setup>
// Einstellungen › Server: Werte aus der .env (wie views/admin/server.ejs)
import { computed, reactive, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import SectionForm from '@/components/SectionForm.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction } from '@/lib/actions.js';
import { plural } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Array.isArray(data.value.groups));
const open = reactive({});
const own = (g) => g.fields.filter((f) => f.source === 'verwaltung').length;
const testTo = ref(null);
const sendTest = () => runAction('/verwaltung/server/testmail', { test_to: testTo.value ?? data.value.testTo });
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Einstellungen" :crumbs="[['Einstellungen'], ['Server']]" :show-search="false" />
    <AdminTabs />
    <div class="grid grid-main">
      <SectionForm action="/verwaltung/server" :source="data" :reload="refresh" hint="Mehrere Werte ändern, dann einmal speichern." autocomplete="off">
        <input type="hidden" name="has__AUTH_PROVIDERS" value="1">
        <div class="card-head"><h2>Werte aus der .env <span class="hint">Gruppe anklicken zum Aufklappen</span></h2></div>
        <div class="card-body small muted">Was du hier speicherst, gilt sofort und geht der <code>.env</code> auf dem Server vor. Ohne Eintrag hier gilt die <code>.env</code>, ohne Eintrag dort der Standardwert. Mit «zurück auf .env» löschst du den Wert hier wieder.</div>
        <div class="table-wrap">
          <table class="form-table server-table">
            <thead><tr><th>Einstellung</th><th>Wert</th><th>Quelle</th></tr></thead>
            <tbody v-for="(g, gi) in data.groups" :key="g.name">
              <tr class="group-row"><th colspan="3"><button type="button" class="group-toggle" :aria-expanded="String(Boolean(open[gi]))" @click="open[gi] = !open[gi]"><span class="chev" aria-hidden="true">▸</span> {{ g.name }}</button> <span class="muted small">· {{ plural(g.fields.length, 'Wert', 'Werte') }}{{ own(g) ? ` · ${own(g)} hier geändert` : '' }}</span></th></tr>
              <tr v-for="f in g.fields" v-show="open[gi]" :key="f.key">
                <td class="server-label">
                  <label :for="`v__${f.key}`">{{ f.label }}</label>
                  <code class="server-key">{{ f.key }}</code>
                  <div class="field-hint">{{ f.help }}</div>
                </td>
                <td class="server-value">
                  <select v-if="f.type === 'bool'" :id="`v__${f.key}`" :name="`v__${f.key}`">
                    <option value="true" :defaultSelected="f.value === 'true'">Ja</option>
                    <option value="false" :defaultSelected="f.value === 'false'">Nein</option>
                  </select>
                  <div v-else-if="f.type === 'providers'" :id="`v__${f.key}`" class="check-list">
                    <label class="check"><input type="checkbox" :name="`v__${f.key}`" value="local" :defaultChecked="f.value.split(',').includes('local')"> Passwort</label>
                    <label class="check"><input type="checkbox" :name="`v__${f.key}`" value="microsoft" :defaultChecked="f.value.split(',').includes('microsoft')"> Microsoft</label>
                  </div>
                  <input v-else-if="f.type === 'secret'" :id="`v__${f.key}`" type="password" :name="`v__${f.key}`" defaultValue="" autocomplete="new-password" :placeholder="f.isSet ? 'gesetzt – leer lassen = unverändert' : 'nicht gesetzt'">
                  <span v-else-if="f.type === 'number'" class="row"><input :id="`v__${f.key}`" type="number" :name="`v__${f.key}`" :defaultValue="f.value" :min="f.min" :max="f.max" required style="width:110px"><span v-if="f.unit" class="small muted">{{ f.unit }}</span></span>
                  <input v-else-if="f.type === 'date'" :id="`v__${f.key}`" type="date" :name="`v__${f.key}`" :defaultValue="f.value">
                  <textarea v-else-if="f.wide" :id="`v__${f.key}`" :name="`v__${f.key}`" rows="3" :defaultValue="f.value"></textarea>
                  <input v-else :id="`v__${f.key}`" type="text" :inputmode="f.type === 'url' ? 'url' : undefined" :name="`v__${f.key}`" :defaultValue="f.value" :placeholder="f.placeholder" spellcheck="false">
                </td>
                <td class="server-source"><Badge v-if="f.source === 'verwaltung'" text="Verwaltung" tone="orange" /><Badge v-else-if="f.source === 'env'" text=".env" /><span v-else class="small muted">Standard</span><div v-if="f.overridesEnv" class="field-hint">überschreibt .env</div><label v-if="f.source === 'verwaltung'" class="check small mt-s"><input type="checkbox" :name="`reset__${f.key}`" value="1"> zurück auf .env</label></td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionForm>
      <div class="stack">
        <details class="card help-fold-card">
          <summary class="card-head"><h2>Nur in der .env <span class="hint">Port, Datenordner …</span></h2><span class="btn btn-sm">Anzeigen</span></summary>
          <div class="card-body small">
            <p class="muted">Diese Werte braucht der Server, bevor er startet. Darum lassen sie sich nur in der Datei <code>.env</code> ändern, danach unter <router-link to="/verwaltung/system">System</router-link> neu starten.</p>
            <dl class="server-readonly">
              <div v-for="f in data.readonly" :key="f.key">
                <dt>{{ f.label }} <code>{{ f.key }}</code></dt>
                <dd><code>{{ f.value || '–' }}</code>{{ ' ' }}<Badge v-if="f.source === 'env'" text=".env" /><span v-else class="small muted">Standard</span></dd>
                <dd class="field-hint">{{ f.reason }}</dd>
              </div>
            </dl>
          </div>
        </details>
        <form class="card" @submit.prevent="sendTest">
          <div class="card-head"><h2>Mailserver testen</h2></div>
          <div class="card-body small">
            <p v-if="!data.smtp" class="muted">Noch kein Mailserver eingetragen. Mails bleiben im Postausgang.</p>
            <div class="field"><label for="test_to">Testmail an</label><input id="test_to" type="email" name="test_to" :value="testTo ?? data.testTo" required @input="testTo = $event.target.value"></div>
            <button class="btn btn-sm mt-s" type="submit">Testmail senden</button>
          </div>
        </form>
        <div class="card">
          <div class="card-head"><h2>Ausgesperrt?</h2></div>
          <div class="card-body small">
            <p>Wer sich mit einem Wert hier ausgesperrt hat, doppelklickt auf dem Server im Ordner <code>betrieb\windows</code> auf <code>server-zuruecksetzen.cmd</code>. Das löscht alle Werte dieser Seite und startet den Einsatzplaner neu, danach gilt wieder die <code>.env</code>.</p>
            <p class="muted">Linux: <code>betrieb/linux/server-zuruecksetzen.sh</code>. Nur einzelne Werte: Namen anhängen, z. B. <code>server-zuruecksetzen.cmd AUTH_PROVIDERS</code>.</p>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
