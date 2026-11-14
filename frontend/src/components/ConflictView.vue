<script setup>
// Wie views/pages/conflict.ejs: beide Stände nebeneinander, dann entscheiden
import { computed } from 'vue';
import Topbar from './Topbar.vue';
import { conflict, clearConflict } from '@/lib/conflict.js';
import { post, navigate, ApiError, flash } from '@/lib/api.js';
import { leaveAllowed } from '@/lib/section.js';
import { dates } from '@/lib/format.js';

const c = computed(() => conflict.data);
async function go(url) { clearConflict(); leaveAllowed(); await navigate(url); }
async function reapply() {
  const { mine, version, action } = c.value;
  const body = { ...mine, version };
  delete body._csrf;
  try {
    clearConflict();
    leaveAllowed();
    await post(action, body, { follow: true });
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 409 && e.body?.view === 'pages/conflict') conflict.data = e.body.data;
    else for (const m of e.messages) flash('error', m);
  }
}
</script>

<template>
  <Topbar :crumbs="[['Gleichzeitige Änderung']]" heading="Gleichzeitige Änderung" :show-search="false" />
  <div class="callout warn mb">
    <strong class="cap">Achtung</strong>
    Dieser Datensatz wurde soeben von <strong>{{ c.who }}</strong> geändert{{ c.when ? ` (${dates.fmtRelative(c.when)})` : '' }}.<template v-if="c.summary"><br><span class="small">{{ c.summary }}</span></template>
    <br>Deine Änderung wurde nicht gespeichert, damit nichts still überschrieben wird. Bitte entscheide:
  </div>
  <div class="card mb">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Feld</th><th>Aktueller Stand (gespeichert)</th><th>Deine Änderung</th></tr></thead>
        <tbody>
          <tr v-if="!c.rows.length"><td colspan="3" class="empty">Keine inhaltlichen Unterschiede in den Feldern.</td></tr>
          <tr v-for="r in c.rows" :key="r.key"><td><strong>{{ r.label }}</strong></td><td class="pre">{{ r.theirs || '–' }}</td><td class="pre">{{ r.mine || '–' }}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="row">
    <a class="btn" :href="c.editUrl" @click.prevent="go(c.editUrl)">Aktuellen Stand übernehmen und weiterbearbeiten</a>
    <form class="inline" @submit.prevent="reapply"><button class="btn btn-primary" type="submit">Eigene Änderung erneut anwenden</button></form>
    <a class="btn btn-ghost" :href="c.backUrl" @click.prevent="go(c.backUrl)">Verwerfen</a>
  </div>
</template>
