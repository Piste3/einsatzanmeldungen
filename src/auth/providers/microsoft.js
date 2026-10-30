'use strict';
// Microsoft Entra ID (Microsoft 365) Single Sign-On über OpenID Connect.
// Vorbereitet für die spätere Umstellung: aktivieren mit AUTH_PROVIDERS=microsoft (oder «local,microsoft»)
// und MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET. Redirect-URI in Entra: <BASE_URL>/auth/microsoft/callback
//
// Konten werden nicht automatisch angelegt: Der Admin legt das Benutzerkonto (mit Rolle) an.
// Beim ersten SSO-Login wird es über die E-Mail-Adresse gefunden und mit der Entra-Objekt-ID verknüpft.
const crypto = require('node:crypto');
const db = require('../../db');
const config = require('../../config');
const { nowIso } = require('../../lib/dates');

const ms = config.microsoft;
const authority = () => `https://login.microsoftonline.com/${ms.tenantId}/v2.0`;
const redirectUri = () => `${config.baseUrl}/auth/microsoft/callback`;

let discovery = null;
let jwks = null;

async function getDiscovery() {
  if (!discovery) {
    const r = await fetch(`${authority()}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`OIDC-Konfiguration nicht abrufbar (${r.status})`);
    discovery = await r.json();
  }
  return discovery;
}

async function getKey(kid) {
  const find = () => jwks?.keys?.find((k) => k.kid === kid);
  if (!find()) {
    const d = await getDiscovery();
    jwks = await (await fetch(d.jwks_uri)).json();
  }
  const jwk = find();
  if (!jwk) throw new Error('Signaturschlüssel unbekannt');
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

async function verifyIdToken(idToken, nonce) {
  const [h, p, s] = String(idToken).split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  if (header.alg !== 'RS256') throw new Error('Unerwarteter Signaturalgorithmus');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), await getKey(header.kid), Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('Signatur ungültig');
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== ms.clientId) throw new Error('Token für andere Anwendung');
  if (claims.tid !== ms.tenantId) throw new Error('Falscher Mandant');
  if (claims.exp < now - 60 || claims.nbf > now + 60) throw new Error('Token abgelaufen');
  if (claims.nonce !== nonce) throw new Error('Nonce stimmt nicht');
  return claims;
}

module.exports = {
  id: 'microsoft',
  type: 'redirect',
  label: 'Mit Microsoft anmelden',
  enabled: () => config.authProviders.includes('microsoft') && Boolean(ms.tenantId && ms.clientId && ms.clientSecret),

  // Schritt 1: Weiterleitung zu Microsoft. state/nonce/PKCE liegen in einem kurzlebigen Cookie.
  async start(req, res) {
    const d = await getDiscovery();
    const state = crypto.randomBytes(16).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    res.cookie('kkb_oidc', JSON.stringify({ state, nonce, verifier }), {
      httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 10 * 60000, path: '/auth/microsoft',
    });
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: ms.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
      scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
    });
    res.redirect(url.toString());
  },

  // Schritt 2: Rückkehr von Microsoft
  async callback(req, res) {
    let saved;
    try { saved = JSON.parse(req.cookies.kkb_oidc || ''); } catch { saved = null; }
    res.clearCookie('kkb_oidc', { path: '/auth/microsoft' });
    if (!saved || req.query.state !== saved.state) return { ok: false, error: 'Anmeldung abgelaufen, bitte erneut versuchen.' };
    if (req.query.error) return { ok: false, error: `Microsoft meldet: ${req.query.error_description || req.query.error}` };
    const d = await getDiscovery();
    const r = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ms.clientId, client_secret: ms.clientSecret, grant_type: 'authorization_code',
        code: String(req.query.code || ''), redirect_uri: redirectUri(), code_verifier: saved.verifier,
      }),
    });
    const tokens = await r.json();
    if (!r.ok || !tokens.id_token) return { ok: false, error: 'Microsoft-Anmeldung fehlgeschlagen.' };
    const claims = await verifyIdToken(tokens.id_token, saved.nonce);
    const email = String(claims.email || claims.preferred_username || '').toLowerCase();
    let user = db.one("SELECT * FROM users WHERE auth_provider = 'microsoft' AND external_id = ?", claims.oid);
    if (!user && email) {
      user = db.one('SELECT * FROM users WHERE lower(email) = ? AND external_id IS NULL', email);
      if (user) {
        db.run("UPDATE users SET auth_provider = 'microsoft', external_id = ?, updated_at = ? WHERE id = ?", claims.oid, nowIso(), user.id);
      }
    }
    if (!user || !user.active) return { ok: false, error: 'Für dieses Microsoft-Konto ist kein Zugang eingerichtet. Bitte beim Admin melden.' };
    db.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
    return { ok: true, user };
  },
};
