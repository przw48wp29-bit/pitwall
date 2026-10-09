// Tests der Titelchancen-Simulation (Ersatz für die KI-Prognose).

import { suite, assert } from './harness.js';
import { titleOdds } from '../assets/js/stats.js';

// Reproduzierbarer Zufall
const seeded = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const driver = (id, points, team = 't') => ({ Driver: { driverId: id, familyName: id }, Constructors: [{ constructorId: team }], points: String(points), active: true });
const race = (round, order) => ({ round: String(round), Results: order.map((id, i) => ({ Driver: { driverId: id }, points: String([25, 18, 15, 12, 10, 8, 6, 4, 2, 1][i] || 0) })) });

export default async function statsTests() {
  const t = suite('Titelchancen (Simulation)');
  const ids = Array.from({ length: 12 }, (_, i) => 'd' + i);

  t('Uneinholbarer Vorsprung = 100 %', () => {
    const core = { standingsRound: 22, schedule: [{ round: '23' }], drivers: [driver('a', 400), ...ids.map(id => driver(id, 300))] };
    const res = { races: [race(22, ['a', ...ids])], sprints: [] };
    const o = titleOdds(core, res, { sims: 500, rng: seeded(1) });
    assert.equal(o[0].driverId, 'a');
    assert.equal(o[0].chance, 100);
  });

  t('Gleich stark und punktgleich ≈ 50:50', () => {
    const core = { standingsRound: 10, schedule: [11, 12, 13, 14].map(r => ({ round: String(r) })), drivers: [driver('a', 200), driver('b', 200), ...ids.map(id => driver(id, 10))] };
    const res = { races: [race(9, ['a', 'b', ...ids]), race(10, ['b', 'a', ...ids])], sprints: [] };
    const o = titleOdds(core, res, { sims: 4000, rng: seeded(7) });
    const a = o.find(x => x.driverId === 'a').chance, b = o.find(x => x.driverId === 'b').chance;
    assert.ok(Math.abs(a - b) < 6, `a=${a} b=${b}`);
    assert.ok(Math.abs(o.reduce((s, x) => s + x.chance, 0) - 100) < 0.5, 'Summe 100 %');
  });

  t('Formstarker Verfolger hat realistische Chancen', () => {
    const core = { standingsRound: 18, schedule: [19, 20, 21, 22, 23].map(r => ({ round: String(r), Sprint: r === 20 })), drivers: [driver('a', 300), driver('b', 280), ...ids.map(id => driver(id, 50))] };
    const res = { races: [14, 15, 16, 17, 18].map(r => race(r, ['b', ...ids.slice(0, 5), 'a', ...ids.slice(5)])), sprints: [] };
    const o = titleOdds(core, res, { sims: 3000, rng: seeded(3) });
    assert.equal(o[0].driverId, 'b', 'der Formstärkere liegt vorne');
    assert.ok(o.find(x => x.driverId === 'a').chance > 0, 'Leader hat noch Chancen');
  });

  return t;
}
