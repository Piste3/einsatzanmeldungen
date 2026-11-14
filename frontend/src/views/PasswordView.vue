<script setup>
// Eigenes Passwort ändern, auch erzwungen nach dem Zurücksetzen (wie views/auth/password.ejs)
import { computed, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { session, bootstrap, navigate, flashCarry } from '@/lib/api.js';
import { useSection, leaveAllowed } from '@/lib/section.js';
import { labels } from '@/lib/format.js';

const { env, error } = usePage((r) => r.fullPath, { live: false });
const user = computed(() => session.user);
const form = ref(null);
useSection(form);
async function save() {
  // Nach dem Ändern gilt die Pflicht nicht mehr: Sitzung neu lesen, dann weiter
  const res = await runAction('/konto/passwort', formBody(form.value), { onDone: () => bootstrap({ refreshOnly: true }) });
  if (res?.redirect) { leaveAllowed(); flashCarry.keep = true; await navigate(res.redirect); }
}
</script>

<template>
  <div v-if="error && !env" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="env && user">
    <Topbar heading="Passwort ändern" :crumbs="[['Konto']]" :show-search="false" />
    <nav class="tabs"><router-link to="/konto/passwort" class="active">Passwort</router-link><router-link to="/konto/2fa">Zwei-Faktor</router-link></nav>
    <div v-if="user.must_change_password" class="callout warn mb">Bitte lege jetzt ein eigenes Passwort fest, bevor du weiterarbeitest.</div>
    <div class="card" style="max-width:460px">
      <div class="card-body">
        <dl class="kv left mb"><dt>Benutzername</dt><dd>{{ user.username }}</dd><dt>Rolle</dt><dd>{{ labels.ROLES[user.role] }}</dd></dl>
        <p v-if="user.auth_provider !== 'local'">Dein Konto ist mit Microsoft verknüpft. Das Passwort verwaltest du bei Microsoft.</p>
        <p v-else-if="!Number(user.password_login ?? 1)">Für dein Konto ist die Anmeldung mit Benutzername und Passwort ausgeschaltet. Du meldest dich mit Microsoft an. Darum kannst du hier kein Passwort ändern.</p>
        <form v-else ref="form" @submit.prevent="save">
          <input type="text" name="username" :defaultValue="user.username" autocomplete="username" hidden>
          <div class="field"><label for="current">Aktuelles Passwort</label><input id="current" name="current" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="password">Neues Passwort</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required><div class="field-hint">mindestens 10 Zeichen, nicht der Benutzername</div></div>
          <div class="field"><label for="password_confirm">Neues Passwort wiederholen</label><input id="password_confirm" name="password_confirm" type="password" autocomplete="new-password" required></div>
          <button class="btn btn-primary" type="submit">Passwort ändern</button>
          <p class="small muted mt">Beim Ändern werden alle anderen Sitzungen dieses Kontos abgemeldet.</p>
        </form>
      </div>
    </div>
  </AppShell>
</template>
