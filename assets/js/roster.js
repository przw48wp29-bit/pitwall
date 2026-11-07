// Wer faehrt gerade wirklich? Jolpicas WM-Wertung sagt nur, wer diese Saison
// Punkte holen konnte – nicht, wer heute im Cockpit sitzt. Das steht in den
// Rennergebnissen. Dieses Modul leitet daraus das aktuelle Feld ab:
//
//   stamm   Stammfahrer des Teams
//   ersatz  springt gerade ein (Reserve-, Ersatz- oder Testfahrer)
//   raus    faehrt zurzeit nicht (ersetzt, abgesetzt oder weg)
//
// Die Regel schaut auf die letzten paar Rennen statt nur auf das letzte. Sonst
// gilt jeder, der ein Rennen aussetzt, sofort als ohne Cockpit – und jeder, der
// einmal einspringt, als Stammfahrer. Sie korrigiert sich von selbst: kommt der
// Stammfahrer zurueck, ist er nach einem Rennen wieder «stamm»; uebernimmt der
// Ersatzmann dauerhaft, ist er es nach zwei Rennen.
//
// Reine Funktionen, keine Netz- oder Browser-Zugriffe – damit sie sowohl im
// Browser (data.js) als auch in den GitHub-Actions (update.mjs, tippspiel.mjs)
// dieselbe Antwort geben.

export const WINDOW = 3;

const driverIdOf = r => r?.Driver?.driverId;
const teamIdOf = r => r?.Constructor?.constructorId;

// Rennen neueste zuerst. `round` kommt bei Jolpica als Zeichenkette.
const byRoundDesc = races => [...races].sort((a, b) => +b.round - +a.round);

const resultsOf = race => race?.Results || race?.results || [];

// Pro Team: wer hat im Zeitfenster wie oft fuer das Team gestartet, und wann
// zuletzt? Die beiden mit den meisten Starts gelten als Stammfahrer; bei
// Gleichstand entscheidet der juengste Einsatz.
function seatsPerTeam(window) {
  const teams = new Map();
  window.forEach((race, i) => {
    for (const res of resultsOf(race)) {
      const [d, t] = [driverIdOf(res), teamIdOf(res)];
      if (!d || !t) continue;
      if (!teams.has(t)) teams.set(t, new Map());
      const seat = teams.get(t);
      const cur = seat.get(d) || { driverId: d, starts: 0, recency: Infinity };
      // i ist der Abstand zum letzten Rennen (0 = letztes Rennen).
      seat.set(d, { driverId: d, starts: cur.starts + 1, recency: Math.min(cur.recency, i) });
    }
  });
  const out = new Map();
  for (const [t, seat] of teams) {
    out.set(t, [...seat.values()].sort((a, b) => b.starts - a.starts || a.recency - b.recency));
  }
  return out;
}

