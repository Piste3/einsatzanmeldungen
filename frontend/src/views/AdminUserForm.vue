<script setup>
// Benutzerkonto anlegen oder bearbeiten, danach Startpasswort zeigen (wie views/admin/user-form.ejs und user-created.ejs)
import { computed, ref, watch } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import SearchSelect from '@/components/SearchSelect.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection, leaveAllowed } from '@/lib/section.js';
import { session } from '@/lib/api.js';
import { labels, dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath, { live: false });
const u = computed(() => data.value.u);
const isNew = computed(() => Boolean(data.value.isNew));
const created = ref(null);
watch(data, () => { created.value = null; });
const heading = computed(() => (created.value ? created.value.title : isNew.value ? 'Neues Benutzerkonto' : u.value.display_name));
const crumbs = computed(() => (created.value ? [['Einstellungen', '/verwaltung'], ['Benutzer', '/verwaltung/benutzer']] : [['Einstellungen', '/verwaltung'], ['Benutzer', '/verwaltung/benutzer'], [isNew.value ? 'Neu' : u.value.display_name]]));
const personOptions = computed(() => (data.value.persons || []).map((p) => ({ value: p.id, text: `${p.last_name} ${p.first_name}${p.rank_short ? ` (${p.rank_short})` : ''}` })));
const personId = ref('');
watch(u, (v) => { if (v) personId.value = v.person_id ? Number(v.person_id) : ''; }, { immediate: true });
const pwLogin = computed(() => Number(u.value.password_login ?? 1));

const form = ref(null);
useSection(form, data);
// Antwort mit Startpasswort: auf derselben Seite zeigen
function show(res) {
  if (res?.view !== 'admin/user-created') return false;
  leaveAllowed();
  created.value = { ...res.data, title: res.title };
  window.scrollTo(0, 0);
  return true;
}
async function save() {
  const path = isNew.value ? '/verwaltung/benutzer' : `/verwaltung/benutzer/${u.value.id}`;
  const res = await runAction(path, formBody(form.value), { follow: !isNew.value });
  show(res);
}
async function resetPassword() {
  const res = await runAction(`/verwaltung/benutzer/${u.value.id}/passwort`, {}, { confirm: `Passwort von ${u.value.display_name} zurücksetzen?`, follow: true });
  show(res);
}
const resetTwofa = () => runAction(`/verwaltung/benutzer/${u.value.id}/2fa-zuruecksetzen`, {}, { confirm: `Zwei-Faktor-Anmeldung von ${u.value.display_name} zurücksetzen?`, follow: true });
const remove = () => runAction(`/verwaltung/benutzer/${u.value.id}/loeschen`, {}, { confirm: `Benutzerkonto «${u.value.username}» (${u.value.display_name}) endgültig löschen?`, follow: true });
</script>

