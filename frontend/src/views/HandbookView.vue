<script setup>
// Handbuch in der App (wie views/pages/handbook.ejs)
import { computed } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Topbar from '@/components/Topbar.vue';
import { usePage } from '@/lib/usePage.js';
import { apiUrl } from '@/lib/useFilters.js';
import { dates } from '@/lib/format.js';

const { env, data, error } = usePage((r) => r.fullPath, { live: false });
const doc = computed(() => data.value.doc);
const toc = computed(() => doc.value.toc.filter((x) => x.depth === 2));
</script>

<template>
  <div v-if="error && !doc" class="flash flash-error">{{ error.message }}</div>
  <AppShell v-if="doc">
    <Topbar :heading="env.title" :crumbs="[['Handbuch']]" :show-search="false">
      <template #actions><router-link v-if="data.other" class="btn" :to="data.other.href">{{ data.other.label }}</router-link><a class="btn btn-primary" :href="apiUrl(data.pdfHref)" target="_blank" rel="noopener" title="Das gestaltete Handbuch als PDF in einem neuen Tab öffnen – zum Drucken, Speichern oder Weiterschicken">Als PDF</a></template>
    </Topbar>
    <div class="subline mb">Stand {{ dates.fmtDate(String(doc.date).slice(0, 10)) }}{{ doc.commit ? ` · Version ${doc.commit}` : '' }} · wird mit jedem Update automatisch aktualisiert</div>
    <div class="handbook">
      <nav v-if="doc.toc.length > 2" class="card handbook-toc no-print">
        <div class="card-head"><h2>Inhalt</h2></div>
        <div class="card-body"><a v-for="t in toc" :key="t.id" :href="`#${t.id}`">{{ t.text }}</a></div>
      </nav>
      <article class="card handbook-body"><div class="card-body prose" v-html="doc.html"></div></article>
    </div>
  </AppShell>
</template>