// Gibt eine Map driverId -> { role, team, standsInFor, replacedBy } zurueck.
// `races` sind die Rennergebnisse der Saison in beliebiger Reihenfolge.
export function roles(races = [], { window = WINDOW, seats = 2 } = {}) {
  const sorted = byRoundDesc(races).filter(r => resultsOf(r).length);
  const out = new Map();
  if (!sorted.length) return out;

  const recent = sorted.slice(0, window);
  const lastRace = recent[0];
  const perTeam = seatsPerTeam(recent);

  // Team eines Fahrers: das Team seines juengsten Einsatzes ueberhaupt – auch
  // wenn das laenger her ist als das Zeitfenster (z. B. Tsunoda).
  const teamOf = new Map();
  const lastRoundOf = new Map();
  for (const race of sorted) {
    for (const res of resultsOf(race)) {
      const d = driverIdOf(res);
      if (d && !teamOf.has(d)) { teamOf.set(d, teamIdOf(res)); lastRoundOf.set(d, +race.round); }
    }
  }

  const inLast = new Map();
  for (const res of resultsOf(lastRace)) inLast.set(driverIdOf(res), teamIdOf(res));

  for (const [driverId, team] of teamOf) {
    const regulars = (perTeam.get(team) || []).slice(0, seats).map(s => s.driverId);
    const drivingNow = inLast.get(driverId) === team;
    const role = drivingNow ? (regulars.includes(driverId) ? 'stamm' : 'ersatz') : 'raus';
    out.set(driverId, { driverId, team, role, lastRound: lastRoundOf.get(driverId) });
  }

  // Ersatzmann und verdraengter Stammfahrer einander zuordnen – aber nur, wenn
  // es pro Team eindeutig ist. Sonst lieber nichts behaupten.
  for (const [team, seat] of perTeam) {
    const mine = [...out.values()].filter(r => r.team === team);
    const subs = mine.filter(r => r.role === 'ersatz');
    // Ein Ersatzmann vertritt einen Stammfahrer – nicht einen anderen
    // Ersatzmann. Darum nur die beiden Meistgemeldeten des Teams vergleichen.
    const regulars = seat.slice(0, seats).map(x => x.driverId);
    const gone = mine.filter(r => r.role === 'raus' && regulars.includes(r.driverId));
    if (subs.length === 1 && gone.length === 1) {
      subs[0].standsInFor = gone[0].driverId;
      gone[0].replacedBy = subs[0].driverId;
    }
  }
  return out;
}

