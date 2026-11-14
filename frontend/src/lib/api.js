// Zugriff auf die Schnittstelle /api/v1. Das Cookie der Sitzung geht automatisch mit, das CSRF-Token im Kopf.
import { reactive } from 'vue';

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
    this.messages = body?.messages || [this.message];
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
  session.flashes = s.flashes || [];
  session.ready = true;
  return s;
}

// Meldungen aus der Antwort anzeigen (verschwinden nach einigen Sekunden)
export function flash(type, message) {
  const f = { type, message, id: Math.random() };
  session.flashes.push(f);
  setTimeout(() => { session.flashes = session.flashes.filter((x) => x.id !== f.id); }, 8000);
}

// Aktion senden. Eine Weiterleitung in der Antwort führt die Browser-App aus.
export async function act(method, path, body, { follow = true } = {}) {
  const json = await request(method, path, body);
  for (const f of json.flashes || []) flash(f.type, f.message);
  if (follow && json.redirect) await navigate(json.redirect);
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
