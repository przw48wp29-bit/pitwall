// Tests für das aktuelle Fahrerfeld (assets/js/roster.js).
// Entscheidend ist nicht nur der Normalfall, sondern dass sich die Regel bei
// einem Wechsel von selbst korrigiert – in beide Richtungen.

import { suite, assert } from './harness.js';
import { roles, applyRoles, provisionalGrid, splitName, keepPrevious, racesFromEntries, knownFromEntries, codeOf } from '../assets/js/roster.js';

// Kurzschreibweise: race(19, ['bearman:haas', 'ryo_hirakawa:haas'])
const race = (round, pairs) => ({ round: String(round), Results: pairs.map(p => {
  const [driverId, constructorId] = p.split(':');
  return { Driver: { driverId }, Constructor: { constructorId } };
}) });

// Ein Team über mehrere Runden: seats(17, 19, ['bearman','ocon'], ...)
const grid = (...rounds) => rounds.map((pairs, i) => race(i + 1, pairs));

export default async function rosterTests() {
  const t = suite('Fahrerfeld: Stammfahrer, Ersatz, Saisonwechsel');

  t('Normalfall: beide Stammfahrer, niemand ersetzt', () => {
    const r = roles(grid(
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ocon:haas'],
    ));
    assert.equal(r.get('bearman').role, 'stamm');
    assert.equal(r.get('ocon').role, 'stamm');
    assert.equal(r.get('ocon').replacedBy, undefined);
  });

  t('Ersatzfahrer springt ein: er ist «ersatz», der Stammfahrer «raus»', () => {
    const r = roles(grid(
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ryo_hirakawa:haas'],
    ));
    assert.equal(r.get('bearman').role, 'stamm');
    assert.equal(r.get('ryo_hirakawa').role, 'ersatz', 'ein Einsatz macht noch keinen Stammfahrer');
    assert.equal(r.get('ocon').role, 'raus');
    assert.equal(r.get('ryo_hirakawa').standsInFor, 'ocon');
    assert.equal(r.get('ocon').replacedBy, 'ryo_hirakawa');
  });

  t('Stammfahrer kehrt zurück: nach einem Rennen wieder «stamm»', () => {
    const r = roles(grid(
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ryo_hirakawa:haas'],
      ['bearman:haas', 'ocon:haas'],
    ));
    assert.equal(r.get('ocon').role, 'stamm');
    assert.equal(r.get('ryo_hirakawa').role, 'raus', 'wer nicht mehr faehrt, ist raus');
    assert.equal(r.get('ocon').replacedBy, undefined, 'keine falsche Verknuepfung mehr');
  });

  t('Ersatzfahrer übernimmt dauerhaft: nach zwei Rennen «stamm»', () => {
    const r = roles(grid(
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ryo_hirakawa:haas'],
      ['bearman:haas', 'ryo_hirakawa:haas'],
    ));
    assert.equal(r.get('ryo_hirakawa').role, 'stamm');
    assert.equal(r.get('ocon').role, 'raus');
    // Ocon ist kein Stammfahrer des Fensters mehr -> keine Ersatz-Verknuepfung.
    assert.equal(r.get('ryo_hirakawa').standsInFor, undefined);
  });

  t('Saisonstart: nach einem einzigen Rennen sind alle Stammfahrer', () => {
    const r = roles(grid(['bearman:haas', 'ocon:haas', 'norris:mclaren', 'piastri:mclaren']));
    assert.deepEqual([...r.values()].map(x => x.role), ['stamm', 'stamm', 'stamm', 'stamm'],
      'mit nur einem Rennen darf niemand als Ersatz gelten');
  });

  t('Teamwechsel mitten in der Saison: das neue Team zählt', () => {
    const r = roles([
      race(1, ['lawson:red_bull', 'hadjar:red_bull', 'tsunoda:rb']),
      race(2, ['lawson:rb', 'hadjar:red_bull', 'lindblad:rb']),
      race(3, ['lawson:rb', 'hadjar:red_bull', 'lindblad:rb']),
      race(4, ['lawson:rb', 'hadjar:red_bull', 'lindblad:rb']),
    ]);
    assert.equal(r.get('lawson').team, 'rb');
    assert.equal(r.get('lawson').role, 'stamm');
    assert.equal(r.get('tsunoda').role, 'raus', 'faehrt seit Runde 2 nicht mehr');
    assert.equal(r.get('tsunoda').team, 'rb', 'Team bleibt das des letzten Einsatzes');
  });

  t('Zwei Ersatzleute im selben Team: keine geratene Zuordnung', () => {
    const r = roles(grid(
      ['a:haas', 'b:haas'],
      ['a:haas', 'b:haas'],
      ['c:haas', 'd:haas'],
    ));
    assert.equal(r.get('c').role, 'ersatz');
    assert.equal(r.get('d').role, 'ersatz');
    assert.equal(r.get('c').standsInFor, undefined, 'bei zwei Wechseln wird nichts behauptet');
    assert.equal(r.get('a').replacedBy, undefined);
  });

  t('Ohne Rennen keine Rollen (Saison noch nicht gestartet)', () => {
    assert.equal(roles([]).size, 0);
    assert.equal(roles([{ round: '1', Results: [] }]).size, 0);
  });

  t('applyRoles hängt die Rolle an die WM-Wertung', () => {
    const standings = [
      { points: '23', Driver: { driverId: 'bearman' }, Constructors: [{ constructorId: 'haas' }] },
      { points: '7', Driver: { driverId: 'ocon' }, Constructors: [{ constructorId: 'haas' }] },
      { points: '1', Driver: { driverId: 'ryo_hirakawa' }, Constructors: [] },
    ];
    const out = applyRoles(standings, grid(
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ocon:haas'],
      ['bearman:haas', 'ryo_hirakawa:haas'],
    ));
    assert.equal(out[1].active, false, 'Ocon faehrt gerade nicht');
    assert.equal(out[1].role, 'raus');
    assert.equal(out[2].role, 'ersatz');
    assert.equal(out[2].Constructors.at(-1).constructorId, 'haas', 'Team wird ergaenzt, wenn es fehlt');
  });

  t('Fahrer ohne Einsatz gilt als nicht aktiv', () => {
    const out = applyRoles(
      [{ Driver: { driverId: 'niemand' }, Constructors: [{ constructorId: 'haas' }] }],
      grid(['bearman:haas', 'ocon:haas']));
    assert.equal(out[0].active, false);
    assert.equal(out[0].role, 'raus');
  });

  t('Namen aufteilen, Zusätze bleiben beim Nachnamen', () => {
    assert.deepEqual(splitName('Rafael Câmara'), { givenName: 'Rafael', familyName: 'Câmara' });
    assert.deepEqual(splitName('Andrea Kimi Antonelli'), { givenName: 'Andrea Kimi', familyName: 'Antonelli' });
    assert.deepEqual(splitName('Carlos Sainz Jr.'), { givenName: 'Carlos', familyName: 'Sainz Jr.' });
    assert.deepEqual(splitName('Verstappen'), { givenName: '', familyName: 'Verstappen' });
    assert.deepEqual(splitName(''), { givenName: '', familyName: '' });
  });

  t('Saisonwechsel: Feld aus den Verträgen, Details aus der Vorsaison', () => {
    const contracts = [
      { driverId: 'bearman', name: 'Oliver Bearman', team2027: 'haas', status: 'bestätigt' },
      { driverId: 'camara', name: 'Rafael Câmara', team2027: 'haas', status: 'bestätigt', number: '50' },
      { driverId: 'norris', name: 'Lando Norris', team2027: 'mclaren', status: 'erwartet' },
      { driverId: 'ocon', name: 'Esteban Ocon', team2027: null, status: 'offen' },
    ];
    const prev = [
      { Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris', code: 'NOR', permanentNumber: '4', url: 'u' }, Constructors: [{ constructorId: 'mclaren' }] },
      { Driver: { driverId: 'bearman', givenName: 'Oliver', familyName: 'Bearman', code: 'BEA', permanentNumber: '87' }, Constructors: [{ constructorId: 'haas' }] },
    ];
    const g = provisionalGrid(contracts, 2027, prev);
    assert.deepEqual(g.map(s => s.Driver.driverId), ['norris', 'bearman', 'camara'],
      'Teams in der Reihenfolge der Vorsaison, innerhalb alphabetisch');
    assert.equal(g[0].Driver.permanentNumber, '4', 'bekannte Fahrer behalten ihre Daten');
    assert.equal(g[2].Driver.givenName, 'Rafael', 'Neulinge kommen aus dem Vertragsnamen');
    assert.equal(g[2].Driver.permanentNumber, '50', 'Startnummer aus der Wikipedia-Startliste');
    assert.ok(g.every(s => s.provisional && s.active && s.role === 'stamm'));
    assert.ok(!g.some(s => s.Driver.driverId === 'ocon'), 'offene Cockpits gehoeren nicht ins Feld');
  });

  t('Saisonwechsel: leere Jolpica-Daten dürfen den Snapshot nicht löschen', () => {
    const voll = { schedule: [{ round: '1' }], drivers: [{ Driver: { driverId: 'a' } }] };
    const leer = { schedule: [], drivers: [] };
    assert.equal(keepPrevious(leer, voll), true, 'leer + guter alter Stand -> alten behalten');
    assert.equal(keepPrevious({ schedule: [{ round: '1' }], drivers: [] }, voll), true, 'Kalender ohne Fahrer reicht nicht');
    assert.equal(keepPrevious(voll, voll), false, 'vollstaendige Daten werden geschrieben');
    assert.equal(keepPrevious(leer, leer), false, 'ohne alten Stand bleibt nur der neue');
    assert.equal(keepPrevious(leer, undefined), false, 'beim allerersten Lauf nichts blockieren');
  });

  t('Debütant ohne WM-Wertung wird trotzdem angezeigt', () => {
    // Câmaras Fall: gemeldet fuer das kommende Rennen, aber bei Jolpica noch
    // ohne Eintrag, weil er nie gestartet ist. Ohne diesen Schritt fehlt er.
    const standings = [
      { points: '23', Driver: { driverId: 'bearman', givenName: 'Oliver', familyName: 'Bearman' }, Constructors: [{ constructorId: 'haas' }] },
      { points: '7', Driver: { driverId: 'ocon', givenName: 'Esteban', familyName: 'Ocon' }, Constructors: [{ constructorId: 'haas' }] },
    ];
    const entries = [
      { id: 'bearman', team: 'haas', rounds: [18, 19, 20], givenName: 'Oliver', familyName: 'Bearman', number: '87' },
      { id: 'ocon', team: 'haas', rounds: [18, 19], givenName: 'Esteban', familyName: 'Ocon', number: '31' },
      { id: 'rafael_camara', team: 'haas', rounds: [20], givenName: 'Rafael', familyName: 'Câmara', number: '51' },
    ];
    const out = applyRoles(standings, racesFromEntries(entries), { known: knownFromEntries(entries) });
    const cam = out.find(s => s.Driver.driverId === 'rafael_camara');
    assert.ok(cam, 'Debuetant muss im Feld auftauchen');
    assert.equal(cam.active, true);
    assert.equal(cam.role, 'ersatz');
    assert.equal(cam.standsInFor, 'ocon');
    assert.equal(cam.Driver.familyName, 'Câmara', 'Name kommt aus der Meldeliste');
    assert.equal(cam.Driver.permanentNumber, '51', 'Startnummer ebenso');
    assert.equal(cam.points, '0', 'noch keine Punkte');
    assert.equal(cam.Driver.code, 'CAM', 'Kuerzel wird abgeleitet, solange Jolpica keines hat');
    assert.equal(cam.newcomer, true);
    assert.equal(out.find(s => s.Driver.driverId === 'ocon').role, 'raus');
    assert.equal(out.find(s => s.Driver.driverId === 'bearman').role, 'stamm');
  });

  t('Meldeliste zu Pseudo-Rennen: eine Runde je Meldung', () => {
    const races = racesFromEntries([
      { id: 'a', team: 'haas', rounds: [1, 2] },
      { id: 'b', team: 'haas', rounds: [2] },
    ]);
    assert.deepEqual(races.map(r => r.round), ['1', '2']);
    assert.deepEqual(races[1].Results.map(r => r.Driver.driverId), ['a', 'b']);
    assert.deepEqual(racesFromEntries([]), []);
  });

  t('Kürzel aus dem Nachnamen, ohne Akzente', () => {
    assert.equal(codeOf('Câmara'), 'CAM');
    assert.equal(codeOf('Hülkenberg'), 'HUL');
    assert.equal(codeOf('Ocon'), 'OCO');
    assert.equal(codeOf(''), null);
  });

  return t;
}
