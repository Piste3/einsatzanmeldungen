<script setup>
// Anmeldeformular: Eingang, Spamverdacht, Fehler, Postausgang (wie views/pages/forms.ejs)
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';
import { runAction } from '@/lib/actions.js';
import { session } from '@/lib/api.js';
import { labels, dates } from '@/lib/format.js';

const route = useRoute();
const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Array.isArray(data.value.list));
const total = computed(() => Object.values(data.value.counts).reduce((a, b) => a + b, 0));
const answerText = (a) => `${a.event_name || `Einsatz ${a.event_id}`}: ${a.answer === 'nein' ? 'Nein' : (a.shifts.length ? a.shifts.map((x) => x.name).join(', ') : 'Ja')}${a.remark ? ` · «${a.remark}»` : ''}`;
const MAIL = { gesendet: ['gesendet', 'green'], fehler: ['Fehler', 'red'], offen: ['offen', 'blue'], nicht_konfiguriert: ['kein SMTP konfiguriert', 'gray'] };
// Aktionen: Seite bleibt mit ihrem Filter stehen, nur der Inhalt wird neu geladen
const processIt = (s) => runAction(`/formulare/${s.id}/verarbeiten`, {}, { onDone: refresh });
const spam = (s) => runAction(`/formulare/${s.id}/spam`, {}, { onDone: refresh });
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="Anmeldeformular" :crumbs="[['Formulare']]">
      <template #actions><a class="btn" href="/forms/anmeldung?vorschau=1" target="_blank" rel="noopener">Vorschau</a><a class="btn" :href="apiUrl('/formulare', route.query, { format: 'xlsx' })">Excel</a></template>
    </Topbar>
    <div class="grid grid-4 mb">
      <div class="card kpi"><div class="label">Offene Einsätze im Formular</div><div class="value">{{ data.openEvents.length }}</div><div class="sub">{{ data.openEvents.map((e) => e.name).join(', ') || 'keine' }}</div></div>
      <router-link class="card kpi" to="/formulare"><div class="label">Absendungen gesamt</div><div class="value">{{ total }}</div><div class="sub">{{ data.counts.verarbeitet || 0 }} verarbeitet</div></router-link>
      <router-link class="card kpi" to="/formulare?status=spam"><div class="label">Spamverdacht</div><div class="value">{{ data.counts.spam || 0 }}</div><div class="sub">nicht verarbeitet</div></router-link>
      <router-link class="card kpi" to="/formulare?status=fehler"><div class="label">Fehler</div><div :class="['value', { orange: data.counts.fehler }]">{{ data.counts.fehler || 0 }}</div><div class="sub">bitte prüfen</div></router-link>
    </div>
    <div class="grid grid-main">
      <div class="card">
        <div class="card-head">
          <h2>Formular-Eingang <span class="hint">jede Absendung unverändert gespeichert</span></h2>
          <div class="chips">
            <router-link :class="['chip', 'badge-gray', { active: !data.status }]" to="/formulare">Alle</router-link>
            <router-link v-for="(v, k) in labels.SUBMISSION_STATUS" :key="k" :class="['chip', `badge-${v.tone}`, { active: data.status === k }]" :to="`/formulare?status=${k}`">{{ v.label }} · {{ data.counts[k] || 0 }}</router-link>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Eingang</th><th>Name</th><th>Antworten</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr v-if="!data.list.length"><td colspan="5" class="empty">Keine Absendungen.</td></tr>
              <tr v-for="s in data.list" :key="s.id" :data-row-id="`f${s.id}-${s.status}`">
                <td class="nowrap">#{{ s.id }} · {{ dates.fmtRelative(s.received_at) }}</td>
                <td><strong>{{ s.first_name }} {{ s.last_name }}</strong></td>
                <td class="small"><div v-for="(a, i) in s.data.answers || []" :key="i">{{ answerText(a) }}</div></td>
                <td><Badge :text="labels.SUBMISSION_STATUS[s.status].label" :tone="labels.SUBMISSION_STATUS[s.status].tone" /><span v-if="s.error || s.spam_reason" class="sub">{{ s.error || s.spam_reason }}</span></td>
                <td class="right nowrap">
                  <template v-if="s.status !== 'verarbeitet'">
                    <form class="inline" @submit.prevent="processIt(s)"><button class="btn btn-xs" type="submit">{{ s.status === 'spam' ? 'Doch verarbeiten' : 'Erneut verarbeiten' }}</button></form>
                    <form v-if="s.status !== 'spam'" class="inline" @submit.prevent="spam(s)"><button class="btn btn-xs btn-ghost" type="submit">Spam</button></form>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Postausgang <span class="hint">Anmeldebestätigungen</span></h2></div>
          <div v-if="!data.outbox.length" class="empty">Noch keine E-Mails.</div>
          <div v-for="m in data.outbox.slice(0, 10)" :key="m.id" class="activity"><time>{{ dates.fmtRelative(m.created_at) }}</time> {{ m.to_address }} · {{ m.subject }}
            <span class="sub"><Badge :text="MAIL[m.status][0]" :tone="MAIL[m.status][1]" /> {{ m.error || '' }}</span></div>
          <details v-if="data.outbox.length > 10" class="activity-more"><summary>Ältere anzeigen ({{ data.outbox.length - 10 }})</summary>
            <div v-for="m in data.outbox.slice(10)" :key="m.id" class="activity"><time>{{ dates.fmtRelative(m.created_at) }}</time> {{ m.to_address }} · {{ m.subject }}
              <span class="sub"><Badge :text="MAIL[m.status][0]" :tone="MAIL[m.status][1]" /> {{ m.error || '' }}</span></div>
          </details>
        </div>
        <details class="card help-fold-card">
          <summary class="card-head"><h2>Einbettung in ClubDesk <span class="hint">einmalig einrichten</span></h2><span class="btn btn-sm">Anzeigen</span></summary>
          <div class="card-body small">
            <p>Feste Adresse – ändert sich nie:</p>
            <input type="text" readonly :value="data.formUrl" data-select-on-focus>
            <p class="mt-s">Einmalig im ClubDesk-Baustein «Externe Inhalte» einbetten. Falls die Darstellung auf dem Handy nicht passt, genügt ein einfacher Link «Zur Anmeldung».</p>
            <p class="muted">Einbettung erlaubt für: <code>{{ data.frameAncestors }}</code>{{ ' ' }}<template v-if="session.user?.role === 'admin'">(ändern unter <router-link to="/verwaltung/server">Einstellungen › Server</router-link>)</template><template v-else>(FORM_FRAME_ANCESTORS)</template></p>
          </div>
        </details>
      </div>
    </div>
  </AppShell>
</template>
