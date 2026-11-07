// Fahrerfeld der nächsten Saison aus dem englischen Wikipedia-Artikel
// «<Jahr> Formula One World Championship», Abschnitt «Entries».
//
// Warum: die Vertragsdaten in editorial.json füllt nur die KI-Recherche, und die
// kostet Geld und ist darum aus. Wikipedia ist gratis, wird bei jeder Bestätigung
// innert Stunden nachgeführt und belegt jede Zeile mit einer Quelle. Damit zieht
// die Cockpit-Tabelle täglich von selbst nach.
//
// Reine Funktionen ohne Browser- oder Node-Abhängigkeiten. Sie werden vom
// Update-Skript (scripts/update.mjs) und von den Tests benutzt.

import { TEAMS } from './config.js';

const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// ---------------------------------------------------------------------------
// 1. Wikitext lesen
// ---------------------------------------------------------------------------
// Die Tabelle ist pro Team zwei Zeilen hoch: die erste Zeile trägt den Namen
// (als data-sort-value, schön sauber ohne Sponsoren), beide Zeilen je eine
// Startnummer und einen Fahrer. Offene Cockpits stehen als «TBC»/«TBA» drin.
//
// Gibt zurück: [{ entrant: 'Haas', number: '50', driver: 'Rafael Câmara' }]
// Ein offenes Cockpit hat driver: null.
export function parseEntryTable(wikitext) {
  const text = String(wikitext || '');
  const start = text.indexOf('== Entries ==');
  if (start < 0) return [];
  const open = text.indexOf('{|', start);
  const end = text.indexOf('\n|}', open);
  if (open < 0 || end < 0) return [];

  // Fussnoten raus – sie enthalten selbst Links und Vorlagen und stören sonst.
  const table = text.slice(open, end)
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');

  const out = [];
  let entrant = null;
  for (const row of table.split('\n|-')) {
    const name = row.match(/data-sort-value="([^"]+)"/);
    if (name) entrant = name[1].trim();
    if (!entrant) continue;
    const lines = row.split('\n').filter(l => l.trim());
    lines.forEach((line, i) => {
      // Die Nummernzelle ist die einzige zentrierte: |style="text-align:center"|50
      const num = line.match(/^\|[^|]*text-align:\s*center[^|]*\|\s*([^|]+?)\s*$/i);
      if (!num || i + 1 >= lines.length) return;
      out.push({ entrant, number: /^\d+$/.test(num[1]) ? num[1] : null, driver: driverFromCell(lines[i + 1]) });
    });
  }
  return out;
}

// Die Fahrerzelle ist mit Flaggen- und nowrap-Vorlagen garniert, der Name steht
// als Wiki-Link darin. Vorlagen enthalten hier nie selbst einen Link, darum
// genügt es, den letzten [[…]]-Link zu nehmen.
function driverFromCell(cell) {
  const links = [...String(cell).matchAll(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g)];
  const name = links.length
    ? (links.at(-1)[2] || links.at(-1)[1]).trim()
    : String(cell).replace(/\{\{[^{}]*\}\}/g, '').replace(/^\|\s*/, '').replace(/^nowrap\|/, '').trim();
  return name && !/^(tba|tbc|tbd)$/i.test(name) ? name : null;
}

// ---------------------------------------------------------------------------
// 2. Auf unsere IDs abbilden
// ---------------------------------------------------------------------------
// Wikipedia schreibt «Red Bull Racing» und «Racing Bulls», wir sagen «Red Bull»
// und «Racing Bulls». Längster Treffer zuerst, damit sich die beiden nicht in
// die Quere kommen.
export function teamIdOf(entrant) {
  const e = fold(entrant);
  return Object.keys(TEAMS)
    .map(id => [id, fold(TEAMS[id].short)])
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, short]) => e === short || e.startsWith(short + ' '))?.[0] || null;
}

// roster: [{ driverId, givenName, familyName }] aus season.json.
// Fahrer, die noch nie in der Formel 1 gefahren sind (Rookies), stehen nicht im
// Roster – für die leiten wir die ID aus dem Nachnamen ab, so wie es die
// KI-Recherche auch tut.
export function driverIdOf(name, roster = []) {
  const n = fold(name);
  const hit = roster.find(d => {
    const fam = fold(d.familyName);
    return fam && new RegExp(`(^|[^a-z])${fam}([^a-z]|$)`).test(n);
  });
  if (hit) return hit.driverId;
  const last = n.replace(/\b(jr|sr)\.?$/, '').trim().split(/\s+/).pop() || '';
  return last.replace(/[^a-z]/g, '') || null;
}

