<script setup>
import { computed, reactive } from 'vue';
import EventShell from '@/components/EventShell.vue';
import ExternalForm from '@/components/ExternalForm.vue';
import Badge from '@/components/Badge.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction } from '@/lib/actions.js';
import { session } from '@/lib/api.js';
import { dates, plural, pct, fmtEventDate, eventState } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => `/einsaetze/${r.params.id}`);
const ev = computed(() => data.value.event);
const s = computed(() => data.value.stats);
const fn = computed(() => data.value.fnSummary);
const isAdmin = computed(() => session.user?.role === 'admin');
const base = computed(() => `/einsaetze/${ev.value.id}`);

const nextStatus = computed(() => ({
  entwurf: [['veroeffentlicht', 'Veröffentlichen', 'btn-primary'], ['abgesagt', 'Absagen', 'btn-danger']],
  veroeffentlicht: [['abgeschlossen', 'Abschliessen', ''], ['entwurf', 'Zurück auf Entwurf', ''], ['abgesagt', 'Absagen', 'btn-danger']],
  abgesagt: [['entwurf', 'Wieder auf Entwurf setzen', '']],
  abgeschlossen: isAdmin.value ? [['veroeffentlicht', 'Wieder öffnen (Admin)', '']] : [],
}[ev.value.status] || []));

// Lage: was fehlt noch? Pro Schicht die Funktionen mit Lücken, sonst die Schicht als Ganzes
const lage = computed(() => {
  const gaps = [];
  const overs = [];
  for (const sh of fn.value.shifts) {
    const miss = sh.rows.filter((f) => f.missing > 0).map((f) => `${f.missing} ${f.short}`);
    if (miss.length) gaps.push({ shift: sh.name, text: miss.join(', ') });
    const more = sh.rows.filter((f) => f.over > 0).map((f) => `${f.over} ${f.short}`);
    if (more.length) overs.push({ shift: sh.name, text: more.join(', ') });
  }
  if (!fn.value.hasTargets) for (const sh of s.value.shifts) if (sh.missing) gaps.push({ shift: sh.name, text: `${sh.missing} Personen` });
  const noSoll = !s.value.shifts.some((sh) => sh.soll);
  const head = noSoll ? { tone: 'gray', text: 'Noch kein Soll festgelegt' } : gaps.length ? { tone: 'yellow', text: 'Es fehlen noch Leute' } : { tone: 'green', text: 'Alle Schichten sind besetzt' };
  return { gaps, overs, noSoll, ...head };
});
function gapTotal(key) {
  const sum = new Map();
  for (const sh of fn.value.shifts) for (const f of sh.rows) if (f[key] > 0) sum.set(f.short, { pos: f.pos, n: (sum.get(f.short)?.n || 0) + f[key] });
  if (!sum.size && key === 'missing') return `${s.value.shifts.reduce((a, sh) => a + (sh.missing || 0), 0)} Personen`;
  return [...sum].sort((a, b) => a[1].pos - b[1].pos).map(([k, v]) => `${v.n} ${k}`).join(', ');
}
const gapLine = (list) => list.map((g) => (fn.value.shifts.length > 1 ? `${g.shift}: ${g.text}` : g.text)).join(' · ');
const overLine = (list) => list.map((g) => (fn.value.shifts.length > 1 ? `${g.shift} ${g.text}` : g.text)).join(' · ');
const openItems = computed(() => data.value.checklist.filter((c) => !c.done));

// Besetzung als Tabelle: Zeilen = Funktionen, Spalten = Schichten
const fnRows = computed(() => {
  const out = [];
  for (const sh of fn.value.shifts) for (const f of sh.rows) if (!out.some((x) => x.id === f.id)) out.push(f);
  return out;
});
const cell = (sh, f) => sh.rows.find((x) => x.id === f.id);
const occText = (c) => (!c ? '–' : `${c.ist} / ${c.soll ?? '–'}`);
const occNote = (c) => (!c || !c.soll ? '' : c.over ? `${c.over} zu viel` : c.missing ? `${c.missing} ${c.missing === 1 ? 'fehlt' : 'fehlen'}` : 'voll');

const extTotal = computed(() => data.value.externals.reduce((a, x) => a + x.person_count, 0));
const extMeta = (x) => [x.func.is_default ? '' : `Funktion ${x.func.short}`, ev.value.shifts.length > 1 ? (x.allShifts ? 'alle Schichten' : x.shiftNames.join(' + ')) : '',
  x.dietLabel ? `Essen: ${x.dietLabel}` : '', x.contact ? `Kontakt: ${x.contact}` : '', x.note || ''].filter(Boolean).join(' · ');
