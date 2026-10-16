// Tests für das Fahrerfeld aus Wikipedia (Gratisquelle für die Verträge).
// Die Vorlage ist der echte Abschnitt «Entries» des Artikels zur Saison 2027,
// nur mit gekürzten Fussnoten.

import { suite, assert } from './harness.js';
import { parseEntryTable, teamIdOf, driverIdOf, mergeContracts } from '../assets/js/wiki-grid.js';

const ROSTER = [
  { driverId: 'max_verstappen', familyName: 'Verstappen', team: 'red_bull' },
  { driverId: 'hulkenberg', familyName: 'Hülkenberg', team: 'audi' },
  { driverId: 'perez', familyName: 'Pérez', team: 'cadillac' },
  { driverId: 'sainz', familyName: 'Sainz', team: 'williams' },
  { driverId: 'albon', familyName: 'Albon', team: 'williams' },
  { driverId: 'bearman', familyName: 'Bearman', team: 'haas' },
  { driverId: 'ocon', familyName: 'Ocon', team: 'haas' },
];

export default async function wikiGridTests({ readText }) {
  const t = suite('Fahrerfeld (Wikipedia)');
  const wikitext = await readText('tests/fixtures/wiki-2027.txt');

  t('Startliste wird vollständig gelesen', () => {
    const e = parseEntryTable(wikitext);
    assert.equal(e.length, 22, '11 Teams à 2 Cockpits');
    assert.equal(e.filter(x => x.driver).length, 19, 'besetzte Cockpits');
    assert.equal(e.filter(x => !x.driver).length, 3, 'offene Cockpits (Haas 1, Racing Bulls 2)');
    // Flaggenvorlagen und verschachteltes {{nowrap|…}} dürfen den Namen nicht fressen.
    assert.equal(e.find(x => x.number === '23').driver, 'Alexander Albon');
    assert.equal(e.find(x => x.number === '5').driver, 'Gabriel Bortoleto');
    assert.equal(e.find(x => x.number === '55').driver, 'Carlos Sainz Jr.');
    // Sponsoren in der Team-Zelle sind keine Fahrer.
    assert.ok(!e.some(x => /Gucci|Atlassian|Oracle|Visa/.test(x.driver || '')), 'keine Sponsoren');
  });

  t('Kein Abschnitt, keine Tabelle: leer statt Absturz', () => {
    assert.deepEqual(parseEntryTable(''), []);
    assert.deepEqual(parseEntryTable('== Entries ==\nNoch nichts bekannt.'), []);
    assert.deepEqual(parseEntryTable(null), []);
  });

  t('Teamnamen: Red Bull Racing ist nicht Racing Bulls', () => {
    assert.equal(teamIdOf('Red Bull Racing'), 'red_bull');
    assert.equal(teamIdOf('Racing Bulls'), 'rb');
    assert.equal(teamIdOf('Aston Martin'), 'aston_martin');
    assert.equal(teamIdOf('Haas'), 'haas');
    assert.equal(teamIdOf('Andretti'), null, 'unbekanntes Team wird übersprungen');
  });

  t('Fahrernamen treffen die bestehenden IDs', () => {
    assert.equal(driverIdOf('Max Verstappen', ROSTER), 'max_verstappen');
    assert.equal(driverIdOf('Nico Hülkenberg', ROSTER), 'hulkenberg', 'Umlaut');
    assert.equal(driverIdOf('Sergio Pérez', ROSTER), 'perez', 'Akzent');
    assert.equal(driverIdOf('Carlos Sainz Jr.', ROSTER), 'sainz', 'Namenszusatz');
    assert.equal(driverIdOf('Rafael Câmara', ROSTER), 'camara', 'Rookie: ID aus dem Nachnamen');
  });

  t('Zusammenführen: ergänzen und hochstufen, Notizen bleiben', () => {
    const prev = [
      { driverId: 'max_verstappen', team2027: 'red_bull', status: 'bestätigt', note: 'Bleibt.', sources: [{ name: 'F1', url: 'https://f1.com/a' }] },
      { driverId: 'sainz', team2027: 'williams', status: 'erwartet' },
      { driverId: 'bearman', team2027: null, status: 'offen' },
    ];
    const after = mergeContracts(prev, parseEntryTable(wikitext), ROSTER, { season: 2027 });
    const by = id => after.find(c => c.driverId === id);

    assert.equal(by('camara').team2027, 'haas', 'neuer Fahrer kommt dazu');
    assert.equal(by('camara').name, 'Rafael Câmara');
    assert.equal(by('sainz').status, 'bestätigt', 'erwartet → bestätigt');
    assert.equal(by('max_verstappen').note, 'Bleibt.', 'recherchierte Notiz bleibt');
    assert.equal(by('max_verstappen').sources.length, 2, 'eigene Quelle bleibt, Wikipedia kommt dazu');
    assert.ok(/wikipedia\.org/.test(by('max_verstappen').sources.at(-1).url));
    assert.equal(by('bearman').status, 'offen', 'ohne Eintrag in der Liste unverändert');
    assert.equal(after.filter(c => c.team2027 === 'rb').length, 0, 'Racing Bulls bleibt offen');
  });

  t('Volles Team überstimmt einen widersprechenden Eintrag', () => {
    // Wikipedia hat bei Ferrari beide Cockpits besetzt (Leclerc, Hamilton) –
    // ein vermuteter dritter Ferrari-Fahrer kann dann nicht stimmen.
    const prev = [{ driverId: 'ocon', team2027: 'ferrari', status: 'Gerücht' }];
    const after = mergeContracts(prev, parseEntryTable(wikitext), ROSTER, { season: 2027 });
    const ocon = after.find(c => c.driverId === 'ocon');
    assert.equal(ocon.team2027, null);
    assert.equal(ocon.status, 'offen');
  });

  t('Wikipedia-Quelle wird nicht doppelt gesammelt', () => {
    const entries = parseEntryTable(wikitext);
    const once = mergeContracts([], entries, ROSTER, { season: 2027 });
    const twice = mergeContracts(once, entries, ROSTER, { season: 2027 });
    assert.deepEqual(twice, once, 'zweiter Lauf ändert nichts');
    assert.equal(twice.find(c => c.driverId === 'camara').sources.length, 1);
  });

  return t;
}
