// Tests für den News-Abruf (RSS): Einlesen, Zuordnen, Zusammenführen.

import { suite, assert } from './harness.js';
import { parseFeed, tagNews, mergeNews, canonicalUrl, cleanText, categorize, swiss } from '../assets/js/news-feed.js';

const ROSTER = [
  { driverId: 'max_verstappen', familyName: 'Verstappen', team: 'red_bull' },
  { driverId: 'hadjar', familyName: 'Hadjar', team: 'red_bull' },
  { driverId: 'hulkenberg', familyName: 'Hülkenberg', team: 'audi' },
  { driverId: 'perez', familyName: 'Pérez', team: 'cadillac' },
  { driverId: 'leclerc', familyName: 'Leclerc', team: 'ferrari' },
];

export default async function newsTests({ readText }) {
  const t = suite('News (RSS)');

  t('Formel1.de-Feed wird gelesen', async () => {
    const items = parseFeed(await readText('tests/fixtures/formel1de.xml'));
    assert.ok(items.length >= 3, 'Anzahl ' + items.length);
    assert.ok(items.every(i => i.title && i.url.startsWith('https://') && i.date), 'Titel, Link, Datum');
    assert.ok(!items[0].summary.includes('<'), 'kein HTML im Kurztext');
  });

  t('Formula1.com-Feed (ohne Datum) wird gelesen', async () => {
    const items = parseFeed(await readText('tests/fixtures/f1com.xml'));
    assert.ok(items.length >= 3);
    assert.equal(items[0].date, null);
    assert.ok(!/â€/.test(items[0].summary), 'Umlaute/Anführungszeichen korrekt');
  });

  t('Zuordnung zu Fahrern, Teams und Kategorie', () => {
    const a = tagNews({ title: 'Rätselraten bei Red Bull: Hadjar nach Qualifying-Debakel ratlos', summary: 'Weit hinter Verstappen' }, ROSTER);
    assert.deepEqual(a.drivers, ['hadjar', 'max_verstappen']);
    assert.equal(a.team, 'red_bull');
    assert.equal(a.category, 'Rennen');
    const b = tagNews({ title: 'Wann Racing Bulls seine Fahrerentscheidung trifft', summary: '' }, ROSTER);
    assert.deepEqual(b.teams, ['rb'], 'Racing Bulls ≠ Red Bull');
    const c = tagNews({ title: 'Hulkenberg und Perez im Duell', summary: '' }, ROSTER);
    assert.deepEqual(c.drivers, ['hulkenberg', 'perez'], 'Namen ohne Akzente');
    assert.equal(tagNews({ title: 'Stewards issue verdict over Verstappen yellow flag incident', summary: '' }, ROSTER).category, 'Regeln');
    assert.equal(categorize('Mercedes bringt neuen Unterboden'), 'Technik');
    assert.equal(categorize('Finanzbericht: Abfindung für Horner'), 'Business');
  });

  t('Links ohne Tracking, Texte sauber, Schweizer ss', () => {
    assert.equal(canonicalUrl('https://de.motorsport.com/f1/news/x/123/?utm_source=RSS&amp;utm_medium=referral'), 'https://de.motorsport.com/f1/news/x/123/');
    assert.equal(cleanText('<![CDATA[Ein <b>Test</b> &amp; mehr ...<a class=\'more\' href="x">Weiterlesen</a>]]>'), 'Ein Test & mehr …');
    assert.equal(swiss('Das grosse Ferrari-Problem: Maß der Dinge'), 'Das grosse Ferrari-Problem: Mass der Dinge');
  });

  t('Zusammenführen: keine Doppelten, neueste zuerst, Datum bleibt', () => {
    const now = '2026-10-09T12:00:00.000Z';
    const prev = [{ title: 'Alt', url: 'https://a/1', date: '2026-10-08T10:00:00.000Z', firstSeen: '2026-10-08T10:05:00.000Z' }];
    const fresh = [
      { title: 'Neu ohne Datum', url: 'https://b/2', date: null },
      { title: 'Alt', url: 'https://a/1', date: '2026-10-08T10:00:00.000Z' },
      { title: 'ALT', url: 'https://c/3', date: '2026-10-09T09:00:00.000Z' },   // gleicher Titel, andere Quelle
    ];
    const m = mergeNews(prev, fresh, { now });
    assert.equal(m.length, 2);
    assert.equal(m[0].title, 'Neu ohne Datum');
    assert.equal(m[0].date, now, 'Zeitpunkt des ersten Auftauchens');
    assert.equal(m[1].firstSeen, '2026-10-08T10:05:00.000Z');
  });

  return t;
}
