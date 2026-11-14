import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { installGlobalUi } from './lib/globalUi.js';

installGlobalUi();
createApp(App).use(router).mount('#app');
