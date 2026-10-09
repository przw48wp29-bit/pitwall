// Tägliches Update für Pitwall (läuft in GitHub Actions um 06:00 Uhr Schweizer Zeit).
//
//  1. Snapshot aller Saisondaten von Jolpica   -> data/season.json
//  2. Weltmeister-Archiv + Karrierezahlen      -> data/champions.json, data/careers.json
//  3. Strategie-Daten beendeter Rennen (OpenF1) -> data/races/*.json
//  4. News aus RSS-Feeds (gratis)              -> data/news.json (läuft zusätzlich alle 2 h)
//  5. OPTIONAL, nur mit ANTHROPIC_API_KEY (kostet Geld): KI-Recherche zu
//     Upgrades, Verträgen, Strafen, Motorenkontingent, Prognosen, Regeln,
//     Streckeninfos -> data/editorial.json. Ohne Key bleibt editorial.json, wie es ist.
//  6. Fotos + Bildnachweise von Wikimedia      -> data/media.json (Kuratiertes bleibt)
//  7. Kalender-Abo + Zeitstempel               -> data/calendar.ics, data/meta.json
//
// Umgebungsvariablen:
//   ANTHROPIC_API_KEY  optional, aktiviert Schritt 5
//   FORCE=1            ignoriert die 06:00-Prüfung (manueller Start)
//   CLAUDE_MODEL       Standard: claude-opus-5-5
//   SKIP_AI=1          Schritt 5 auch mit Key überspringen

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEAMS } from '../assets/js/config.js';
import { compactStrategy } from '../assets/js/data.js';
import { buildICS } from '../assets/js/features.js';
import { updateNews } from './news.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const UA = 'PitwallF1Hub/1.0 (private fan site; GitHub Actions)';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------------------------------------------------------------------------
// 0. Nur um 06:00 Uhr Zürich laufen (Cron feuert um 04:00 und 05:00 UTC,
//    damit Sommer- und Winterzeit abgedeckt sind).
// ---------------------------------------------------------------------------
const zurichHour = +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hour: '2-digit', hour12: false }).format(new Date());
if (process.env.FORCE !== '1' && zurichHour !== 6) {
  log(`Es ist ${zurichHour} Uhr in Zürich, nicht 6 Uhr – nichts zu tun.`);
  process.exit(0);
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8')); } catch { return fallback; }
}
async function writeJSON(file, value) {
  await fs.writeFile(path.join(DATA, file), JSON.stringify(value, null, 1) + '\n');
  log('geschrieben:', file);
}

async function getJSON(url, headers = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`Aufgegeben: ${url}`);
}
const J = async p => { await sleep(350); return (await getJSON(`${JOLPICA}/${p}`)).MRData; };

// ---------------------------------------------------------------------------
// 1. Jolpica-Snapshot
// ---------------------------------------------------------------------------
async function racesAll(p) {
  const out = new Map();
  let offset = 0, total = 1;
  while (offset < total) {
    const d = await J(`${p}.json?limit=100&offset=${offset}`);
    total = +d.total;
    for (const race of d.RaceTable.Races) {
      const key = ['Results', 'SprintResults', 'QualifyingResults'].find(k => race[k]);
      if (!key) continue;
      if (!out.has(race.round)) out.set(race.round, { ...race, [key]: [] });
      out.get(race.round)[key].push(...race[key]);
    }
    offset += 100;
  }
  return [...out.values()].sort((a, b) => a.round - b.round);
}

