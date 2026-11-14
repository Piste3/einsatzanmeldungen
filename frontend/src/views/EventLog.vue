<script setup>
// Reiter «Verlauf»: jede Änderung mit Person und Zeitpunkt
import { computed } from 'vue';
import EventShell from '@/components/EventShell.vue';
import { usePage } from '@/lib/usePage.js';
import { dates } from '@/lib/format.js';

const { data, error } = usePage((r) => r.fullPath);
const ev = computed(() => data.value.event);
function changes(l) {
  if (l.action !== 'update' || !l.details) return null;
  let d = null;
  try { d = JSON.parse(l.details); } catch { return null; }
  if (!d) return null;
  return Object.entries(d).filter(([, v]) => v && typeof v === 'object' && 'alt' in v)
    .map(([k, v]) => `${k}: «${String(v.alt ?? '–').slice(0, 60)}» → «${String(v.neu ?? '–').slice(0, 60)}»`);
}
</script>

<template>
  <div v-if="error && !ev" class="flash flash-error">{{ error.message }}</div>
  <EventShell v-if="ev" :data="data" tab="verlauf">
    <div class="card">
      <div class="card-head"><h2>Verlauf <span class="hint">jede Änderung mit Person und Zeitpunkt</span></h2></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Ereignis</th></tr></thead>
          <tbody>
            <tr v-if="!data.log.length"><td colspan="3" class="empty">Noch keine Einträge.</td></tr>
            <tr v-for="l in data.log" :key="l.id" :data-row-id="`a${l.id}`">
              <td class="nowrap">{{ dates.fmtDateTime(l.created_at) }}</td>
              <td class="nowrap">{{ l.user_name || 'System' }}</td>
              <td>{{ l.summary }}
                <span v-if="changes(l)" class="sub"><template v-for="(c, i) in changes(l)" :key="i">{{ c }}<br></template></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </EventShell>
</template>
