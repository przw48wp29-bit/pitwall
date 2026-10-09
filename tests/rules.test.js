// Tests der reinen Tippspiel-Funktionen (Browser-Seite) und der
// Kalender-Abbildung für den Sync-Job.

import { suite, assert } from './harness.js';
import { lockTime, validatePicks, draftToPicks, samePicks, kindsFor } from '../assets/js/tipp/rules.js';
import { eventsFromSchedule, driversFromStandings, eventId } from '../assets/js/tipp/sync.js';

export default async function rulesTests() {
  const t = suite('Tipp-Regeln und Kalender');

  const jolpicaRace = {
    season: '2026', round: '17', raceName: 'Singapore Grand Prix', date: '2026-10-11', time: '12:00:00Z',
    Circuit: { circuitId: 'marina_bay', Location: { country: 'Singapore' } },
    FirstPractice: { date: '2026-10-09', time: '08:30:00Z' },
    SprintQualifying: { date: '2026-10-09', time: '12:30:00Z' },
    Sprint: { date: '2026-10-10', time: '09:00:00Z' },
    Qualifying: { date: '2026-10-10', time: '13:00:00Z' },
  };

  t('Jolpica-Kalender wird korrekt übernommen (UTC)', () => {
    const [e] = eventsFromSchedule([jolpicaRace]);
    assert.equal(e.id, '2026-17');
    assert.equal(e.quali_start, '2026-10-10T13:00:00.000Z');
    assert.equal(e.sprint_quali_start, '2026-10-09T12:30:00.000Z');
    assert.equal(e.sprint_start, '2026-10-10T09:00:00.000Z');
    assert.equal(e.race_start, '2026-10-11T12:00:00.000Z');
    assert.equal(eventId(2026, 3), '2026-03');
  });

  t('Wochenende ohne Sprint und ohne Quali-Zeit', () => {
    const [e] = eventsFromSchedule([{ ...jolpicaRace, Sprint: undefined, SprintQualifying: undefined, Qualifying: undefined }]);
    assert.equal(e.sprint_start, null);
    assert.equal(e.quali_start, '2026-10-10T12:00:00.000Z', '24 h vor dem Rennen');
    assert.deepEqual(kindsFor(e), ['quali', 'race', 'extras']);
  });

  t('Tippschluss früh und spät (wie in der Datenbank)', () => {
    const [e] = eventsFromSchedule([jolpicaRace]);
    assert.equal(lockTime(e, { lock: 'early' }, 'race').toISOString(), e.quali_start);
    assert.equal(lockTime(e, { lock: 'early' }, 'sprint').toISOString(), e.sprint_quali_start);
    assert.equal(lockTime(e, { lock: 'late' }, 'race').toISOString(), e.race_start);
    assert.equal(lockTime(e, { lock: 'late' }, 'extras').toISOString(), e.race_start);
    assert.equal(lockTime(e, { lock: 'late' }, 'sprint').toISOString(), e.sprint_start);
    assert.equal(lockTime(e, { lock: 'late' }, 'quali').toISOString(), e.quali_start);
  });

  t('Fahrerfeld: aktiv nach letzten Rennen', () => {
    const st = [
      { Driver: { driverId: 'a', code: 'AAA', givenName: 'A', familyName: 'Aa', permanentNumber: '1' }, Constructors: [{ constructorId: 'x' }, { constructorId: 'y' }] },
      { Driver: { driverId: 'b', givenName: 'B', familyName: 'Bb' }, Constructors: [{ constructorId: 'x' }], active: false },
    ];
    const d = driversFromStandings('2026', st);
    assert.equal(d[0].team_id, 'y', 'aktuelles Team = letztes');
    assert.equal(d[1].active, false);
    assert.equal(driversFromStandings('2026', st, new Set(['b']))[0].active, false);
  });

  t('Tipps prüfen wie der Server', () => {
    const ok = new Set(['a', 'b', 'c', 'd']);
    assert.equal(validatePicks('race', { order: ['a', 'b', 'c'] }, ok), null);
    assert.ok(/nur einmal/.test(validatePicks('race', { order: ['a', 'a', 'c'] }, ok)));
    assert.ok(/nicht wählbar/.test(validatePicks('quali', { order: ['z'] }, ok)));
    assert.ok(/3 bis 10/.test(validatePicks('race', { order: ['a'] }, ok)));
    assert.equal(validatePicks('quali', { order: ['a'] }, ok), null, 'nur Pole ist erlaubt');
    assert.ok(/keinen ersten Ausfall/.test(validatePicks('extras', { dnf: 0, firstDnf: 'a' }, ok)));
    assert.ok(/Leerer/.test(validatePicks('extras', {}, ok)));
  });

  t('Entwurf → Tipp: Lücken am Ende fallen weg', () => {
    assert.deepEqual(draftToPicks('race', ['a', 'b', 'c', null, null]), { order: ['a', 'b', 'c'] });
    assert.deepEqual(draftToPicks('race', ['a', null, 'c']), { order: ['a', null, 'c'] });
    assert.equal(draftToPicks('race', [null, null]), null);
    assert.deepEqual(draftToPicks('extras', { sc: 0, fastest: null }), { sc: 0 });
  });

  t('Tipps vergleichen unabhängig von der Schlüssel-Reihenfolge', () => {
    assert.ok(samePicks({ sc: 1, dnf: 2 }, { dnf: 2, sc: 1 }));
    assert.ok(!samePicks({ order: ['a', 'b'] }, { order: ['b', 'a'] }));
  });

  return t;
}
