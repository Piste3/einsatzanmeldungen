<script setup>
// Einstellungen › Benutzer (wie views/admin/users.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction } from '@/lib/actions.js';
import { labels, dates } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Array.isArray(data.value.list));
const pw = (u) => Number(u.password_login ?? 1);
const loginText = (u) => `${pw(u) ? 'Passwort' : 'nur Microsoft'}${pw(u) && u.ms_linked ? ' + Microsoft' : ''}${!u.ms_linked && u.ms_login ? ' · Microsoft freigegeben' : ''}${u.must_change_password ? ' · Startpasswort' : ''}`;
const unlock = (u) => runAction(`/verwaltung/benutzer/${u.id}/entsperren`, {}, { onDone: refresh });
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Einstellungen" :crumbs="[['Einstellungen'], ['Benutzer']]" :show-search="false">
      <template #actions><router-link class="btn btn-primary" to="/verwaltung/benutzer/neu">+ Benutzerkonto</router-link></template>
    </Topbar>
    <AdminTabs />
    <div class="card">
      <div class="card-head"><h2>Benutzerkonten <span class="hint">Jede Person hat ein eigenes Konto – Konten werden nicht geteilt.</span></h2>
        <span class="small muted">Anmeldung: {{ data.providers.map((p) => p === 'local' ? 'eigenes Login' : 'Microsoft').join(' + ') }}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Benutzername</th><th>Rolle</th><th>Stammdaten</th><th>Anmeldung</th><th>Letztes Login</th><th>Status</th><th></th></tr></thead>
          <tbody>
            <tr v-for="u in data.list" :key="u.id">
              <td><strong>{{ u.display_name }}</strong><span v-if="u.email" class="sub">{{ u.email }}</span></td>
              <td>{{ u.username }}</td>
              <td><Badge :text="labels.ROLES[u.role]" :tone="u.role === 'admin' ? 'orange' : 'blue'" /></td>
              <td><router-link v-if="u.person_id" class="link" :to="`/personen/${u.person_id}`">{{ u.first_name }} {{ u.last_name }}</router-link><span v-else class="muted">nicht verknüpft</span></td>
              <td>{{ loginText(u) }}<span v-if="u.auth_provider === 'local'" class="sub">{{ u.totp_enabled_at ? '2FA aktiv' : (u.twofa_required ? '2FA Pflicht – noch offen' : 'ohne 2FA') }}</span></td>
              <td class="nowrap">{{ u.last_login_at ? dates.fmtDateTime(u.last_login_at) : '–' }}</td>
              <td><Badge v-if="!u.active" text="deaktiviert" /><Badge v-else-if="u.locked" text="gesperrt" tone="red" /><Badge v-else text="aktiv" tone="green" /></td>
              <td class="right nowrap">
                <form v-if="u.locked" class="inline" @submit.prevent="unlock(u)"><button class="btn btn-xs" type="submit">Entsperren</button></form>{{ ' ' }}<router-link class="btn btn-xs" :to="`/verwaltung/benutzer/${u.id}`">Bearbeiten</router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="callout mt"><strong class="cap">Microsoft-Anmeldung</strong>Ist sie auf dem Server eingerichtet, erscheint auf der Login-Seite «Mit Microsoft anmelden». Wer sie nutzen darf, legst du pro Benutzerkonto fest: E-Mail-Adresse des Microsoft-Kontos eintragen und «Microsoft-Anmeldung erlaubt» ankreuzen. Das Login mit Passwort bleibt daneben bestehen.</div>
  </AppShell>
</template>