const suggested = computed(() => data.value.leaderCandidates.find((u) => ev.value.leader_person_id && u.person_id === ev.value.leader_person_id));

const statusReason = reactive({});
async function setStatus(st) {
  const confirm = st === 'abgesagt' ? 'Einsatz wirklich absagen?' : st === 'abgeschlossen' ? 'Einsatz abschliessen? Danach sind die Daten schreibgeschützt.' : null;
  const body = { status: st };
  if (ev.value.status === 'abgeschlossen') {
    if (!statusReason[st]) return;
    body.reason = statusReason[st];
  }
  await runAction(`${base.value}/status`, body, { confirm, onDone: refresh });
}
async function toggleForm(e) {
  await runAction(`${base.value}/formular`, { show_in_form: ev.value.show_in_form ? '0' : '1' }, { onDone: refresh });
  e.target.checked = !!ev.value.show_in_form;
}
const removeExternal = (x) => runAction(`${base.value}/externe/${x.id}/loeschen`, {}, { confirm: `«${x.unit_name}» von diesem Einsatz entfernen?`, event: ev.value, onDone: refresh });
const grant = (userId) => runAction(`${base.value}/einsatzleiter`, { user_id: userId }, { onDone: refresh });
const revoke = (l) => runAction(`${base.value}/einsatzleiter/${l.id}/entfernen`, {}, { confirm: `Freigabe für ${l.display_name} entfernen?`, onDone: refresh });
function grantPicked(evnt) {
  const v = new FormData(evnt.target).get('user_id');
  if (v) grant(v);
}
</script>

