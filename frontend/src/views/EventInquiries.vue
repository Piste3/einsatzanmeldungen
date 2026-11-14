<script setup>
// Reiter «Anfragen» eines Einsatzes (wie views/event/anfragen.ejs)
import { computed, ref, watch } from 'vue';
import EventShell from '@/components/EventShell.vue';
import Badge from '@/components/Badge.vue';
import Rank from '@/components/Rank.vue';
import Icon from '@/components/Icon.vue';
import AttemptDialog from '@/components/AttemptDialog.vue';
import { usePage } from '@/lib/usePage.js';
import { useFilters } from '@/lib/useFilters.js';
import { runAction } from '@/lib/actions.js';
import { resetPerson } from '@/lib/attempts.js';
import { uiAlert } from '@/lib/dialog.js';
import { session } from '@/lib/api.js';
import { labels, dates } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const { f, apply, typed } = useFilters({ status: '', team: '', sort: 'rang', q: '' });
const ev = computed(() => data.value.event);
const list = computed(() => data.value.list || []);
const base = computed(() => `/einsaetze/${ev.value.id}/anfragen`);
const locked = computed(() => (ev.value.status === 'abgeschlossen' && session.user?.role !== 'admin') || ev.value.status === 'abgesagt');
const chipOrder = ['offen', 'nicht_erreicht', 'whatsapp', 'unsicher', 'zugesagt', 'angemeldet', 'abgesagt'];
const label = (st) => labels.INQUIRY_ROW[st] || labels.INQUIRY_STATUS[st] || { label: st, tone: 'gray' };
const chips = computed(() => chipOrder.filter((st) => data.value.listCounts?.[st]));
const resultText = { nicht_erreicht: 'nicht erreicht', whatsapp: 'gesendet', zugesagt: 'zugesagt', unsicher: 'unsicher', abgesagt: 'abgesagt' };
const chipTo = (status) => ({ path: base.value, query: { status, team: data.value.filters.team || undefined, q: data.value.filters.q || undefined, sort: data.value.filters.sort !== 'rang' ? data.value.filters.sort : undefined } });
// Filter wirken auf den aktuell gezeigten Status (auch wenn der Server ihn gewählt hat)
const filterNow = (delay) => { f.status = data.value.filters.status || 'alle'; delay ? typed() : apply(); };

const isClosed = (r) => ['zugesagt', 'angemeldet', 'abgesagt'].includes(r.state);
const isDone = (r) => ['zugesagt', 'angemeldet'].includes(r.state);
const openRows = computed(() => list.value.filter((r) => !isClosed(r)));
const closedRows = computed(() => list.value.filter(isClosed));
const grouped = computed(() => !data.value.filters.status && openRows.value.length > 0 && closedRows.value.length > 0);
const sections = computed(() => (grouped.value
  ? [{ key: 'offen', label: 'Noch offen', hint: '', rows: openRows.value }, { key: 'erledigt', label: 'Erledigt', hint: ' (zugesagt, angemeldet oder abgesagt)', rows: closedRows.value }]
  : [{ key: 'alle', rows: list.value }]));
