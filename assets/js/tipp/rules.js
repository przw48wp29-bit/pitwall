// Tippspiel-Regeln, die Browser und Tests teilen. Verbindlich ist immer die
// Datenbank (supabase/01_tippspiel.sql); diese Funktionen spiegeln sie nur,
// damit die Seite schon vor dem Speichern sagen kann, was geht.

export const KINDS = ['quali', 'sprint', 'race', 'extras'];
export const KIND_LABEL = { quali: 'Qualifying', sprint: 'Sprint', race: 'Rennen', extras: 'Zusatztipps' };
export const KIND_HINT = {
  quali: 'Pole und Top 3 in der richtigen Reihenfolge',
  sprint: 'Podium des Sprints',
  race: 'Top 10 im Ziel, P1–P3 ist dein Podium',
  extras: 'Schnellste Runde, Fahrer des Tages, Safety Car, Ausfälle',
};
export const SLOTS = { quali: 3, sprint: 3, race: 10 };
export const MIN_SLOTS = { quali: 1, sprint: 3, race: 3 };
export const slotLabel = (kind, i) => (kind === 'quali' && i === 0 ? 'Pole' : `P${i + 1}`);

export const EXTRAS = {
  fastest: { label: 'Schnellste Runde', type: 'driver' },
  dotd: { label: 'Fahrer des Tages', type: 'driver', note: 'Fan-Wahl auf F1.com, trägt der Admin nach dem Rennen ein' },
  sc: { label: 'Safety-Car-Einsätze', type: 'count', options: [0, 1, 2, 3, 4], fmt: n => (n === 0 ? 'Keins' : n === 4 ? '4+' : String(n)), note: 'Nur echtes Safety Car, das virtuelle (VSC) zählt nicht' },
  dnf: { label: 'Ausfälle', type: 'count', options: [0, 1, 2, 3, 4, 5, 6], fmt: n => (n === 6 ? '6+' : String(n)), note: 'Im Rennen ausgeschieden (auch wenn noch gewertet). Nicht gestartet und Disqualifikationen zählen nicht.' },
  firstDnf: { label: 'Erster Ausfall', type: 'driver', note: 'Wer die wenigsten Runden fährt. Bei Gleichstand zählen alle.' },
};

export const PRESETS = {
  einfach: { label: 'Einfach', text: 'Pole, Podium und schnellste Runde. Ideal für Gelegenheits-Tipper.' },
  standard: { label: 'Standard', text: 'Alle Tipps mit Teilpunkten, Boni und Aussenseiter-Bonus.' },
  profi: { label: 'Profi', text: 'Wie Standard, aber «knapp daneben» gibt auch Punkte. Mehr Risiko, mehr Ehre.' },
};

// Bezeichnungen der Punkte-Posten (Schlüssel wie in public.points_preset / score_kind).
export const ITEM_LABEL = {
  pole: 'Pole exakt', exact: 'exakt', inTop: 'falscher Platz',
  podium: 'Podium exakt', podiumIn: 'Podium, falscher Platz', near: 'einen Platz daneben',
  bonus: 'Bonus: alles exakt', bonusPodium: 'Bonus: Podium komplett exakt', bonusTop10: 'Bonus: Top 10 komplett exakt',
  fastest: 'Schnellste Runde', dotd: 'Fahrer des Tages', scYes: 'Safety Car ja/nein richtig', sc: 'Safety-Car-Anzahl exakt',
  dnf: 'Ausfälle exakt', dnfNear: 'Ausfälle ±1', firstDnf: 'Erster Ausfall', outsider: 'Aussenseiter-Bonus',
};

