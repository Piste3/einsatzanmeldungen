<script setup>
// Einstellungen › System: Version, Update, Neustart, Protokoll (wie views/admin/system.ejs)
import { computed, ref, watch, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import AdminTabs from '@/components/AdminTabs.vue';
import { usePage } from '@/lib/usePage.js';
import { runAction } from '@/lib/actions.js';
import { dates } from '@/lib/format.js';

const route = useRoute();
const router = useRouter();
const { data, error, refresh } = usePage((r) => r.fullPath, { live: false });
const ready = computed(() => Boolean(data.value.st));
const st = computed(() => data.value.st);
const check = ref(null);
watch(() => data.value.check, (c) => { if (c !== undefined) check.value = c; });

// Protokoll: während Update oder Neustart den Stand abfragen, danach die Seite neu laden
const log = ref(null);
const stateText = ref(null);
const logText = computed(() => (st.value.lines.length ? st.value.lines.join('\n') : 'Noch kein Update ausgeführt.'));
let timer = null;
let sawDown = false;
async function poll() {
  try {
    const res = await fetch('/api/v1/verwaltung/system/status', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error('nicht bereit');
    const s = await res.json();
    if (s.lines.length) data.value.st = { ...st.value, lines: s.lines };
    await nextTick();
    if (log.value) log.value.scrollTop = log.value.scrollHeight;
    stateText.value = s.running ? `läuft: ${s.step || ''}` : s.restarting ? 'Neustart …' : '';
    if (!s.running && !s.restarting) { timer = null; stateText.value = null; if (route.query.neustart) await router.replace('/verwaltung/system'); await refresh(); return; }
  } catch {
    sawDown = true;
    stateText.value = 'Server startet neu …';
  }
  timer = setTimeout(poll, sawDown ? 2000 : 1200);
}
function startPolling() { if (!timer) { sawDown = false; timer = setTimeout(poll, 800); } }
watch(() => [st.value?.running, st.value?.restarting, route.query.neustart], ([a, b, c]) => { if (a || b || c) startPolling(); }, { immediate: true });
onUnmounted(() => clearTimeout(timer));
const shownState = computed(() => stateText.value ?? (st.value.running ? `läuft: ${st.value.step || ''}` : st.value.restarting ? 'Neustart …' : st.value.ok === false ? 'fehlgeschlagen' : ''));

async function checkNow() { const res = await runAction('/verwaltung/system/pruefen'); if (res?.data) { data.value = res.data; check.value = res.data.check; } }
async function update() {
  const res = await runAction('/verwaltung/system/update', {}, { confirm: 'Update jetzt installieren?\n\nDie Datenbank wird vorher gesichert. Der Server startet danach neu und ist kurz nicht erreichbar.' });
  if (res) { await refresh(); startPolling(); }
}
async function restart() {
  const res = await runAction('/verwaltung/system/neustart', {}, { confirm: 'Server jetzt neu starten?\n\nDie Seite ist für einige Sekunden nicht erreichbar.' });
  if (res) startPolling();
}
</script>

<template>
  <div v-if="error && !ready" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="ready">
    <Topbar heading="System" :crumbs="[['Einstellungen'], ['System']]" :show-search="false" />
    <AdminTabs />
    <div class="grid grid-main">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Update</h2></div>
          <div class="card-body">
            <div v-if="!st.canRestart" class="callout warn mb">Der Server läuft noch mit dem alten Startskript. Damit Update und Neustart hier funktionieren, bitte <strong>einmalig auf dem Server</strong> <code>betrieb\windows\gesamt\update.cmd</code> ausführen (Linux/macOS: <code>betrieb/linux/update.sh</code>). Ist der Autostart eingerichtet, danach zusätzlich <code>betrieb\windows\wartung\autostart-ein.cmd</code> als Administrator.</div>
            <p class="small">Holt die neueste Version von GitHub. Vorher wird die Datenbank gesichert, danach startet der Server neu. Während des Neustarts ist die Seite für einige Sekunden nicht erreichbar.</p>
            <template v-if="check">
              <div v-if="check.error" class="callout warn mt-s">{{ check.error }}</div>
              <div v-else-if="!check.commits.length" class="callout mt-s">Du bist auf dem neuesten Stand.</div>
              <div v-else class="callout mt-s"><strong>{{ check.commits.length }} Neuerung{{ check.commits.length === 1 ? '' : 'en' }} verfügbar:</strong>
                <ul class="small mt-s"><li v-for="(c, i) in check.commits" :key="i">{{ c.subject }} <span class="muted">({{ dates.fmtDateTime(c.date) }})</span></li></ul></div>
            </template>
            <div class="row mt">
              <form class="inline" @submit.prevent="checkNow"><button class="btn" type="submit">Nach Updates suchen</button></form>
              <form class="inline" @submit.prevent="update"><button class="btn btn-primary" type="submit" :disabled="st.running || !st.canRestart">Update installieren</button></form>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Protokoll <span id="update-state" class="hint">{{ shownState }}</span></h2></div>
          <div class="card-body">
            <pre ref="log" class="update-log" data-update-log>{{ logText }}</pre>
          </div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Version</h2></div>
          <div class="card-body small">
            <template v-if="data.version">
              <div class="row-between"><span class="muted">Stand</span><span><code>{{ data.version.hash }}</code></span></div>
              <div class="row-between"><span class="muted">vom</span><span>{{ dates.fmtDateTime(data.version.date) }}</span></div>
              <p class="mt-s">{{ data.version.subject }}</p>
            </template>
            <p v-else class="muted">Keine Versionsangabe (kein git-Projekt).</p>
            <div class="row-between mt-s"><span class="muted">Node.js</span><span>{{ data.node }} ({{ data.platform }})</span></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Neustart</h2></div>
          <div class="card-body small">
            <p>Startet den Server neu, z. B. nach Änderungen an der <code>.env</code>. Werte unter <router-link to="/verwaltung/server">Server</router-link> gelten ohne Neustart. Dauert wenige Sekunden.</p>
            <form class="mt-s" @submit.prevent="restart"><button class="btn" type="submit" :disabled="st.running || !st.canRestart">Server neu starten</button></form>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>