async function snapshot() {
  log('Jolpica-Snapshot …');
  const sched = await J('current.json?limit=100');
  const ds = await J('current/driverStandings.json');
  const cs = await J('current/constructorStandings.json');
  const last = await J('current/last/results.json').catch(() => null);
  const dl = ds.StandingsTable.StandingsLists[0];
  const cl = cs.StandingsTable.StandingsLists[0];
  const lastRace = last?.RaceTable.Races[0];
  if (lastRace) {
    const cur = new Map(lastRace.Results.map(r => [r.Driver.driverId, r.Constructor.constructorId]));
    for (const s of dl?.DriverStandings || []) {
      const t = cur.get(s.Driver.driverId);
      s.active = !!t;
      if (t) s.Constructors.sort((a, b) => (a.constructorId === t) - (b.constructorId === t));
    }
  }
  const results = {
    races: await racesAll('current/results'),
    sprints: await racesAll('current/sprint'),
    quali: await racesAll('current/qualifying'),
  };
  const core = {
    season: sched.RaceTable.season,
    schedule: sched.RaceTable.Races,
    standingsRound: +(dl?.round || 0),
    drivers: dl?.DriverStandings || [],
    constructors: cl?.ConstructorStandings || [],
  };
  await writeJSON('season.json', { generatedAt: new Date().toISOString(), core, results });
  return { core, results };
}

// ---------------------------------------------------------------------------
// 2. Wikimedia-Bilder mit Bildnachweis
// ---------------------------------------------------------------------------
const stripHtml = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const commonsQuery = params => getJSON(`${COMMONS}?${new URLSearchParams({ format: 'json', ...params })}`);

// Datei von Commons mit zwei Grössen (800 / 1920) und Bildnachweis.
async function commonsFile(fileName) {
  if (!fileName) return null;
  try {
    const t = 'File:' + fileName;
    const a = await commonsQuery({ action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: 800, titles: t });
    await sleep(800);
    const b = await commonsQuery({ action: 'query', prop: 'imageinfo', iiprop: 'url', iiurlwidth: 1920, titles: t });
    await sleep(800);
    const ii = Object.values(a.query?.pages || {})[0]?.imageinfo?.[0];
    if (!ii) return null;
    const big = Object.values(b.query?.pages || {})[0]?.imageinfo?.[0];
    const m = ii.extmetadata || {};
    return { src: ii.thumburl, large: big?.thumburl || ii.thumburl, file: ii.descriptionurl, credit: stripHtml(m.Artist?.value) || 'Wikimedia Commons', license: stripHtml(m.LicenseShortName?.value), w: ii.width, h: ii.height };
  } catch (e) { log('Bild fehlt:', fileName, e.message); return null; }
}

// Hauptbild eines Wikipedia-Artikels als Commons-Dateiname (SVG statt PNG-Vorschau).
async function leadFile(title) {
  if (!title) return null;
  try {
    const s = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    const src = s.originalimage?.source;
    if (!src) return null;
    let n = decodeURIComponent(src.split('?')[0].split('/').pop()).replace(/_/g, ' ').replace(/^\d+px-/, '');
    if (n.endsWith('.svg.png')) n = n.slice(0, -4);
    if (/logo/i.test(n)) return null;   // Logos sind keine Streckenkarten
    return n;
  } catch { return null; }
}

// Action-Foto eines Fahrers in der aktuellen Saison suchen (breites Querformat).
async function findCarPhoto(driver, season) {
  try {
    const q = await commonsQuery({ action: 'query', list: 'search', srnamespace: 6, srlimit: 30, srsearch: `intitle:"${driver.familyName}" ${season} filetype:bitmap` });
    const titles = (q.query?.search || []).map(x => x.title).filter(t => t.includes(String(season)) && !/ at the |portrait|walk|press|fan/i.test(t));
    if (!titles.length) return null;
    const info = await commonsQuery({ action: 'query', prop: 'imageinfo', iiprop: 'size', titles: titles.slice(0, 20).join('|') });
    const best = Object.values(info.query?.pages || {}).map(p => ({ t: p.title, ...(p.imageinfo?.[0] || {}) }))
      .filter(x => x.width / x.height >= 1.7 && x.width >= 2500).sort((a, b) => b.width - a.width)[0];
    return best ? best.t.replace(/^File:/, '') : null;
  } catch { return null; }
}

const wikiTitle = url => url ? decodeURIComponent(url.split('/wiki/')[1] || '') : '';
const CURATED_SEASON = '2026';   // Die handverlesenen Bilder in media.json stammen aus dieser Saison

