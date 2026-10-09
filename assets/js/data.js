// Datenschicht: holt Live-Daten (Jolpica, OpenF1, Open-Meteo, Wikipedia),
// cached sie im Browser und fällt auf den täglichen Snapshot in /data zurück.

import { API, TEAMS } from './config.js';

const mem = new Map();

function cacheGet(store, key, ttlMs) {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > ttlMs) return null;
    return v;
  } catch { return null; }
}
function cacheSet(store, key, v) {
  try { store.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* voll oder gesperrt */ }
}

// Jolpica erlaubt ~4 Anfragen/Sekunde -> Anfragen hintereinander mit Abstand.
let queue = Promise.resolve();
function throttled(fn, gap = 280) {
  const run = queue.then(fn);
  queue = run.catch(() => {}).then(() => new Promise(r => setTimeout(r, gap)));
  return run;
}

export async function fetchJSON(url, { ttl = 10 * 60e3, store = 'session', throttle = false } = {}) {
  if (mem.has(url)) return mem.get(url);
  const st = store === 'local' ? localStorage : store === 'session' ? sessionStorage : null;
  if (st && ttl) {
    const hit = cacheGet(st, 'c:' + url, ttl);
    if (hit) { mem.set(url, Promise.resolve(hit)); return hit; }
  }
  const doFetch = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url);
      if (res.status === 429) { await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); continue; }
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; try { e.body = await res.json(); } catch {} throw e; }
      return res.json();
    }
    throw new Error('Rate limit');
  };
  const p = (throttle ? throttled(doFetch) : doFetch()).then(v => { if (st && ttl) cacheSet(st, 'c:' + url, v); return v; });
  mem.set(url, p);
  p.catch(() => mem.delete(url));
  return p;
}

const J = (path, opts) => fetchJSON(`${API.jolpica}/${path}`, { throttle: true, ...opts }).then(d => d.MRData);

// Alle Seiten einer Jolpica-Ressource holen und Rennen nach Runde zusammenführen.
async function jolpicaRaces(path) {
  const limit = 100;
  const first = await J(`${path}.json?limit=${limit}&offset=0`);
  const total = +first.total;
  const pages = [first];
  for (let off = limit; off < total; off += limit) pages.push(await J(`${path}.json?limit=${limit}&offset=${off}`));
  const byRound = new Map();
  for (const p of pages) for (const race of p.RaceTable.Races) {
    const key = race.round;
    const listKey = ['Results', 'SprintResults', 'QualifyingResults'].find(k => race[k]);
    if (!byRound.has(key)) byRound.set(key, { ...race, [listKey]: [] });
    byRound.get(key)[listKey].push(...race[listKey]);
  }
  return [...byRound.values()].sort((a, b) => a.round - b.round);
}

// ---------- Saison-Kern (Startseite) ----------
let corePromise;
export function loadCore(season = 'current') {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    try {
      const [sched, ds, cs, last] = await Promise.all([
        J(`${season}.json?limit=100`),
        J(`${season}/driverStandings.json`),
        J(`${season}/constructorStandings.json`),
        J(`${season}/last/results.json`).catch(() => null),
      ]);
      const dl = ds.StandingsTable.StandingsLists[0];
      const cl = cs.StandingsTable.StandingsLists[0];
      // Jolpica sortiert die Teams eines Fahrers nicht chronologisch. Das
      // aktuelle Team kommt aus dem letzten Rennen und wird ans Ende gestellt.
      const lastRace = last?.RaceTable.Races[0];
      if (lastRace) {
        const cur = new Map(lastRace.Results.map(r => [r.Driver.driverId, r.Constructor.constructorId]));
        for (const s of dl?.DriverStandings || []) {
          const t = cur.get(s.Driver.driverId);
          s.active = !!t;
          if (t) s.Constructors.sort((a, b) => (a.constructorId === t) - (b.constructorId === t));
        }
      }
      return {
        live: true,
        season: sched.RaceTable.season,
        schedule: sched.RaceTable.Races,
        standingsRound: +(dl?.round || 0),
        drivers: dl?.DriverStandings || [],
        constructors: cl?.ConstructorStandings || [],
      };
    } catch (err) {
      console.warn('Live-Daten nicht erreichbar, nutze Snapshot', err);
      const snap = await fetchJSON('data/season.json', { ttl: 0, store: null });
      return { ...snap.core, live: false, snapshotAt: snap.generatedAt };
    }
  })();
  return corePromise;
}

