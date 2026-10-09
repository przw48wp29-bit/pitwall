// Berechnungen aus den Rohdaten: Saisonstatistiken, Teamduelle, Punkteverlauf, Titelrechner.

import { POINTS } from './config.js';

export const classified = r => /^\d+$/.test(r.positionText);

export function seasonStats(results) {
  const d = new Map();
  const get = (D, C) => {
    if (!d.has(D.driverId)) d.set(D.driverId, { driver: D, team: C.constructorId, races: 0, wins: 0, podiums: 0, poles: 0, fastest: 0, dnf: 0, pointsFinishes: 0, best: 99, finishSum: 0, finishes: 0, gridSum: 0, gained: 0, sprintWins: 0, sprintPodiums: 0, frontRows: 0, laps: 0 });
    const s = d.get(D.driverId);
    s.team = C.constructorId;
    return s;
  };
  for (const race of results.races) for (const r of race.Results) {
    const s = get(r.Driver, r.Constructor);
    const pos = +r.position;
    s.races++;
    s.laps += +r.laps || 0;
    if (classified(r)) {
      s.finishes++; s.finishSum += pos; s.best = Math.min(s.best, pos);
      if (pos === 1) s.wins++;
      if (pos <= 3) s.podiums++;
      if (+r.grid > 0) s.gained += +r.grid - pos;
    } else s.dnf++;
    if (+r.points > 0) s.pointsFinishes++;
    if (r.FastestLap?.rank === '1') s.fastest++;
  }
  for (const q of results.quali) for (const r of q.QualifyingResults) {
    const s = get(r.Driver, r.Constructor);
    if (r.position === '1') s.poles++;
    if (+r.position <= 2) s.frontRows++;
  }
  for (const sp of results.sprints) for (const r of sp.SprintResults) {
    const s = get(r.Driver, r.Constructor);
    if (r.position === '1') s.sprintWins++;
    if (+r.position <= 3) s.sprintPodiums++;
  }
  for (const s of d.values()) s.avg = s.finishes ? s.finishSum / s.finishes : null;
  return d;
}

// Teamduelle: wer war im Qualifying/Rennen vor dem Teamkollegen?
export function headToHead(results) {
  const pairs = new Map();
  const bump = (team, a, b, field) => {
    const key = team + ':' + [a, b].sort().join('|');
    if (!pairs.has(key)) pairs.set(key, { team, a: [a, b].sort()[0], b: [a, b].sort()[1], quali: {}, race: {} });
    const p = pairs.get(key);
    p[field][a] = (p[field][a] || 0) + 1;
    p[field][b] = p[field][b] || 0;
  };
  const scan = (list, key, field, better) => {
    for (const ev of list) {
      const byTeam = new Map();
      for (const r of ev[key]) {
        if (!byTeam.has(r.Constructor.constructorId)) byTeam.set(r.Constructor.constructorId, []);
        byTeam.get(r.Constructor.constructorId).push(r);
      }
      for (const [team, rs] of byTeam) {
        if (rs.length !== 2) continue;
        const [x, y] = rs;
        const w = better(x, y) ? x : y;
        const l = w === x ? y : x;
        bump(team, w.Driver.driverId, l.Driver.driverId, field);
      }
    }
  };
  scan(results.quali, 'QualifyingResults', 'quali', (x, y) => +x.position < +y.position);
  scan(results.races, 'Results', 'race', (x, y) => +x.position < +y.position);
  return [...pairs.values()];
}

// Kumulierte Punkte pro Runde (Rennen + Sprint).
export function pointsProgression(results) {
  const rounds = [...new Set(results.races.map(r => +r.round))].sort((a, b) => a - b);
  const per = new Map();
  const add = (id, round, pts) => {
    if (!per.has(id)) per.set(id, new Map());
    per.get(id).set(round, (per.get(id).get(round) || 0) + pts);
  };
  for (const r of results.races) for (const x of r.Results) add(x.Driver.driverId, +r.round, +x.points);
  for (const r of results.sprints) for (const x of r.SprintResults) add(x.Driver.driverId, +r.round, +x.points);
  const series = new Map();
  for (const [id, m] of per) {
    let sum = 0;
    series.set(id, rounds.map(rd => (sum += m.get(rd) || 0)));
  }
  return { rounds, series };
}