// ---------------------------------------------------------------------------
// 3. Mit den bisherigen Verträgen zusammenführen
// ---------------------------------------------------------------------------
// Grundsatz: Wikipedia ergänzt und korrigiert harte Fakten (wer sitzt wo), die
// recherchierten Notizen und Quellen bleiben unangetastet.
//
// Wir stufen nur hoch, nie herunter – mit einer Ausnahme: hat Wikipedia bei
// einem Team beide Cockpits besetzt, kann dort niemand sonst mehr sitzen. Nur
// dann setzen wir einen widersprechenden Eintrag auf «offen». Dass jemand in
// der Tabelle fehlt, heisst für sich genommen nichts – Wikipedia führt dort nur
// unterschriebene Verträge, Wechsel «erwartet» stehen bewusst nicht drin.
export function mergeContracts(prev = [], entries = [], roster = [], { season = 2027, lang = 'en' } = {}) {
  const source = { name: `Wikipedia: ${season} Formula One World Championship`, url: `https://${lang}.wikipedia.org/wiki/${season}_Formula_One_World_Championship` };
  const byId = new Map(prev.map(c => [c.driverId, { ...c }]));
  const seats = new Map();   // teamId -> Anzahl belegter Cockpits laut Wikipedia

  for (const e of entries) {
    const team = teamIdOf(e.entrant);
    if (!team) continue;
    if (!e.driver) continue;
    seats.set(team, (seats.get(team) || 0) + 1);
    const id = driverIdOf(e.driver, roster);
    if (!id) continue;
    const old = byId.get(id) || {};
    byId.set(id, {
      ...old,
      driverId: id,
      name: old.name || e.driver,
      // Die Startnummer brauchen wir fuer das vorlaeufige Feld am Saisonanfang
      // (roster.js), wenn es zu einem Neuling noch keine Jolpica-Daten gibt.
      number: e.number ?? old.number ?? null,
      currentTeam: old.currentTeam ?? roster.find(d => d.driverId === id)?.team ?? null,
      team2027: team,
      status: 'bestätigt',
      sources: withSource(old.sources, source),
    });
  }

  // Volles Team = alle anderen Ansprüche darauf sind überholt.
  for (const c of byId.values()) {
    if (c.team2027 && c.status !== 'bestätigt' && seats.get(c.team2027) >= 2) {
      c.team2027 = null;
      c.status = 'offen';
    }
  }
  return [...byId.values()];
}

const withSource = (list, source) => {
  const keep = (list || []).filter(s => s?.url && !/wikipedia\.org/i.test(s.url));
  return [...keep, source];
};

// ---------------------------------------------------------------------------
// Startliste der laufenden Saison (mit Spalte «Rounds»)
// ---------------------------------------------------------------------------
// Der Artikel zur laufenden Saison fuehrt pro Team alle Fahrer des Jahres in
// EINER Zeile, mit <br> getrennt, und dazu die Runden, fuer die sie gemeldet
// sind – auch fuer kommende. Nur so erfaehrt die Seite vor dem Rennen, wer am
// Wochenende faehrt. Aus den Ergebnissen allein kaeme ein Debuetant nie vor.
//
// Beispiel Haas 2026:
//   Nummern  31<br>50<br>51<br>87
//   Fahrer   Ocon<br>Hirakawa<br>Câmara<br>Bearman
//   Runden   1–19{{efn|…}}<br>19<br>20<br>1–20
//
// Gibt zurueck: [{ entrant, number, driver, rounds: [20] }]

const stripTemplates = s => {
  let out = String(s);
  // Vorlagen koennen verschachtelt sein ({{nowrap|{{flagg|…}}}}), darum in
  // Runden von innen nach aussen aufloesen statt mit einem gierigen Muster.
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/\{\{[^{}]*\}\}/g, '');
    if (next === out) break;
    out = next;
  }
  return out;
};

