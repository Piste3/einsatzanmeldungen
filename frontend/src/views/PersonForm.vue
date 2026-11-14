<script setup>
// Person anlegen oder bearbeiten (wie views/pages/person-form.ejs)
import { computed, ref, watch, onUnmounted } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection } from '@/lib/section.js';
import { setEditing } from '@/lib/live.js';
import { labels } from '@/lib/format.js';

const { data, error, refresh } = usePage((r) => r.fullPath, { live: false });
const p = computed(() => data.value.p);
const isNew = computed(() => Boolean(data.value.isNew));
const from = computed(() => data.value.from || '');
const name = computed(() => `${p.value.first_name} ${p.value.last_name}`);
const crumbs = computed(() => (isNew.value ? [['Personen', '/personen'], ['Neue Person']] : [['Personen', '/personen'], [name.value, `/personen/${p.value.id}`], ['Bearbeiten']]));
const teamIds = computed(() => (p.value.team_ids || []).map(Number));
const cancelTo = computed(() => (isNew.value ? (from.value ? '/klaerungen' : '/personen') : `/personen/${p.value.id}`));

// Wer bearbeitet gerade dieselbe Person?
watch(() => data.value.editKey, (k) => setEditing(k || null), { immediate: true });
onUnmounted(() => setEditing(null));

const form = ref(null);
useSection(form, data);
async function save() {
  const path = isNew.value ? '/personen' : `/personen/${p.value.id}/bearbeiten`;
  await runAction(path, formBody(form.value), { follow: true });
}

// Namensvarianten: Seite bleibt, nur der Inhalt wird neu geladen
const aliasForm = ref(null);
const aliasKey = ref(0);
useSection(aliasForm, data);
async function addAlias() {
  const res = await runAction(`/personen/${p.value.id}/alias`, formBody(aliasForm.value), { onDone: refresh });
  if (res) aliasKey.value += 1;
}
const removeAlias = (a) => runAction(`/personen/${p.value.id}/alias/${a.id}/loeschen`, {}, { onDone: refresh });

// Löschen mit Angabe, was alles mitgeht
const impact = computed(() => data.value.impact);
const parts = computed(() => {
  const i = impact.value || {};
  const out = [];
  if (i.registrations) out.push(`${i.registrations} Anmeldung${i.registrations === 1 ? '' : 'en'} inkl. Schichtzuteilungen`);
  if (i.inquiries) out.push(`${i.inquiries} Anfrage${i.inquiries === 1 ? '' : 'n'} mit Kontaktversuchen`);
  return out;
});
// Ein Textstück wie bisher (getrennte Textteile verschieben die Schrift um Bruchteile eines Pixels)
const impactText = computed(() => {
  const i = impact.value || {};
  return `Entfernt die Person endgültig${parts.value.length ? `, zusammen mit ${parts.value.join(' und ')}` : ''}.${i.leaderOf ? ` Bei ${i.leaderOf} Einsatz/Einsätzen wird die Einsatzleitung geleert.` : ''}${i.user ? ` Das Benutzerkonto «${i.user}» bleibt bestehen, ist danach aber mit keiner Person mehr verknüpft.` : ''} Der Verlauf bleibt als Text erhalten.`;
});
const remove = () => runAction(`/personen/${p.value.id}/loeschen`, {}, {
  confirm: `${name.value} endgültig löschen?${parts.value.length ? `\n\nDabei werden auch gelöscht: ${parts.value.join(', ')}.` : ''}\n\nDas lässt sich nicht rückgängig machen.`,
  follow: true,
});
</script>