// Punktetabelle einer Gruppe zum Anzeigen: [[Tipp, Punkte-Text], …] (0 = zählt nicht).
export function pointsRows(p) {
  if (!p) return [];
  const v = (n, txt) => (n ? `${n} ${txt || ''}`.trim() : null);
  const rows = [
    ['Pole', v(p.quali.pole)],
    ['Quali P2/P3 exakt · in den Top 3', [v(p.quali.exact), v(p.quali.inTop)].filter(Boolean).join(' · ') || null],
    ['Quali komplett exakt', v(p.quali.bonus, 'Bonus')],
    ['Rennen P1–P3 exakt · auf dem Podium', [v(p.race.podium), v(p.race.podiumIn)].filter(Boolean).join(' · ') || null],
    ['Rennen P4–P10 exakt · einen Platz daneben · in den Top 10', [v(p.race.exact), v(p.race.near), v(p.race.inTop)].filter(Boolean).join(' · ') || null],
    ['Podium komplett · Top 10 komplett', [v(p.race.bonusPodium, 'Bonus'), v(p.race.bonusTop10, 'Bonus')].filter(Boolean).join(' · ') || null],
    ['Sprint-Podium exakt · auf dem Podium', [v(p.sprint.exact), v(p.sprint.inTop)].filter(Boolean).join(' · ') || null],
    ['Schnellste Runde · Fahrer des Tages', [v(p.extras.fastest), v(p.extras.dotd)].filter(Boolean).join(' · ') || null],
    ['Safety Car ja/nein · Anzahl exakt', [v(p.extras.scYes), v(p.extras.sc)].filter(Boolean).join(' · ') || null],
    ['Ausfälle exakt · ±1 · erster Ausfall', [v(p.extras.dnf), v(p.extras.dnfNear), v(p.extras.firstDnf)].filter(Boolean).join(' · ') || null],
    ['Aussenseiter (≤ 25 % der Tipper · als Einziger)', p.outsider.few ? `+${p.outsider.few} · +${p.outsider.alone}` : null],
  ];
  return rows.map(([a, b]) => [a, b || 'zählt nicht']);
}

export const DEFAULT_SETTINGS = { preset: 'standard', lock: 'early', missing: 'carry', jokers: 3 };
export const LOCK_LABEL = {
  early: 'Früh: alles schliesst beim Qualifying-Start',
  late: 'Spät: Renn- und Sprint-Tipps erst beim Start',
};
export const MISSING_LABEL = {
  carry: 'Letzten Tipp übernehmen',
  zero: 'Kein Tipp, keine Punkte',
};

// Tippschluss wie in public.lock_time() (Datenbank).
export function lockTime(ev, settings = DEFAULT_SETTINGS, kind) {
  const late = (settings?.lock || 'early') === 'late';
  const t = v => (v ? new Date(v) : null);
  switch (kind) {
    case 'quali': return t(ev.quali_start);
    case 'sprint': return late ? t(ev.sprint_start) : t(ev.sprint_quali_start || ev.sprint_start);
    case 'race':
    case 'extras': return late ? t(ev.race_start) : t(ev.quali_start);
    default: return null;
  }
}

export function kindsFor(ev) {
  return KINDS.filter(k => k !== 'sprint' || ev.sprint_start);
}

// Prüft einen Tipp wie der Datenbank-Trigger. Gibt eine Fehlermeldung oder null zurück.
export function validatePicks(kind, picks, allowed) {
  const ok = id => !allowed || allowed.has(id);
  if (kind === 'extras') {
    const p = picks || {};
    const keys = Object.keys(p).filter(k => p[k] != null);
    if (!keys.length) return 'Leerer Zusatztipp.';
    for (const k of ['fastest', 'dotd', 'firstDnf']) if (p[k] != null && !ok(p[k])) return 'Ungültiger Fahrer im Zusatztipp.';
    if (p.sc != null && !EXTRAS.sc.options.includes(p.sc)) return 'Safety Car: 0 bis 4.';
    if (p.dnf != null && !EXTRAS.dnf.options.includes(p.dnf)) return 'Ausfälle: 0 bis 6.';
    if (p.dnf === 0 && p.firstDnf) return 'Ohne Ausfall gibt es keinen ersten Ausfall.';
    return null;
  }
  const order = picks?.order || [];
  if (order.length < MIN_SLOTS[kind] || order.length > SLOTS[kind]) return `Bitte ${MIN_SLOTS[kind]} bis ${SLOTS[kind]} Fahrer wählen.`;
  if (order.some(x => !x)) return 'Bitte jeden Platz mit einem Fahrer besetzen.';
  if (new Set(order).size !== order.length) return 'Jeder Fahrer darf nur einmal vorkommen.';
  const bad = order.find(x => !ok(x));
  if (bad) return `Fahrer «${bad}» ist an diesem Wochenende nicht wählbar.`;
  return null;
}

// Entwurf (Plätze mit Lücken) in einen speicherbaren Tipp verwandeln:
// Lücken am Ende fallen weg, Lücken mittendrin sind ein Fehler.
export function draftToPicks(kind, draft) {
  if (kind === 'extras') {
    const out = {};
    for (const k of Object.keys(EXTRAS)) if (draft?.[k] != null) out[k] = draft[k];
    return Object.keys(out).length ? out : null;
  }
  const arr = [...(draft || [])];
  while (arr.length && !arr.at(-1)) arr.pop();
  return arr.length ? { order: arr } : null;
}

// Vergleich unabhängig von der Reihenfolge der Schlüssel (jsonb sortiert sie um).
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
export const samePicks = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
