// Gleichzeitige Änderung: Der Server zeigt beide Stände (pages/conflict). Die Browser-App zeigt sie an Stelle der Seite.
import { reactive } from 'vue';
import { session } from './api.js';

export const conflict = reactive({ data: null });
export function showConflict(data) { conflict.data = data; session.liveTopics = []; window.scrollTo(0, 0); }
export function clearConflict() { conflict.data = null; }
