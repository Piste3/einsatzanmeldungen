<script setup>
import ConfirmDialog from './components/ConfirmDialog.vue';
import ErrorView from './views/ErrorView.vue';
import { pageError } from './lib/pageError.js';
</script>
<template>
  <ErrorView v-if="pageError.data" />
  <router-view v-else />
  <ConfirmDialog />
</template>
