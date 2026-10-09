// Aufruf der Datenbank-Funktionen in PGlite so, wie Supabase es tut:
// als Rolle "authenticated" (bzw. "anon") mit der Benutzer-ID im JWT.
// Genutzt vom Demo-Modus und von den Tests.

// Datentypen der Funktions-Parameter (PGlite braucht sie für eindeutige Aufrufe).
const TYPES = {
  p_group: 'uuid', p_user: 'uuid', p_groups: 'uuid[]', p_season: 'int', p_points: 'int', p_id: 'bigint',
  p_settings: 'jsonb', p_avatar: 'jsonb', p_picks: 'jsonb',
};

const toParam = (k, v) => {
  if (v == null) return null;
  if (TYPES[k] === 'jsonb') return JSON.stringify(v);
  if (TYPES[k] === 'uuid[]') return `{${v.join(',')}}`;
  return v;
};

export async function rpcCall(db, uid, fn, args = {}) {
  if (!/^[a-z_]+$/.test(fn)) throw new Error('Ungültige Funktion');
  const keys = Object.keys(args).filter(k => args[k] !== undefined);
  keys.forEach(k => { if (!/^p_[a-z_]+$/.test(k)) throw new Error('Ungültiger Parameter ' + k); });
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}::${TYPES[k] || 'text'}`).join(', ')}) as r`;
  try {
    return await db.transaction(async tx => {
      await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
      const res = await tx.query(sql, keys.map(k => toParam(k, args[k])));
      return res.rows[0]?.r ?? null;
    });
  } catch (e) {
    throw new Error(e.message || String(e));
  }
}

// Direkter SQL-Zugriff als bestimmter Benutzer (für Tests der Zugriffsregeln).
export async function asUser(db, uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' })]);
    return (await tx.query(sql, params)).rows;
  });
}

export async function upsertSchedule(db, events, drivers) {
  await db.transaction(async tx => {
    for (const e of events) {
      await tx.query(`insert into public.events (id, season, round, name, circuit_id, country, quali_start, sprint_quali_start, sprint_start, race_start)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (id) do update set name = excluded.name, circuit_id = excluded.circuit_id, country = excluded.country,
          quali_start = excluded.quali_start, sprint_quali_start = excluded.sprint_quali_start, sprint_start = excluded.sprint_start,
          race_start = excluded.race_start, status = 'scheduled', updated_at = now()`,
      [e.id, e.season, e.round, e.name, e.circuit_id, e.country, e.quali_start, e.sprint_quali_start, e.sprint_start, e.race_start]);
    }
    for (const d of drivers) {
      await tx.query(`insert into public.season_drivers (season, driver_id, code, given_name, family_name, team_id, number, active)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (season, driver_id) do update set code = excluded.code, given_name = excluded.given_name, family_name = excluded.family_name,
          team_id = excluded.team_id, number = excluded.number, active = excluded.active`,
      [d.season, d.driver_id, d.code, d.given_name, d.family_name, d.team_id, d.number, d.active]);
    }
  });
}