const who = (r) => `${r.rank_short ? `${r.rank_short} ` : ''}${r.first_name} ${r.last_name}`;
const waLink = (mobile) => {
  let d = String(mobile || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = `41${d.slice(1)}`;
  return /^\d{8,15}$/.test(d) ? `https://wa.me/${d}` : null;
};
const regLink = (r) => ({ path: `/einsaetze/${ev.value.id}/anmeldungen`, query: { q: r.last_name } });

// Auswahl für «Kontakt für mehrere erfassen»
const picked = ref([]);
const pickable = computed(() => list.value.filter((r) => !isDone(r)).map((r) => r.person_id));
watch(pickable, (ids) => { const s = new Set(ids); picked.value = picked.value.filter((id) => s.has(id)); });
const allPicked = computed({
  get: () => pickable.value.length > 0 && picked.value.length === pickable.value.length,
  set: (v) => { picked.value = v ? [...pickable.value] : []; },
});

const dialog = ref(null);
const openAttempt = (r) => dialog.value.open({ person: r.person_id, event: ev.value.id, who: who(r), channel: ['nicht_erreicht', 'whatsapp'].includes(r.state) ? 'whatsapp' : 'telefon' });
async function openBulk() {
  if (!picked.value.length) { await uiAlert('Bitte zuerst Personen ankreuzen.'); return; }
  dialog.value.open({ event: ev.value.id, bulk: [...picked.value], channel: 'whatsapp' });
}
const afterSave = () => { picked.value = []; refresh(); };
const setStatus = (r, status) => runAction(`${base.value}/status`, { person_id: r.person_id, status }, { onDone: refresh });
const undoAttempt = (r, a) => runAction(`${base.value}/versuch/${a.id}/loeschen`, {}, {
  confirm: a.result === 'zugesagt' && r.registration_id ? 'Diesen Kontaktversuch zurücknehmen? Die daraus erstellte Anmeldung wird ebenfalls gelöscht.' : 'Diesen Kontaktversuch zurücknehmen?',
  onDone: refresh,
});
const reset = (r) => resetPerson({ personId: r.person_id, eventId: ev.value.id, who: who(r), onDone: refresh });
</script>

<template>
  <div v-if="error && !ev" class="flash flash-error">{{ error.message }}</div>
  <EventShell v-if="ev" :data="data" tab="anfragen">
    <div class="row-between mb">
      <div class="chips">
        <router-link :class="['chip', 'badge-gray', { active: !data.filters.status }]" :to="chipTo('alle')">Alle · {{ data.listTotal }}</router-link>
        <router-link v-for="st in chips" :key="st" :class="['chip', `badge-${label(st).tone}`, { active: data.filters.status === st }]" :to="chipTo(st)">{{ label(st).label }} · {{ data.listCounts[st] }}</router-link>
      </div>
      <form class="filters" style="margin:0" @submit.prevent="filterNow()">
        <select v-model="f.team" @change="filterNow()"><option value="">Alle Mannschaften</option><option v-for="t in data.teams" :key="t.id" :value="String(t.id)">{{ t.name }}</option></select>
        <select v-model="f.sort" aria-label="Sortierung" @change="filterNow()"><option value="rang">Rang: tief → hoch</option><option value="rang_ab">Rang: hoch → tief</option></select>
        <input v-model="f.q" type="search" placeholder="Name filtern" @input="filterNow(true)">
      </form>
    </div>
    <div v-if="locked" class="flash flash-info">Der Einsatz ist {{ labels.EVENT_STATUS[ev.status].label.toLowerCase() }}. Anfragen lassen sich nur noch ansehen.</div>
    <div class="card">
      <details class="card-head nachfassen-head help-fold" data-remember="hilfe-nachfassen" open>
        <summary><h2>Nachfassen</h2><span class="hint help-fold-hint">So geht es</span></summary>
        <ol class="nachfassen-steps">
          <li>Person anrufen oder per WhatsApp anschreiben (Nummer bzw. Sprechblase anklicken).</li>
          <li>Mit <strong>Erfassen</strong> festhalten, wie es gelaufen ist.</li>
          <li>Kommt die Antwort später, in der Zeile <strong>Zugesagt</strong> oder <strong>Abgesagt</strong> klicken.</li>
        </ol>
        <p class="hint">Mehreren dieselbe WhatsApp geschickt? Links ankreuzen und für alle auf einmal erfassen.</p>
      </details>
      <form v-if="!locked" class="bulkbar" @submit.prevent>
        <label class="check"><input v-model="allPicked" type="checkbox"> <span class="count">{{ picked.length ? `${picked.length} ausgewählt` : 'Alle auswählen' }}</span></label>
        <button v-if="picked.length" class="btn btn-sm" type="button" @click="openBulk">Kontakt für {{ picked.length }} Person{{ picked.length === 1 ? '' : 'en' }} erfassen</button>
      </form>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="check-col"></th><th>Person</th><th>Mobil</th><th>Status</th><th>Kontaktversuche</th><th class="actions-col"></th></tr></thead>
          <tbody>
            <tr v-if="!list.length"><td colspan="6" class="empty">{{ data.listTotal ? 'Keine Treffer für diesen Filter.' : 'Alle aktiven Mitglieder haben sich gemeldet.' }}</td></tr>
            <template v-for="g in sections" :key="g.key">
              <tr v-if="grouped" class="group-row"><td colspan="6"><strong>{{ g.label }}</strong> <span class="muted">· {{ g.rows.length }}{{ g.hint }}</span></td></tr>
              <tr v-for="r in g.rows" :key="r.person_id" :data-row-id="`i${r.person_id}-${r.attempts.length}-${r.state}`" :class="[r.state === 'whatsapp' ? 'highlight' : '', isDone(r) || r.state === 'abgesagt' ? 'row-muted' : '']">
                <td class="check-col"><input v-if="!locked && !isDone(r)" v-model="picked" type="checkbox" :value="r.person_id" aria-label="Auswählen"></td>
                <td><Rank :short="r.rank_short" /><router-link :to="`/personen/${r.person_id}`"><strong>{{ r.first_name }} {{ r.last_name }}</strong></router-link><template v-if="r.plan">{{ ' ' }}<span :class="['tag', r.plan.none ? 'tag-gray' : 'tag-blue', 'tag-np']" :title="r.plan.title">{{ r.plan.text }}</span></template><span v-if="r.teams" class="sub">{{ r.teams }}</span></td>
                <td class="nowrap">
                  <template v-if="r.mobile">
                    <a class="link" :href="`tel:${r.mobile.replace(/\s/g, '')}`" title="Anrufen">{{ r.mobile }}</a>{{ ' ' }}<a v-if="waLink(r.mobile)" class="icon-link" :href="waLink(r.mobile)" target="_blank" rel="noopener" title="WhatsApp-Chat öffnen"><Icon name="chat" /></a>
                  </template>
                  <span v-else class="muted">–</span>
                </td>
                <td>
                  <Badge :text="label(r.state).label" :tone="label(r.state).tone" />
                  <router-link v-if="r.state === 'angemeldet'" class="cell-sub link" :to="regLink(r)">{{ labels.REG_STATUS[r.reg_status].short }} · {{ labels.SOURCE[r.reg_source] }}</router-link>
                  <router-link v-if="r.state === 'zugesagt' && r.registration_id" class="cell-sub link" :to="regLink(r)">→ Anmeldung erstellt</router-link>
                </td>
                <td>
                  <span v-if="!r.attempts.length" class="muted">–</span>
                  <div class="attempts">
                    <div v-for="(a, idx) in r.attempts" :key="a.id" class="attempt"><span :class="['ch', { whatsapp: 'wa', muendlich: 'md' }[a.channel] || '']">{{ labels.CHANNEL[a.channel].short }}</span>{{ dates.fmtDateShort(a.contacted_at.slice(0, 10)) }} {{ a.contacted_at.slice(11, 16) }} · {{ a.sent_by_name }} · {{ resultText[a.result] }}{{ a.note ? ` · «${a.note}»` : '' }}
                      <form v-if="idx === r.attempts.length - 1 && !locked" class="inline" @submit.prevent="undoAttempt(r, a)"><button class="icon-btn" type="submit" title="Zurücknehmen (falsch erfasst)"><Icon name="undo" /></button></form>
                    </div>
                  </div>
                </td>
                <td class="actions-col right nowrap">
                  <template v-if="!locked && !isDone(r)">
                    <template v-if="['whatsapp', 'nicht_erreicht', 'unsicher'].includes(r.state)">
                      <form class="inline" @submit.prevent="setStatus(r, 'zugesagt')"><button class="btn btn-xs" type="submit" title="Antwort ist gekommen: kommt">Zugesagt</button></form>{{ ' ' }}<form class="inline" @submit.prevent="setStatus(r, 'abgesagt')"><button class="btn btn-xs" type="submit" title="Antwort ist gekommen: kommt nicht">Abgesagt</button></form>{{ ' ' }}
                    </template>
                    <button class="btn btn-sm" type="button" @click="openAttempt(r)">Erfassen</button>
                  </template>
                  <button v-else-if="!locked && isDone(r)" class="icon-btn" type="button" title="Alles zurücksetzen: Kontaktversuche, Anmeldung und Schichten für diesen Einsatz löschen" @click="reset(r)"><Icon name="undo" /></button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
    <AttemptDialog ref="dialog" :action="`${base}/versuch`" :all-users="data.allUsers" :shift-choices="data.shiftChoices" @done="afterSave" />
  </EventShell>
</template>
