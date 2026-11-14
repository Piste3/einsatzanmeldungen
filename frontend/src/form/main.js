// Öffentliches Anmeldeformular (wird in ClubDesk eingebettet). Eigener, kleiner Einstieg ohne Router und Login.
import { createApp } from 'vue';
import FormApp from './FormApp.vue';

createApp(FormApp).mount('#form-app');

// Höhe an das ClubDesk-iFrame melden (falls die Seite darauf hört)
const report = () => { try { parent.postMessage({ type: 'kkb-form-height', height: document.documentElement.scrollHeight }, '*'); } catch { /* ignorieren */ } };
window.addEventListener('load', report);
new ResizeObserver(report).observe(document.body);