// ---------- Letztes Rennen (eine einzige, schnelle Anfrage) ----------
export function loadLastRace() {
  return J('current/last/results.json').then(d => d.RaceTable.Races[0] || null);
}

// ---------- Alle Ergebnisse der Saison (lazy) ----------
// Zuerst der tägliche Snapshot (schnell, statisch). Nur wenn seither ein Rennen
// zu Ende gegangen ist, werden die Ergebnisse live bei Jolpica nachgeladen.
let resultsPromise;
export function loadResults(season = 'current') {
  if (resultsPromise) return resultsPromise;
  resultsPromise = (async () => {
    try {
      const [snap, core] = await Promise.all([fetchJSON('data/season.json', { ttl: 5 * 60e3 }).catch(() => null), loadCore()]);
      if (snap?.results && core.season === snap.core?.season) {
        const finished = core.schedule.filter(r => new Date(`${r.date}T${r.time || '12:00:00Z'}`).getTime() + 3 * 3600e3 < Date.now()).length;
        if (snap.results.races.length >= finished && +snap.core.standingsRound >= core.standingsRound) return snap.results;
      }
    } catch { /* weiter mit Live-Daten */ }
    try {
      const [races, sprints, quali] = await Promise.all([
        jolpicaRaces(`${season}/results`),
        jolpicaRaces(`${season}/sprint`),
        jolpicaRaces(`${season}/qualifying`),
      ]);
      return { races, sprints, quali };
    } catch (err) {
      console.warn('Ergebnisse live nicht erreichbar, nutze Snapshot', err);
      const snap = await fetchJSON('data/season.json', { ttl: 0, store: null });
      return snap.results;
    }
  })();
  return resultsPromise;
}

// ---------- Karriere-Statistiken eines Fahrers ----------
export async function driverCareer(id) {
  const pre = await fetchJSON('data/careers.json', { ttl: 3600e3 }).catch(() => null);
  if (pre?.[id]) return pre[id];
  const key = 'career:' + id;
  const hit = cacheGet(localStorage, key, 12 * 3600e3);
  if (hit) return hit;
  const total = p => J(`drivers/${id}/${p}.json?limit=1`, { store: null }).then(d => +d.total).catch(() => null);
  const [starts, wins, p2, p3, poles, titles, seasons] = [
    await total('results'), await total('results/1'), await total('results/2'), await total('results/3'),
    await total('qualifying/1'), await total('driverStandings/1'), await total('seasons'),
  ];
  const v = { starts, wins, podiums: wins == null ? null : wins + (p2 || 0) + (p3 || 0), poles, titles, seasons };
  cacheSet(localStorage, key, v);
  return v;
}

// ---------- Redaktionelle Daten (tägliches KI-Update) ----------
export function loadEditorial() {
  return fetchJSON('data/editorial.json', { ttl: 5 * 60e3 }).catch(() => null);
}
// ---------- News (RSS, alle 2 Stunden) ----------
// Fällt auf die News in editorial.json zurück, solange es noch kein news.json gibt.
export async function loadNews() {
  const n = await fetchJSON('data/news.json', { ttl: 5 * 60e3 }).catch(() => null);
  if (n?.items?.length) return { items: n.items, updatedAt: n.updatedAt, feeds: n.feeds, rss: true };
  const ed = await loadEditorial();
  return { items: (ed?.news || []).map(x => ({ ...x, teams: x.team ? [x.team] : [] })), updatedAt: ed?.generatedAt, rss: false };
}
export function loadMeta() {
  return fetchJSON('data/meta.json', { ttl: 5 * 60e3 }).catch(() => null);
}

// ---------- Bilder (Wikimedia) ----------
let mediaPromise;
function loadMedia() {
  if (!mediaPromise) mediaPromise = fetchJSON('data/media.json', { ttl: 30 * 60e3 }).catch(() => ({}));
  return mediaPromise;
}

