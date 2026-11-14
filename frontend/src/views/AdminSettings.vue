<script setup>
// Einstellungen › Allgemein: Verein, Anmeldeformular, Datensicherung (wie views/admin/settings.ejs)
import { computed, ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction, formBody } from '@/lib/actions.js';
import { useSection } from '@/lib/section.js';

const { data, error, refresh } = usePage((r) => r.fullPath);
const s = computed(() => data.value.s);
const form = ref(null);
useSection(form, data);
const save = () => runAction('/verwaltung/einstellungen', formBody(form.value), { onDone: refresh });
const backupNow = () => runAction('/verwaltung/sicherung', {}, { onDone: refresh });
</script>

<template>
  <div v-if="error && !s" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="s">
    <Topbar heading="Allgemein" :crumbs="[['Einstellungen'], ['Allgemein']]" :show-search="false" />
    <AdminTabs />
    <form ref="form" class="grid grid-main" @submit.prevent="save">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Verein</h2></div>
          <div class="card-body">
            <div class="fields fields-2">
              <div class="field"><label for="verein_name">Vereinsname</label><input id="verein_name" type="text" name="verein_name" :defaultValue="s.verein_name"></div>
              <div class="field"><label for="aufgebot_email">Aufgebots-E-Mail</label><input id="aufgebot_email" type="email" name="aufgebot_email" :defaultValue="s.aufgebot_email"><div class="field-hint">steht im Aufgebot, z. B. aufgebot@kkb.ch</div></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Anmeldeformular</h2></div>
          <div class="card-body">
            <div class="fields fields-2">
              <div class="field"><label for="form_title">Titel</label><input id="form_title" type="text" name="form_title" :defaultValue="s.form.title"></div>
              <div class="field"><label for="form_min_seconds">Spam-Schutz: Mindestzeit (Sekunden)</label><input id="form_min_seconds" type="number" min="0" name="form_min_seconds" :defaultValue="s.form.min_seconds"><div class="field-hint">Schneller abgeschickte Formulare gelten als Spamverdacht.</div></div>
            </div>
            <div class="field"><label for="form_intro">Einleitungstext (optional)</label><textarea id="form_intro" name="form_intro" rows="2" :defaultValue="s.form.intro"></textarea></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Automatische Anmeldebestätigung</h2></div>
          <div class="card-body small">Betreff, Text und Versand der Bestätigungsmail bearbeitest du unter <router-link to="/verwaltung/bestaetigungsmail">Bestätigungsmail</router-link>.</div>
        </div>
        <div><button class="btn btn-primary" type="submit">Einstellungen speichern</button></div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Datensicherung</h2></div>
          <div class="card-body small">
            <p>Die Datenbank wird täglich automatisch gesichert (Ordner <code>{{ data.backupDir }}</code>).</p>
            <div v-for="b in data.backups.slice(0, 7)" :key="b.name" class="row-between"><span>{{ b.name }}</span><span class="muted">{{ Math.round(b.size / 1024) }} KB</span></div>
            <p v-if="!data.backups.length" class="muted">Noch keine Sicherung.</p>
            <button class="btn btn-sm mt-s" type="button" @click="backupNow">Jetzt sichern</button>
          </div>
        </div>
      </div>
    </form>
  </AppShell>
</template>
