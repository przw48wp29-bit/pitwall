// Verbindung zum Tippspiel-Server.
//   * Mit Supabase-Zugangsdaten in config.js (TIPPSPIEL) läuft alles über Supabase.
//   * Ohne Zugangsdaten (oder mit ?demo in der Adresse) läuft der Demo-Modus:
//     dieselbe Datenbank-Logik in einer echten Postgres-Datenbank im Browser
//     (PGlite). Alles bleibt dann nur auf diesem Gerät.

import { TIPPSPIEL } from '../config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm';

const demoForced = () => {
  try { return new URLSearchParams(location.search).has('demo') || sessionStorage.getItem('pitwall-demo') === '1'; } catch { return false; }
};
export const isDemo = () => !(TIPPSPIEL.supabaseUrl && TIPPSPIEL.supabaseKey) || demoForced();

let backendP = null;
export function backend() {
  if (!backendP) {
    backendP = (isDemo() ? import('./dev.js').then(m => m.demoBackend()) : supabaseBackend())
      .catch(e => { backendP = null; throw e; });
  }
  return backendP;
}

export const rpc = async (fn, args = {}) => (await backend()).rpc(fn, args);
export const currentUser = async () => (await backend()).user();
export const auth = {
  signUp: async a => (await backend()).signUp(a),
  signIn: async a => (await backend()).signIn(a),
  signOut: async () => (await backend()).signOut(),
  updatePassword: async pw => (await backend()).updatePassword(pw),
};

// Schnelle Prüfung ohne Server: ist hier jemand angemeldet? (für Navigation/Startseite)
export function probablyLoggedIn() {
  try {
    if (isDemo()) return !!localStorage.getItem('pitwall-demo-user');
    return Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k));
  } catch { return false; }
}

const listeners = new Set();
export function onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export const emitAuth = user => listeners.forEach(cb => { try { cb(user); } catch (e) { console.error(e); } });

// Verständliche Fehlermeldungen.
export function friendly(e) {
  const m = e?.message || String(e);
  const map = [
    [/invalid login credentials/i, 'E-Mail oder Passwort ist falsch.'],
    [/already registered|already been registered|already exists/i, 'Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.'],
    [/password should be|weak password|password is too/i, 'Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen.'],
    [/email not confirmed/i, 'Die E-Mail-Adresse ist noch nicht bestätigt. (Admin: In Supabase «Confirm email» ausschalten.)'],
    [/rate limit|too many requests/i, 'Zu viele Versuche. Bitte warte einen Moment.'],
    [/invalid email|unable to validate email|email address .* is invalid/i, 'Diese E-Mail-Adresse ist ungültig.'],
    [/failed to fetch|networkerror|load failed/i, 'Keine Verbindung zum Server. Bist du online?'],
    [/jwt expired|invalid jwt|refresh token/i, 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.'],
    [/row-level security/i, 'Das ist nicht (mehr) erlaubt – vermutlich ist der Tippschluss vorbei.'],
  ];
  const hit = map.find(([re]) => re.test(m));
  const err = new Error(hit ? hit[1] : m);
  err.original = e;
  return err;
}

async function supabaseBackend() {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(TIPPSPIEL.supabaseUrl, TIPPSPIEL.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  let session = (await sb.auth.getSession()).data.session;
  sb.auth.onAuthStateChange((_ev, s) => {
    const changed = (s?.user?.id || null) !== (session?.user?.id || null);
    session = s;
    if (changed) emitAuth(s?.user ? { id: s.user.id, email: s.user.email } : null);
  });
  const fail = error => { if (error) throw friendly(error); };
  return {
    kind: 'supabase',
    user: () => (session?.user ? { id: session.user.id, email: session.user.email } : null),
    async signUp({ email, password, name }) {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
      fail(error);
      if (!data.session) throw new Error('Konto erstellt. Bitte bestätige zuerst deine E-Mail-Adresse und melde dich dann an.');
    },
    async signIn({ email, password }) { const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password }); fail(error); },
    async signOut() { await sb.auth.signOut(); },
    async updatePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); fail(error); },
    async rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); fail(error); return data; },
  };
}