const wikiTitle = url => url ? decodeURIComponent(url.split('/wiki/')[1] || '') : '';

// Liefert { src, page, credit, license } oder null.
export async function imageFor(kind, id, wikiUrlOrTitle) {
  const media = await loadMedia();
  const pre = media?.[kind]?.[id];
  if (pre) return pre;
  if (kind === 'driverCars') return null;   // Fallback (Teamauto) regelt hydrateImages
  const title = wikiUrlOrTitle?.includes('/wiki/') ? wikiTitle(wikiUrlOrTitle) : (wikiUrlOrTitle || (kind === 'cars' ? TEAMS[id]?.carWiki : ''));
  if (!title) return null;
  const key = 'img:' + title;
  const hit = cacheGet(localStorage, key, 7 * 86400e3);
  if (hit !== null && hit !== undefined) return hit || null;
  try {
    const s = await wikiQueue(() => fetchJSON(API.wiki + encodeURIComponent(title), { ttl: 0, store: null }));
    const src = s.thumbnail?.source || s.originalimage?.source;
    const v = src ? { src, large: s.originalimage?.source || src, page: s.content_urls?.desktop?.page, credit: 'Wikimedia Commons', license: 'siehe Bildseite', file: fileFromThumb(src) } : false;
    cacheSet(localStorage, key, v);
    return v || null;
  } catch { return null; }
}

// Wikipedia mag keine 20 gleichzeitigen Anfragen -> max. 4 parallel.
let wikiActive = 0;
const wikiWaiting = [];
function wikiQueue(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      wikiActive++;
      fn().then(resolve, reject).finally(() => { wikiActive--; wikiWaiting.shift()?.(); });
    };
    wikiActive < 4 ? run() : wikiWaiting.push(run);
  });
}

function fileFromThumb(src) {
  const m = src.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/);
  return m ? `https://commons.wikimedia.org/wiki/File:${m[1]}` : null;
}

// Wikimedia-Thumbnail in passender Breite.
export function sized(src, width) {
  if (!src) return src;
  return src.replace(/\/(\d+)px-/, `/${width}px-`);
}

// ---------- OpenF1 ----------
export async function openf1(path, ttl = 20e3) {
  try {
    return await fetchJSON(`${API.openf1}/${path}`, { ttl, store: ttl ? 'session' : null });
  } catch (e) {
    if (e.status === 401) { const err = new Error('locked'); err.locked = true; err.detail = e.body?.detail; throw err; }
    throw e;
  }
}

// OpenF1 antwortet bei leeren Ergebnissen mit 404 – das ist kein Fehler, sondern "keine Daten".
const none = e => { if (e.locked) throw e; return []; };

// Strategie-Daten eines Rennens: zuerst der tägliche Snapshot, sonst live von OpenF1.
// Format: { drivers: [{ n, code, name, team, color }], stints: [{ n, compound, start, end, age }],
//           pits: [{ n, lap, dur }], laps: { n: [sek|null, …] }, totalLaps }
export async function raceStrategy(season, race, kind = 'Race') {
  const file = `data/races/${season}-${String(race.round).padStart(2, '0')}${kind === 'Sprint' ? '-sprint' : ''}.json`;
  const snap = await fetchJSON(file, { ttl: 30 * 60e3, store: 'session' }).catch(() => null);
  if (snap) return snap;
  const sessions = await openf1(`sessions?year=${season}&session_name=${kind}`, 10 * 60e3);
  const target = new Date(`${race.date}T${race.time || '12:00:00Z'}`).getTime();
  const sess = sessions
    .filter(s => Math.abs(new Date(s.date_start).getTime() - target) < (kind === 'Race' ? 86400e3 : 3 * 86400e3))
    .sort((a, b) => Math.abs(new Date(a.date_start) - target) - Math.abs(new Date(b.date_start) - target))[0];
  if (!sess) return null;
  const k = sess.session_key;
  const [drivers, stints, pits, laps, positions] = await Promise.all([
    openf1(`drivers?session_key=${k}`, 0), openf1(`stints?session_key=${k}`, 0).catch(none),
    openf1(`pit?session_key=${k}`, 0).catch(none), openf1(`laps?session_key=${k}`, 0).catch(none),
    openf1(`position?session_key=${k}`, 0).catch(none),
  ]);
  if (!laps.length) return null;
  return compactStrategy(drivers, stints, pits, laps, positions, k);
}