// Kuratierte Bilder bleiben erhalten. Fehlendes wird ergänzt; in einer neuen
// Saison werden die Auto-Fotos neu gesucht (neue Autos, neue Lackierungen).
async function media(core, editorial) {
  log('Wikimedia-Bilder …');
  const prev = await readJSON('media.json', {});
  const out = { drivers: { ...prev.drivers }, driverCars: {}, cars: {}, circuits: { ...prev.circuits } };
  const fresh = e => e && (e.season || CURATED_SEASON) === core.season;
  for (const s of core.drivers) {
    const id = s.Driver.driverId;
    if (!out.drivers[id]) out.drivers[id] = await commonsFile(await leadFile(wikiTitle(s.Driver.url)));
    const car = prev.driverCars?.[id];
    if (fresh(car)) out.driverCars[id] = car;
    else {
      const f = await findCarPhoto(s.Driver, core.season);
      const e = f && await commonsFile(f);
      if (e) out.driverCars[id] = { ...e, season: core.season };
    }
  }
  for (const c of core.constructors) {
    const id = c.Constructor.constructorId;
    if (fresh(prev.cars?.[id])) { out.cars[id] = prev.cars[id]; continue; }
    const first = core.drivers.find(s => s.Constructors.at(-1).constructorId === id && out.driverCars[s.Driver.driverId]);
    if (first) { out.cars[id] = out.driverCars[first.Driver.driverId]; continue; }
    const title = editorial?.teamInfo?.[id]?.carWiki || TEAMS[id]?.carWiki;
    const e = await commonsFile(await leadFile(title));
    if (e) out.cars[id] = { ...e, season: core.season };
  }
  for (const r of core.schedule) {
    const cid = r.Circuit.circuitId;
    if (!out.circuits[cid]) out.circuits[cid] = await commonsFile(await leadFile(wikiTitle(r.Circuit.url)));
  }
  await writeJSON('media.json', out);
}

// ---------------------------------------------------------------------------
// 2a. Archiv: Weltmeister aller Saisons + Karrierezahlen der aktuellen Fahrer
// ---------------------------------------------------------------------------
async function history(core) {
  log('Archiv & Karrieren …');
  const champs = await readJSON('champions.json', []);
  const have = new Set(champs.map(c => c.season));
  for (let y = 1950; y < +core.season; y++) {
    if (have.has(String(y))) continue;
    try {
      const d = (await J(`${y}/driverStandings/1.json`)).StandingsTable.StandingsLists[0]?.DriverStandings[0];
      if (!d) continue;
      const c = y >= 1958 ? (await J(`${y}/constructorStandings/1.json`)).StandingsTable.StandingsLists[0]?.ConstructorStandings[0] : null;
      champs.push({
        season: String(y),
        driver: { driverId: d.Driver.driverId, givenName: d.Driver.givenName, familyName: d.Driver.familyName, nationality: d.Driver.nationality, url: d.Driver.url },
        teams: d.Constructors.map(t => ({ constructorId: t.constructorId, name: t.name })), points: d.points, wins: d.wins,
        constructor: c ? { constructorId: c.Constructor.constructorId, name: c.Constructor.name, points: c.points } : null,
      });
      log('  Weltmeister ergänzt:', y);
    } catch (e) { log('  Archiv', y, e.message); }
  }
  champs.sort((a, b) => a.season - b.season);
  await writeJSON('champions.json', champs);

  const titles = {};
  champs.forEach(c => { titles[c.driver.driverId] = (titles[c.driver.driverId] || 0) + 1; });
  const careers = {};
  for (const s of core.drivers) {
    const id = s.Driver.driverId;
    try {
      const seasons = new Set();
      let starts = 0, wins = 0, podiums = 0, off = 0, total = 1;
      while (off < total) {
        const r = await J(`drivers/${id}/results.json?limit=100&offset=${off}`);
        total = +r.total;
        for (const race of r.RaceTable.Races) { seasons.add(race.season); starts++; const p = +race.Results[0].position; if (p === 1) wins++; if (p <= 3) podiums++; }
        off += 100;
      }
      const poles = +(await J(`drivers/${id}/qualifying/1.json?limit=1`)).total;
      careers[id] = { seasons: seasons.size, starts, wins, podiums, poles, titles: titles[id] || 0, first: [...seasons].sort()[0] };
    } catch (e) { log('  Karriere', id, e.message); }
  }
  await writeJSON('careers.json', careers);
}

