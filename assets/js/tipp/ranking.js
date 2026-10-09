// Ranglisten aus den Daten von group_standings (supabase/01_tippspiel.sql).
// Reine Funktionen, getestet in tests/ranking.test.js.
//
// Reihenfolge: mehr Punkte → mehr exakte Treffer → mehr Wochenendsiege
// (meiste Punkte der Gruppe an einem Wochenende, geteilte Siege zählen) →
// sonst geteilter Platz.

// Monat eines Rennens in Zürcher Zeit, z. B. '2026-11'.
export function monthKey(iso) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit' }).formatToParts(new Date(iso));
  return `${p.find(x => x.type === 'year').value}-${p.find(x => x.type === 'month').value}`;
}

export const monthLabel = key => new Intl.DateTimeFormat('de-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  .format(new Date(`${key}-15T12:00:00Z`));

// Ausgewertete Wochenenden (in Kalender-Reihenfolge).
export const scoredEvents = data => (data.events || []).filter(e => e.scored);

// Rangliste für eine Auswahl von Wochenenden.
//   eventIds: Set der Wochenenden (null = ganze Saison)
//   Korrekturen ohne Wochenende zählen nur in der Saisonansicht.
export function rankTable(data, eventIds = null) {
  const inScope = id => eventIds ? eventIds.has(id) : true;
  const scores = (data.scores || []).filter(s => inScope(s.event_id));
  const adj = (data.adjustments || []).filter(a => a.event_id ? inScope(a.event_id) : !eventIds);

  const best = new Map();
  for (const s of scores) best.set(s.event_id, Math.max(best.get(s.event_id) ?? -Infinity, s.points));

  const rows = (data.members || []).map(m => {
    const mine = scores.filter(s => s.user_id === m.user_id);
    const corr = adj.filter(a => a.user_id === m.user_id).reduce((n, a) => n + a.points, 0);
    return {
      ...m,
      points: mine.reduce((n, s) => n + s.points, 0) + corr,
      exact: mine.reduce((n, s) => n + s.exact, 0),
      wins: mine.filter(s => s.points > 0 && s.points === best.get(s.event_id)).length,
      played: mine.length,
      adjust: corr,
    };
  });

  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || b.wins - a.wins
    || String(a.name).localeCompare(String(b.name), 'de'));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.exact === r.exact && prev.wins === r.wins ? prev.rank : i + 1;
    r.shared = false;
  });
  rows.forEach(r => { r.shared = rows.filter(x => x.rank === r.rank).length > 1; });
  return rows;
}

// Monate mit ausgewerteten Wochenenden: [{ key, label, ids:Set }]
export function months(data) {
  const map = new Map();
  for (const e of scoredEvents(data)) {
    const k = monthKey(e.race_start);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(e.id);
  }
  return [...map].map(([key, ids]) => ({ key, label: monthLabel(key), ids }));
}

// Punkteverlauf: kumulierte Punkte pro Spieler nach jedem ausgewerteten Wochenende
// (Korrekturen beim zugehörigen Wochenende, solche ohne Wochenende am Schluss).
export function progression(data) {
  const evs = scoredEvents(data);
  return (data.members || []).map(m => {
    let sum = 0;
    const points = evs.map(e => {
      sum += (data.scores || []).filter(s => s.user_id === m.user_id && s.event_id === e.id).reduce((n, s) => n + s.points, 0);
      sum += (data.adjustments || []).filter(a => a.user_id === m.user_id && a.event_id === e.id).reduce((n, a) => n + a.points, 0);
      return sum;
    });
    const loose = (data.adjustments || []).filter(a => a.user_id === m.user_id && !a.event_id).reduce((n, a) => n + a.points, 0);
    if (points.length && loose) points[points.length - 1] += loose;
    return { user_id: m.user_id, name: m.name, avatar: m.avatar, points };
  });
}
