// Fehlerseite vom Server (kein Zugriff, nicht gefunden): ersetzt die Ansicht, bis man woanders hin geht
import { reactive } from 'vue';

export const pageError = reactive({ data: null });
export function showPageError(data) { pageError.data = data; }
export function clearPageError() { pageError.data = null; }
