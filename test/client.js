'use strict';
// Testzugang zur Schnittstelle /api/v1 wie die Browser-App: Cookies, CSRF-Token im Kopf, JSON hin und zurück
function client(base, { userAgent } = {}) {
  const jar = new Map();
  let csrf = '';
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  function keep(res) {
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (!v || /expires=Thu, 01 Jan 1970/i.test(c) || /max-age=0/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
  }
  async function call(method, path, body, headers = {}) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(jar.size ? { cookie: cookie() } : {}),
        ...(method !== 'GET' && csrf ? { 'x-csrf-token': csrf } : {}),
        ...(userAgent ? { 'user-agent': userAgent } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    keep(res);
    const type = res.headers.get('content-type') || '';
    const json = type.includes('json') ? await res.json() : null;
    return { status: res.status, json, data: json?.data, view: json?.view, redirect: json?.redirect, flashes: json?.flashes || [], res, headers: res.headers };
  }
  async function refresh() {
    const s = await call('GET', '/session');
    csrf = s.json.csrf;
    return s.json;
  }
  return {
    jar,
    cookie,
    get: (path, headers) => call('GET', path, undefined, headers),
    post: async (path, body = {}, headers) => { if (!csrf) await refresh(); return call('POST', path, body, headers); },
    // Anmelden; danach gilt ein neues CSRF-Token
    async login(username, password, extra = {}) {
      const r = await call('POST', '/login', { username, password, next: '/', ...extra });
      await refresh();
      return r;
    },
    refresh,
    get csrf() { return csrf; },
    set csrf(v) { csrf = v; },
  };
}

// Text aller Meldungen einer Antwort
const flashText = (r) => r.flashes.map((f) => f.message).join(' ');

module.exports = { client, flashText };