// Wird identisch auch im täglichen Update-Script verwendet (scripts/update.mjs).
export function compactStrategy(drivers, stints, pits, laps, positions, sessionKey) {
  const lapMap = {}, lapStart = {};
  let totalLaps = 0;
  for (const l of laps) {
    (lapMap[l.driver_number] ||= [])[l.lap_number - 1] = l.lap_duration ?? null;
    (lapStart[l.driver_number] ||= [])[l.lap_number - 1] = l.date_start ? Date.parse(l.date_start) : null;
    totalLaps = Math.max(totalLaps, l.lap_number);
  }
  for (const k in lapMap) lapMap[k] = Array.from({ length: lapMap[k].length }, (_, i) => lapMap[k][i] ?? null);
  // Position am Ende jeder Runde = letzte Positionsmeldung vor Beginn der nächsten Runde
  const pos = {};
  const byDriver = {};
  for (const p of positions || []) (byDriver[p.driver_number] ||= []).push([Date.parse(p.date), p.position]);
  for (const n in lapMap) {
    const ps = (byDriver[n] || []).sort((a, b) => a[0] - b[0]);
    if (!ps.length) continue;
    const starts = lapStart[n] || [];
    let j = 0, cur = null;
    pos[n] = lapMap[n].map((dur, i) => {
      const t = starts[i + 1] ?? (starts[i] != null && dur ? starts[i] + dur * 1000 : null);
      if (t == null) return null;
      while (j < ps.length && ps[j][0] <= t) cur = ps[j++][1];
      return cur;
    });
  }
  return {
    sessionKey, totalLaps, pos,
    drivers: drivers.map(d => ({ n: d.driver_number, code: d.name_acronym, name: d.full_name, team: d.team_name, color: '#' + (d.team_colour || '888888') })),
    stints: stints.map(s => ({ n: s.driver_number, compound: s.compound || 'UNKNOWN', start: s.lap_start, end: s.lap_end, age: s.tyre_age_at_start })),
    pits: pits.map(p => ({ n: p.driver_number, lap: p.lap_number, dur: p.stop_duration ?? p.pit_duration ?? null, lane: p.lane_duration ?? p.pit_duration ?? null })),
    laps: lapMap,
  };
}

// ---------- Archiv & Strecken (Jolpica, lange gecacht) ----------
const LONG = { ttl: 7 * 86400e3, store: 'local' };
// Weltmeister aller Saisons (vom täglichen Update gepflegt, Jolpica hat dafür keinen Sammel-Endpunkt).
export const champions = () => fetchJSON('data/champions.json', { ttl: 3600e3 });
export async function seasonArchive(year) {
  const [ds, cs, wins, sched] = await Promise.all([
    J(`${year}/driverStandings.json?limit=100`, LONG),
    J(`${year}/constructorStandings.json?limit=100`, LONG).catch(() => null),
    J(`${year}/results/1.json?limit=100`, LONG),
    J(`${year}.json?limit=100`, LONG),
  ]);
  return {
    drivers: ds.StandingsTable.StandingsLists[0]?.DriverStandings || [],
    constructors: cs?.StandingsTable.StandingsLists[0]?.ConstructorStandings || [],
    winners: wins.RaceTable.Races,
    schedule: sched.RaceTable.Races,
  };
}
export async function circuitHistory(circuitId) {
  const first = await J(`circuits/${circuitId}/results/1.json?limit=100`, LONG);
  let races = first.RaceTable.Races;
  if (+first.total > 100) races = races.concat((await J(`circuits/${circuitId}/results/1.json?limit=100&offset=100`, LONG)).RaceTable.Races);
  return races;
}
export const allCircuits = () => J('circuits.json?limit=100', LONG).then(d => d.CircuitTable.Circuits);

// ---------- Wetter (Open-Meteo) ----------
export function weather(lat, lon, start, end) {
  const q = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    start_date: start, end_date: end,
  });
  return fetchJSON(`${API.meteo}?${q}`, { ttl: 30 * 60e3 });
}
