import { createRouter, createWebHistory } from 'vue-router';
import { session, bootstrap, useRouter } from './lib/api.js';

// Ausgewählte Ansichten sind schon in der Browser-App. Alle anderen Adressen öffnet die bisherige Ansicht (LegacyView).
const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'cockpit', component: () => import('./views/CockpitView.vue') },
  { path: '/einsaetze', name: 'events', component: () => import('./views/EventsView.vue') },
  { path: '/einsaetze/:id(\\d+)', name: 'event', component: () => import('./views/EventOverview.vue') },
  { path: '/einsaetze/:id(\\d+)/anfragen', name: 'event-inquiries', component: () => import('./views/EventInquiries.vue') },
  { path: '/einsaetze/:id(\\d+)/schichten', name: 'event-shifts', component: () => import('./views/EventShifts.vue') },
  { path: '/einsaetze/:id(\\d+)/anmeldungen', name: 'event-registrations', component: () => import('./views/EventRegistrations.vue') },
  { path: '/:pathMatch(.*)*', name: 'legacy', component: () => import('./views/LegacyView.vue'), meta: { public: true } },
];

export const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });
useRouter(router);

router.beforeEach(async (to) => {
  if (!session.ready) await bootstrap();
  if (to.meta.public) return true;
  if (!session.user) return { name: 'login', query: { next: to.fullPath } };
  return true;
});
