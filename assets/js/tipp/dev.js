// Demo-Modus: das ganze Tippspiel lokal im Browser, ohne Server.
// Läuft auf PGlite (echtes PostgreSQL als WebAssembly) mit genau demselben
// SQL wie Supabase (supabase/01_tippspiel.sql) plus einer kleinen Nachbildung
// von Supabase-Login und -Rollen (supabase/dev/compat.sql).
// Die Daten liegen in der IndexedDB dieses Browsers.

import { loadCore } from '../data.js';
import { eventsFromSchedule, driversFromStandings } from './sync.js';
import { rpcCall, upsertSchedule } from './pg.js';
import { emitAuth } from './api.js';

const PGLITE = 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js';
const DB_NAME = 'idb://pitwall-demo';
const USER_KEY = 'pitwall-demo-user';

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const getUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
const setUser = u => {
  try { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); } catch { /* egal */ }
  emitAuth(u);
};
const meta = async (db, k) => (await db.query('select v from auth.dev_meta where k = $1', [k])).rows[0]?.v ?? null;
const setMeta = (db, k, v) => db.query('insert into auth.dev_meta (k, v) values ($1, $2) on conflict (k) do update set v = excluded.v', [k, v]);

async function migrate(db) {
  const [compat, schema] = await Promise.all(['supabase/dev/compat.sql', 'supabase/01_tippspiel.sql']
    .map(f => fetch(f, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(f + ' fehlt'); return r.text(); })));
  const version = await sha(compat + schema);
  let cur = null;
  try { cur = await meta(db, 'schema'); } catch { /* neue Datenbank */ }
  if (cur === version) return;
  await db.exec(compat);
  await db.exec(schema);
  await setMeta(db, 'schema', version);
}

// Kalender und Fahrer aus den Live-Daten der Seite übernehmen (wie der Sync-Job).
async function seed(db, force = false) {
  const last = await meta(db, 'seeded');
  if (!force && last && (last === 'frozen' || Date.now() - Date.parse(last) < 6 * 3600e3)) return;
  const core = await loadCore();
  await upsertSchedule(db, eventsFromSchedule(core.schedule), driversFromStandings(core.season, core.drivers));
  await setMeta(db, 'seeded', new Date().toISOString());
}

let instance = null;
export async function demoBackend() {
  if (instance) return instance;
  const { PGlite } = await import(PGLITE);
  const db = await PGlite.create(DB_NAME);
  await migrate(db);
  await seed(db);

  instance = {
    kind: 'demo',
    db,
    user: () => getUser(),
    async signUp({ email, password, name }) {
      email = String(email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Diese E-Mail-Adresse ist ungültig.');
      if (String(password || '').length < 8) throw new Error('Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen.');
      if ((await db.query('select 1 from auth.users where email = $1', [email])).rows.length) throw new Error('Für diese E-Mail gibt es schon ein Konto. Bitte anmelden.');
      const id = (await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify({ display_name: String(name || '').trim() })])).rows[0].id;
      await db.query('insert into auth.dev_passwords (user_id, hash) values ($1, $2)', [id, await sha(password)]);
      setUser({ id, email });
    },
    async signIn({ email, password }) {
      email = String(email || '').trim().toLowerCase();
      const r = (await db.query('select u.id, p.hash from auth.users u left join auth.dev_passwords p on p.user_id = u.id where u.email = $1', [email])).rows[0];
      if (!r || r.hash !== await sha(password || '')) throw new Error('E-Mail oder Passwort ist falsch.');
      setUser({ id: r.id, email });
    },
    async signOut() { setUser(null); },
    async updatePassword(pw) {
      const u = getUser();
      if (!u) throw new Error('Bitte zuerst anmelden.');
      if (String(pw || '').length < 8) throw new Error('Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen.');
      await db.query('update auth.dev_passwords set hash = $2 where user_id = $1', [u.id, await sha(pw)]);
    },
    async rpc(fn, args) {
      const u = getUser();
      const r = await rpcCall(db, u?.id || null, fn, args);
      if (fn === 'delete_account') setUser(null);
      return r;
    },
  };
  // Gespeicherter Benutzer existiert nicht mehr (z. B. nach Zurücksetzen)?
  const u = getUser();
  if (u && !(await db.query('select 1 from auth.users where id = $1', [u.id])).rows.length) setUser(null);
  return instance;
}

// ---------------------------------------------------------------------------
// Werkzeuge für den Demo-Modus (Panel unten links)
// ---------------------------------------------------------------------------
const TEST_PLAYERS = [
  { name: 'Lena', color: '#ff8000' },
  { name: 'Marco', color: '#e8002d' },
  { name: 'Sven', color: '#27f4d2' },
  { name: 'Nora', color: '#3671c6' },
];

