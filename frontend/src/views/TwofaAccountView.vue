<script setup>
// Eigene Zwei-Faktor-Anmeldung: einrichten, Codes erneuern, Geräte vergessen, abschalten (wie views/auth/twofa-account.ejs)
import { computed, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction } from '@/lib/actions.js';
import { bootstrap } from '@/lib/api.js';
import { dates } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath, { live: false });
const ready = computed(() => Boolean(data.value.u));
const errors = computed(() => data.value.errors || []);

// Einrichten und neue Codes: Die Antwort ist die neue Seite (mit den einmal sichtbaren Codes)
const setupCode = ref('');
const newCode = ref('');
const offPassword = ref('');
function adopt(res) { if (res?.data?.u) data.value = res.data; }
async function enable() {
  const res = await runAction('/konto/2fa/einrichten', { code: setupCode.value });
  setupCode.value = '';
  adopt(res);
  if (res?.data?.enabled) await bootstrap({ refreshOnly: true });
}
async function codes() {
  const res = await runAction('/konto/2fa/codes', { code: newCode.value });
  newCode.value = '';
  adopt(res);
}
const forget = () => runAction('/konto/2fa/geraete', {}, { onDone: refresh });
async function off() {
  const res = await runAction('/konto/2fa/aus', { password: offPassword.value }, { confirm: 'Zwei-Faktor-Anmeldung wirklich abschalten?' });
  offPassword.value = '';
  if (res?.redirect) { await refresh(); await bootstrap({ refreshOnly: true }); } else adopt(res);
}
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Zwei-Faktor-Anmeldung" :crumbs="[['Konto']]" :show-search="false" />
    <nav class="tabs"><router-link to="/konto/passwort">Passwort</router-link><router-link to="/konto/2fa" class="active">Zwei-Faktor</router-link></nav>
    <div v-if="errors.length" class="flash flash-error">{{ errors.join(' ') }}</div>
    <div v-if="data.required && !data.enabled" class="callout warn mb">Für dein Konto ist die Zwei-Faktor-Anmeldung vorgeschrieben. Bitte richte sie jetzt ein, danach kannst du weiterarbeiten.</div>
    <div class="grid grid-main">
      <div class="stack">
        <div v-if="data.codes" class="card card-highlight">
          <div class="card-head"><h2>{{ data.justEnabled ? 'Eingerichtet! Jetzt die Wiederherstellungscodes sichern' : 'Neue Wiederherstellungscodes' }}</h2></div>
          <div class="card-body">
            <p class="small">Mit diesen Codes kommst du hinein, falls das Handy verloren geht. <strong>Jeder Code gilt einmal.</strong> Speichere oder drucke sie jetzt, denn sie werden nur dieses eine Mal angezeigt. Ältere Codes sind ab sofort ungültig.</p>
            <div class="recovery-codes"><code v-for="c in data.codes" :key="c">{{ c }}</code></div>
            <button class="btn btn-sm mt" type="button" data-print>Drucken</button>
          </div>
        </div>

        <div v-if="data.u.auth_provider !== 'local'" class="card"><div class="card-body">Dein Konto meldet sich über Microsoft an. Die Zwei-Faktor-Anmeldung stellst du dort ein.</div></div>
        <div v-else-if="!data.enabled && data.setup" class="card">
          <div class="card-head"><h2>Einrichten</h2></div>
          <div class="card-body">
            <ol class="steps small">
              <li>Installiere auf dem Handy eine Authenticator-App, z. B. <strong>Microsoft Authenticator</strong>, <strong>Google Authenticator</strong> oder die Passwort-App auf dem iPhone.</li>
              <li>Scanne in der App diesen QR-Code:</li>
            </ol>
            <div class="qr" v-html="data.setup.qr"></div>
            <p class="small muted">Scannen nicht möglich? Diesen Schlüssel von Hand eingeben: <code class="secret">{{ data.setup.secret }}</code></p>
            <form class="mt" @submit.prevent="enable">
              <ol class="steps small" start="3"><li>Gib zur Bestätigung den 6-stelligen Code ein, den die App jetzt anzeigt:</li></ol>
              <div class="row"><input v-model="setupCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required class="code-input" placeholder="123 456" style="max-width:160px"><button class="btn btn-primary" type="submit">Aktivieren</button></div>
            </form>
          </div>
        </div>
        <template v-else-if="data.enabled">
          <div class="card">
            <div class="card-head"><h2>Status</h2><Badge text="aktiv" tone="green" /></div>
            <div class="card-body small">
              <p>Beim Anmelden wird nach dem Passwort ein Code aus deiner Authenticator-App verlangt{{ data.rememberLabel ? `, ${data.rememberLabel}` : '' }}.</p>
              <dl class="kv left mt-s">
                <dt>Eingerichtet</dt><dd>{{ dates.fmtDateTime(data.u.totp_enabled_at) }}</dd>
                <dt>Wiederherstellungscodes</dt><dd>{{ data.remaining }} übrig{{ data.remaining <= 2 ? ' – bitte neue erzeugen' : '' }}</dd>
                <dt>Gemerkte Geräte</dt><dd>{{ data.devices }}</dd>
              </dl>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Neue Wiederherstellungscodes</h2></div>
            <div class="card-body">
              <form class="row" @submit.prevent="codes">
                <input v-model="newCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required class="code-input" placeholder="Code aus der App" style="max-width:180px">
                <button class="btn" type="submit">Neue Codes erzeugen</button>
              </form>
            </div>
          </div>
          <div v-if="data.devices" class="card"><div class="card-body row-between">
            <span class="small">Alle Geräte vergessen, auf denen «nicht mehr fragen» gewählt wurde.</span>
            <form @submit.prevent="forget"><button class="btn btn-sm" type="submit">Geräte vergessen</button></form>
          </div></div>
          <div v-if="!data.required" class="card card-danger">
            <div class="card-head"><h2>Abschalten</h2></div>
            <div class="card-body">
              <form class="row" @submit.prevent="off">
                <input v-model="offPassword" name="password" type="password" autocomplete="current-password" required placeholder="Dein Passwort" style="max-width:220px">
                <button class="btn btn-danger" type="submit">Abschalten</button>
              </form>
            </div>
          </div>
        </template>
      </div>
      <div class="card">
        <div class="card-head"><h2>Was ist das?</h2></div>
        <div class="card-body small">
          <p>Mit der Zwei-Faktor-Anmeldung reicht das Passwort allein nicht mehr. Zusätzlich braucht es einen Code, den nur dein Handy erzeugt. Wer dein Passwort errät oder mitliest, kommt so trotzdem nicht hinein.</p>
          <p class="mt-s">Der Code wechselt alle 30 Sekunden und funktioniert auch ohne Internet auf dem Handy.</p>
        </div>
      </div>
    </div>
  </AppShell>
</template>