<template>
  <div v-if="error && !u" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="u">
    <Topbar :heading="heading" :crumbs="crumbs" :show-search="false" />
    <div v-if="created" class="card" style="max-width:520px"><div class="card-body">
      <dl class="kv left"><dt>Name</dt><dd>{{ created.u.display_name }}</dd><dt>Benutzername</dt><dd><strong>{{ created.u.username }}</strong></dd><dt>Rolle</dt><dd>{{ labels.ROLES[created.u.role] }}</dd>
        <template v-if="created.password"><dt>Startpasswort</dt><dd><code class="pre" style="font-size:16px">{{ created.password }}</code></dd></template></dl>
      <div v-if="created.password" class="callout warn mt">Das Startpasswort wird nur jetzt angezeigt. Bitte sicher übermitteln – beim ersten Login muss es geändert werden.</div>
      <router-link class="btn mt" to="/verwaltung/benutzer">Zur Benutzerliste</router-link>
    </div></div>
    <div v-else class="grid grid-main">
      <form ref="form" class="card" @submit.prevent="save">
        <div class="card-body">
          <div class="fields fields-2">
            <div class="field"><label for="display_name">Anzeigename</label><input id="display_name" type="text" name="display_name" :defaultValue="u.display_name || ''" required></div>
            <div class="field"><label for="username">Benutzername</label><input id="username" type="text" name="username" :defaultValue="u.username || ''" :required="isNew" :disabled="!isNew" autocomplete="off"></div>
          </div>
          <div class="fields fields-2">
            <div class="field"><label for="role">Rolle</label><select id="role" name="role"><option v-for="(v, k) in labels.ROLES" :key="k" :value="k" :defaultSelected="u.role === k">{{ v }}</option></select>
              <div class="field-hint">Admin: Stammdaten, Benutzer, Einstellungen und alles der Aufgebotsstelle. Einsatzleiter: sieht nur Einsätze, die die Aufgebotsstelle freigibt (Angaben und Teilnehmer, nur lesen).</div></div>
            <div class="field"><label for="email">E-Mail</label><input id="email" type="email" name="email" :defaultValue="u.email || ''"><div class="field-hint">bei Microsoft-Anmeldung: die Adresse des Microsoft-Kontos</div></div>
          </div>
          <div class="field"><label for="person_id">Verknüpfte Person (Stammdaten)</label>
            <SearchSelect id="person_id" v-model="personId" name="person_id" :options="personOptions" :default-value="u.person_id ? String(u.person_id) : ''" allow-empty />
            <div class="field-hint">Daraus kommen Rang und Name als «Absender» im Aufgebot.</div></div>
          <fieldset v-if="data.msEnabled || Number(u.ms_login)" class="fieldset mt">
            <legend>Anmeldung</legend>
            <input type="hidden" name="login_fields" value="1">
            <label class="check"><input type="checkbox" name="ms_login" value="1" :defaultChecked="Boolean(Number(u.ms_login))"> Mit dem Microsoft-Konto dieser E-Mail-Adresse anmelden erlaubt</label>
            <div class="field-hint">{{ u.ms_linked ? 'Verknüpft: Die Person hat sich schon mit Microsoft angemeldet. Ausschalten oder eine andere E-Mail löst die Verknüpfung.' : 'Beim ersten Microsoft-Login wird das Konto über die E-Mail-Adresse verknüpft.' }}{{ data.msEnabled ? '' : ' Die Microsoft-Anmeldung ist auf dem Server zurzeit ausgeschaltet.' }}</div>
            <label class="check mt-s"><input type="checkbox" name="password_login" value="1" :defaultChecked="Boolean(pwLogin)"> Mit Benutzername und Passwort anmelden erlaubt</label>
            <div class="field-hint">Ausschalten = nur noch Microsoft. Dein eigenes Konto erst, nachdem du dich einmal mit Microsoft angemeldet hast. Notausgang: Wird die Microsoft-Anmeldung auf dem Server ausgeschaltet (Einstellungen › Server: nur «Passwort», oder <code>AUTH_PROVIDERS=local</code>), gilt das Passwort wieder für alle.</div>
          </fieldset>
          <fieldset class="fieldset mt">
            <legend>Zwei-Faktor-Anmeldung</legend>
            <label class="check"><input type="checkbox" name="twofa_required" value="1" :defaultChecked="Boolean(Number(u.twofa_required))"> Pflicht für dieses Konto <span class="muted small">(muss beim nächsten Login eingerichtet werden)</span></label>
            <div class="field mt-s"><label for="twofa_remember_days">Code verlangen</label>
              <select id="twofa_remember_days" name="twofa_remember_days" style="max-width:320px"><option v-for="[d, l] in data.twofaOptions" :key="d" :value="d" :defaultSelected="Number(u.twofa_remember_days || 0) === d">{{ l }}</option></select>
              <div class="field-hint">Gilt für alle, die 2FA eingerichtet haben – auch freiwillig. «Pro Gerät» heisst: beim Login lässt sich «nicht mehr fragen» ankreuzen.</div></div>
          </fieldset>
          <div v-if="isNew" class="field"><label for="password">Startpasswort</label><input id="password" type="text" name="password" autocomplete="off" placeholder="leer lassen = zufällig erzeugen"><div class="field-hint">Muss beim ersten Login geändert werden.</div></div>
          <label v-else class="check"><input type="checkbox" name="active" value="1" :defaultChecked="Boolean(u.active)"> Konto aktiv</label>
        </div>
        <div class="card-body row"><button class="btn btn-primary" type="submit">Speichern</button><router-link class="btn btn-ghost" to="/verwaltung/benutzer">Abbrechen</router-link></div>
      </form>
      <template v-if="!isNew">
        <div class="card"><div class="card-head"><h2>Passwort</h2></div><div class="card-body">
          <p v-if="!pwLogin" class="small muted">Gesperrt: Die Anmeldung mit Benutzername und Passwort ist für dieses Konto ausgeschaltet. Darum lässt sich das Passwort nicht zurücksetzen. Zuerst oben «Mit Benutzername und Passwort anmelden erlaubt» einschalten und speichern.</p>
          <template v-else>
            <p class="small muted">Erzeugt ein neues Startpasswort, meldet alle Sitzungen ab und verlangt beim nächsten Login ein eigenes Passwort.</p>
            <form @submit.prevent="resetPassword"><button class="btn btn-sm" type="submit">Passwort zurücksetzen</button></form>
          </template>
        </div>
        <div class="card-head"><h2>Zwei-Faktor</h2><Badge v-if="u.totp_enabled_at" text="eingerichtet" tone="green" /><Badge v-else-if="Number(u.twofa_required)" text="Pflicht, noch nicht eingerichtet" tone="orange" /><Badge v-else text="nicht eingerichtet" /></div>
        <div class="card-body">
          <template v-if="u.totp_enabled_at">
            <p class="small muted">Eingerichtet am {{ dates.fmtDateTime(u.totp_enabled_at) }}. Zurücksetzen, wenn das Handy verloren ging: Die App-Verknüpfung, die Wiederherstellungscodes und die gemerkten Geräte werden gelöscht, und das Konto wird abgemeldet.</p>
            <form @submit.prevent="resetTwofa"><button class="btn btn-sm" type="submit">2FA zurücksetzen</button></form>
          </template>
          <p v-else class="small muted">Einrichten kann die Person selbst unter «Konto › Zwei-Faktor» (Klick auf den eigenen Namen unten links).</p>
        </div></div>
        <div v-if="u.id !== session.user?.id" class="card card-danger mt"><div class="card-head"><h2>Konto löschen</h2></div><div class="card-body">
          <p class="small muted">Löscht das Benutzerkonto endgültig und meldet es ab. Was die Person erfasst hat (Anmeldungen, Kontaktversuche, Verlauf), bleibt mit ihrem Namen erhalten. Die verknüpfte Person in den Stammdaten bleibt bestehen. Nur sperren statt löschen: «Konto aktiv» ausschalten.</p>
          <form @submit.prevent="remove"><button class="btn btn-sm btn-danger" type="submit">Benutzerkonto löschen</button></form>
        </div></div>
      </template>
    </div>
  </AppShell>
</template>
