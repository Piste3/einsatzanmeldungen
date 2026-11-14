<script setup>
// Rückmeldungen: wer hat sich wofür gemeldet? (wie views/pages/feedback.ejs)
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import Rank from '@/components/Rank.vue';
import FbSym from '@/components/FbSym.vue';
import AttemptDialog from '@/components/AttemptDialog.vue';
import { usePage } from '@/lib/usePage.js';
import { useFilters, apiUrl } from '@/lib/useFilters.js';
import { labels, dates } from '@/lib/format.js';

const route = useRoute();
const { data, error, refresh } = usePage((r) => r.fullPath);
const ready = computed(() => Boolean(data.value.filters));
const { f, apply, typed } = useFilters({ view: 'tabelle', q: '', period: '3m', team: '', only: '', sort: 'rang', drafts: '' }, () => data.value.filters);
const fl = computed(() => data.value.filters);
const viewTo = (view) => ({ path: '/rueckmeldungen', query: { ...route.query, view } });
const showReset = computed(() => fl.value.period !== '3m' || fl.value.team || fl.value.only || fl.value.sort !== 'rang' || fl.value.drafts || fl.value.view !== 'tabelle');
const exportUrl = (format) => apiUrl('/rueckmeldungen', route.query, { format });
function setDrafts(ev) { f.drafts = ev.target.checked ? '1' : ''; apply(); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const npText = (c) => (c.notPlanned ? `Vorgesehen: ${c.plannedFor || 'andere Personen'}` : '');
const hasPlan = computed(() => data.value.columns.some((col) => col.planned));
const hasShiftCols = computed(() => data.value.columns.some((col) => col.shift));
const hasAndereNoDetail = computed(() => data.value.rows.some((r) => r.cells.some((c) => c.state === 'andere' && !c.detail)));
const stateLabel = (c) => (c.detail ? labels.FEEDBACK_DETAIL[c.detail].label : labels.FEEDBACK[c.state].label);
const setBy = (c) => (c.last ? `${c.last.by}, ${c.last.atShort}` : '');
const cellTitle = (c, col, p) => `${p.first_name} ${p.last_name} · ${col.event.name}${col.shift ? ` · ${col.shift.name}` : ''}: ${stateLabel(c)}${c.notPlanned ? ` (${npText(c)})` : ''}${c.last ? `\nZuletzt: ${c.last.text} – ${setBy(c)}${c.last.count > 1 ? ` (${c.last.count} Einträge im Verlauf)` : ''}` : ''}\nKlicken für Verlauf und Kontaktversuch`;
const currentText = (c) => {
  if (['offen', 'nicht_vorgesehen'].includes(c.state) && !c.inq && !c.reg) return npText(c);
  const parts = [stateLabel(c)];
  if (c.reg) parts.push(`Anmeldung: ${labels.REG_STATUS[c.reg.status].short} · ${labels.SOURCE[c.reg.source]}`);
  if (c.inq) parts.push(`Anfrage: ${(labels.INQUIRY_ROW[c.inq.status] || labels.INQUIRY_STATUS[c.inq.status]).label}`);
  if (c.last) parts.push(`gesetzt von ${setBy(c)}`);
  if (c.notPlanned) parts.push(npText(c));
  return parts.join(' · ');
};
// Fenster beim längeren Darüberfahren: Schichten des Einsatzes mit Tag und Zeit
const shiftWhen = (sh, e) => dates.fmtShiftWhen(sh, dates.isMultiDay(e)) || 'Zeit fehlt';
const shiftList = (e, { here = null, mine = null } = {}) => `<ul class="tip-shifts">${e.shifts.map((sh) => {
  const isMine = mine && mine.ids.includes(sh.id);
  const clash = mine && mine.clash.includes(sh.id);
  const tag = isMine ? `<em class="tip-tag tip-mine">${mine.kind}</em>` : clash ? '<em class="tip-tag tip-clash">gleiche Zeit</em>' : '<em class="tip-tag"></em>';
  const ist = e.istByShift[sh.id] || 0;
  return `<li class="${here && here.id === sh.id ? 'is-here' : ''}${isMine ? ' is-mine' : ''}${clash ? ' is-clash' : ''}"><span class="tip-sh">${esc(sh.name)}</span><span class="tip-when">${esc(shiftWhen(sh, e))}</span><span class="tip-num">${ist}${sh.target_count ? ` / ${sh.target_count}` : ''}</span>${tag}</li>`;
}).join('')}</ul>`;
const headTip = (col) => `<strong>${esc(col.event.name)}</strong><span class="tip-sub">${esc(dates.fmtEventDate(col.event, 'short'))}</span>${col.shift ? shiftList(col.event, { here: col.shift }) : ''}`;
const cellTip = (c, col, p) => {
  let out = `<strong>${esc(`${p.first_name} ${p.last_name}`)}</strong><span class="tip-sub">${esc(col.event.name)}${col.shift ? ` · ${esc(col.shift.name)}` : ''}</span><span class="tip-state">${esc(stateLabel(c))}</span>${c.notPlanned ? `<span class="tip-np">${esc(npText(c))}</span>` : ''}`;
  if (col.shift) out += shiftList(col.event, { here: col.shift, mine: c.mine });
  if (c.last) out += `<span class="tip-last">Zuletzt: ${esc(c.last.text)} – ${esc(setBy(c))}${c.last.count > 1 ? ` (${c.last.count} Einträge)` : ''}</span>`;
  return `${out}<span class="tip-hint">Klicken für Verlauf und Kontaktversuch</span>`;
};
const shiftTime = (sh) => (sh.starts_at && sh.ends_at ? `${sh.starts_at.slice(11, 16)}–${sh.ends_at.slice(11, 16)}` : '');
const colDate = (col) => (col.shift && col.shift.starts_at && dates.isMultiDay(col.event) ? dates.fmtRange(col.shift.starts_at.slice(0, 10), null, 'short') : dates.fmtEventDate(col.event, 'short'));
const colExt = (col) => (col.shift ? col.event.externByShift[col.shift.id] || 0 : 0);
const colIst = (col) => (col.shift ? col.event.istByShift[col.shift.id] || 0 : col.event.ist);
const colFill = (col) => (col.shift && col.shift.target_count ? Math.min(100, Math.round(((colIst(col) + colExt(col)) / col.shift.target_count) * 100)) : null);
const extTxt = (n) => (n ? ` + ${n} ext.` : '');
const colTone = (col) => { const v = colFill(col); return v === null ? 'gray' : v >= 100 ? 'green' : v >= 60 ? 'yellow' : 'red'; };
const fill = (e) => (e.soll ? Math.min(100, Math.round(((e.ist + (e.extern || 0)) / e.soll) * 100)) : null);
const tone = (e) => { const v = fill(e); return v === null ? 'gray' : v >= 100 ? 'green' : v >= 60 ? 'yellow' : 'red'; };
const colAria = (col) => `${col.event.name} · ${colDate(col)}${col.shift ? ` · ${col.shift.name} ${shiftTime(col.shift)}` : ''}`;
const totTitle = (col) => {
  const t = data.value.colTotals[col.key];
  return `${t.an} An${col.shift ? ` (${col.shift.name})` : ''}${t.schicht_offen ? ` · ${t.schicht_offen} An ohne Schicht` : ''}${t.andere ? ` · ${t.andere} andere Schicht` : ''} · ${t.ab} Ab · ${t.unsicher} Unsicher · ${t.offen} Offen${t.nicht_vorgesehen ? ` · ${t.nicht_vorgesehen} nicht vorgesehen` : ''}`;
};

// Kontaktversuch-Fenster aus einer Zelle oder einem Namen
const dialog = ref(null);
function openCell(c, col, p) {
  dialog.value.open({
    person: p.id, event: c.eventId, shift: c.shiftId || '', who: `${p.first_name} ${p.last_name} · ${col.event.name}${col.shift ? ` · ${col.shift.name}` : ''}`,
    current: currentText(c), currentLink: c.reg ? `/einsaetze/${c.eventId}/${['andere', 'schicht_offen'].includes(c.state) ? 'schichten' : `anmeldungen?q=${encodeURIComponent(p.last_name)}`}` : '',
  });
}
const openPill = (p, e) => dialog.value.open({ person: p.id, event: e.id, who: `${p.first_name} ${p.last_name} · ${e.name}` });

// Ansicht «Pro Einsatz»
const cards = computed(() => data.value.events.map((e, i) => {
  const rows = data.value.rows;
  const groups = { an: [], unsicher: [], ab: [], offen: [], nicht_vorgesehen: [] };
  for (const row of rows) groups[row.eventCells[i].state].push({ ...row.person, last: row.eventCells[i].last });
  const perShift = e.shifts.map((sh) => ({ sh, list: rows.filter((row) => row.cells.some((c) => c.eventId === e.id && c.shiftId === sh.id && c.counts)).map((row) => row.person) }));
  const noShift = e.shifts.length ? rows.filter((row) => row.cells.some((c) => c.eventId === e.id && c.state === 'schicht_offen')).map((row) => row.person) : [];
  const waiting = e.shifts.length ? rows.filter((row) => row.eventCells[i].reg?.status === 'warteliste').map((row) => row.person) : [];
  const shown = Object.entries(groups).filter(([st, list]) => list.length && !(st === 'an' && perShift.length));
  return { e, groups: shown, perShift, noShift, waiting };
}));
const SYM = { an: '✓', ab: '✕', unsicher: '?', offen: '' };
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar :crumbs="[['Rückmeldungen']]" heading="Wer hat sich wofür gemeldet?">
      <template #actions><button class="btn" type="button" data-print>Drucken</button><a class="btn" :href="exportUrl('xlsx')">Excel</a><a class="btn" :href="exportUrl('csv')">CSV</a></template>
    </Topbar>
    <form class="filters fb-filters" @submit.prevent="apply()">
      <input v-model="f.q" type="search" placeholder="Name suchen" @input="typed">
      <select v-model="f.period" @change="apply()"><option v-for="(p, k) in data.periods" :key="k" :value="k">{{ p.label }}</option></select>
      <select v-model="f.team" @change="apply()"><option value="">Alle Mannschaften</option><option v-for="t in data.teams" :key="t.id" :value="String(t.id)">{{ t.name }}</option></select>
      <select v-model="f.only" @change="apply()">
        <option value="">Alle Mitglieder</option>
        <option value="offen">Nur mit offenen Einsätzen</option>
        <option value="unsicher">Nur mit Unsicheren</option>
      </select>
      <select v-if="fl.view === 'tabelle'" v-model="f.sort" aria-label="Sortierung" @change="apply()"><option value="rang">Rang: tief → hoch</option><option value="rang_ab">Rang: hoch → tief</option><option value="name">nach Name</option><option value="offen">meiste offen zuerst</option></select>
      <label class="check"><input type="checkbox" :checked="f.drafts === '1'" @change="setDrafts"> Entwürfe</label>
      <router-link v-if="showReset" class="btn btn-sm btn-ghost" to="/rueckmeldungen?filter=zuruecksetzen" title="Alle Filter auf den Standard zurücksetzen">Filter zurücksetzen</router-link>
    </form>
    <div class="row-between mb-s">
      <div class="segmented-links">
        <router-link :class="{ active: fl.view === 'tabelle' }" :to="viewTo('tabelle')">Tabelle</router-link>
        <router-link :class="{ active: fl.view === 'einsatz' }" :to="viewTo('einsatz')">Pro Einsatz</router-link>
      </div>
      <span class="muted small">{{ data.events.length }} Einsätze · {{ data.rows.length }}{{ data.rows.length !== data.allCount ? ` von ${data.allCount}` : '' }} Mitglieder</span>
    </div>
    <div class="legend small fb-legend mb" aria-label="Legende">
      <span class="fb-legend-title">Legende</span>
      <span class="fb-legend-item"><span class="fb fb-an">✓</span> An</span>
      <span class="fb-legend-item"><span class="fb fb-an fb-d-bestaetigt">✓</span> Bestätigt</span>
      <span class="fb-legend-item"><span class="fb fb-an fb-d-warteliste"><FbSym detail="warteliste" /></span> Warteliste</span>
      <span class="fb-legend-item"><span class="fb fb-ab">✕</span> Ab</span>
      <span class="fb-legend-item"><span class="fb fb-unsicher fb-d-whatsapp"><FbSym detail="whatsapp" /></span> Nachricht gesendet</span>
      <span class="fb-legend-item"><span class="fb fb-unsicher fb-d-telefon"><FbSym detail="telefon" /></span> Nicht erreicht</span>
      <span class="fb-legend-item"><span class="fb fb-unsicher fb-d-muendlich"><FbSym detail="muendlich" /></span> Mündlich gefragt</span>
      <span class="fb-legend-item"><span class="fb fb-unsicher">?</span> Unsicher</span>
      <span class="fb-legend-item"><span class="fb fb-unsicher fb-d-rueckfrage">!</span> Rückfrage</span>
      <span class="fb-legend-item"><span class="fb fb-offen"></span> Offen</span>
      <template v-if="hasPlan">
        <span class="fb-legend-item"><span class="fb fb-nicht_vorgesehen"><FbSym state="nicht_vorgesehen" /></span> Nicht vorgesehen (Mannschaft, Alter oder Rang)</span>
        <span class="fb-legend-item"><span class="fb fb-an fb-np">✓</span> Angemeldet, obwohl nicht vorgesehen</span>
      </template>
      <template v-if="hasShiftCols">
        <span class="fb-legend-item"><span class="fb fb-schicht_offen">✓</span> An, ohne Schicht</span>
        <span class="fb-legend-item"><span class="fb fb-andere fb-d-ueberschneidung">–</span> Andere Schicht, gleiche Zeit</span>
        <span class="fb-legend-item"><span class="fb fb-andere fb-d-frei"><span class="fb-ring"></span></span> Andere Schicht, zeitlich möglich</span>
        <span v-if="hasAndereNoDetail" class="fb-legend-item"><span class="fb fb-andere">·</span> Andere Schicht, Zeit fehlt</span>
      </template>
    </div>

    <div v-if="!data.events.length" class="card"><div class="empty">Keine veröffentlichten Einsätze im gewählten Zeitraum.</div></div>
    <div v-else-if="fl.view === 'tabelle'" class="card fb-table-card">
      <div class="table-wrap fb-wrap" data-keep-scroll>
        <table class="matrix fb-matrix">
          <thead>
            <tr>
              <th class="fb-name">Mitglied</th>
              <th v-for="col in data.columns" :key="col.key" :class="['fb-ev', { 'fb-shift': col.shift, 'fb-first': col.first }]" :style="col.shift && col.first ? { '--fb-span': col.event.shifts.length } : undefined" :aria-label="colAria(col)" :data-tip="headTip(col)">
                <router-link :to="`/einsaetze/${col.event.id}${col.shift ? '/schichten' : ''}`">
                  <span class="dt">{{ dates.fmtEventDate(col.event, 'short') }}</span>
                  <span class="ev">{{ col.event.name }}</span>
                  <template v-if="col.shift">
                    <span class="sh">{{ col.shift.name }}<span v-if="dates.isMultiDay(col.event) && col.shift.starts_at" class="sh-day">{{ colDate(col) }}</span><span v-if="shiftTime(col.shift)" class="sh-day">{{ shiftTime(col.shift) }}</span><span v-if="col.planned" class="sh-day sh-plan">nur {{ col.planned }}</span></span>
                    <span :class="['fill', `fill-${colTone(col)}`]"><span :style="{ width: `${colFill(col) ?? 0}%` }"></span></span>
                    <span class="num">{{ colIst(col) }}{{ extTxt(colExt(col)) }}{{ col.shift.target_count ? ` / ${col.shift.target_count}` : '' }}{{ data.colTotals[col.key].schicht_offen ? ` · ${data.colTotals[col.key].schicht_offen} ohne Schicht` : '' }}</span>
                  </template>
                  <template v-else>
                    <span v-if="col.planned" class="sh"><span class="sh-day sh-plan">nur {{ col.planned }}</span></span>
                    <span :class="['fill', `fill-${tone(col.event)}`]"><span :style="{ width: `${fill(col.event) ?? 0}%` }"></span></span>
                    <span class="num">{{ col.event.ist }}{{ extTxt(col.event.extern) }}{{ col.event.soll ? ` / ${col.event.soll}` : '' }}</span>
                  </template>
                </router-link>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!data.rows.length"><td :colspan="data.columns.length + 1" class="empty">Keine Mitglieder für diesen Filter.</td></tr>
            <tr v-for="row in data.rows" :key="row.person.id" :data-row-id="`p${row.person.id}-${row.cells.map((c) => c.state[0]).join('')}`">
              <td class="fb-name"><Rank :short="row.person.rank_short" /><router-link :to="`/personen/${row.person.id}`"><strong>{{ row.person.first_name }} {{ row.person.last_name }}</strong></router-link><span v-if="row.person.teams" class="sub">{{ row.person.teams }}</span></td>
              <td v-for="(c, i) in row.cells" :key="i" :class="['fb-cell', { 'fb-first': data.columns[i].first }]">
                <button type="button" :class="['fb', `fb-${c.state}`, c.detail ? `fb-d-${c.detail}` : '', c.notPlanned && c.state !== 'nicht_vorgesehen' ? 'fb-np' : '']" :aria-label="cellTitle(c, data.columns[i], row.person)" :data-tip="cellTip(c, data.columns[i], row.person)" @click="openCell(c, data.columns[i], row.person)"><FbSym :state="c.state" :detail="c.detail" /></button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="fb-name">Total ({{ data.allCount }} Mitglieder)</td>
              <td v-for="col in data.columns" :key="col.key" :class="['fb-tot', { 'fb-first': col.first }]" :title="totTitle(col)"><span class="g">{{ data.colTotals[col.key].an }}</span> <span class="r">{{ data.colTotals[col.key].ab }}</span> <span class="y">{{ data.colTotals[col.key].unsicher }}</span> <span class="m">{{ data.colTotals[col.key].offen }}</span></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    <div v-else class="fb-cards" data-keep-scroll>
      <div v-for="card in cards" :key="card.e.id" class="card fb-card">
        <div class="card-head">
          <h2><router-link :to="`/einsaetze/${card.e.id}`">{{ card.e.name }}</router-link> <span class="hint">{{ dates.fmtEventDate(card.e, 'short') }}{{ card.e.status === 'entwurf' ? ' · Entwurf' : '' }}</span></h2>
          <span class="num"><strong>{{ card.e.ist }}</strong>{{ extTxt(card.e.extern) }}{{ card.e.soll ? ` / ${card.e.soll}` : '' }} besetzt</span>
        </div>
        <div class="card-body">
          <span :class="['fill', `fill-${tone(card.e)}`, 'fill-wide']"><span :style="{ width: `${fill(card.e) ?? 0}%` }"></span></span>
          <div v-if="card.perShift.length" class="fb-shifts">
            <template v-for="{ sh, list } in card.perShift" :key="sh.id">
              <div class="fb-shift-row"><span class="sh-name">{{ sh.name }} <span class="muted small">{{ dates.fmtShiftWhen(sh, dates.isMultiDay(card.e)) }}{{ sh.planned ? ` · nur ${sh.planned}` : '' }}</span></span><span class="num"><strong>{{ card.e.istByShift[sh.id] || 0 }}</strong>{{ extTxt(card.e.externByShift[sh.id]) }}{{ sh.target_count ? ` / ${sh.target_count}` : '' }}</span></div>
              <div class="fb-names"><router-link v-for="p in list" :key="p.id" class="pill" :to="`/personen/${p.id}`">{{ p.first_name }} {{ p.last_name }}</router-link><span v-if="!list.length" class="muted small">noch niemand</span></div>
            </template>
            <template v-if="card.noShift.length"><div class="fb-shift-row"><span class="sh-name">An, ohne Schicht</span><router-link class="link small" :to="`/einsaetze/${card.e.id}/schichten`">zuteilen →</router-link></div>
              <div class="fb-names"><router-link v-for="p in card.noShift" :key="p.id" class="pill" :to="`/personen/${p.id}`">{{ p.first_name }} {{ p.last_name }}</router-link></div></template>
            <template v-if="card.waiting.length"><div class="fb-shift-row"><span class="sh-name">Warteliste <span class="muted small">zählt nicht</span></span></div>
              <div class="fb-names"><router-link v-for="p in card.waiting" :key="p.id" class="pill" :to="`/personen/${p.id}`">{{ p.first_name }} {{ p.last_name }}</router-link></div></template>
          </div>
          <details v-for="[st, list] in card.groups" :key="st" class="fb-group" :open="!(['offen', 'nicht_vorgesehen'].includes(st) && list.length > 8)">
            <summary><span :class="['fb', `fb-${st}`]"><FbSym v-if="st === 'nicht_vorgesehen'" state="nicht_vorgesehen" /><template v-else>{{ SYM[st] }}</template></span> {{ labels.FEEDBACK[st].label }} <span class="muted">· {{ list.length }}</span></summary>
            <div class="fb-names">
              <template v-for="p in list" :key="p.id">
                <button v-if="['offen', 'nicht_vorgesehen'].includes(st)" type="button" class="pill" :title="`${p.last ? `Zuletzt: ${p.last.text} – ${setBy(p)} · ` : ''}Klicken für Verlauf und Kontaktversuch`" @click="openPill(p, card.e)">{{ p.first_name }} {{ p.last_name }}</button>
                <router-link v-else class="pill" :to="`/personen/${p.id}`" :title="p.last ? `${p.last.text} – ${setBy(p)}` : undefined">{{ p.first_name }} {{ p.last_name }}</router-link>
              </template>
            </div>
          </details>
          <div v-if="!data.rows.length" class="muted small">Keine Mitglieder für diesen Filter.</div>
        </div>
      </div>
    </div>
    <AttemptDialog ref="dialog" action="/anfragen/versuch" event-choice :all-users="data.allUsers" :shift-choices="data.shiftChoices" @done="refresh" />
  </AppShell>
</template>