// ---------------------------------------------------------------------------
// 2b. Strategie-Snapshots (OpenF1) für alle beendeten Rennen und Sprints
// ---------------------------------------------------------------------------
async function strategies(core) {
  log('Strategie-Daten …');
  await fs.mkdir(path.join(DATA, 'races'), { recursive: true });
  const raceEnd = r => new Date(`${r.date}T${r.time || '12:00:00Z'}`).getTime() + 4 * 3600e3;
  const done = core.schedule.filter(r => raceEnd(r) < Date.now());
  const of1 = p => getJSON(`https://api.openf1.org/v1/${p}`);
  let sessions;
  try {
    sessions = [...await of1(`sessions?year=${core.season}&session_name=Race`), ...await of1(`sessions?year=${core.season}&session_name=Sprint`)];
  } catch (e) { log('OpenF1 nicht verfügbar:', e.message); return; }
  for (const r of done) {
    for (const kind of r.Sprint ? ['Race', 'Sprint'] : ['Race']) {
      const file = path.join(DATA, 'races', `${core.season}-${String(r.round).padStart(2, '0')}${kind === 'Sprint' ? '-sprint' : ''}.json`);
      try { await fs.access(file); continue; } catch { /* fehlt noch */ }
      const target = new Date(`${r.date}T${r.time || '12:00:00Z'}`).getTime();
      const s = sessions.filter(x => x.session_name === kind && Math.abs(new Date(x.date_start) - target) < 3 * 86400e3)
        .sort((a, b) => Math.abs(new Date(a.date_start) - target) - Math.abs(new Date(b.date_start) - target))[0];
      if (!s) continue;
      try {
        const k = s.session_key;
        const opt = p => of1(p).catch(() => []);   // 404 = keine Daten
        const [drivers, stints, pits, laps, positions] = [await of1(`drivers?session_key=${k}`), await opt(`stints?session_key=${k}`), await opt(`pit?session_key=${k}`), await opt(`laps?session_key=${k}`), await opt(`position?session_key=${k}`)];
        if (!laps.length) continue;
        await fs.writeFile(file, JSON.stringify(compactStrategy(drivers, stints, pits, laps, positions, k)));
        log('  Strategie gespeichert:', path.basename(file));
        await sleep(500);
      } catch (e) { log('  Strategie fehlgeschlagen:', r.raceName, kind, e.message); }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. KI-Recherche
// ---------------------------------------------------------------------------
const SYSTEM = `Du bist Redakteur einer deutschsprachigen Formel-1-Infoseite für Fans in der Schweiz.
Du recherchierst mit der Websuche aktuelle, überprüfbare Fakten aus seriösen Quellen (formula1.com, fia.com, the-race.com, motorsport.com, autosport.com, racingnews365.com, planetf1.com, racefans.net, speedweek.com, offizielle Team-Seiten).
Regeln:
- Nur Fakten mit Quelle. Gerüchte klar als Gerücht kennzeichnen. Nichts erfinden; lieber weglassen.
- Schreibe auf Deutsch (Schweizer Rechtschreibung, also "ss" statt "ß"). Fachbegriffe wie Pole Position, Sprint, Power Unit, Front Wing bleiben englisch.
- Kurz und sachlich. Zusammenfassungen höchstens 2–3 Sätze, in eigenen Worten (keine langen Zitate).
- Verwende ausschliesslich die vorgegebenen IDs für Teams und Fahrer.
- Antworte am Ende mit genau einem \`\`\`json Codeblock mit gültigem JSON (ohne Kommentare), der dem verlangten Schema entspricht, und sonst nichts nach dem Block.`;

function idLists(core) {
  const teams = core.constructors.map(c => `${c.Constructor.constructorId} (${c.Constructor.name})`).join(', ');
  const drivers = core.drivers.map(s => `${s.Driver.driverId} (${s.Driver.givenName} ${s.Driver.familyName}, ${s.Constructors.at(-1).constructorId})`).join(', ');
  return `Team-IDs: ${teams}\nFahrer-IDs: ${drivers}`;
}

async function ask(client, task, { maxSearches = 12 } = {}) {
  const messages = [{ role: 'user', content: task }];
  for (let turn = 0; turn < 6; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: maxSearches },
      ],
      messages,
    });
    const msg = await stream.finalMessage();
    log(`  Claude: stop=${msg.stop_reason} in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}`);
    if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
    if (msg.stop_reason === 'refusal') throw new Error('Anfrage abgelehnt');
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = text.match(/```json\s*([\s\S]*?)```(?![\s\S]*```json)/);
    if (!m) throw new Error('Kein JSON in der Antwort');
    // Falls das Modell die Kommentare aus dem Schema übernimmt: entfernen.
    return JSON.parse(m[1].replace(/(?<=[,[{\]}])[ \t]*\/\/[^\n]*$/gm, ''));
  }
  throw new Error('Zu viele Pausen');
}

const todayCH = () => new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', dateStyle: 'full' }).format(new Date());

async function editorial(core) {
  const prev = await readJSON('editorial.json', {});
  if (!process.env.ANTHROPIC_API_KEY || process.env.SKIP_AI === '1') { log('KI-Recherche übersprungen (kein API-Key oder SKIP_AI).'); return prev; }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const ids = idLists(core);
  const now = Date.now();
  const raceEnd = r => new Date(`${r.date}T${r.time || '12:00:00Z'}`).getTime() + 3 * 3600e3;
  const next = core.schedule.find(r => raceEnd(r) > now);
  const done = core.schedule.filter(r => raceEnd(r) <= now);
  const ed = { ...prev, season: core.season };
  const standings = core.drivers.slice(0, 10).map(s => `${s.position}. ${s.Driver.familyName} ${s.points}`).join(', ');
  const context = `Heute ist ${todayCH()}. Saison ${core.season}. Stand nach Runde ${core.standingsRound}: ${standings}.
Nächstes Rennen: ${next ? `Runde ${next.round}, ${next.raceName} (${next.date})` : 'keines – Saisonpause'}.
${ids}`;

  // --- a) Gerüchte, Prognose, Fahrer-Notizen (News kommen gratis per RSS) -----
  try {
    log('KI: Gerüchte & Prognose …');
    const r = await ask(client, `${context}

Recherchiere die Lage der letzten 72 Stunden (Rennen, Technik, Transfers, Teams, Regeln) und erstelle:
{
 "rumours": [ { "title": "...", "text": "...", "likelihood": "niedrig|mittel|hoch", "sources": [ { "name": "...", "url": "..." } ] } ],
 "predictions": { "summary": "2 Sätze zum Titelkampf", "title": [ { "driverId": "...", "name": "Nachname", "team": "<team-id>", "chance": 0-100 } ], "nextRace": { "favourite": "<fahrer-id>", "text": "..." }, "storylines": [ { "title": "...", "text": "..." } ] },
 "driverNotes": { "<fahrer-id>": { "form": "stark|solide|durchwachsen|schwach", "text": "1–2 Sätze zur aktuellen Form" } }   // für alle Fahrer
}
Titel-Wahrscheinlichkeiten müssen zusammen etwa 100 ergeben und die verbleibenden Punkte realistisch berücksichtigen. Ist die Saison entschieden oder vorbei, sag das in der Zusammenfassung.`, { maxSearches: 15 });
    if (r.rumours) ed.rumours = r.rumours;
    if (r.predictions) ed.predictions = r.predictions;
    if (r.driverNotes) ed.driverNotes = { ...prev.driverNotes, ...r.driverNotes };
  } catch (e) { log('News fehlgeschlagen:', e.message); }

  // --- b) Upgrades: aktuelles/letztes Wochenende + fehlende Runden nachtragen -
  try {
    const have = new Set((prev.upgrades || []).map(u => +u.round));
    const recent = [...done.slice(-1), ...(next && new Date(next.date).getTime() - now < 4 * 86400e3 ? [next] : [])];
    const missing = done.filter(r => !have.has(+r.round)).slice(-3);   // max. 3 alte Runden pro Tag nachtragen
    const rounds = [...new Map([...recent, ...missing].map(r => [r.round, r])).values()];
    if (rounds.length) {
      log('KI: Upgrades für Runden', rounds.map(r => r.round).join(', '));
      const r = await ask(client, `${context}

Erfasse für folgende Rennwochenenden ALLE technischen Neuerungen jedes Teams, wie sie in den FIA-Dokumenten "Car Presentation Submissions" stehen (oder seriösen Berichten darüber). Dazu Power-Unit-Wechsel, Getriebewechsel mit Strafe und andere technische Änderungen, auch kleine.
Wochenenden: ${rounds.map(r => `Runde ${r.round} = ${r.raceName} (${r.date})`).join('; ')}
Für jedes Wochenende und jedes Team ein Eintrag, auch wenn das Team nichts gebracht hat (dann "items": []).
{ "upgrades": [ { "round": 17, "race": "Singapore Grand Prix", "team": "<team-id>", "items": [ { "area": "Front Wing|Rear Wing|Floor|Diffuser|Sidepod|Bodywork|Cooling|Brakes|Suspension|Power Unit|Chassis|Other", "component": "Bauteil auf Deutsch", "purpose": "Zweck auf Deutsch", "category": "Performance|Strecken-spezifisch|Zuverlässigkeit" } ], "notes": "optional: Motorwechsel, Strafen, aufgeteilte Spezifikation …", "sources": [ { "name": "...", "url": "..." } ] } ] }
Wenn für ein noch nicht begonnenes Wochenende noch keine Liste veröffentlicht ist, lass es weg.`, { maxSearches: 20 });
      const got = (r.upgrades || []).filter(u => u.team && u.round);
      const gotRounds = new Set(got.map(u => +u.round));
      ed.upgrades = [...(prev.upgrades || []).filter(u => !gotRounds.has(+u.round)), ...got].sort((a, b) => b.round - a.round);
    }
  } catch (e) { log('Upgrades fehlgeschlagen:', e.message); }

  // --- c) Verträge & Fahrermarkt (täglich) -----------------------------------
  try {
    log('KI: Verträge …');
    const nextSeason = +core.season + 1;
    const r = await ask(client, `${context}

Ermittle für JEDEN aktuellen Fahrer den Vertragsstand für die Saison ${nextSeason}. Falls schon neue Fahrer für ${nextSeason} bestätigt sind (z. B. Rookies), nimm sie mit eigener driverId (Kleinbuchstaben, Nachname) und "name" auf.
{ "contracts": [ { "driverId": "...", "name": "Vorname Nachname", "currentTeam": "<team-id oder null>", "team2027": "<team-id oder null>", "status": "bestätigt|erwartet|offen|Gerücht|weg", "until": "Vertragsende, falls bekannt", "note": "1–2 Sätze", "sources": [ { "name": "...", "url": "..." } ] } ] }
"bestätigt" nur bei offizieller Bekanntgabe. "weg" = verlässt die F1 oder verliert das Cockpit sicher. Das Feld heisst immer "team2027", auch wenn es um eine andere Saison geht.`, { maxSearches: 15 });
    if (r.contracts?.length >= Math.min(10, core.drivers.length)) ed.contracts = r.contracts;
  } catch (e) { log('Verträge fehlgeschlagen:', e.message); }

  // --- e) Strafen & Motorenkontingent (täglich) -------------------------------
  try {
    log('KI: Strafen & Power Units …');
    const r = await ask(client, `${context}

Ermittle den aktuellen Stand zu Strafen und Power-Unit-Teilen (Quelle bevorzugt: FIA-Dokumente "Power Unit Elements used" und "Penalty points", sonst seriöse Medien):
{
 "superlicence": [ { "driverId": "...", "points": 0, "note": "kurz: wofür / wann verfallen Punkte" } ],   // alle Fahrer mit mindestens 1 Strafpunkt
 "grid": [ { "round": 17, "race": "Singapore Grand Prix", "driverId": "...", "penalty": "10 Plätze | Start von hinten | Boxengasse", "reason": "...", "sources": [ { "name": "...", "url": "..." } ] } ],   // alle Startplatzstrafen dieser Saison
 "pu": { "asOf": "nach Runde X / Rennen", "allocation": { "ICE": 0, "TC": 0, "MGU-K": 0, "ES": 0, "CE": 0, "EX": 0 }, "usage": { "<fahrer-id>": { "ICE": 0, "TC": 0, "MGU-K": 0, "ES": 0, "CE": 0, "EX": 0 } } }
}
Nur Werte eintragen, die du belegen kannst; unbekannte Fahrer bei "usage" weglassen.`, { maxSearches: 15 });
    ed.penalties = {
      superlicence: r.superlicence?.length ? r.superlicence : prev.penalties?.superlicence || [],
      grid: r.grid?.length ? r.grid : prev.penalties?.grid || [],
      pu: r.pu?.usage && Object.keys(r.pu.usage).length ? r.pu : prev.penalties?.pu || {},
    };
  } catch (e) { log('Strafen fehlgeschlagen:', e.message); }

  // --- d) Regeln, Teaminfos, Strecken (montags oder wenn etwas fehlt) ---------
  const monday = new Date().getUTCDay() === 1;
  const missingCircuits = core.schedule.map(r => r.Circuit).filter(c => !prev.circuits?.[c.circuitId]);
  if (monday || missingCircuits.length || !prev.rules?.length || !prev.teamInfo || !Object.keys(prev.teamInfo).length) {
    try {
      log('KI: Regeln, Teams, Strecke …');
      const r = await ask(client, `${context}

Erstelle Hintergrund-Infos:
{
 "rules": [ { "year": ${core.season}, "title": "...", "tag": "Neu|Gilt weiter|Beschlossen|In Diskussion", "text": "2–3 Sätze, verständlich erklärt", "sources": [ { "name": "...", "url": "..." } ] } ],   // aktuelle Saison + beschlossene Änderungen der nächsten Jahre, 10–16 Einträge
 "teamInfo": { "<team-id>": { "car": "Chassis-Name", "carWiki": "exakter englischer Wikipedia-Artikeltitel des Autos, z. B. Mercedes_W17", "powerUnit": "...", "principal": "Teamchef", "base": "Ort, Länderkürzel", "note": "1–2 Sätze zur Saison" } },
 "circuits": { "<circuit-id>": { "Länge": "x,xxx km", "Runden": "..", "Kurven": "..", "Typ": "Stadtkurs | Permanente Strecke | …", "Rundenrekord": "1:xx.xxx (Fahrer, Jahr)", "Reifen": "Pirelli-Mischungen dieses Jahr, z. B. C3/C4/C5", "notes": "1–2 Sätze, was die Strecke besonders macht" } },   // für diese Strecken: ${[...new Set([...missingCircuits.map(c => c.circuitId), next?.Circuit.circuitId].filter(Boolean))].join(', ')}
 "records": [ { "title": "...", "value": "...", "text": "Rekord oder Meilenstein der laufenden Saison" } ]
}`, { maxSearches: 15 });
      if (r.rules?.length) ed.rules = r.rules;
      if (r.teamInfo) ed.teamInfo = { ...prev.teamInfo, ...r.teamInfo };
      if (r.circuits) ed.circuits = { ...prev.circuits, ...r.circuits };
      if (r.records) ed.records = r.records;
    } catch (e) { log('Hintergrund fehlgeschlagen:', e.message); }
  }

  ed.generatedAt = new Date().toISOString();
  ed.source = 'ai';
  await writeJSON('editorial.json', ed);
  return ed;
}

// ---------------------------------------------------------------------------
await fs.mkdir(DATA, { recursive: true });
const { core } = await snapshot();
await history(core);
await strategies(core);
try { await updateNews(); } catch (e) { log('News fehlgeschlagen:', e.message); }
const ed = await editorial(core);
await media(core, ed);
await fs.writeFile(path.join(DATA, 'calendar.ics'), buildICS(core));
log('geschrieben: calendar.ics');
await writeJSON('meta.json', { updatedAt: new Date().toISOString(), editorial: ed?.source || 'seed', season: core.season, model: ed?.source === 'ai' && process.env.ANTHROPIC_API_KEY ? MODEL : null });
log('Fertig.');