// Haengt die Rollen an die WM-Wertung von Jolpica. Das aktuelle Team wandert –
// wie bisher – ans Ende von `Constructors`, damit `Constructors.at(-1)` stimmt.
//
// `known` liefert Stammdaten zu Fahrern, die noch gar nicht in der Wertung
// stehen (Map driverId -> Driver). Ein Debuetant wie Rafael Câmara taucht bei
// Jolpica erst nach seinem ersten Rennen auf – gemeldet ist er aber schon.
// Ohne diesen Schritt fehlte er auf der Seite bis Montag.
export function applyRoles(standings = [], races = [], { known, ...opts } = {}) {
  const map = roles(races, opts);
  const out = standings.map(s => {
    const r = map.get(s.Driver?.driverId);
    if (!r) return { ...s, active: false, role: 'raus' };
    const cons = [...(s.Constructors || [])].sort((a, b) => (a.constructorId === r.team) - (b.constructorId === r.team));
    if (r.team && !cons.some(c => c.constructorId === r.team)) cons.push({ constructorId: r.team });
    return { ...s, Constructors: cons, active: r.role !== 'raus', role: r.role,
      lastRound: r.lastRound, standsInFor: r.standsInFor, replacedBy: r.replacedBy };
  });

  const haveIds = new Set(standings.map(s => s.Driver?.driverId));
  for (const r of map.values()) {
    if (haveIds.has(r.driverId) || r.role === 'raus') continue;
    const d = known?.get?.(r.driverId) || known?.[r.driverId];
    out.push({
      position: null, points: '0', wins: '0',
      Driver: { driverId: r.driverId, givenName: '', familyName: r.driverId, ...(d || {}) },
      Constructors: [{ constructorId: r.team }],
      active: true, role: r.role, lastRound: r.lastRound,
      standsInFor: r.standsInFor, replacedBy: r.replacedBy, newcomer: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saisonwechsel
// ---------------------------------------------------------------------------
// Ab dem 1. Januar zeigt Jolpica auf die neue Saison – und liefert null Fahrer
// und null Rennen, bis das erste Wochenende gefahren ist. Ohne Rueckfall waere
// die Seite wochenlang leer. Wir nehmen dann die Startliste, die taeglich aus
// Wikipedia nach editorial.json synchronisiert wird (siehe wiki-grid.js).

// Das Vertragsfeld heisst `team2027`. Falls es spaeter saisonrichtig benannt
// wird, greift hier zuerst der neue Name.
export const contractTeam = (c, season) => c?.[`team${season}`] ?? c?.team2027 ?? null;

// «Rafael Câmara» -> { givenName: 'Rafael', familyName: 'Câmara' }.
// Namenszusaetze bleiben beim Nachnamen, sonst heisst Sainz spaeter «Jr.».
export function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { givenName: '', familyName: parts[0] || '' };
  let cut = parts.length - 1;
  while (cut > 1 && /^(jr|sr|i{1,3})\.?$/i.test(parts[cut])) cut--;
  return { givenName: parts.slice(0, cut).join(' '), familyName: parts.slice(cut).join(' ') };
}

// Vorlaeufiges Feld in der Form der Jolpica-Wertung, damit der Rest der Seite
// unveraendert damit arbeiten kann. Details (Nummer, Bild-URL, Kuerzel) kommen
// aus der Vorsaison, soweit der Fahrer schon dabei war.
export function provisionalGrid(contracts = [], season, prevStandings = []) {
  const prev = new Map(prevStandings.map(s => [s.Driver.driverId, s.Driver]));
  const rows = contracts
    .filter(c => contractTeam(c, season) && c.status !== 'offen')
    .map(c => {
      const known = prev.get(c.driverId);
      const name = known
        ? { givenName: known.givenName, familyName: known.familyName }
        : splitName(c.name);
      return {
        position: null, points: '0', wins: '0',
        Driver: { driverId: c.driverId, code: known?.code || null,
          permanentNumber: known?.permanentNumber || c.number || null, url: known?.url || null, ...name },
        Constructors: [{ constructorId: contractTeam(c, season) }],
        active: true, role: 'stamm', provisional: true,
      };
    });
  // Innerhalb eines Teams alphabetisch, Teams in der Reihenfolge der Vorsaison.
  const order = [...new Set(prevStandings.map(s => s.Constructors?.at(-1)?.constructorId))];
  const rank = t => { const i = order.indexOf(t); return i < 0 ? 99 : i; };
  return rows.sort((a, b) =>
    rank(a.Constructors[0].constructorId) - rank(b.Constructors[0].constructorId)
    || a.Driver.familyName.localeCompare(b.Driver.familyName));
}

// Soll der frisch geholte Stand verworfen werden? Ab dem 1. Januar zeigt
// Jolpica auf die neue Saison und liefert wochenlang leere Listen. Wer die
// dann speichert, ueberschreibt den letzten guten Stand – und damit auch den
// Rueckfall, von dem die Website lebt. Lieber nichts anfassen.
export function keepPrevious(next, prev) {
  const leer = !next?.schedule?.length || !next?.drivers?.length;
  return leer && !!prev?.drivers?.length;
}

// Die Meldeliste, wie sie in season.json liegt (kompakt, damit die Datei nicht
// aufgeht), zurueck in die Form der Rennergebnisse – dieselbe, die roles() liest.
export function racesFromEntries(entries = []) {
  const byRound = new Map();
  for (const e of entries) {
    for (const r of e.rounds || []) {
      if (!byRound.has(r)) byRound.set(r, { round: String(r), Results: [] });
      byRound.get(r).Results.push({ Driver: { driverId: e.id }, Constructor: { constructorId: e.team } });
    }
  }
  return [...byRound.values()].sort((a, b) => +a.round - +b.round);
}

// Kuerzel wie im Fernsehen: die ersten drei Buchstaben des Nachnamens, ohne
// Akzente (Câmara -> CAM). Jolpica vergibt es erst nach dem ersten Rennen.
export const codeOf = name => String(name || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || null;

// Stammdaten der gemeldeten Fahrer (fuer Neulinge, die Jolpica noch nicht hat).
export const knownFromEntries = (entries = []) => new Map(entries.map(e => [e.id, {
  driverId: e.id, givenName: e.givenName || '', familyName: e.familyName || e.id,
  permanentNumber: e.number || null, code: e.code || codeOf(e.familyName || e.id),
  nationality: e.nationality || null, country: e.country || null, url: e.url || null,
}]));