<template>
  <div v-if="error && !ev" class="flash flash-error">{{ error.message }}</div>
  <EventShell v-if="ev" :data="data" tab="uebersicht">
    <div class="card mb lage">
      <div class="lage-main">
        <span :class="['lage-dot', `dot-${lage.tone}`]" aria-hidden="true"></span>
        <div>
          <strong>{{ lage.text }}</strong>
          <div v-if="lage.gaps.length" class="small muted">
            <template v-if="lage.gaps.length > 2">In {{ lage.gaps.length }} von {{ fn.shifts.length }} Schichten fehlen noch {{ gapTotal('missing') }}. <a class="link no-print" href="#besetzung">Details in der Besetzung ↓</a></template>
            <template v-else>{{ gapLine(lage.gaps) }}</template>
          </div>
          <div v-if="lage.overs.length" class="small muted">Mehr als nötig: <template v-if="lage.overs.length > 2">in {{ lage.overs.length }} Schichten, total {{ gapTotal('over') }}</template><template v-else>{{ overLine(lage.overs) }}</template></div>
          <div v-if="lage.noSoll" class="small muted"><router-link class="link" :to="`${base}/bearbeiten#funktionen`">Soll pro Schicht festlegen</router-link></div>
          <div v-if="openItems.length" class="lage-todo small"><span class="muted">Noch offen:</span> {{ openItems.map((c) => c.label).join(' · ') }} <router-link class="link no-print" :to="`${base}/bearbeiten`">Angaben ergänzen →</router-link></div>
        </div>
      </div>
      <div class="lage-counts">
        <router-link :to="`${base}/anmeldungen?status=neu`"><strong>{{ s.neu }}</strong> neu</router-link>
        <router-link :to="`${base}/anmeldungen?status=zu_pruefen`" :class="s.zuPruefen ? 'warn' : ''"><strong>{{ s.zuPruefen }}</strong> zu prüfen</router-link>
        <router-link :to="`${base}/anmeldungen?status=bestaetigt`"><strong>{{ s.bestaetigt }}</strong> bestätigt</router-link>
        <router-link :to="`${base}/anmeldungen`"><strong>{{ s.total }}</strong> Anmeldungen</router-link>
        <router-link :to="`${base}/anfragen`"><strong>{{ s.offen }}</strong> ohne Rückmeldung</router-link>
      </div>
    </div>

    <div class="grid grid-main">
      <div class="stack">
        <div id="besetzung" class="card">
          <div class="card-head"><h2>Besetzung <span class="hint">Ist / Soll</span></h2><router-link class="small no-print" :to="`${base}/schichten#funktionen`">Einteilen →</router-link></div>
          <div class="table-wrap">
            <table class="occ-table no-cards">
              <thead><tr><th>Funktion</th><th v-for="sh in fn.shifts" :key="sh.id" class="right">{{ sh.name }}<span class="sub">{{ dates.fmtShiftWhen(sh, dates.isMultiDay(ev)) || 'Zeit offen' }}</span></th></tr></thead>
              <tbody>
                <tr v-for="f in fnRows" :key="f.id">
                  <td><span :class="['fn-tag', { 'fn-default': f.is_default }]">{{ f.short }}</span> {{ f.name }}</td>
                  <td v-for="sh in fn.shifts" :key="sh.id" class="right nowrap">
                    <span v-if="cell(sh, f)" class="occ-cell"><span class="occ-n">{{ occText(cell(sh, f)) }}</span><span :class="['occ-note', `tone-${cell(sh, f).tone}`]">{{ occNote(cell(sh, f)) }}</span></span>
                    <span v-else class="muted">–</span>
                  </td>
                </tr>
                <tr v-if="!fnRows.length"><td :colspan="fn.shifts.length + 1" class="empty">Noch kein Soll und noch niemand zugeteilt.</td></tr>
              </tbody>
              <tfoot>
                <tr><td>Total</td><td v-for="sh in s.shifts" :key="sh.id" class="right">
                  <div class="occ-total"><strong>{{ sh.ist }} / {{ sh.soll ?? '–' }}</strong><span v-if="sh.extern" class="small muted">{{ sh.intern }} eigene + {{ sh.extern }} extern</span></div>
                  <div :class="['bar', sh.tone]"><span :style="{ width: pct(sh.ist, sh.soll) + '%' }"></span></div>
                </td></tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div id="angaben" class="card">
          <div class="card-head"><h2>Angaben</h2><router-link class="small no-print" :to="`${base}/bearbeiten`">Bearbeiten →</router-link></div>
          <div class="card-body">
            <dl class="kv left">
              <dt>Datum</dt><dd><template v-if="ev.date_from">{{ fmtEventDate(ev, 'long') }}<span v-if="!ev.date" class="muted small"> · aus den Schichten</span></template><span v-else class="muted">offen – Datum beim Einsatz oder bei den <router-link class="link" :to="`${base}/schichten#schichten-bearbeiten`">Schichten</router-link> eintragen</span></dd>
              <dt>Antreten</dt><dd>{{ ev.start_time || '–' }}{{ ev.start_place ? ` · ${ev.start_place}` : '' }}</dd>
              <dt>Abtreten</dt><dd>{{ ev.end_time || '–' }}{{ (ev.end_place || ev.start_place) ? ` · ${ev.end_place || ev.start_place}` : '' }}</dd>
              <dt>Einsatzleitung</dt><dd>{{ ev.leader_last ? `${ev.leader_rank || ''} ${ev.leader_first} ${ev.leader_last}`.trim() + (ev.leader_mobile ? ` (${ev.leader_mobile})` : '') : '–' }}</dd>
              <dt>Tenue</dt><dd class="pre">{{ ev.tenue || '–' }}</dd>
              <dt>Beschreibung</dt><dd class="pre">{{ ev.description || '–' }}</dd>
              <template v-for="d in data.extraDefs" :key="d.name"><dt>{{ d.name }}</dt><dd>{{ (ev.extra || {})[d.name] || '–' }}</dd></template>
              <dt>Interne Bemerkung</dt><dd class="pre">{{ ev.internal_note || '–' }}</dd>
              <dt>Aufgebot</dt><dd>{{ ev.calendar_sent_at ? `Kalendertermin exportiert ${dates.fmtDateTime(ev.calendar_sent_at)}` : 'noch nicht exportiert' }}</dd>
            </dl>
          </div>
        </div>

        <div id="externe" class="card">
          <div class="card-head"><h2>Externe Abteilungen <span class="hint">nur Anzahl Personen – zählen in der Besetzung mit</span></h2><strong v-if="extTotal" class="small">{{ plural(extTotal, 'Person', 'Personen') }}</strong></div>
          <details v-for="x in data.externals" :key="x.id" class="ext-row">
            <summary>
              <span class="name"><span class="tag tag-blue">extern</span> <strong>{{ x.unit_name }}</strong></span>
              <span class="ext-count"><strong>{{ plural(x.person_count, 'Person', 'Personen') }}</strong></span>
              <span class="ext-meta muted small">{{ extMeta(x) }}</span>
              <span class="btn btn-sm btn-ghost no-print">Bearbeiten</span>
            </summary>
            <ExternalForm :event="ev" :x="x" :function-options="data.functionOptions" @saved="refresh" />
            <form class="card-body ext-delete" @submit.prevent="removeExternal(x)">
              <button class="btn btn-sm btn-ghost btn-danger" type="submit">Vom Einsatz entfernen</button>
            </form>
          </details>
          <details class="ext-add no-print">
            <summary class="card-body"><span class="btn btn-sm">+ Externe Abteilung hinzufügen</span></summary>
            <ExternalForm :event="ev" :x="null" :function-options="data.functionOptions" @saved="refresh" />
          </details>
          <datalist id="ext-units"><option v-for="u in data.unitOptions" :key="u.id || u.name" :value="u.name"></option></datalist>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Status und Formular</h2><Badge v-bind="eventState({ ...ev, inForm: data.inForm })" /></div>
          <div class="card-body">
            <p class="small muted">Entwurf → Veröffentlicht → Abgeschlossen (oder jederzeit Abgesagt)</p>
            <div class="row">
              <form v-for="[st, label, cls] in nextStatus" :key="st" class="inline" @submit.prevent="setStatus(st)">
                <input v-if="ev.status === 'abgeschlossen'" v-model="statusReason[st]" type="text" required placeholder="Begründung" class="mb-s">
                <button :class="['btn', 'btn-sm', cls]" type="submit">{{ label }}</button>
              </form>
            </div>
          </div>
          <div class="card-body sep-top">
            <form class="switch" @submit.prevent>
              <input type="checkbox" :checked="!!ev.show_in_form" :disabled="ev.status !== 'veroeffentlicht'" aria-label="Im Formular anzeigen" @change="toggleForm">
              <div><strong>Im Formular anzeigen</strong>
                <div class="small muted">
                  <template v-if="ev.status !== 'veroeffentlicht'">Wird beim Veröffentlichen automatisch eingeschaltet.</template>
                  <template v-else-if="data.inForm">Steht im Anmeldeformular bis {{ dates.fmtLocal(data.lastEnd) }}.</template>
                  <template v-else-if="ev.show_in_form">Ende der letzten Schicht ist vorbei – automatisch aus dem Formular.</template>
                  <template v-else>Von Hand aus dem Formular genommen.</template>
                </div>
              </div>
            </form>
            <router-link class="small link no-print" :to="`${base}/formular`">So sieht der Einsatz im Formular aus →</router-link>
            <div v-if="data.inForm && s.full" class="callout orange mt-s">Alle Schichten sind voll – Einsatz aus dem Formular nehmen?</div>
          </div>
        </div>

        <div id="einsatzleiter" class="card">
          <div class="card-head"><h2>Einsatzleiter-Zugriff</h2></div>
          <div class="card-body">
            <p class="small muted">Login für Einsatzleiter: Freigegebene Konten sehen diesen Einsatz mit Angaben und Teilnehmerliste – nur lesen. Unabhängig von der Funktion EL.</p>
            <form v-for="u in data.leaderSuggestions" :key="u.id" class="callout mb-s fn-suggest" @submit.prevent="grant(u.id)">
              <span><strong>{{ u.display_name }}</strong> ist als {{ u.func.name }} ({{ u.func.short }}) eingeteilt und hat ein Einsatzleiter-Konto.</span>
              <button class="btn btn-sm btn-primary" type="submit">Freigeben</button>
            </form>
            <ul v-if="data.leaderAccess.length" class="plain-list mb-s">
              <li v-for="l in data.leaderAccess" :key="l.id" class="row between">
                <span><strong>{{ l.display_name }}</strong><template v-if="!l.active"> <Badge text="deaktiviert" tone="gray" /></template><br><span class="small muted">seit {{ dates.fmtDateTime(l.granted_at) }}{{ l.granted_by_name ? ` · ${l.granted_by_name}` : '' }}</span></span>
                <form class="inline" @submit.prevent="revoke(l)"><button class="btn btn-sm btn-ghost" type="submit">Entfernen</button></form>
              </li>
            </ul>
            <form v-if="data.leaderCandidates.length" class="row" @submit.prevent="grantPicked">
              <select name="user_id" aria-label="Einsatzleiter wählen" required>
                <option v-if="!suggested" value="">Einsatzleiter wählen …</option>
                <option v-for="u in data.leaderCandidates" :key="u.id" :value="u.id" :selected="suggested && suggested.id === u.id">{{ u.display_name }}</option>
              </select>
              <button class="btn btn-sm" type="submit">Freigeben</button>
            </form>
            <p v-else-if="!data.leaderAccess.length" class="small muted">Es gibt noch kein Konto mit der Rolle «Einsatzleiter». {{ isAdmin ? 'Unter Einstellungen › Benutzer anlegen.' : 'Ein Admin legt es unter Einstellungen › Benutzer an.' }}</p>
          </div>
        </div>
      </div>
    </div>
  </EventShell>
</template>
