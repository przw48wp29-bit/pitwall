// Tests der Auswertung (Stufe B): Punkteberechnung (score_kind in SQL),
// Resultat-Abbildung (sync.js), Ranglisten (ranking.js) und der ganze Ablauf
// in der Datenbank: Resultat → Punkte → Strafe → Neuberechnung, Fahrer des
// Tages, Korrekturen, Absage, Rechte.

import { suite, assert } from './harness.js';
import { rpcCall, asUser, upsertSchedule } from '../assets/js/tipp/pg.js';
import { resultsFromSources } from '../assets/js/tipp/sync.js';
import { rankTable, months, progression, monthKey } from '../assets/js/tipp/ranking.js';

export default async function scoringTests({ PGlite, readText }) {
  const t = suite('Auswertung: Punkte und Ranglisten');
  let db;
  const U = {};
  let G;
  const now = Date.now();
  const at = h => new Date(now + h * 3600e3).toISOString();
  const call = (who, fn, args) => rpcCall(db, who ? U[who] : null, fn, args);
  const D = Array.from({ length: 20 }, (_, i) => `d${i + 1}`);
  // Rennresultat: d1 … d20 in dieser Reihenfolge
  const RES = { quali: D.slice(), race: D.slice(), fastest: 'd5', dnf: ['d19', 'd20'], firstDnf: ['d20'], sc: 2 };
  const score = async (kind, picks, res = RES, preset = 'standard', dotd = null) =>
    (await db.query('select public.score_kind($1, $2, $3, public.points_preset($4), $5) as r',
      [kind, JSON.stringify(picks), res && JSON.stringify(res), preset, dotd])).rows[0].r;
  const keys = r => r.items.map(i => `${i.k}${i.s ? '@' + i.s : ''}:${i.p}`).join(' ');

  t('Datenbank vorbereiten', async () => {
    db = await PGlite.create();
    const [compat, schema] = await Promise.all([readText('supabase/dev/compat.sql'), readText('supabase/01_tippspiel.sql')]);
    await db.exec(compat);
    await db.exec(schema);
    const ev = (id, round, q, r) => ({ id, season: 2026, round, name: `GP ${round}`, circuit_id: 'c' + round, country: 'X',
      quali_start: at(q), sprint_quali_start: null, sprint_start: null, race_start: at(r) });
    await upsertSchedule(db, [ev('2026-15', 15, -400, -380), ev('2026-16', 16, -50, -26), ev('2026-17', 17, 30, 50)],
      D.map((id, i) => ({ season: 2026, driver_id: id, code: id.toUpperCase(), given_name: 'F', family_name: 'Nr' + (i + 1), team_id: 't' + i, number: String(i + 1), active: true })));
    for (const name of ['anna', 'ben', 'cleo', 'dave', 'eve']) {
      U[name] = (await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
        [name + '@test.local', JSON.stringify({ display_name: name[0].toUpperCase() + name.slice(1) })])).rows[0].id;
    }
  });

  // --- Punkte pro Tipp (reine Funktion) -------------------------------------
  t('Qualifying: Pole, exakt, im Top 3, Bonus', async () => {
    let r = await score('quali', { order: ['d1', 'd2', 'd3'] });
    assert.equal(keys(r), 'pole@1:4 exact@2:3 exact@3:3 bonus:3');
    assert.equal(r.points, 13);
    assert.equal(r.exact, 3);
    r = await score('quali', { order: ['d2', 'd1', 'd9'] });
    assert.equal(keys(r), 'inTop@1:1 inTop@2:1', 'vertauscht = je 1 Punkt, d9 nichts');
    r = await score('quali', { order: ['d1'] });
    assert.equal(r.points, 4, 'nur Pole getippt');
  });

  t('Rennen: Podium, Top 10, Boni', async () => {
    let r = await score('race', { order: D.slice(0, 10) });
    assert.equal(r.points, 3 * 5 + 7 * 2 + 5 + 10, 'alles exakt: ' + keys(r));
    r = await score('race', { order: ['d2', 'd1', 'd3', 'd5', 'd4', 'd15'] });
    assert.equal(keys(r), 'podiumIn@1:2 podiumIn@2:2 podium@3:5 inTop@4:1 inTop@5:1');
    r = await score('race', { order: ['d4', 'd2', 'd3'] });
    assert.equal(keys(r), 'inTop@1:1 podium@2:5 podium@3:5', 'Podiumstipp in Top 10 = 1 Punkt, kein Podiumsbonus');
  });

  t('Profi: «einen Platz daneben» und höhere Werte', async () => {
    const r = await score('race', { order: ['d1', 'd2', 'd3', 'd5', 'd4', 'd7'] }, RES, 'profi');
    assert.equal(keys(r), 'podium@1:6 podium@2:6 podium@3:6 near@4:2 near@5:2 near@6:2 bonusPodium:5');
  });

  t('Einfach: nur Pole, Podium und schnellste Runde zählen', async () => {
    const q = await score('quali', { order: ['d1', 'd2', 'd3'] }, RES, 'einfach');
    assert.equal(keys(q), 'pole@1:3');
    const r = await score('race', { order: D.slice(0, 10) }, RES, 'einfach');
    assert.equal(keys(r), 'podium@1:3 podium@2:3 podium@3:3 bonusPodium:3');
    const x = await score('extras', { fastest: 'd5', sc: 2, dnf: 2 }, RES, 'einfach');
    assert.equal(keys(x), 'fastest:2');
  });

  t('Zusatztipps: SC, Ausfälle, erster Ausfall, Fahrer des Tages', async () => {
    let r = await score('extras', { fastest: 'd5', sc: 2, dnf: 2, firstDnf: 'd20', dotd: 'd3' }, RES, 'standard', 'd3');
    assert.equal(keys(r), 'fastest:2 dotd:2 scYes:1 sc:2 dnf:3 firstDnf:3');
    assert.equal(r.exact, 5);
    r = await score('extras', { sc: 1, dnf: 3 });
    assert.equal(keys(r), 'scYes:1 dnfNear:1', 'SC ja richtig, Anzahl falsch; Ausfälle ±1');
    r = await score('extras', { sc: 0 });
    assert.equal(r.points, 0, 'SC nein, es gab aber 2');
    r = await score('extras', { sc: 4 }, { ...RES, sc: 6 });
    assert.equal(keys(r), 'scYes:1 sc:2', '4 = vier oder mehr');
    r = await score('extras', { dotd: 'd3', sc: 1 }, { race: D, dnf: [], firstDnf: [] });
    assert.deepEqual(r.open, ['dotd', 'sc'], 'ohne Fahrer des Tages und SC-Daten noch offen');
    r = await score('extras', { dnf: 0 }, { race: D, dnf: [], firstDnf: [] });
    assert.equal(keys(r), 'dnf:3', 'kein Ausfall richtig getippt');
  });

  t('Ohne Resultat keine Punkte (offen statt 0)', async () => {
    assert.equal(await score('race', { order: ['d1', 'd2', 'd3'] }, { quali: D }), null);
    assert.equal(await score('extras', { sc: 1 }, { quali: D }), null);
    assert.equal(await score('quali', { order: ['d1'] }, null), null);
  });

  // --- Resultat aus Jolpica/OpenF1 -------------------------------------------
  t('Resultat: Ausfälle, erster Ausfall, DSQ, Safety Car', () => {
    const row = (pos, id, status, laps, text = String(pos), fl) => ({ position: String(pos), positionText: text, status, laps: String(laps),
      Driver: { driverId: id }, ...(fl ? { FastestLap: { rank: '1' } } : {}) });
    const race = { Results: [
      row(1, 'a', 'Finished', 57), row(2, 'b', 'Finished', 57, '2', true), row(3, 'c', '+1 Lap', 56), row(4, 'd', 'Lapped', 56),
      row(5, 'e', 'Finished', 57), row(6, 'f', 'Finished', 57), row(7, 'g', 'Finished', 57), row(8, 'h', 'Finished', 57),
      row(9, 'i', 'Retired', 54),                  // gewertet, aber ausgefallen
      row(10, 'j', 'Retired', 3, 'R'), row(11, 'k', 'Collision', 3, 'R'),
      row(12, 'l', 'Disqualified', 57, 'D'), row(13, 'm', 'Did not start', 0, 'W'),
    ] };
    const quali = { QualifyingResults: 'abcdefghijklm'.split('').map((id, i) => ({ position: String(13 - i), Driver: { driverId: id } })) };
    const rc = [{ message: 'SAFETY CAR DEPLOYED' }, { message: 'VSC DEPLOYED' }, { message: 'SAFETY CAR IN THIS LAP' }, { message: 'SAFETY CAR DEPLOYED' }];
    const r = resultsFromSources({ race, quali, raceControl: rc });
    assert.deepEqual(r.race.slice(0, 3), ['a', 'b', 'c']);
    assert.equal(r.quali[0], 'm', 'Quali nach Position sortiert');
    assert.equal(r.fastest, 'b');
    assert.deepEqual(r.dnf, ['i', 'j', 'k']);
    assert.deepEqual(r.firstDnf, ['j', 'k'], 'Gleichstand: beide');
    assert.deepEqual(r.dsq, ['l']);
    assert.equal(r.sc, 2, 'nur echte SC-Phasen');
    assert.equal(resultsFromSources({ race, raceControl: null }).sc, undefined, 'OpenF1 nicht erreichbar → SC offen');
    assert.equal(resultsFromSources({}), null);
  });

  // --- Ranglisten ------------------------------------------------------------
  t('Rangliste: Punkte, dann exakte Treffer, dann Siege, sonst geteilt', () => {
    const data = {
      events: [{ id: 'e1', scored: true, race_start: '2026-10-25T20:00:00Z' }, { id: 'e2', scored: true, race_start: '2026-11-22T04:00:00Z' }],
      members: ['A', 'B', 'C', 'D'].map(n => ({ user_id: n, name: n })),
      scores: [
        { user_id: 'A', event_id: 'e1', points: 10, exact: 2 }, { user_id: 'A', event_id: 'e2', points: 5, exact: 1 },
        { user_id: 'B', event_id: 'e1', points: 5, exact: 3 }, { user_id: 'B', event_id: 'e2', points: 10, exact: 0 },
        { user_id: 'C', event_id: 'e1', points: 8, exact: 3 }, { user_id: 'C', event_id: 'e2', points: 7, exact: 0 },
      ],
      adjustments: [{ user_id: 'D', event_id: null, points: 3 }],
    };
    const tab = rankTable(data);
    assert.deepEqual(tab.map(r => `${r.rank}${r.name}${r.points}`), ['1A15', '1B15', '3C15', '4D3']);
    assert.ok(tab[0].shared && tab[1].shared && !tab[2].shared, 'A und B teilen Platz 1');
    const nov = rankTable(data, new Set(['e2']));
    assert.equal(nov[0].name, 'B');
    assert.equal(nov.find(r => r.name === 'D').points, 0, 'Korrektur ohne Wochenende nur in der Saison');
    assert.deepEqual(months(data).map(m => m.key), ['2026-10', '2026-11']);
    assert.equal(monthKey('2026-11-01T22:30:00Z'), '2026-11', 'Zürcher Zeit');
    assert.equal(monthKey('2026-10-31T22:30:00Z'), '2026-10', '23:30 in Zürich ist noch Oktober');
    assert.deepEqual(progression(data).find(p => p.user_id === 'D').points, [0, 3]);
  });

  // --- Ablauf in der Datenbank -----------------------------------------------
  t('Resultat eintragen → Punkte für alle (inkl. Aussenseiter-Bonus)', async () => {
    G = (await call('anna', 'create_group', { p_name: 'Testliga' })).id;
    const code = (await call('anna', 'group_detail', { p_group: G })).invite_code;
    for (const n of ['ben', 'cleo', 'dave']) await call(n, 'join_group', { p_code: code });
    // Tipps (direkt, als wären sie vor dem Tippschluss abgegeben worden)
    const tip = (u, kind, picks) => db.query('insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, $3, $4, $5)',
      [G, U[u], '2026-16', kind, JSON.stringify(picks)]);
    await tip('anna', 'race', { order: ['d1', 'd2', 'd3'] });
    await tip('ben', 'race', { order: ['d1', 'd3', 'd2'] });
    await tip('cleo', 'race', { order: ['d2', 'd1', 'd4'] });
    await tip('dave', 'race', { order: ['d4', 'd5', 'd6'] });
    await tip('anna', 'extras', { fastest: 'd5' });
    let st = await call('anna', 'group_standings', { p_group: G });
    assert.equal(st.scores.length, 0, 'ohne Resultat keine Punkte');

    await db.query(`update public.events set results = $1 where id = '2026-16'`, [JSON.stringify(RES)]);
    const ev = (await db.query(`select results_hash, results_at from public.events where id = '2026-16'`)).rows[0];
    assert.ok(ev.results_hash && ev.results_at, 'Prüfsumme gesetzt');
    st = await call('anna', 'group_standings', { p_group: G });
    const pts = Object.fromEntries(st.scores.map(s => [Object.keys(U).find(k => U[k] === s.user_id), s.points]));
    // Anna: Podium exakt 3×5 + Bonus 5 = 20; P2/P3 hat sie allein exakt → je +2 (allein);
    //       P1 haben Anna und Ben (2 von 4 = 50 %) → kein Bonus; schnellste Runde 2 (+2 allein, aber nur 1 Tipper → kein Bonus)
    assert.equal(pts.anna, 20 + 2 + 2 + 2, 'Anna');
    // Ben: P1 exakt 5, d3/d2 vertauscht je 2 = 9
    assert.equal(pts.ben, 9, 'Ben');
    // Cleo: d2 und d1 vertauscht je 2, d4 im Top 10: 1 = 5
    assert.equal(pts.cleo, 5, 'Cleo');
    // Dave: alle drei im Top 10, aber nicht auf dem Podium = 3
    assert.equal(pts.dave, 3, 'Dave');
    const ge = await call('ben', 'group_event', { p_group: G, p_event: '2026-16' });
    const anna = ge.scores.find(s => s.user_id === U.anna);
    assert.ok(anna.detail.race.items.some(i => i.k === 'outsider' && i.alone), 'Aufschlüsselung mit Aussenseiter-Bonus');
    assert.ok(ge.results.race, 'Resultat in der Übersicht');
  });

  t('Strafe nach dem Rennen: Resultat ändert sich → neu berechnet', async () => {
    const changed = { ...RES, race: ['d2', 'd1', ...D.slice(2)] };   // d1 bekommt eine Strafe
    await db.query(`update public.events set results = $1 where id = '2026-16'`, [JSON.stringify(changed)]);
    const st = await call('anna', 'group_standings', { p_group: G });
    const cleo = st.scores.find(s => s.user_id === U.cleo);
    assert.ok(cleo.points > 5, 'Cleo hat jetzt P1 und P2 richtig: ' + cleo.points);
    // gleiches Resultat nochmals schreiben: keine Änderung der Prüfsumme
    const h1 = (await db.query(`select results_hash from public.events where id = '2026-16'`)).rows[0].results_hash;
    await db.query(`update public.events set results = $1, name = 'GP 16' where id = '2026-16'`, [JSON.stringify(changed)]);
    const h2 = (await db.query(`select results_hash from public.events where id = '2026-16'`)).rows[0].results_hash;
    assert.equal(h1, h2);
    await db.query(`update public.events set results = $1 where id = '2026-16'`, [JSON.stringify(RES)]);
  });

  t('Fahrer des Tages: nur Admin, zählt sofort', async () => {
    await db.query(`insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, '2026-16', 'extras', '{"dotd":"d7"}')`, [G, U.ben]);
    await db.query(`update public.events set results = results || '{"x":1}' where id = '2026-16'`);  // neu auswerten
    const before = (await call('ben', 'group_standings', { p_group: G })).scores.find(s => s.user_id === U.ben).points;
    await assert.rejects(() => call('ben', 'set_dotd', { p_group: G, p_event: '2026-16', p_driver: 'd7' }), /Nur Admins/);
    await assert.rejects(() => call('anna', 'set_dotd', { p_group: G, p_event: '2026-17', p_driver: 'd7' }), /nach dem Rennen/);
    await call('anna', 'set_dotd', { p_group: G, p_event: '2026-16', p_driver: 'd7' });
    const after = (await call('ben', 'group_standings', { p_group: G })).scores.find(s => s.user_id === U.ben).points;
    assert.equal(after - before, 2, 'Fahrer des Tages +2 (kein Aussenseiter-Bonus bei nur 2 Tippern)');
  });

  t('Korrekturen: nur Admin, mit Begründung, für alle sichtbar', async () => {
    await assert.rejects(() => call('ben', 'add_adjustment', { p_group: G, p_user: U.ben, p_points: 50, p_reason: 'weil ich es kann' }), /Nur Admins/);
    await assert.rejects(() => call('anna', 'add_adjustment', { p_group: G, p_user: U.ben, p_points: 5, p_reason: '' }), /Begründung/);
    await assert.rejects(() => call('anna', 'add_adjustment', { p_group: G, p_user: U.eve, p_points: 5, p_reason: 'Test' }), /nicht in der Gruppe/);
    const { id } = await call('anna', 'add_adjustment', { p_group: G, p_user: U.dave, p_points: -2, p_reason: 'Tipp zu spät per WhatsApp', p_event: '2026-16' });
    let st = await call('cleo', 'group_standings', { p_group: G });
    assert.equal(st.adjustments.length, 1);
    assert.equal(st.adjustments[0].by, 'Anna');
    assert.equal(rankTable(st).find(r => r.user_id === U.dave).adjust, -2);
    await assert.rejects(() => asUser(db, U.anna, `insert into public.scores (group_id, user_id, event_id, points) values ($1, $2, '2026-16', 99)`, [G, U.anna]), /permission denied/);
    await assert.rejects(() => asUser(db, U.anna, `update public.adjustments set points = 99`), /permission denied/);
    await call('anna', 'delete_adjustment', { p_group: G, p_id: id });
    st = await call('cleo', 'group_standings', { p_group: G });
    assert.equal(st.adjustments.length, 0);
  });

  t('Punktesystem wechseln: alles wird neu berechnet', async () => {
    const before = (await call('anna', 'group_standings', { p_group: G })).scores.find(s => s.user_id === U.anna).points;
    await call('anna', 'update_group', { p_group: G, p_settings: { preset: 'einfach' } });
    const after = (await call('anna', 'group_standings', { p_group: G })).scores.find(s => s.user_id === U.anna).points;
    assert.equal(after, 3 * 3 + 3 + 2, 'Einfach: Podium 3×3 + Bonus 3 + schnellste Runde 2');
    assert.ok(before !== after);
    await call('anna', 'update_group', { p_group: G, p_settings: { preset: 'standard' } });
  });

  t('Übernommene Tipps zählen, verdeckte Funktionen sind gesperrt', async () => {
    // Eve tritt bei, tippt nie: kein übernommener Tipp → keine Punkte
    await call('eve', 'join_group', { p_code: (await call('anna', 'group_detail', { p_group: G })).invite_code });
    // Dave hatte beim Rennen davor getippt → wird beim nächsten übernommen
    await db.query(`insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, '2026-15', 'quali', '{"order":["d1","d2","d3"]}')`, [G, U.dave]);
    await db.query(`update public.events set results = results || '{"y":1}' where id = '2026-16'`);
    const ge = await call('anna', 'group_event', { p_group: G, p_event: '2026-16' });
    const dave = ge.scores.find(s => s.user_id === U.dave);
    assert.equal(dave.detail.quali.points, 13, 'übernommener Quali-Tipp gewertet');
    assert.ok(!ge.scores.some(s => s.user_id === U.eve), 'Eve ohne Tipp: keine Punkte');
    await assert.rejects(() => call('anna', 'effective_tips', { p_group: G, p_event: '2026-17' }), /permission denied/);
    await assert.rejects(() => call('anna', 'score_event', { p_event: '2026-16' }), /permission denied/);
  });

  t('Absage: Punkte des Wochenendes fallen weg', async () => {
    await db.query(`update public.events set status = 'cancelled' where id = '2026-16'`);
    let st = await call('anna', 'group_standings', { p_group: G });
    assert.equal(st.scores.length, 0);
    await db.query(`update public.events set status = 'scheduled' where id = '2026-16'`);
    st = await call('anna', 'group_standings', { p_group: G });
    assert.ok(st.scores.length >= 4, 'nach Rücknahme wieder da');
  });

  t('Mitglied entfernt: seine Punkte verschwinden mit', async () => {
    await call('anna', 'remove_member', { p_group: G, p_user: U.dave });
    const n = (await db.query('select count(*)::int n from public.scores where group_id = $1 and user_id = $2', [G, U.dave])).rows[0].n;
    assert.equal(n, 0);
  });

  return t;
}
