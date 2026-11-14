// Gleiche Adresse, andere Ansicht je nach Rolle: Einsatzleiter sehen unter / und /einsaetze/:id ihre eigene, schreibgeschützte Seite
import { defineComponent, defineAsyncComponent, h } from 'vue';
import { session } from './api.js';

export function byRole(normal, leader) {
  const A = defineAsyncComponent(normal);
  const L = defineAsyncComponent(leader);
  return defineComponent({
    name: 'ByRole',
    setup() { return () => h(session.user?.role === 'einsatzleiter' ? L : A); },
  });
}