<template>
  <div v-if="error && !p" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="p">
    <Topbar :crumbs="crumbs" :heading="isNew ? 'Neue Person' : name" :show-search="false" />
    <div v-if="from" class="callout mb">Die neue Person wird nach dem Speichern direkt der Anmeldung aus den Klärungen zugeordnet.</div>
    <div class="grid grid-main">
      <form ref="form" class="card" @submit.prevent="save">
        <input v-if="!isNew" type="hidden" name="version" :value="p.version">
        <input v-if="from" type="hidden" name="from_registration" :value="from">
        <div class="card-head"><h2>Stammdaten</h2></div>
        <div class="card-body">
          <div class="fields fields-2">
            <div class="field"><label for="first_name">Vorname <span class="req">*</span></label><input id="first_name" type="text" name="first_name" :defaultValue="p.first_name || ''" required></div>
            <div class="field"><label for="last_name">Nachname <span class="req">*</span></label><input id="last_name" type="text" name="last_name" :defaultValue="p.last_name || ''" required></div>
          </div>
          <div class="fields fields-3e">
            <div class="field"><label for="status">Status</label><select id="status" name="status"><option v-for="(v, k) in labels.PERSON_STATUS" :key="k" :value="k" :defaultSelected="p.status === k">{{ v.label }}</option></select><div class="field-hint">Inaktive erscheinen nicht in Vorschlägen</div></div>
            <div class="field"><label for="rank_id">Rang</label><select id="rank_id" name="rank_id"><option value="">–</option><option v-for="r in data.ranks" :key="r.id" :value="r.id" :defaultSelected="Number(p.rank_id) === r.id">{{ r.name }} ({{ r.short }})</option></select></div>
            <div class="field"><label>Mannschaft / Kader</label>
              <label v-for="t in data.teams" :key="t.id" class="check"><input type="checkbox" name="team_ids" :value="t.id" :defaultChecked="teamIds.includes(t.id)"> {{ t.name }}</label>
              <span v-if="!data.teams.length" class="small muted">Noch keine Mannschaften – unter Einstellungen › Auswahllisten anlegen.</span>
            </div>
          </div>
          <div class="fields fields-3e">
            <div class="field"><label for="birth_date">Geburtsdatum</label><input id="birth_date" type="date" name="birth_date" :defaultValue="p.birth_date || ''"></div>
            <div class="field"><label for="birth_year">oder Jahrgang</label><input id="birth_year" type="number" name="birth_year" min="1900" max="2100" :defaultValue="p.birth_date ? '' : (p.birth_year || '')"></div>
            <div></div>
          </div>
          <div class="fields fields-2">
            <div class="field"><label for="mobile">Mobilnummer</label><input id="mobile" type="tel" name="mobile" :defaultValue="p.mobile || ''" placeholder="079 123 45 67"></div>
            <div class="field"><label for="email">E-Mail</label><input id="email" type="email" name="email" :defaultValue="p.email || ''" placeholder="vorname.nachname@web.kkb.ch"></div>
          </div>
          <div class="fields fields-2">
            <div class="field"><label for="diet_category">Essenseinschränkung</label><select id="diet_category" name="diet_category"><option value="">keine</option><option v-for="(v, k) in labels.DIET" :key="k" :value="k" :defaultSelected="p.diet_category === k">{{ v }}</option></select></div>
            <div class="field"><label for="diet_text">Details</label><input id="diet_text" type="text" name="diet_text" :defaultValue="p.diet_text || ''" placeholder="z. B. Nüsse"></div>
          </div>
          <div class="field"><label for="internal_note">Interne Bemerkung</label><textarea id="internal_note" name="internal_note" rows="2" :defaultValue="p.internal_note || ''"></textarea></div>
        </div>
        <div class="card-foot row" style="padding:0 16px 16px"><button class="btn btn-primary" type="submit">Speichern</button><router-link class="btn btn-ghost" :to="cancelTo">Abbrechen</router-link></div>
      </form>
      <template v-if="!isNew">
        <div class="card">
          <div class="card-head"><h2>Namensvarianten <span class="hint">z. B. Spitznamen wie «Chrigi»</span></h2></div>
          <div class="card-body">
            <div v-for="a in p.aliases" :key="a.id" class="row-between mb-s"><span>«{{ a.first_name }} {{ a.last_name }}»</span>
              <form class="inline" @submit.prevent="removeAlias(a)"><button class="btn btn-xs btn-ghost btn-danger" type="submit">Entfernen</button></form></div>
            <p v-if="!p.aliases.length" class="small muted">Noch keine Namensvarianten.</p>
            <form ref="aliasForm" :key="aliasKey" class="mt" @submit.prevent="addAlias">
              <div class="fields fields-2"><div class="field"><input type="text" name="first_name" placeholder="Vorname" required></div><div class="field"><input type="text" name="last_name" placeholder="Nachname" :defaultValue="p.last_name" required></div></div>
              <button class="btn btn-sm" type="submit">+ Namensvariante</button>
            </form>
          </div>
        </div>
        <div v-if="impact" class="card card-danger">
          <div class="card-head"><h2>Person löschen</h2></div>
          <div class="card-body">
            <p class="small">{{ impactText }}</p>
            <p class="small muted">Wer nur nicht mehr aktiv ist, setzt besser den Status auf «inaktiv» oder «ausgetreten», dann bleibt die Einsatz-Historie erhalten.</p>
            <form class="mt" @submit.prevent="remove"><button class="btn btn-danger" type="submit">Person endgültig löschen</button></form>
          </div>
        </div>
      </template>
    </div>
  </AppShell>
</template>
