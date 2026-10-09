// Tests der Datenbank-Regeln (supabase/01_tippspiel.sql) in einer echten
// PostgreSQL-Instanz (PGlite). Geprüft wird, was der Server erzwingen muss:
// Tippschluss, Sichtbarkeit, Rechte, Einladungen, Konto löschen.

import { suite, assert } from './harness.js';
import { rpcCall, asUser, upsertSchedule } from '../assets/js/tipp/pg.js';

export default async function dbTests({ PGlite, readText }) {
  const t = suite('Datenbank: Konten, Gruppen, Tipps');
  let db;
  const U = {};
  const G = {};
  const now = Date.now();
  const at = h => new Date(now + h * 3600e3).toISOString();
  const call = (who, fn, args) => rpcCall(db, who ? U[who] : null, fn, args);
  const D = Array.from({ length: 12 }, (_, i) => `d${i + 1}`);
  const order = n => ({ order: D.slice(0, n) });

  t('Schema lässt sich (auch mehrfach) einspielen', async () => {
    db = await PGlite.create();
    const [compat, schema] = await Promise.all([readText('supabase/dev/compat.sql'), readText('supabase/01_tippspiel.sql')]);
    await db.exec(compat);
    await db.exec(schema);
    await db.exec(schema);
    const ev = (id, round, q, r, sprint) => ({ id, season: 2026, round, name: `GP ${round}`, circuit_id: 'c' + round, country: 'X',
      quali_start: at(q), sprint_quali_start: sprint ? at(sprint[0]) : null, sprint_start: sprint ? at(sprint[1]) : null, race_start: at(r) });
    const drivers = D.map((id, i) => ({ season: 2026, driver_id: id, code: id.toUpperCase(), given_name: 'Fahrer', family_name: 'Nr' + (i + 1), team_id: 't' + Math.ceil((i + 1) / 2), number: String(i + 1), active: true }));
    drivers.push({ season: 2026, driver_id: 'old', code: 'OLD', given_name: 'Alt', family_name: 'Fahrer', team_id: 't1', number: '99', active: false });
    await upsertSchedule(db, [
      ev('2026-16', 16, -50, -26),
      ev('2026-17', 17, -1, 20, [-20, -3]),   // Quali läuft schon, Rennen morgen, Sprint vorbei
      ev('2026-18', 18, 48, 72),              // alles offen
    ], drivers);
    for (const name of ['anna', 'ben', 'cleo', 'dave']) {
      U[name] = (await db.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id', [name + '@test.local', JSON.stringify({ display_name: name[0].toUpperCase() + name.slice(1) })])).rows[0].id;
    }
  });

  t('Registrierung legt ein Profil mit Namen an', async () => {
    const p = await call('anna', 'my_profile');
    assert.equal(p.display_name, 'Anna');
  });

  t('Ohne Anmeldung: Kalender ja, Gruppen nein', async () => {
    const s = await call(null, 'season_data', {});
    assert.equal(s.events.length, 3);
    assert.equal(s.drivers.length, 13);
    await assert.rejects(() => call(null, 'my_groups'), /anmelden|permission denied/i);
    await assert.rejects(() => asUser(db, null, 'select * from public.profiles'), /permission denied/i);
  });

  t('Profil ändern prüft Name und Avatar', async () => {
    const p = await call('anna', 'update_profile', { p_name: '  Anna R.  ', p_avatar: { color: '#ff8000' } });
    assert.equal(p.display_name, 'Anna R.');
    await assert.rejects(() => call('anna', 'update_profile', { p_name: '' }), /1 bis 30/);
    await assert.rejects(() => call('anna', 'update_profile', { p_name: 'A', p_avatar: { color: 'red' } }), /Avatar/);
  });

  t('Gruppe erstellen: Ersteller ist Admin, Code hat 8 Zeichen', async () => {
    const r = await call('anna', 'create_group', { p_name: 'Bierrunde', p_settings: { preset: 'standard' } });
    G.main = r.id; G.code = r.invite_code;
    assert.ok(/^[A-Z2-9]{8}$/.test(r.invite_code), 'Code ' + r.invite_code);
    const mine = await call('anna', 'my_groups');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].role, 'admin');
    assert.equal(mine[0].settings.lock, 'early');
    await assert.rejects(() => call('anna', 'create_group', { p_name: 'X' }), /2 bis 40/);
    await assert.rejects(() => call('anna', 'create_group', { p_name: 'Gültig', p_settings: { lock: 'nie' } }), /Einstellungen/);
  });

  t('Einladung: Vorschau ohne Konto, Beitritt mit Code', async () => {
    const pv = await call(null, 'group_preview', { p_code: G.code.toLowerCase() });
    assert.equal(pv.name, 'Bierrunde');
    assert.equal(pv.members, 1);
    await call('ben', 'join_group', { p_code: G.code });
    await call('cleo', 'join_group', { p_code: ' ' + G.code + ' ' });
    await call('cleo', 'join_group', { p_code: G.code });   // doppelt ist harmlos
    const g = await call('ben', 'group_detail', { p_group: G.main });
    assert.equal(g.members.length, 3);
    assert.equal(g.role, 'member');
    await assert.rejects(() => call('dave', 'join_group', { p_code: 'FALSCH12' }), /ungültig/);
  });

  t('Gruppen sind privat: Nicht-Mitglieder sehen nichts', async () => {
    await assert.rejects(() => call('dave', 'group_detail', { p_group: G.main }), /nicht Mitglied/);
    assert.equal((await asUser(db, U.dave, 'select * from public.groups')).length, 0);
    assert.equal((await asUser(db, U.dave, 'select * from public.memberships')).length, 0);
    assert.equal((await asUser(db, U.dave, 'select * from public.profiles')).length, 1, 'nur das eigene Profil');
    assert.equal((await asUser(db, U.ben, 'select * from public.profiles')).length, 3, 'Profile der Gruppe');
  });

  t('Tipp vor dem Tippschluss: speichern und ändern', async () => {
    let r = await call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'race', p_picks: order(10), p_groups: [G.main] });
    assert.ok(r[0].ok, r[0].error);
    r = await call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'race', p_picks: { order: [...D.slice(0, 10)].reverse() }, p_groups: [G.main] });
    assert.ok(r[0].ok, r[0].error);
    r = await call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'quali', p_picks: order(1), p_groups: [G.main] });
    assert.ok(r[0].ok, 'nur Pole getippt: ' + r[0].error);
    const st = await call('ben', 'event_state', { p_event: '2026-18' });
    assert.equal(st.groups[0].tips.race.picks.order[0], 'd10');
    assert.equal(st.groups[0].open.race, true);
  });

  t('Ungültige Tipps lehnt die Datenbank ab', async () => {
    const bad = async (kind, picks, re, ev = '2026-18') => {
      const r = await call('ben', 'save_tips', { p_event: ev, p_kind: kind, p_picks: picks, p_groups: [G.main] });
      assert.equal(r[0].ok, false, JSON.stringify(picks));
      assert.ok(re.test(r[0].error), r[0].error);
    };
    await bad('race', { order: ['d1', 'd1', 'd2'] }, /nur einmal/);
    await bad('race', { order: ['d1', 'd2', 'old'] }, /nicht wählbar/);
    await bad('race', { order: [...D, 'x'].slice(0, 11) }, /3 bis 10/);
    await bad('race', { order: ['d1', null, 'd3'] }, /jeden Platz/);
    await assert.rejects(() => call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'sprint', p_picks: order(3), p_groups: [G.main] }), /keinen Sprint/);
    await assert.rejects(() => call('ben', 'save_tips', { p_event: '2099-01', p_kind: 'race', p_picks: order(3), p_groups: [G.main] }), /Unbekanntes/);
    await bad('extras', { sc: 7 }, /Safety Car/);
    await bad('extras', { dnf: 0, firstDnf: 'd1' }, /keinen ersten Ausfall/);
    await bad('extras', { foo: 1 }, /Unbekannter/);
    const ok = await call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'extras', p_picks: { fastest: 'd1', sc: 1, dnf: 2, firstDnf: 'd5', dotd: null }, p_groups: [G.main] });
    assert.ok(ok[0].ok, ok[0].error);
  });

  t('Niemand kann für andere tippen (auch nicht direkt)', async () => {
    await assert.rejects(() => asUser(db, U.ben, `insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, '2026-18', 'quali', '{"order":["d1"]}')`, [G.main, U.anna]), /row-level security/);
    await assert.rejects(() => asUser(db, U.dave, `insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, '2026-18', 'quali', '{"order":["d1"]}')`, [G.main, U.dave]), /row-level security|foreign key/);
    const r = await call('dave', 'save_tips', { p_event: '2026-18', p_kind: 'quali', p_picks: order(3), p_groups: [G.main] });
    assert.equal(r[0].ok, false);
    assert.ok(/nicht Mitglied/.test(r[0].error), r[0].error);
  });

  t('Vor dem Tippschluss: fremde Tipps verdeckt, nur «hat getippt»', async () => {
    const ge = await call('anna', 'group_event', { p_group: G.main, p_event: '2026-18' });
    assert.equal(ge.tips.length, 0, 'keine fremden Inhalte');
    assert.ok(ge.status.some(s => s.user_id === U.ben && s.kind === 'race'), 'Ben hat getippt');
    assert.equal((await asUser(db, U.anna, 'select * from public.tips')).length, 0);
    const own = await asUser(db, U.ben, 'select * from public.tips');
    assert.ok(own.length >= 3, 'eigene Tipps sichtbar');
  });

  t('Tippschluss wird erzwungen (Quali läuft schon)', async () => {
    // Cleo hatte vor dem Tippschluss getippt (direkt eingefügt = vor dem Start).
    await db.query(`insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, '2026-17', 'quali', '{"order":["d3","d1","d2"]}')`, [G.main, U.cleo]);
    for (const kind of ['quali', 'race', 'extras']) {
      const picks = kind === 'extras' ? { sc: 1 } : order(3);
      const r = await call('ben', 'save_tips', { p_event: '2026-17', p_kind: kind, p_picks: picks, p_groups: [G.main] });
      assert.equal(r[0].ok, false, kind + ' müsste gesperrt sein');
      assert.ok(/Tippschluss/.test(r[0].error), r[0].error);
    }
    // Direktes Ändern am Frontend vorbei: die Regel filtert die Zeile weg, nichts ändert sich.
    await asUser(db, U.cleo, `update public.tips set picks = '{"order":["d1","d2","d3"]}' where event_id = '2026-17'`);
    const row = (await db.query(`select picks from public.tips where event_id = '2026-17' and user_id = $1`, [U.cleo])).rows[0];
    assert.equal(row.picks.order[0], 'd3', 'Tipp trotz Tippschluss geändert');
    assert.equal((await asUser(db, U.cleo, `delete from public.tips where event_id = '2026-17' returning 1`)).length, 0, 'löschen gesperrt');
  });

  t('Nach dem Tippschluss: alle sehen die Tipps', async () => {
    const ge = await call('anna', 'group_event', { p_group: G.main, p_event: '2026-17' });
    const cleo = ge.tips.find(x => x.user_id === U.cleo && x.kind === 'quali');
    assert.ok(cleo, 'Cleos Quali-Tipp sichtbar');
    assert.equal(cleo.picks.order[0], 'd3');
    assert.equal((await asUser(db, U.anna, `select * from public.tips where event_id = '2026-17'`)).length, 1);
  });

  t('Tippschluss «spät»: Renn-Tipp bis zum Rennstart', async () => {
    await assert.rejects(() => call('ben', 'update_group', { p_group: G.main, p_settings: { lock: 'late' } }), /Nur Admins/);
    const g = await call('anna', 'update_group', { p_group: G.main, p_settings: { lock: 'late' } });
    assert.equal(g.settings.lock, 'late');
    let r = await call('ben', 'save_tips', { p_event: '2026-17', p_kind: 'race', p_picks: order(10), p_groups: [G.main] });
    assert.ok(r[0].ok, 'Rennen offen: ' + r[0].error);
    r = await call('ben', 'save_tips', { p_event: '2026-17', p_kind: 'sprint', p_picks: order(3), p_groups: [G.main] });
    assert.equal(r[0].ok, false, 'Sprint ist vorbei');
    r = await call('ben', 'save_tips', { p_event: '2026-17', p_kind: 'quali', p_picks: order(3), p_groups: [G.main] });
    assert.equal(r[0].ok, false, 'Quali bleibt gesperrt');
    // Offene Renn-Tipps bleiben für andere verdeckt
    const ge = await call('anna', 'group_event', { p_group: G.main, p_event: '2026-17' });
    assert.ok(!ge.tips.some(x => x.kind === 'race'), 'Renn-Tipp noch verdeckt');
    await call('anna', 'update_group', { p_group: G.main, p_settings: { lock: 'early' } });
  });

  t('Fehlende Tipps: letzten Tipp übernehmen oder leer lassen', async () => {
    // Ben hatte beim letzten Rennen die Quali getippt, beim aktuellen nicht.
    await db.query(`insert into public.tips (group_id, user_id, event_id, kind, picks) values ($1, $2, '2026-16', 'quali', '{"order":["d7","d8","d9"]}')`, [G.main, U.ben]);
    let ge = await call('anna', 'group_event', { p_group: G.main, p_event: '2026-17' });
    const auto = ge.tips.find(x => x.user_id === U.ben && x.kind === 'quali');
    assert.ok(auto, 'übernommener Tipp vorhanden');
    assert.equal(auto.source, 'auto');
    assert.equal(auto.picks.order[0], 'd7');
    assert.ok(!ge.tips.some(x => x.user_id === U.cleo && x.source === 'auto' && x.kind === 'quali'), 'Cleo hat selbst getippt');
    await call('anna', 'update_group', { p_group: G.main, p_settings: { missing: 'zero' } });
    ge = await call('anna', 'group_event', { p_group: G.main, p_event: '2026-17' });
    assert.ok(!ge.tips.some(x => x.source === 'auto'), 'keine Übernahme bei «0 Punkte»');
    await call('anna', 'update_group', { p_group: G.main, p_settings: { missing: 'carry' } });
  });

  t('Mehrere Gruppen: ein Tipp für alle, Rückmeldung pro Gruppe', async () => {
    G.second = (await call('anna', 'create_group', { p_name: 'Büro', p_settings: { lock: 'late' } })).id;
    const r = await call('anna', 'save_tips', { p_event: '2026-17', p_kind: 'race', p_picks: order(10), p_groups: [G.main, G.second] });
    assert.equal(r.find(x => x.group_id === G.main).ok, false, 'Bierrunde: früh → gesperrt');
    assert.equal(r.find(x => x.group_id === G.second).ok, true, 'Büro: spät → offen');
    const st = await call('anna', 'event_state', { p_event: '2026-18' });
    assert.equal(st.groups.length, 2);
  });

  t('Tipp löschen (vor dem Tippschluss)', async () => {
    const r = await call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'quali', p_picks: null, p_groups: [G.main] });
    assert.ok(r[0].ok);
    const st = await call('ben', 'event_state', { p_event: '2026-18' });
    assert.ok(!st.groups[0].tips.quali, 'Quali-Tipp gelöscht');
  });

  t('Abgesagtes Rennen: keine Tipps mehr möglich', async () => {
    await db.query(`update public.events set status = 'cancelled' where id = '2026-18'`);
    const r = await call('ben', 'save_tips', { p_event: '2026-18', p_kind: 'race', p_picks: order(10), p_groups: [G.main] });
    assert.equal(r[0].ok, false);
    await db.query(`update public.events set status = 'scheduled' where id = '2026-18'`);
  });

  t('Admin-Rechte: Rollen, Mitglieder entfernen, Code erneuern', async () => {
    await assert.rejects(() => call('ben', 'remove_member', { p_group: G.main, p_user: U.cleo }), /Nur Admins/);
    await assert.rejects(() => call('ben', 'regenerate_invite', { p_group: G.main }), /Nur Admins/);
    await assert.rejects(() => call('anna', 'set_member_role', { p_group: G.main, p_user: U.anna, p_role: 'member' }), /mindestens einen Admin/);
    const { invite_code } = await call('anna', 'regenerate_invite', { p_group: G.main });
    assert.ok(invite_code !== G.code, 'neuer Code');
    await assert.rejects(() => call('dave', 'join_group', { p_code: G.code }), /ungültig/, 'alter Code gilt nicht mehr');
    await call('anna', 'remove_member', { p_group: G.main, p_user: U.cleo });
    const left = (await db.query('select count(*)::int n from public.tips where group_id = $1 and user_id = $2', [G.main, U.cleo])).rows[0].n;
    assert.equal(left, 0, 'Tipps der entfernten Person gelöscht');
    await assert.rejects(() => call('cleo', 'group_detail', { p_group: G.main }), /nicht Mitglied/);
  });

  t('Letzter Admin tritt aus: ältestes Mitglied übernimmt', async () => {
    await call('anna', 'leave_group', { p_group: G.main });
    const g = await call('ben', 'group_detail', { p_group: G.main });
    assert.equal(g.role, 'admin');
    assert.equal(g.members.length, 1);
  });

  t('Konto löschen entfernt alle Daten', async () => {
    await call('ben', 'delete_account');
    const n = (await db.query(`select
        (select count(*) from auth.users where id = $1) +
        (select count(*) from public.profiles where id = $1) +
        (select count(*) from public.memberships where user_id = $1) +
        (select count(*) from public.tips where user_id = $1) as n`, [U.ben])).rows[0].n;
    assert.equal(+n, 0);
    assert.equal((await db.query('select count(*)::int n from public.groups where id = $1', [G.main])).rows[0].n, 0, 'leere Gruppe gelöscht');
    assert.equal((await db.query('select count(*)::int n from public.groups where id = $1', [G.second])).rows[0].n, 1, 'Annas zweite Gruppe bleibt');
  });

  t('Zeiten werden in UTC gespeichert', async () => {
    const r = (await db.query(`select to_char(race_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as utc from public.events where id = '2026-18'`)).rows[0];
    assert.equal(r.utc, at(72).slice(0, 16));
  });

  return t;
}
