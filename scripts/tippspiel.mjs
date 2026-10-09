// Tippspiel-Sync: Kalender (Rennwochenenden mit Session-Zeiten) und Fahrerfeld
// von Jolpica nach Supabase übertragen. Daraus berechnet die Datenbank den
// Tippschluss. Läuft stündlich als GitHub Action (.github/workflows/tippspiel.yml).
//
// Umgebungsvariablen (als GitHub-Secrets hinterlegen, NIE in den Code):
//   SUPABASE_URL          z. B. https://abcd1234.supabase.co
//   SUPABASE_SERVICE_KEY  geheimer Schlüssel (sb_secret_… oder service_role)
// Fehlen sie, beendet sich das Skript ohne Fehler.

import { API } from '../assets/js/config.js';
import { eventsFromSchedule, driversFromStandings, resultsFromSources } from '../assets/js/tipp/sync.js';

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const UA = 'PitwallF1Hub/1.0 (private fan site; GitHub Actions)';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!BASE || !KEY) {
  log('Supabase ist nicht eingerichtet (SUPABASE_URL / SUPABASE_SERVICE_KEY fehlen) – nichts zu tun.');
  process.exit(0);
}

async function jolpica(path) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(`${API.jolpica}/${path}`, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    if (!res.ok) throw new Error(`Jolpica ${res.status} ${path}`);
    await sleep(300);
    return (await res.json()).MRData;
  }
  throw new Error('Jolpica nicht erreichbar: ' + path);
}

// Supabase REST (PostgREST). Neue Schlüssel (sb_secret_…) gehen nur in den
// "apikey"-Header, alte JWT-Schlüssel zusätzlich als Bearer-Token.
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: KEY, 'Content-Type': 'application/json' };
  if (KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${BASE}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`Supabase ${res.status} ${method} ${path.split('?')[0]}: ${await res.text()}`);
  return res.status === 204 || method !== 'GET' ? null : res.json();
}

// ---------------------------------------------------------------------------
const sched = await jolpica('current.json?limit=100');
const season = sched.RaceTable.season;
const races = sched.RaceTable.Races;
if (races.length < 5) throw new Error(`Kalender ${season} unvollständig (${races.length} Rennen) – Abbruch, um nichts zu löschen.`);
const events = eventsFromSchedule(races).map(e => ({ ...e, status: 'scheduled', updated_at: new Date().toISOString() }));

// Fahrer: aktuelles Team und "aktiv" aus den letzten drei Rennen.
const ds = await jolpica('current/driverStandings.json');
const standings = ds.StandingsTable.StandingsLists[0]?.DriverStandings || [];
const done = races.filter(r => Date.parse(`${r.date}T${r.time || '12:00:00Z'}`) + 3 * 3600e3 < Date.now());
const teamOf = new Map();
const active = new Set();
for (const r of done.slice(-3).reverse()) {
  const res = (await jolpica(`${season}/${r.round}/results.json`)).RaceTable.Races[0]?.Results || [];
  for (const x of res) {
    active.add(x.Driver.driverId);
    if (!teamOf.has(x.Driver.driverId)) teamOf.set(x.Driver.driverId, x.Constructor.constructorId);
  }
}
let drivers = driversFromStandings(season, standings, active.size ? active : null)
  .map(d => ({ ...d, team_id: teamOf.get(d.driver_id) || d.team_id }));

// Saisonstart: noch keine Wertung → Fahrer der Vorsaison übernehmen, bis das
// erste Rennen gefahren ist (dann kommen die echten Daten von Jolpica).
if (!drivers.length) {
  const prev = await rest(`season_drivers?season=eq.${+season - 1}&active=is.true&select=*`);
  drivers = (prev || []).map(d => ({ ...d, season: +season }));
  log(`Noch keine Wertung ${season}: ${drivers.length} Fahrer der Vorsaison übernommen.`);
}

await rest('events?on_conflict=id', { method: 'POST', body: events, prefer: 'resolution=merge-duplicates,return=minimal' });
log(`Kalender ${season}: ${events.length} Rennwochenenden übertragen.`);
if (drivers.length) {
  await rest('season_drivers?on_conflict=season,driver_id', { method: 'POST', body: drivers, prefer: 'resolution=merge-duplicates,return=minimal' });
  log(`Fahrerfeld ${season}: ${drivers.length} Fahrer (${drivers.filter(d => d.active).length} aktiv).`);
}

// Aus dem Kalender gestrichene Rennen als abgesagt markieren.
const ids = events.map(e => `"${e.id}"`).join(',');
await rest(`events?season=eq.${season}&status=eq.scheduled&id=not.in.(${ids})`, { method: 'PATCH', body: { status: 'cancelled' }, prefer: 'return=minimal' });

// ---------------------------------------------------------------------------
// Resultate: Qualifying, Sprint, Rennen (Jolpica) und Safety-Car-Phasen (OpenF1)
// für Wochenenden der letzten 14 Tage. Ändert sich etwas (auch nachträglich
// durch Strafen), wertet die Datenbank automatisch neu aus.
async function safetyCars(raceStart) {
  try {
    const year = raceStart.slice(0, 4);
    const res = await fetch(`${API.openf1}/sessions?year=${year}&session_name=Race`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const ses = (await res.json()).find(s => Math.abs(Date.parse(s.date_start) - Date.parse(raceStart)) < 3 * 3600e3);
    if (!ses) return null;
    const rc = await fetch(`${API.openf1}/race_control?session_key=${ses.session_key}&category=SafetyCar`, { headers: { 'User-Agent': UA } });
    if (!rc.ok) return null;
    const list = await rc.json();
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v);

// Laufendes Wochenende (Rennen in den nächsten 3 Tagen, Sprint kommt vor der Quali)
// und die letzten 14 Tage (nachträgliche Strafen).
const iso = ms => new Date(ms).toISOString();
const recent = await rest(`events?season=eq.${season}&status=eq.scheduled&and=(race_start.gt.${iso(Date.now() - 14 * 86400e3)},race_start.lt.${iso(Date.now() + 3 * 86400e3)})&select=id,round,race_start,results&order=round`);
for (const ev of recent || []) {
  const get = async kind => (await jolpica(`${season}/${ev.round}/${kind}.json`)).RaceTable.Races[0] || null;
  const raceDone = Date.now() > Date.parse(ev.race_start) + 2 * 3600e3;
  const fresh = resultsFromSources({
    quali: await get('qualifying'),
    sprint: await get('sprint'),
    race: raceDone ? await get('results') : null,
    raceControl: raceDone ? await safetyCars(ev.race_start) : null,
  });
  if (!fresh) { log(`${ev.id}: noch kein Resultat.`); continue; }
  // Bestehende Teile behalten, falls eine Quelle gerade nicht antwortet.
  const merged = { ...(ev.results || {}), ...fresh };
  if (canon(merged) === canon(ev.results)) { log(`${ev.id}: Resultat unverändert.`); continue; }
  await rest(`events?id=eq.${ev.id}`, { method: 'PATCH', body: { results: merged }, prefer: 'return=minimal' });
  log(`${ev.id}: Resultat aktualisiert (${Object.keys(merged).join(', ')}) – Punkte werden neu berechnet.`);
}
log('Fertig.');
