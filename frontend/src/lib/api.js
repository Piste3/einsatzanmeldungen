// Zugriff auf die Schnittstelle /api/v1. Das Cookie der Sitzung geht automatisch mit, das CSRF-Token im Kopf.
import { reactive } from 'vue';
import { leaveAllowed } from './section.js';

export const session = reactive({
  ready: false, user: null, csrf: '', nav: {}, flashes: [], liveTopics: [], title: '', offline: false,
});

let router = null;
export function useRouter(r) { router = r; }

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Fehler ${status}`);
    this.status = status;
    this.body = body || {};
    this.messages = body?.messages || (body?.data?.errors?.length ? body.data.errors : [this.message]);
  }
}

function adopt(env) {
  if (env.user !== undefined) session.user = env.user;
  if (env.csrf !== undefined) session.csrf = env.csrf;
  if (env.nav) session.nav = env.nav;
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && session.csrf) headers['X-CSRF-Token'] = session.csrf;
  let res;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    session.offline = false;
  } catch (e) {
    session.offline = true;
    throw new ApiError(0, { error: 'Der Server ist kurz nicht erreichbar.' });
  }
  const type = res.headers.get('content-type') || '';
  const json = type.includes('json') ? await res.json() : null;
  if (res.status === 401 && json?.login) {
    session.user = null;
    if (router && router.currentRoute.value.name !== 'login') router.push({ name: 'login', query: { next: router.currentRoute.value.fullPath } });
  }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

// Seitendaten laden: { view, title, data, flashes, liveTopics, … }
export async function page(path) {
  const env = await request('GET', path);
  adopt(env);
  return env;
}

export async function bootstrap() {
  const s = await request('GET', '/session');
  adopt(s);
  setFlashes(s.flashes);
  session.ready = true;
  return s;
}

// Meldungen («Gespeichert» …) wie bisher: Sie bleiben stehen, bis die nächste Aktion neue bringt
// oder eine andere Seite öffnet. Die Live-Aktualisierung lässt sie stehen.
let flashSeq = 0;
export function flash(type, message) {
  session.flashes.push({ type, message, id: ++flashSeq });
}
export function setFlashes(list) {
  session.flashes = (list || []).map((f) => ({ ...f, id: ++flashSeq }));
}
// Eine Aktion führt auf eine andere Seite: ihre Meldungen sollen dort stehen bleiben
export const flashCarry = { keep: false };

// Aktion senden. Eine Weiterleitung in der Antwort führt die Browser-App aus.
export async function act(method, path, body, { follow = true } = {}) {
  const json = await request(method, path, body);
  setFlashes(json.flashes);
  if (follow && json.redirect) { leaveAllowed(); flashCarry.keep = true; await navigate(json.redirect); }
  return json;
}
export const post = (path, body, opts) => act('POST', path, body, opts);

export async function navigate(target) {
  if (!router) return;
  // Gleiche Adresse: Seite neu laden statt nichts zu tun
  const resolved = router.resolve(target);
  if (resolved.fullPath === router.currentRoute.value.fullPath) router.go(0);
  else await router.push(target);
}

export { request };
