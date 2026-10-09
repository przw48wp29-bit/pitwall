// Abbildung der Jolpica-Daten auf die Tippspiel-Tabellen "events" und
// "season_drivers". Reine Funktionen: genutzt vom Sync-Job (scripts/tippspiel.mjs),
// vom Demo-Modus und von den Tests – damit überall dieselben Regeln gelten.

export const eventId = (season, round) => `${season}-${String(round).padStart(2, '0')}`;

const iso = (s, fallback = null) => s?.date ? new Date(`${s.date}T${s.time || '12:00:00Z'}`).toISOString() : fallback;

export function eventsFromSchedule(schedule = []) {
  return schedule.map(r => {
    const race = iso({ date: r.date, time: r.time });
    const sq = r.SprintQualifying || r.SprintShootout;
    return {
      id: eventId(r.season, r.round),
      season: +r.season,
      round: +r.round,
      name: r.raceName,
      circuit_id: r.Circuit?.circuitId || null,
      country: r.Circuit?.Location?.country || null,
      // Fehlt die Quali-Zeit (sollte nicht vorkommen), gilt 24 h vor dem Rennen.
      quali_start: iso(r.Qualifying, new Date(Date.parse(race) - 86400e3).toISOString()),
      sprint_quali_start: r.Sprint ? iso(sq) : null,
      sprint_start: r.Sprint ? iso(r.Sprint) : null,
      race_start: race,
    };
  });
}

// Resultat eines Wochenendes für events.results (Format siehe supabase/01_tippspiel.sql).
//   race/quali/sprint: Jolpica-Objekte (Races[0]) oder null; raceControl: OpenF1-
//   Meldungen der Kategorie SafetyCar (Array) oder null, wenn nicht verfügbar.
// Ausfall = im Rennen ausgeschieden (auch wenn wegen genug Runden noch gewertet).
// Nicht gestartet und disqualifiziert zählen nicht. Erster Ausfall = wenigste
// Runden (bei Gleichstand alle). Safety Car = nur echte SC-Phasen, kein VSC.
const FINISHED = /^(finished|lapped|\+\d+ laps?)$/i;
const NOT_RACED = /disqualif|did not start|withdrawn|excluded|did not qualify|not qualified|dns/i;
const byPos = list => [...(list || [])].sort((a, b) => +a.position - +b.position).map(x => x.Driver.driverId);

export function resultsFromSources({ race = null, quali = null, sprint = null, raceControl = null } = {}) {
  const out = {};
  const q = quali?.QualifyingResults;
  if (q?.length >= 10) out.quali = byPos(q);
  const s = sprint?.SprintResults;
  if (s?.length >= 10) out.sprint = byPos(s);
  const r = race?.Results;
  if (r?.length >= 10) {
    out.race = byPos(r);
    out.fastest = r.find(x => x.FastestLap?.rank === '1')?.Driver.driverId || null;
    const dnf = r.filter(x => !FINISHED.test(x.status || '') && !NOT_RACED.test(x.status || '') && !/^[DWEF]$/.test(x.positionText || ''));
    out.dnf = dnf.map(x => x.Driver.driverId);
    const minLaps = Math.min(...dnf.map(x => +x.laps || 0));
    out.firstDnf = dnf.filter(x => (+x.laps || 0) === minLaps).map(x => x.Driver.driverId);
    out.dsq = r.filter(x => x.positionText === 'D' || /disqualif/i.test(x.status || '')).map(x => x.Driver.driverId);
    if (Array.isArray(raceControl)) {
      out.sc = raceControl.filter(m => /^SAFETY CAR DEPLOYED/i.test(m.message || '')).length;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Fahrerfeld: alle Fahrer der WM-Wertung. "active" = in einem der letzten
// Rennen gestartet (activeIds); ohne diese Info gilt das Flag aus loadCore.
export function driversFromStandings(season, standings = [], activeIds = null) {
  return standings.map(s => ({
    season: +season,
    driver_id: s.Driver.driverId,
    code: s.Driver.code || null,
    given_name: s.Driver.givenName,
    family_name: s.Driver.familyName,
    team_id: s.Constructors?.at(-1)?.constructorId || null,
    number: s.Driver.permanentNumber || null,
    active: activeIds ? activeIds.has(s.Driver.driverId) : s.active !== false,
  }));
}
