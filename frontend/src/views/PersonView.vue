<script setup>
// Seite eines Mitglieds (wie views/pages/person.ejs)
import { computed, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import AttemptDialog from '@/components/AttemptDialog.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';
import { session } from '@/lib/api.js';
import { labels, dates, plural } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Boolean(data.value.p));
const p = computed(() => data.value.p);
const isAdmin = computed(() => session.user?.role === 'admin');
const name = computed(() => `${p.value.first_name} ${p.value.last_name}`);
const age = computed(() => dates.ageAt(p.value, dates.today()));
const sections = [['an', 'Angemeldet', 'green'], ['ab', 'Abgemeldet', 'red'], ['unsicher', 'Unsicher', 'yellow'], ['offen', 'Offen', 'gray']];
const shown = computed(() => sections.filter(([key]) => data.value.groups[key].length));
const totalItems = computed(() => sections.reduce((n, [key]) => n + data.value.groups[key].length, 0));
const INACTIVE = ['zurueckgezogen', 'abgesagt', 'ungueltig'];
const regLine = (reg) => [reg.func && !reg.func.is_default && !INACTIVE.includes(reg.status) ? `${reg.func.name} (${reg.func.short})` : null, reg.assigned.map((a) => a.name).join(' + ') || null, labels.SOURCE[reg.source], dates.fmtDateTime(reg.registered_at)].filter(Boolean).join(' · ');
const resultText = { nicht_erreicht: 'nicht erreicht', whatsapp: 'gesendet', zugesagt: 'zugesagt', unsicher: 'unsicher', abgesagt: 'abgesagt' };
// Gleiche Kontakte (Kanal, Minute, Person, Ergebnis, Bemerkung) zu einer Zeile zusammenfassen, neueste zuerst
function attemptRuns(attempts) {
  const runs = [];
  for (const a of attempts.slice().reverse()) {
    const key = [a.channel, a.contacted_at.slice(0, 16), a.sent_by_name, a.result, a.note || ''].join('|');
    const prev = runs.at(-1);
    if (prev && prev.key === key) prev.count += 1; else runs.push({ key, a, count: 1 });
  }
  const [newest, ...older] = runs;
  return { newest, older, olderCount: older.reduce((n, r) => n + r.count, 0) };
}
const attemptText = (a) => [`${dates.fmtDateShort(a.contacted_at.slice(0, 10))} ${a.contacted_at.slice(11, 16)}`, a.sent_by_name, resultText[a.result], a.note ? `«${a.note}»` : null].filter(Boolean).join(' · ');
const chClass = (a) => ({ whatsapp: 'wa', muendlich: 'md' }[a.channel] || '');
const lastAttempt = (inq) => inq.attempts.at(-1);
const dialog = ref(null);
const openAttempt = (it) => dialog.value.open({ person: p.value.id, event: it.event.id, who: it.event.name });
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar :heading="name" :crumbs="[['Personen', '/personen'], [name]]" :show-search="false">
      <template v-if="p.rank_short" #badges><span class="rank">{{ p.rank_short }}</span></template>
      <template #actions><button class="btn" type="button" data-print>Drucken</button><a class="btn" :href="apiUrl(`/personen/${p.id}`, {}, { format: 'xlsx' })">Excel</a><router-link v-if="isAdmin" class="btn" :to="`/personen/${p.id}/bearbeiten`">Bearbeiten</router-link></template>
    </Topbar>
    <div class="grid grid-side">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Stammdaten</h2></div>
          <div class="card-body">
            <dl class="kv">
              <dt>Rang</dt><dd>{{ p.rank_name ? `${p.rank_name} (${p.rank_short})` : '–' }}</dd>
              <dt>Mannschaft</dt><dd>{{ p.teams || '–' }}</dd>
              <dt>Jahrgang</dt><dd>{{ dates.birthYear(p) || '–' }}{{ age !== null ? ` (${age} J.)` : '' }}</dd>
              <template v-if="isAdmin && p.birth_date"><dt>Geburtsdatum</dt><dd>{{ dates.fmtDate(p.birth_date) }}</dd></template>
              <dt>Mobil</dt><dd><a v-if="p.mobile" class="link" :href="`tel:${p.mobile.replace(/\s/g, '')}`">{{ p.mobile }}</a><template v-else>–</template></dd>
              <dt>E-Mail</dt><dd><template v-if="p.email">{{ p.email.split('@')[0] }}@<wbr>{{ p.email.split('@').slice(1).join('@') }}</template><template v-else>–</template></dd>
              <dt>Verpflegung</dt><dd><template v-if="!p.diet_category && !p.diet_text">–</template><template v-else-if="data.canSeeDiet">{{ [labels.DIET[p.diet_category], p.diet_text].filter(Boolean).join(': ') }}</template><Badge v-else text="Hinweis vorhanden" /></dd>
              <dt>Status</dt><dd><Badge :text="labels.PERSON_STATUS[p.status].label" :tone="labels.PERSON_STATUS[p.status].tone" /></dd>
            </dl>
            <p v-if="p.aliases.length" class="small muted mt">Namensvarianten: {{ p.aliases.map((a) => `«${a.first_name} ${a.last_name}»`).join(', ') }}</p>
            <p v-if="p.internal_note" class="small mt"><strong>Interne Bemerkung:</strong> {{ p.internal_note }}</p>
            <p v-if="data.linkedUser" class="small muted mt">Benutzerkonto: {{ data.linkedUser.username }} ({{ labels.ROLES[data.linkedUser.role] }})</p>
          </div>
        </div>
      </div>
      <div class="stack">
        <div id="naechste" class="card">
          <div class="card-head"><h2>Nächste Einsätze <span class="hint">{{ totalItems ? shown.map(([key, label]) => `${data.groups[key].length} ${label.toLowerCase()}`).join(' · ') : 'keine' }}</span></h2></div>
          <div v-if="!totalItems" class="empty">Keine anstehenden Einsätze.</div>
          <template v-for="[key, label, tone] in shown" :key="key">
            <div class="person-group-head"><Badge :text="label" :tone="tone" /> <span class="hint">{{ plural(data.groups[key].length, 'Einsatz', 'Einsätze') }}</span></div>
            <div class="card-body person-group">
              <div v-for="it in data.groups[key]" :key="it.event.id" class="ev-item">
                <div>
                  <router-link :to="`/einsaetze/${it.event.id}`"><strong>{{ it.event.name }}</strong></router-link>
                  <div class="small muted">{{ dates.fmtEventDate(it.event, 'short') }}{{ it.reg ? ` · ${regLine(it.reg)}` : '' }}</div>
                  <div v-if="key === 'ab' && it.reg" class="small muted">abgemeldet am {{ dates.fmtDateShort(it.reg.updated_at.slice(0, 10)) }} · {{ labels.SOURCE[it.reg.source] }}</div>
                  <div v-if="key === 'ab' && !it.reg && it.inq" class="small muted">abgesagt{{ lastAttempt(it.inq) ? ` am ${dates.fmtDateShort(lastAttempt(it.inq).contacted_at.slice(0, 10))} per ${labels.CHANNEL[lastAttempt(it.inq).channel].label}` : '' }}</div>
                  <div v-if="it.inq && it.inq.attempts.length && key !== 'ab'" class="attempts mt-s">
                    <template v-for="runs in [attemptRuns(it.inq.attempts)]" :key="0">
                      <div class="attempt"><span :class="['ch', chClass(runs.newest.a)]">{{ labels.CHANNEL[runs.newest.a.channel].short }}</span>{{ attemptText(runs.newest.a) }}<template v-if="runs.newest.count > 1">{{ ' ' }}<span class="attempt-count" :title="`${runs.newest.count} gleiche Einträge`">{{ runs.newest.count }}×</span></template></div>
                      <details v-if="runs.older.length" class="attempts-more"><summary>{{ runs.olderCount === 1 ? '1 früherer Kontakt' : `${runs.olderCount} frühere Kontakte` }}</summary><div class="attempts">
                        <div v-for="(r, i) in runs.older" :key="i" class="attempt"><span :class="['ch', chClass(r.a)]">{{ labels.CHANNEL[r.a.channel].short }}</span>{{ attemptText(r.a) }}<template v-if="r.count > 1">{{ ' ' }}<span class="attempt-count" :title="`${r.count} gleiche Einträge`">{{ r.count }}×</span></template></div>
                      </div></details>
                    </template>
                  </div>
                </div>
                <div>
                  <Badge v-if="it.reg" :text="labels.REG_STATUS[it.reg.status].short" :tone="labels.REG_STATUS[it.reg.status].tone" />
                  <button v-if="key === 'offen' || key === 'unsicher'" class="btn btn-sm" type="button" @click="openAttempt(it)">Anfrage erfassen</button>
                </div>
              </div>
            </div>
          </template>
        </div>
        <details class="card collapse">
          <summary><span>Frühere Einsätze <span class="hint">{{ plural(data.past.length, 'Einsatz', 'Einsätze') }}</span></span></summary>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Datum</th><th>Einsatz</th><th>Schicht</th><th>Quelle</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-if="!data.past.length"><td colspan="5" class="empty">Keine früheren Einsätze.</td></tr>
                <tr v-for="r in data.past" :key="r.id"><td>{{ dates.fmtRange(r.event_date, r.event_date_to) || 'Datum offen' }}</td><td><router-link :to="`/einsaetze/${r.event_id}`">{{ r.event_name }}</router-link></td><td>{{ r.assigned.map((a) => a.name).join(', ') || '–' }}</td><td>{{ labels.SOURCE[r.source] }}</td><td><Badge :text="labels.REG_STATUS[r.status].label" :tone="labels.REG_STATUS[r.status].tone" /></td></tr>
              </tbody>
            </table>
          </div>
        </details>
        <details class="card collapse no-print">
          <summary><span>Verlauf <span class="hint">{{ data.log.length >= 30 ? 'letzte 30 Einträge' : plural(data.log.length, 'Eintrag', 'Einträge') }}</span></span></summary>
          <div v-for="a in data.log.slice(0, 10)" :key="a.id" class="activity"><time>{{ dates.fmtDateTime(a.created_at) }}</time> {{ a.summary }}</div>
          <details v-if="data.log.length > 10" class="activity-more"><summary>Ältere anzeigen ({{ data.log.length - 10 }})</summary><div v-for="a in data.log.slice(10)" :key="a.id" class="activity"><time>{{ dates.fmtDateTime(a.created_at) }}</time> {{ a.summary }}</div></details>
          <div v-if="!data.log.length" class="empty">Keine Einträge.</div>
        </details>
      </div>
    </div>
    <AttemptDialog ref="dialog" action="/anfragen/versuch" event-choice :all-users="data.allUsers" :shift-choices="data.shiftChoices" @done="refresh" />
  </AppShell>
</template>
