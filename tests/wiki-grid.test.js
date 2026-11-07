// Tests für das Fahrerfeld aus Wikipedia (Gratisquelle für die Verträge).
// Die Vorlage ist der echte Abschnitt «Entries» des Artikels zur Saison 2027,
// nur mit gekürzten Fussnoten.

import { suite, assert } from './harness.js';
import { parseEntryTable, teamIdOf, driverIdOf, mergeContracts, parseSeasonEntries, parseRounds, entryRaces } from '../assets/js/wiki-grid.js';

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

  // --- Meldeliste der laufenden Saison (Spalte «Rounds») ---
  const season2026 = await readText('tests/fixtures/wiki-2026-entries.txt');
  const entries = parseSeasonEntries(season2026);
  const of = team => entries.filter(e => e.entrant === team);

  t('Rundenangaben lesen: Bereiche, Listen, Fussnoten', () => {
    assert.deepEqual(parseRounds('20'), [20]);
    assert.deepEqual(parseRounds('1–5'), [1, 2, 3, 4, 5], 'Gedankenstrich');
    assert.deepEqual(parseRounds('1-3'), [1, 2, 3], 'Bindestrich');
    assert.deepEqual(parseRounds('1–3, 7'), [1, 2, 3, 7], 'Liste aus Bereich und Einzelrunde');
    assert.deepEqual(parseRounds('1–2{{efn|irgendein Hinweis mit [[Link]]}}'), [1, 2], 'Fussnote stoert nicht');
    assert.deepEqual(parseRounds(''), []);
  });

  t('Meldeliste: mehrere Fahrer pro Team-Zeile, mit Runden', () => {
    const haas = of('Haas');
    assert.deepEqual(haas.map(e => e.driver), ['Esteban Ocon', 'Ryo Hirakawa', 'Rafael Câmara', 'Oliver Bearman']);
    assert.deepEqual(haas.map(e => e.number), ['31', '50', '51', '87'], 'Nummern bleiben den Fahrern zugeordnet');
    assert.deepEqual(haas.find(e => e.driver === 'Rafael Câmara').rounds, [20], 'Debuetant ist fuer Runde 20 gemeldet');
    assert.equal(haas.find(e => e.driver === 'Esteban Ocon').rounds.length, 19, 'Ocon 1–19');
    assert.deepEqual(of('Racing Bulls').find(e => e.driver === 'Liam Lawson').rounds.slice(-3), [18, 19, 20]);
    assert.deepEqual(of('Racing Bulls').find(e => e.driver === 'Yuki Tsunoda').rounds, [12, 13, 14], 'Luecke mittendrin');
  });

  t('Meldeliste: Teams mit zwei festen Fahrern', () => {
    assert.deepEqual(of('Ferrari').map(e => e.driver), ['Charles Leclerc', 'Lewis Hamilton']);
    assert.ok(of('Ferrari').every(e => e.rounds.length === 20), 'beide ueber die ganze Saison');
  });

  t('Meldeliste wird zu Pseudo-Rennen für die Rollenlogik', () => {
    const roster = [
      { driverId: 'ocon', familyName: 'Ocon' }, { driverId: 'bearman', familyName: 'Bearman' },
      { driverId: 'ryo_hirakawa', familyName: 'Hirakawa' }, { driverId: 'rafael_camara', familyName: 'Camara' },
    ];
    const races = entryRaces(of('Haas'), roster);
    assert.equal(races.length, 20, 'eine Runde je gemeldetem Rennen');
    assert.equal(races.at(-1).round, '20');
    assert.deepEqual(races.at(-1).Results.map(r => r.Driver.driverId).sort(), ['bearman', 'rafael_camara'],
      'fuer Runde 20 sind genau Bearman und Câmara gemeldet');
    assert.ok(races.at(-1).Results.every(r => r.Constructor.constructorId === 'haas'));
  });

  t('Fehlender Abschnitt: leer statt Absturz', () => {
    assert.deepEqual(parseSeasonEntries(''), []);
    assert.deepEqual(parseSeasonEntries('== Entries ==\nkein Tabellenanfang'), []);
    assert.deepEqual(entryRaces([], []), []);
  });

  return t;
}
