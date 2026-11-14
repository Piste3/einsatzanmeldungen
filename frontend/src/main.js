import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router.js';
import { installDialogScroll } from './lib/scroll.js';
import { installGlobalUi } from './lib/globalUi.js';

installGlobalUi();
installDialogScroll();
createApp(App).use(router).mount('#app');