// Titelchancen per Simulation (gratis, ohne KI): Die restlichen Rennen und
// Sprints werden n-mal ausgespielt. Wie stark ein Fahrer ist, ergibt sich aus
// seinen Punkten pro Wochenende in den letzten 6 Rennen; die Zielreihenfolge
// wird danach zufällig gezogen (Plackett-Luce). Ergebnis: Chance in Prozent.
const RACE_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_PTS = [8, 7, 6, 5, 4, 3, 2, 1];
export function titleOdds(core, results, { sims = 4000, window = 6, rng = Math.random } = {}) {
  const done = core.standingsRound;
  const remaining = core.schedule.filter(r => +r.round > done);
  const field = core.drivers.filter(s => s.active !== false);
  if (!field.length) return [];
  const recent = results.races.slice(-window);
  const strength = field.map(s => {
    const id = s.Driver.driverId;
    let pts = 0;
    for (const r of recent) {
      pts += +(r.Results.find(x => x.Driver.driverId === id)?.points || 0);
      pts += +(results.sprints.find(x => x.round === r.round)?.SprintResults.find(x => x.Driver.driverId === id)?.points || 0);
    }
    return Math.pow(pts / Math.max(1, recent.length) + 0.5, 1.4);
  });
  const base = field.map(s => +s.points);
  const wins = new Array(field.length).fill(0);
  const order = new Array(field.length);
  const draw = n => {   // Plackett-Luce: Plätze nacheinander gewichtet ziehen
    const w = strength.slice();
    let total = w.reduce((a, b) => a + b, 0);
    for (let p = 0; p < Math.min(n, w.length); p++) {
      let x = rng() * total, i = -1;
      do { i++; x -= w[i]; } while (x > 0 && i < w.length - 1);
      if (w[i] === 0) i = w.findIndex(v => v > 0);   // Rundungsfehler abfangen
      order[p] = i; total -= w[i]; w[i] = 0;
    }
  };
  for (let s = 0; s < sims; s++) {
    const tot = base.slice();
    for (const r of remaining) {
      const k = Math.min(field.length, RACE_PTS.length), ks = Math.min(field.length, SPRINT_PTS.length);
      if (r.Sprint) { draw(ks); for (let p = 0; p < ks; p++) tot[order[p]] += SPRINT_PTS[p]; }
      draw(k); for (let p = 0; p < k; p++) tot[order[p]] += RACE_PTS[p];
    }
    let best = 0;
    for (let i = 1; i < tot.length; i++) if (tot[i] > tot[best] || (tot[i] === tot[best] && rng() < 0.5)) best = i;
    wins[best]++;
  }
  return field.map((s, i) => ({ driverId: s.Driver.driverId, name: s.Driver.familyName, team: s.Constructors.at(-1).constructorId, chance: Math.round((wins[i] / sims) * 1000) / 10 }))
    .filter(x => x.chance > 0).sort((a, b) => b.chance - a.chance);
}

// Titelrechner: wie viele Punkte sind noch zu vergeben?
export function titleMath(core) {
  const done = core.standingsRound;
  const remaining = core.schedule.filter(r => +r.round > done);
  const races = remaining.length;
  const sprints = remaining.filter(r => r.Sprint).length;
  const maxDriver = races * POINTS.race + sprints * POINTS.sprint;
  const maxTeam = races * (POINTS.race + 18) + sprints * (POINTS.sprint + 7);
  const [p1, p2] = core.drivers;
  const gap = p1 && p2 ? +p1.points - +p2.points : 0;
  return { races, sprints, maxDriver, maxTeam, gap, leader: p1, second: p2, clinched: gap > maxDriver };
}