// «1–11, 15–20» -> [1,…,11,15,…,20]. Bindestrich und Gedankenstrich gelten beide.
export function parseRounds(cell, maxRound = 30) {
  const txt = stripTemplates(cell).replace(/\[\[[^\]|]*\|?([^\]]*)\]\]/g, '$1');
  const out = new Set();
  for (const part of txt.split(',')) {
    const m = part.trim().match(/^(\d+)\s*[–—-]\s*(\d+)$/);
    if (m) { for (let i = +m[1]; i <= Math.min(+m[2], maxRound); i++) out.add(i); continue; }
    const one = part.trim().match(/^(\d+)$/);
    if (one) out.add(+one[1]);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseSeasonEntries(wikitext, { maxRound = 30 } = {}) {
  const text = String(wikitext || '');
  const start = text.indexOf('== Entries ==');
  if (start < 0) return [];
  const open = text.indexOf('{|', start);
  const end = text.indexOf('\n|}', open);
  if (open < 0 || end < 0) return [];
  const table = text.slice(open, end)
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');

  const out = [];
  for (const row of table.split('\n|-')) {
    const name = row.match(/data-sort-value="([^"]+)"/);
    if (!name) continue;
    const entrant = name[1].trim();
    const lines = row.split('\n').filter(l => l.trim());
    const numIdx = lines.findIndex(l => /text-align:\s*center/i.test(l) && /\d/.test(l));
    if (numIdx < 0 || numIdx + 1 >= lines.length) continue;

    // Vorsicht: Eine Zelle kann mit einer Vorlage beginnen, die selbst Pipes
    // enthaelt ({{flagg|cnxa|France}}). Darum nur einen echten Attribut-Vorsatz
    // abschneiden (style="…"|, align="…"|) – erkennbar am «=» ohne Klammern.
    const cellBody = l => {
      const m = String(l).match(/^\|([^|{}]*=[^|{}]*)\|/);
      return m ? String(l).slice(m[0].length) : String(l).replace(/^\|\s*/, '');
    };
    const numbers = cellBody(lines[numIdx]).split(/<br\s*\/?>/i).map(x => stripTemplates(x).trim());
    const drivers = cellBody(lines[numIdx + 1]).split(/<br\s*\/?>/i).map(x => driverFromCell('|' + x));
    // Die Rundenspalte steht direkt danach; fehlt sie (Artikel zur naechsten
    // Saison), gilt der Fahrer fuer die ganze Saison.
    const roundsLine = lines[numIdx + 2] && /align=\s*"?center/i.test(lines[numIdx + 2]) ? lines[numIdx + 2] : null;
    const rounds = roundsLine
      ? cellBody(roundsLine).split(/<br\s*\/?>/i).map(x => parseRounds(x, maxRound))
      : [];

    // Land und Artikelname je Fahrer: fuer Flagge und Portraet eines Debuetanten,
    // zu dem Jolpica ausser dem Namen noch gar nichts hat.
    const cells = cellBody(lines[numIdx + 1]).split(/<br\s*\/?>/i);
    drivers.forEach((driver, i) => {
      if (!driver) return;
      const raw = cells[i] || '';
      const flagM = raw.match(/\{\{\s*flagg?\s*\|[^|}]*\|\s*([^|}]+?)\s*\}\}/i)
        || raw.match(/\{\{\s*flagicon\s*\|\s*([^|}]+?)\s*\}\}/i);
      const linkM = raw.match(/\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]\s*$/);
      out.push({
        entrant,
        number: /^\d+$/.test(numbers[i] || '') ? numbers[i] : null,
        driver,
        country: flagM ? flagM[1].trim() : null,
        wiki: linkM ? linkM[1].trim() : driver,
        rounds: rounds[i] || null,
      });
    });
  }
  return out;
}

// Macht aus der Startliste «Pseudo-Rennen» in der Form der Jolpica-Ergebnisse.
// Damit beurteilt dieselbe geprueften Regel in roster.js, wer Stammfahrer und
// wer Ersatz ist – nur eben auf Basis der Meldungen statt der Ergebnisse. Das
// ist der Unterschied, der einen Debuetanten ueberhaupt sichtbar macht: In den
// Ergebnissen steht er erst am Montag, in den Meldungen schon am Donnerstag.
export function entryRaces(entries = [], roster = []) {
  const byRound = new Map();
  for (const e of entries) {
    const team = teamIdOf(e.entrant);
    const id = driverIdOf(e.driver, roster);
    if (!team || !id || !e.rounds?.length) continue;
    for (const r of e.rounds) {
      if (!byRound.has(r)) byRound.set(r, { round: String(r), Results: [] });
      byRound.get(r).Results.push({ Driver: { driverId: id }, Constructor: { constructorId: team } });
    }
  }
  return [...byRound.values()].sort((a, b) => +a.round - +b.round);
}
