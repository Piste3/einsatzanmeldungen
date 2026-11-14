<script setup>
import { computed, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import { usePage } from '@/lib/usePage.js';
import { post, session } from '@/lib/api.js';
import { confirmDialog } from '@/lib/dialog.js';
import { fmtDateLong, today, plural, pct, fmtRelative, fmtRange, fmtEventDate, labels, eventState, regState, dates } from '@/lib/format.js';

const { data, loading, error, refresh } = usePage(() => '/');

const todos = computed(() => data.value.todos || []);
const kpis = computed(() => data.value.kpis || {});
const unconfirmed = computed(() => data.value.unconfirmed || []);
const rows = computed(() => data.value.rows || []);
const activity = computed(() => data.value.activity || []);
const todoShown = computed(() => todos.value.slice(0, 6));
const todoMore = computed(() => todos.value.slice(6));
const nextLine = computed(() => (kpis.value.next
  ? `${kpis.value.next.name} ${dates.fmtDaysUntil(kpis.value.next.date_from < today() ? today() : kpis.value.next.date_from)}`
  : 'kein Einsatz geplant'));
const msDays = computed(() => data.value.msSecretDays ?? null);

// Anmeldungen nach Einsatz gruppieren (sortiert kommen sie schon vom Server)
const groups = computed(() => {
  const out = [];
  for (const r of unconfirmed.value) {
    let g = out.at(-1);
    if (!g || g.event_id !== r.event_id) { g = { event_id: r.event_id, rows: [], first: r }; out.push(g); }
    g.rows.push(r);
  }
  return out;
});

async function confirmOne(r) {
  await post(`/anmeldungen/${r.id}/status`, { status: 'bestaetigt', expected: r.status, back: '/' }, { follow: false });
  refresh();
}
async function confirmAll(g) {
  const neu = g.rows.filter((x) => x.status === 'neu');
  const ok = await confirmDialog(`${neu.length} neue Anmeldungen für «${g.first.event_name}» bestätigen?`, { ok: 'Bestätigen' });
  if (!ok) return;
  await post(`/einsaetze/${g.event_id}/anmeldungen/sammel`, { ids: neu.map((x) => x.id), status_button: 'bestaetigt', back: '/' }, { follow: false });
  refresh();
}
</script>

<template>
  <AppShell>
    <Topbar :crumbs="[[fmtDateLong(today())]]" heading="Cockpit">
      <template #actions><router-link class="btn btn-primary" to="/einsaetze/neu">+ Neuer Einsatz</router-link></template>
    </Topbar>

    <div v-if="loading && !rows.length && !todos.length" class="empty">Lädt …</div>
    <div v-else-if="error" class="flash flash-error">{{ error.message }}</div>
    <template v-else>
      <div v-if="msDays !== null" :class="['flash', `flash-${msDays < 0 ? 'error' : 'info'}`]">
        <strong>Microsoft-Schlüssel {{ msDays < 0 ? 'ist abgelaufen' : msDays === 0 ? 'läuft heute ab' : `läuft in ${msDays} Tagen ab` }}.</strong>
        {{ msDays < 0 ? 'Die Anmeldung mit Microsoft funktioniert nicht mehr.' : 'Danach funktioniert die Anmeldung mit Microsoft nicht mehr.' }}
        Neuen Schlüssel erstellen: <router-link class="link" to="/handbuch#20-microsoft-anmeldung">Handbuch, Kapitel 20</router-link>.
      </div>

      <div class="card mb todo-card">
        <div class="card-head">
          <h2>Zu tun <span class="hint">{{ todos.length ? plural(todos.length, 'Punkt', 'Punkte') : 'nichts offen' }}</span></h2>
          <span class="small muted todo-next">Nächster Einsatz:
            <router-link v-if="kpis.next" class="link" :to="`/einsaetze/${kpis.next.id}`">{{ nextLine }}</router-link><template v-else>{{ nextLine }}</template></span>
        </div>
        <div v-if="!todos.length" class="empty">Alles erledigt. {{ kpis.neuSeit ? `${plural(kpis.neuSeit, 'Anmeldung', 'Anmeldungen')} in den letzten 24 Stunden.` : '' }}</div>
        <template v-else>
          <div class="todo-grid">
            <router-link v-for="t in todoShown" :key="t.href + t.text" class="todo" :to="t.href"><span :class="['tag', `tag-${t.tone}`]">{{ t.tag }}</span><span>{{ t.text }}</span></router-link>
          </div>
          <details v-if="todoMore.length" class="todo-more">
            <summary>{{ plural(todoMore.length, 'weiterer Punkt', 'weitere Punkte') }} anzeigen</summary>
            <div class="todo-grid"><router-link v-for="t in todoMore" :key="t.href + t.text" class="todo" :to="t.href"><span :class="['tag', `tag-${t.tone}`]">{{ t.tag }}</span><span>{{ t.text }}</span></router-link></div>
          </details>
        </template>
      </div>

      <div class="grid grid-main">
        <div class="stack">
          <div id="unbestaetigt" class="card">
            <div class="card-head"><h2>Noch nicht bestätigt <span class="hint">{{ unconfirmed.length }} Anmeldung{{ unconfirmed.length === 1 ? '' : 'en' }} für anstehende Einsätze</span></h2></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Person</th><th>Schicht</th><th>Eingang</th><th>Status</th><th class="actions-col"></th></tr></thead>
                <tbody>
                  <tr v-if="!unconfirmed.length"><td colspan="5" class="empty">Alle Anmeldungen sind bestätigt.</td></tr>
                  <template v-for="g in groups" :key="g.event_id">
                    <tr class="group-row"><td colspan="5">
                      <div class="row-between">
                        <span><router-link :to="`/einsaetze/${g.event_id}/anmeldungen`"><strong>{{ g.first.event_name }}</strong></router-link>
                          <span class="muted"> · {{ fmtRange(g.first.event_date, g.first.event_date_to, 'wd') || 'Datum offen' }}{{ g.first.event_status === 'entwurf' ? ' · Entwurf' : '' }} · {{ g.rows.length }}</span></span>
                        <button v-if="g.rows.filter((x) => x.status === 'neu').length > 1" class="btn btn-xs" type="button" @click="confirmAll(g)">Alle {{ g.rows.filter((x) => x.status === 'neu').length }} neuen bestätigen</button>
                      </div>
                    </td></tr>
                    <template v-for="r in g.rows" :key="r.id">
                      <tr :class="{ 'has-notes': r.remark || r.internal_note }">
                        <td><Rank :short="r.rank_short" /><router-link class="nowrap" :to="`/personen/${r.person_id}`"><strong>{{ r.first_name }} {{ r.last_name }}</strong></router-link></td>
                        <td>{{ r.shifts || '' }}<span v-if="!r.shifts" class="muted">–</span></td>
                        <td class="nowrap">{{ labels.SOURCE[r.source] }}<span class="sub">{{ fmtRelative(r.registered_at) }}</span></td>
                        <td><Badge v-bind="regState(r.status)" /></td>
                        <td class="actions-col right nowrap"><button class="btn btn-sm" type="button" @click="confirmOne(r)">Bestätigen</button></td>
                      </tr>
                      <tr v-if="r.remark || r.internal_note" class="note-row"><td colspan="5"><div class="notes">
                        <div v-if="r.remark" class="note"><span class="note-k">Bemerkung</span><span>{{ r.remark }}</span></div>
                        <div v-if="r.internal_note" class="note note-intern"><span class="note-k">Interne Bemerkung</span><span>{{ r.internal_note }}</span></div>
                      </div></td></tr>
                    </template>
                  </template>
                </tbody>
              </table>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>Anstehende Einsätze <span class="hint">nächste 3 Monate</span></h2><router-link class="small" to="/einsaetze">Alle Einsätze →</router-link></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Einsatz</th><th>Besetzung (Ist / Soll)</th><th class="center">Neu</th><th class="center">Unsicher</th><th class="center">Offen</th></tr></thead>
                <tbody>
                  <tr v-if="!rows.length"><td colspan="5" class="empty">Keine anstehenden Einsätze. <router-link class="link" to="/einsaetze/neu">Neuen Einsatz anlegen</router-link></td></tr>
                  <tr v-for="e in rows" :key="e.id">
                    <td>
                      <router-link :to="`/einsaetze/${e.id}`"><strong>{{ e.name }}</strong></router-link>
                      <span class="sub">{{ fmtEventDate(e, 'wd') }} · {{ plural(e.shifts.length, 'Schicht', 'Schichten') }}</span>
                      <div class="mt-s"><Badge v-bind="eventState(e)" /></div>
                    </td>
                    <td>
                      <span v-if="e.status === 'entwurf'" class="muted small">noch nicht veröffentlicht</span>
                      <template v-else>
                        <div v-for="s in e.stats.shifts" :key="s.id || s.name" class="occ">
                          <div class="occ-head"><span>{{ s.name }}</span><strong>{{ s.ist }} / {{ s.soll ?? '–' }}</strong></div>
                          <div :class="['bar', s.tone]"><span :style="{ width: pct(s.ist, s.soll) + '%' }"></span></div>
                        </div>
                      </template>
                    </td>
                    <td class="center">{{ e.status === 'entwurf' ? '–' : e.stats.neu }}</td>
                    <td class="center"><Badge v-if="e.stats.zuPruefen" :text="e.stats.zuPruefen" tone="yellow" /><template v-else>–</template></td>
                    <td class="center">{{ e.status === 'entwurf' ? '–' : e.stats.offen }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Letzte Aktivität</h2></div>
            <div v-if="!activity.length" class="empty">Noch keine Aktivität.</div>
            <div v-for="a in activity.slice(0, 8)" :key="a.id" class="activity"><time>{{ fmtRelative(a.created_at) }}</time> {{ a.summary }}</div>
            <details v-if="activity.length > 8" class="activity-more">
              <summary>Ältere anzeigen</summary>
              <div v-for="a in activity.slice(8)" :key="a.id" class="activity"><time>{{ fmtRelative(a.created_at) }}</time> {{ a.summary }}</div>
            </details>
          </div>
        </div>
      </div>
    </template>
  </AppShell>
</template>
