import { createRouter, createWebHistory } from 'vue-router';
import { session, bootstrap, useRouter, setFlashes, flashCarry } from './lib/api.js';
import { dirtySections, leaveAllowed } from './lib/section.js';
import { whenPageLoaded } from './lib/usePage.js';
import { uiDialog } from './lib/dialog.js';
import { clearConflict } from './lib/conflict.js';

// Ausgewählte Ansichten sind schon in der Browser-App. Alle anderen Adressen öffnet die bisherige Ansicht (LegacyView).
const routes = [
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/', name: 'cockpit', component: () => import('./views/CockpitView.vue') },
  { path: '/rueckmeldungen', name: 'feedback', component: () => import('./views/FeedbackView.vue') },
  { path: '/einsaetze', name: 'events', component: () => import('./views/EventsView.vue') },
  { path: '/einsaetze/:id(\\d+)', name: 'event', component: () => import('./views/EventOverview.vue') },
  { path: '/einsaetze/:id(\\d+)/anfragen', name: 'event-inquiries', component: () => import('./views/EventInquiries.vue') },
  { path: '/einsaetze/:id(\\d+)/schichten', name: 'event-shifts', component: () => import('./views/EventShifts.vue') },
  { path: '/einsaetze/neu', name: 'event-new', component: () => import('./views/EventEdit.vue') },
  { path: '/einsaetze/:id(\\d+)/bearbeiten', name: 'event-edit', component: () => import('./views/EventEdit.vue') },
  { path: '/einsaetze/:id(\\d+)/teilnehmerliste', name: 'participants', component: () => import('./views/ParticipantsView.vue') },
  { path: '/einsaetze/:id(\\d+)/verpflegungsliste', name: 'meals', component: () => import('./views/MealsView.vue') },
  { path: '/einsaetze/:id(\\d+)/formular', name: 'event-form', component: () => import('./views/EventFormTab.vue') },
  { path: '/einsaetze/:id(\\d+)/verlauf', name: 'event-log', component: () => import('./views/EventLog.vue') },
  { path: '/einsaetze/:id(\\d+)/anmeldungen', name: 'event-registrations', component: () => import('./views/EventRegistrations.vue') },
  { path: '/:pathMatch(.*)*', name: 'legacy', component: () => import('./views/LegacyView.vue'), meta: { public: true } },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  // Gleiche Seite (Filter, Sortierung): Stelle halten. Zurück/Vor: frühere Stelle. Neue Seite: oben, bei #… dorthin.
  scrollBehavior(to, from, saved) {
    if (saved) return whenPageLoaded().then(() => saved);
    if (to.path === from.path) return false;
    if (to.hash) return { el: to.hash };
    return { top: 0 };
  },
});
useRouter(router);

router.beforeEach(async (to, from) => {
  if (!session.ready) await bootstrap();
  // Wie bisher: Link in der App bei ungespeicherten Änderungen nur nach Rückfrage
  if (dirtySections.size && to.path !== from.path) {
    document.body.classList.remove('nav-open');
    const go = await uiDialog({ title: 'Ungespeicherte Änderungen', message: 'Auf dieser Seite gibt es Änderungen, die noch nicht gespeichert sind. Wenn du die Seite verlässt, gehen sie verloren.', ok: 'Verwerfen und weiter', cancel: 'Bleiben', danger: true });
    if (!go) return false;
    leaveAllowed();
  }
  if (to.meta.public) return true;
  if (!session.user) return { name: 'login', query: { next: to.fullPath } };
  return true;
});

// Eine angezeigte Konfliktseite gilt nur für die Seite, auf der sie entstand
router.afterEach((to, from) => {
  clearConflict();
  // Meldungen gelten für die Seite, auf der sie entstanden; nach einer Aktion mit Weiterleitung kommen sie mit
  if (to.path !== from.path && !flashCarry.keep) setFlashes([]);
  flashCarry.keep = false;
});