export const demoTools = {
  async users() {
    const { db } = await demoBackend();
    return (await db.query('select u.id, u.email, p.display_name as name from auth.users u left join public.profiles p on p.id = u.id order by u.created_at')).rows;
  },
  async switchUser(id) {
    const { db } = await demoBackend();
    const r = (await db.query('select id, email from auth.users where id = $1', [id])).rows[0];
    if (r) setUser({ id: r.id, email: r.email });
  },
  // Testspieler anlegen, in die Gruppe holen und fürs nächste Rennen tippen lassen.
  async addTestPlayers(groupId) {
    const { db } = await demoBackend();
    const drivers = (await db.query(`select d.driver_id from public.season_drivers d
      where d.season = public.current_season() and d.active order by random()`)).rows.map(r => r.driver_id);
    const ev = (await db.query(`select * from public.events where race_start > now() and status = 'scheduled' order by race_start limit 1`)).rows[0];
    for (const p of TEST_PLAYERS) {
      const email = p.name.toLowerCase() + '@demo.local';
      let id = (await db.query('select id from auth.users where email = $1', [email])).rows[0]?.id;
      if (!id) {
        id = (await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [email, JSON.stringify({ display_name: p.name })])).rows[0].id;
        await db.query('insert into auth.dev_passwords (user_id, hash) values ($1, $2)', [id, await sha('demo1234')]);
        await db.query('update public.profiles set avatar = $2 where id = $1', [id, JSON.stringify({ color: p.color })]);
      }
      await db.query('insert into public.memberships (group_id, user_id) values ($1, $2) on conflict do nothing', [groupId, id]);
      if (!ev) continue;
      const pick = n => [...drivers].sort(() => Math.random() - 0.5).slice(0, n);
      const tips = { quali: { order: pick(3) }, race: { order: pick(10) }, extras: { fastest: pick(1)[0], sc: Math.floor(Math.random() * 3), dnf: Math.floor(Math.random() * 4) } };
      if (ev.sprint_start) tips.sprint = { order: pick(3) };
      for (const [kind, picks] of Object.entries(tips)) {
        await db.query(`insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, $3, $4, $5)
          on conflict (group_id, user_id, event_id, kind) do update set picks = excluded.picks`, [groupId, id, ev.id, kind, JSON.stringify(picks)]);
      }
    }
  },
  // Zeitreise fürs nächste Rennwochenende: Tippschluss bald / vorbei / wie im Kalender.
  async timeTravel(mode) {
    const { db } = await demoBackend();
    const ev = (await db.query(`select * from public.events where race_start > now() - interval '3 hours' and status = 'scheduled' order by race_start limit 1`)).rows[0];
    if (mode === 'reset') { await seed(db, true); return; }
    if (!ev) return;
    const at = min => new Date(Date.now() + min * 60e3).toISOString();
    const t = mode === 'soon'
      ? { q: at(3), sq: ev.sprint_start ? at(2) : null, s: ev.sprint_start ? at(60 * 20) : null, r: at(60 * 44) }
      : { q: at(-1), sq: ev.sprint_start ? at(-60 * 20) : null, s: ev.sprint_start ? at(-60 * 2) : null, r: at(60 * 20) };
    await db.query('update public.events set quali_start = $2, sprint_quali_start = $3, sprint_start = $4, race_start = $5 where id = $1', [ev.id, t.q, t.sq, t.s, t.r]);
    await setMeta(db, 'seeded', 'frozen');
  },
  // Nächstes Rennen als gefahren markieren (alle Sessions in der Vergangenheit) und
  // ein Zufallsresultat eintragen. Die Datenbank wertet sofort aus.
  async fakeResults() {
    const { db } = await demoBackend();
    const ev = (await db.query(`select * from public.events where race_start > now() - interval '3 hours' and status = 'scheduled' and results is null order by race_start limit 1`)).rows[0];
    if (!ev) return null;
    const ids = (await db.query('select driver_id from public.season_drivers where season = $1 and active order by random()', [ev.season])).rows.map(r => r.driver_id);
    const shuffle = a => [...a].sort(() => Math.random() - 0.5);
    const race = shuffle(ids);
    const dnf = race.slice(-1 - Math.floor(Math.random() * 3));
    const results = { quali: shuffle(ids), race, fastest: race[Math.floor(Math.random() * 5)], dnf, firstDnf: [dnf.at(-1)], sc: Math.floor(Math.random() * 3) };
    if (ev.sprint_start) results.sprint = shuffle(ids);
    const at = h => new Date(Date.now() - h * 3600e3).toISOString();
    await db.query(`update public.events set quali_start = $2, sprint_quali_start = $3, sprint_start = $4, race_start = $5 where id = $1`,
      [ev.id, at(26), ev.sprint_start ? at(30) : null, ev.sprint_start ? at(28) : null, at(2.5)]);
    await db.query('update public.events set results = $2 where id = $1', [ev.id, JSON.stringify(results)]);
    await setMeta(db, 'seeded', 'frozen');
    return ev.id;
  },
  async reset() {
    try { localStorage.removeItem(USER_KEY); } catch { /* egal */ }
    if (instance) { try { await instance.db.close(); } catch { /* egal */ } }
    await new Promise(res => { const r = indexedDB.deleteDatabase('/pglite/pitwall-demo'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    instance = null;
  },
};
