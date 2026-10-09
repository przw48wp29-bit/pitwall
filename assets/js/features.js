// Zusatzfunktionen: Strategie, WM-Simulator, Fahrervergleich, Strafen, Strecken,
// Archiv, Tippspiel, Kalender-Export.

import { team, TEAMS, TV_CH } from './config.js';
import {
  loadCore, loadResults, loadEditorial, driverCareer, raceStrategy, champions, seasonArchive, circuitHistory,
} from './data.js';
import {
  esc, teamStyle, natFlag, countryFlag, fmtDate, fmtTime, fmtDay, fmtNum, toDate, sessionsOf, sessionEnd,
  weekendRange, raceShort, driverName, img, hydrateImages, tag, sourceLinks, empty,
} from './ui.js';
import { then, pageHead, sectionHead, tableOf, cardHead, tabs, now, nextRace, loadingBox } from './shared.js';
import { lineChart, stintChart, COMPOUND } from './charts.js';
import { seasonStats, headToHead, pointsProgression, classified } from './stats.js';

const RACE_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_PTS = [8, 7, 6, 5, 4, 3, 2, 1];
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };
const fmtLap = s => s == null ? '–' : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

// ======================================================================
// Strategie & Telemetrie (Teil der Rennseite)
// ======================================================================
export function strategyPane(core, race, kind = 'Race') {
  const id = 'strat' + race.round + kind;
  then(() => {
    const el = document.getElementById(id);
    if (!el) return;
    let loaded = false;
    const load = async () => {
      if (loaded) return; loaded = true;
      try {
        const d = await raceStrategy(core.season, race, kind);
        el.innerHTML = d ? renderStrategy(d, race, kind) : empty('Für diese Session gibt es noch keine Strategie-Daten.');
        bindStrategy(el, d);
      } catch (e) {
        el.innerHTML = e.locked || !e.status
          ? `<div class="notice">Während einer laufenden Session sperrt OpenF1 alle Daten. Die Strategie erscheint nach Session-Ende bzw. nach dem nächsten Tagesupdate.</div>`
          : `<div class="notice">Strategie-Daten nicht verfügbar (${esc(e.message)}).</div>`;
      }
    };
    // Erst laden, wenn der Tab sichtbar wird.
    const pane = el.closest('[data-tp]');
    if (!pane || !pane.hidden) load();
    else {
      const onShow = ev => {
        if (!document.contains(el)) { document.removeEventListener('tabshow', onShow); return; }
        if (ev.detail === pane.dataset.id) { document.removeEventListener('tabshow', onShow); load(); }
      };
      document.addEventListener('tabshow', onShow);
    }
  });
  return `<div id="${id}" class="card-pad">${loadingBox(260)}</div>`;
}

function finishOrder(d) {
  // Reihenfolge nach zurückgelegten Runden und Gesamtzeit
  return d.drivers.map(x => {
    const laps = d.laps[x.n] || [];
    const done = laps.filter(v => v != null).length;
    const time = laps.reduce((a, v) => a + (v || 0), 0);
    return { ...x, done, time };
  }).sort((a, b) => b.done - a.done || a.time - b.time);
}

// Positionen pro Runde: bevorzugt aus den offiziellen Positionsdaten (d.pos),
// sonst angenähert über die aufsummierten Rundenzeiten.
function positionsByLap(d) {
  if (d.pos && Object.keys(d.pos).length) return d.pos;
  const ns = d.drivers.map(x => x.n);
  const cum = Object.fromEntries(ns.map(n => [n, 0]));
  const pos = Object.fromEntries(ns.map(n => [n, []]));
  for (let i = 0; i < d.totalLaps; i++) {
    const vals = ns.map(n => d.laps[n]?.[i]).filter(v => v != null);
    const fill = vals.length ? Math.max(...vals) : 0;
    const running = ns.filter(n => (d.laps[n]?.length || 0) > i);
    for (const n of running) cum[n] += d.laps[n][i] ?? fill;
    running.sort((a, b) => cum[a] - cum[b]).forEach((n, k) => { pos[n][i] = i === 0 ? null : k + 1; });
    for (const n of ns) if (pos[n][i] === undefined) pos[n][i] = null;
  }
  return pos;
}

function renderStrategy(d, race, kind) {
  const fo = finishOrder(d);
  const rows = fo.map(x => ({ code: x.code, stints: d.stints.filter(s => s.n === x.n && s.start).sort((a, b) => a.start - b.start).map(s => ({ ...s, end: s.end || d.totalLaps })) })).filter(r => r.stints.length);
  // Standzeit, falls verfügbar – sonst die Zeit in der Boxengasse
  const stops = d.pits.filter(p => p.dur && p.dur > 1.5 && p.dur < 15);
  const useLane = !stops.length;
  const pits = (useLane ? d.pits.filter(p => p.lane && p.lane > 12 && p.lane < 45).map(p => ({ ...p, dur: p.lane })) : stops).sort((a, b) => a.dur - b.dur).slice(0, 10);
  const byN = Object.fromEntries(d.drivers.map(x => [x.n, x]));
  const legend = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].filter(c => d.stints.some(s => s.compound === c))
    .map(c => `<span class="legend-i"><i style="background:${COMPOUND[c]}"></i>${c[0] + c.slice(1).toLowerCase()}</span>`).join('');
  const chips = fo.slice(0, 20).map((x, i) => `<button class="chip ${i < 5 ? 'active' : ''}" data-drv="${x.n}" style="--team:${x.color}"><span class="dot"></span>${esc(x.code)}</button>`).join('');
  return `
    <div class="stack" style="gap:28px">
      <div><div class="split"><h3>Reifenstrategie</h3><div class="legend">${legend}</div></div><div class="mt">${stintChart(rows, d.totalLaps)}</div></div>
      <div><div class="split"><h3>Rundenzeiten</h3><span class="muted" style="font-size:12px">Ohne Boxen- und Safety-Car-Runden</span></div>
        <div class="chips mt" style="margin-bottom:8px">${chips}</div><div data-chart="laps"></div></div>
      <div><h3>Positionsverlauf</h3><div data-chart="pos" class="mt"></div></div>
      ${pits.length ? `<div><div class="split"><h3>${useLane ? 'Schnellste Boxendurchfahrten' : 'Schnellste Boxenstopps'}</h3><span class="muted" style="font-size:12px">${useLane ? 'Zeit von Einfahrt bis Ausfahrt Boxengasse' : 'Standzeit'}</span></div>${tableOf(pits.map((p, i) => { const x = byN[p.n] || {}; return `<tr style="--team:${x.color}"><td class="pos">${i + 1}</td><td><span class="who"><span class="team-bar"></span><b>${esc(x.code || p.n)}</b><span class="muted hide-sm">&nbsp;${esc(x.team || '')}</span></span></td><td class="num muted">Runde ${p.lap}</td><td class="pts">${p.dur.toFixed(1)} s</td></tr>`; }).join(''))}</div>` : ''}
    </div>`;
}

function bindStrategy(el, d) {
  if (!d) return;
  const fo = finishOrder(d);
  const byN = Object.fromEntries(d.drivers.map(x => [x.n, x]));
  const pitLaps = new Set(d.pits.flatMap(p => [`${p.n}:${p.lap}`, `${p.n}:${p.lap + 1}`]));
  const drawLaps = () => {
    const sel = [...el.querySelectorAll('[data-drv].active')].map(b => +b.dataset.drv);
    const all = sel.flatMap(n => (d.laps[n] || []).filter(Boolean));
    const sorted = [...all].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || 0;
    const series = sel.map(n => ({
      label: byN[n]?.code || String(n), color: byN[n]?.color || '#888',
      values: (d.laps[n] || []).map((v, i) => (v && v < med * 1.07 && !pitLaps.has(`${n}:${i + 1}`) && i > 0) ? v : null),
      endLabel: false,
    }));
    el.querySelector('[data-chart="laps"]').innerHTML = lineChart(series, { xLabels: Array.from({ length: d.totalLaps }, (_, i) => i + 1), yFmt: fmtLap, height: 300, label: 'Rundenzeiten' }) || empty('Keine Rundenzeiten.');
  };
  el.querySelectorAll('[data-drv]').forEach(b => b.onclick = () => { b.classList.toggle('active'); drawLaps(); });
  drawLaps();
  const pos = positionsByLap(d);
  const top = fo.slice(0, 10);
  el.querySelector('[data-chart="pos"]').innerHTML = lineChart(top.map(x => ({ label: x.code, color: x.color, values: pos[x.n], endLabel: false })), {
    xLabels: Array.from({ length: d.totalLaps }, (_, i) => i + 1), invert: true, yMin: 1, yMax: Math.max(10, d.drivers.length),
    yTicks: [1, 5, 10, 15, 20].filter(v => v <= d.drivers.length), yFmt: v => 'P' + v, height: 340, label: 'Positionen',
  });
}

// ======================================================================
// WM-Simulator
// ======================================================================
export async function simulator() {
  const core = await loadCore();
  const remaining = core.schedule.filter(r => +r.round > core.standingsRound);
  const drivers = core.drivers.filter(s => s.active !== false);
  if (!remaining.length) return pageHead('WM-Simulator') + empty('Die Saison ist zu Ende. Der Simulator startet wieder mit der neuen Saison.');
  const key = `sim:${core.season}:${core.standingsRound}`;
  let state = lsGet(key, {});
  const opts = `<option value="">–</option>` + drivers.map(s => `<option value="${s.Driver.driverId}">${esc(s.Driver.code)} · ${esc(s.Driver.familyName)}</option>`).join('');

  const presets = {
    form: () => {
      // Erwartung nach aktueller Form: Reihenfolge nach Punkten der letzten Rennen
      for (const r of remaining) { state[r.round] = { race: drivers.slice(0, 10).map(s => s.Driver.driverId), sprint: r.Sprint ? drivers.slice(0, 8).map(s => s.Driver.driverId) : [] }; }
    },
    leader: () => { const ids = drivers.map(s => s.Driver.driverId); for (const r of remaining) state[r.round] = { race: ids.slice(0, 10), sprint: r.Sprint ? ids.slice(0, 8) : [] }; },
    chaser: () => {
      const ids = drivers.map(s => s.Driver.driverId); const [a, b, ...rest] = ids;
      const o = [b, ...rest.slice(0, 8), a];   // Verfolger gewinnt, Leader nur Zehnter
      for (const r of remaining) state[r.round] = { race: o, sprint: r.Sprint ? [b, ...rest.slice(0, 6), a] : [] };
    },
    random: () => {
      const w = drivers.map(s => ({ id: s.Driver.driverId, w: Math.max(1, +s.points) }));
      const draw = n => { const pool = [...w]; const out = []; while (out.length < n && pool.length) { const t = pool.reduce((a, x) => a + x.w, 0); let r = Math.random() * t; const i = pool.findIndex(x => (r -= x.w) <= 0); out.push(pool.splice(i < 0 ? 0 : i, 1)[0].id); } return out; };
      for (const r of remaining) state[r.round] = { race: draw(10), sprint: r.Sprint ? draw(8) : [] };
    },
    clear: () => { state = {}; },
  };

  const compute = () => {
    const pts = new Map(drivers.map(s => [s.Driver.driverId, +s.points]));
    for (const r of remaining) {
      const st = state[r.round] || {};
      (st.race || []).forEach((id, i) => id && pts.set(id, (pts.get(id) || 0) + RACE_PTS[i]));
      (st.sprint || []).forEach((id, i) => id && pts.set(id, (pts.get(id) || 0) + SPRINT_PTS[i]));
    }
    return drivers.map(s => ({ s, pts: pts.get(s.Driver.driverId) })).sort((a, b) => b.pts - a.pts);
  };

  const renderResult = () => {
    lsSet(key, state);
    const res = compute();
    const champ = res[0];
    const box = document.getElementById('simres');
    const max = res[0].pts || 1;
    box.innerHTML = `<div class="champ-banner" ${teamStyle(champ.s.Constructors.at(-1).constructorId)}>
        <div class="kicker" style="color:#fff">Weltmeister ${esc(core.season)}</div>
        <div class="display" style="font-size:30px">${esc(champ.s.Driver.givenName)} ${esc(champ.s.Driver.familyName)}</div>
        <div>${champ.pts} Punkte · ${res[1] ? `${champ.pts - res[1].pts} vor ${esc(res[1].s.Driver.familyName)}` : ''}</div></div>
      ${tableOf(res.slice(0, 12).map((r, i) => {
        const delta = r.pts - +r.s.points; const was = +r.s.position;
        return `<tr ${teamStyle(r.s.Constructors.at(-1).constructorId)}><td class="pos">${i + 1}</td><td><span class="who"><span class="team-bar"></span>${driverName(r.s.Driver)}</span></td><td class="r muted num hide-sm">${was !== i + 1 ? (was > i + 1 ? `<span style="color:#5fe39a">▲${was - i - 1}</span>` : `<span style="color:#ff6b6b">▼${i + 1 - was}</span>`) : ''}</td><td class="hide-sm" style="width:30%"><div class="bar"><i style="width:${(r.pts / max) * 100}%"></i></div></td><td class="r muted num">+${delta}</td><td class="pts">${r.pts}</td></tr>`;
      }).join(''))}`;
  };

  const fillSelects = () => {
    for (const r of remaining) {
      const st = state[r.round] || {};
      document.querySelectorAll(`[data-sim="${r.round}"]`).forEach(sel => {
        const arr = st[sel.dataset.kind] || [];
        sel.value = arr[+sel.dataset.pos] || '';
      });
    }
  };

  then(() => {
    document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { presets[b.dataset.preset](); fillSelects(); renderResult(); });
    document.querySelectorAll('[data-sim]').forEach(sel => sel.onchange = () => {
      const st = (state[sel.dataset.sim] ||= { race: [], sprint: [] });
      const arr = (st[sel.dataset.kind] ||= []);
      // Ein Fahrer kann pro Rennen nur einmal vorkommen
      const prev = arr.indexOf(sel.value);
      if (sel.value && prev >= 0 && prev !== +sel.dataset.pos) arr[prev] = '';
      arr[+sel.dataset.pos] = sel.value;
      fillSelects(); renderResult();
    });
    fillSelects(); renderResult();
  });

  // Frühestmögliche Titelentscheidung: Leader gewinnt alles, Verfolger holt nichts.
  const lead = drivers[0], second = drivers[1];
  const next = remaining[0];
  const maxOf = r => 25 + (r.Sprint ? 8 : 0);
  let gap = +lead.points - +second.points, rest = remaining.reduce((a, r) => a + maxOf(r), 0), earliest = null;
  for (const r of remaining) { gap += maxOf(r); rest -= maxOf(r); if (gap > rest) { earliest = r; break; } }
  const needNow = remaining.slice(1).reduce((a, r) => a + maxOf(r), 0) - (+lead.points - +second.points) + 1;
  const clinchText = !earliest ? `Der Titel kann frühestens im letzten Rennen entschieden werden.`
    : earliest === next
      ? `${esc(lead.Driver.familyName)} kann schon in ${esc(raceShort(next.raceName))} Weltmeister werden, wenn er dort mindestens <b>${Math.max(1, needNow)} Punkte mehr</b> holt als ${esc(second.Driver.familyName)}.`
      : `Frühestmögliche Titelentscheidung: <b>${esc(raceShort(earliest.raceName))}</b> (Runde ${earliest.round}) – vorausgesetzt, ${esc(lead.Driver.familyName)} gewinnt bis dahin alles und ${esc(second.Driver.familyName)} holt keine Punkte.`;

  return `${pageHead('WM-Simulator', 'Was wäre, wenn …? Lege die Ergebnisse der restlichen Rennen fest und sieh sofort, wer Weltmeister wird. Deine Eingaben bleiben auf diesem Gerät gespeichert.')}
    <div class="notice" style="border-left-color:var(--red)">${clinchText}</div>
    <div class="chips mt"><button class="chip" data-preset="leader">Alles bleibt wie es ist</button><button class="chip" data-preset="chaser">Verfolger gewinnt alles</button><button class="chip" data-preset="random">Zufall nach Stärke</button><button class="chip" data-preset="clear">Zurücksetzen</button></div>
    <div class="grid g-main">
      <div class="stack">${remaining.map(r => `
        <details class="card sim-race" ${r === next ? 'open' : ''}>
          <summary class="card-head"><h3>R${r.round} · ${esc(raceShort(r.raceName))} ${r.Sprint ? tag('Sprint') : ''}</h3><span class="muted" style="font-size:13px">${weekendRange(r)}</span></summary>
          <div class="card-pad sim-grid">
            <div><div class="kicker">Rennen</div>${RACE_PTS.map((p, i) => `<label class="sim-row"><span class="pos">P${i + 1}</span><select class="input" data-sim="${r.round}" data-kind="race" data-pos="${i}">${opts}</select><span class="muted">${p}</span></label>`).join('')}</div>
            ${r.Sprint ? `<div><div class="kicker">Sprint</div>${SPRINT_PTS.map((p, i) => `<label class="sim-row"><span class="pos">P${i + 1}</span><select class="input" data-sim="${r.round}" data-kind="sprint" data-pos="${i}">${opts}</select><span class="muted">${p}</span></label>`).join('')}</div>` : ''}
          </div>
        </details>`).join('')}
      </div>
      <div><div class="card sticky-side"><div class="card-head"><h3>Hochgerechneter WM-Stand</h3></div><div id="simres"></div></div></div>
    </div>`;
}

// ======================================================================
// Fahrervergleich
// ======================================================================
export async function compare() {
  const [core, res] = await Promise.all([loadCore(), loadResults()]);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const ids = core.drivers.map(s => s.Driver.driverId);
  const a = ids.includes(q.get('a')) ? q.get('a') : ids[0];
  const b = ids.includes(q.get('b')) && q.get('b') !== a ? q.get('b') : ids.find(x => x !== a);
  const sa = core.drivers.find(s => s.Driver.driverId === a), sb = core.drivers.find(s => s.Driver.driverId === b);
  const stats = seasonStats(res);
  const A = stats.get(a) || {}, B = stats.get(b) || {};
  const ta = sa.Constructors.at(-1).constructorId, tb = sb.Constructors.at(-1).constructorId;
  const ca = team(ta).color, cb = tb === ta ? '#ffffff' : team(tb).color;

  const sel = (name, val) => `<select class="input" data-cmp="${name}">${core.drivers.map(s => `<option value="${s.Driver.driverId}" ${s.Driver.driverId === val ? 'selected' : ''}>${esc(s.Driver.givenName)} ${esc(s.Driver.familyName)}</option>`).join('')}</select>`;
  then(() => {
    document.querySelectorAll('[data-cmp]').forEach(s => s.onchange = () => {
      const v = Object.fromEntries([...document.querySelectorAll('[data-cmp]')].map(x => [x.dataset.cmp, x.value]));
      location.hash = `#/compare?a=${v.a}&b=${v.b}`;
    });
    Promise.all([driverCareer(a), driverCareer(b)]).then(([x, y]) => {
      const el = document.getElementById('cmpcareer');
      if (el) el.innerHTML = [['Saisons', 'seasons'], ['Starts', 'starts'], ['Siege', 'wins'], ['Podien', 'podiums'], ['Poles', 'poles'], ['WM-Titel', 'titles']].map(([l, k]) => cmpRow(l, x?.[k] ?? 0, y?.[k] ?? 0, ca, cb)).join('');
    }).catch(() => {});
  });

  // Direkte Duelle in Rennen, in denen beide klassiert waren
  let ahead = [0, 0], qAhead = [0, 0];
  const raceRows = res.races.map(r => {
    const x = r.Results.find(z => z.Driver.driverId === a), y = r.Results.find(z => z.Driver.driverId === b);
    if (!x || !y) return '';
    if (+x.position < +y.position) ahead[0]++; else ahead[1]++;
    const qa = res.quali.find(z => z.round === r.round)?.QualifyingResults;
    const qx = qa?.find(z => z.Driver.driverId === a), qy = qa?.find(z => z.Driver.driverId === b);
    if (qx && qy) { if (+qx.position < +qy.position) qAhead[0]++; else qAhead[1]++; }
    const cell = (z, win) => `<td class="num ${win ? 'win' : 'muted'}">${classified(z) ? 'P' + z.position : esc(z.positionText === 'R' ? 'DNF' : z.status)}</td>`;
    return `<tr><td class="pos">${r.round}</td><td>${countryFlag(r.Circuit.Location.country, 12)} ${esc(raceShort(r.raceName))}</td>${cell(x, +x.position < +y.position)}${cell(y, +y.position < +x.position)}</tr>`;
  }).reverse().join('');

  const { rounds, series } = pointsProgression(res);
  const chart = lineChart([
    { label: sa.Driver.code, color: ca, values: series.get(a) || [] },
    { label: sb.Driver.code, color: cb, values: series.get(b) || [], dash: tb === ta },
  ], { xLabels: rounds.map(r => 'R' + r), height: 260, label: 'Punkteverlauf' });

  const head = (s, color) => `<a class="cmp-head" href="#/driver/${s.Driver.driverId}" ${teamStyle(s.Constructors.at(-1).constructorId)}>
      <div class="cmp-img">${img('driverCars', s.Driver.driverId, null, { width: 800, fallback: 'cars:' + s.Constructors.at(-1).constructorId })}</div>
      <div class="cmp-txt"><div class="ava-lg">${img('drivers', s.Driver.driverId, s.Driver.url, { width: 330 })}</div><div><div class="display" style="font-size:24px">${esc(s.Driver.familyName)}</div><div class="muted">${esc(team(s.Constructors.at(-1).constructorId).short)} · P${s.position}</div></div></div></a>`;

  return `${pageHead('Fahrervergleich', 'Zwei Fahrer direkt nebeneinander: Saison, direkte Duelle und Karriere.')}
    <div class="grid g2 cmp-pick"><div>${sel('a', a)}</div><div>${sel('b', b)}</div></div>
    <div class="grid g2 mt">${head(sa, ca)}${head(sb, cb)}</div>
    <section class="section grid g-main">
      <div class="card"><div class="card-head"><h3>Saison ${esc(core.season)}</h3></div><div class="card-pad">
        ${[['Punkte', +sa.points, +sb.points], ['Siege', A.wins || 0, B.wins || 0], ['Podien', A.podiums || 0, B.podiums || 0], ['Poles', A.poles || 0, B.poles || 0], ['Schnellste Runden', A.fastest || 0, B.fastest || 0], ['Punkteränge', A.pointsFinishes || 0, B.pointsFinishes || 0], ['Ausfälle', A.dnf || 0, B.dnf || 0, true], ['Sprint-Siege', A.sprintWins || 0, B.sprintWins || 0]].map(([l, x, y, inv]) => cmpRow(l, x, y, ca, cb, inv)).join('')}
        <div class="kicker mt">Direkte Duelle</div>
        ${cmpRow('Qualifying vorne', qAhead[0], qAhead[1], ca, cb)}${cmpRow('Rennen vorne', ahead[0], ahead[1], ca, cb)}
      </div></div>
      <div class="card"><div class="card-head"><h3>Karriere</h3></div><div class="card-pad" id="cmpcareer">${loadingBox(200)}</div></div>
    </section>
    <section class="section"><div class="card"><div class="card-head"><h3>Punkteverlauf</h3></div><div class="card-pad">${chart}</div></div></section>
    <section class="section"><div class="card"><div class="card-head"><h3>Rennen im Vergleich</h3></div>${tableOf(raceRows, `<thead><tr><th>Rd</th><th>GP</th><th>${esc(sa.Driver.code)}</th><th>${esc(sb.Driver.code)}</th></tr></thead>`, 'cmp-tbl')}</div></section>`;
}

function cmpRow(label, x, y, ca, cb, inverse = false) {
  const tot = (x + y) || 1;
  const wx = inverse ? x < y : x > y, wy = inverse ? y < x : y > x;
  return `<div class="cmp-row"><b class="${wx ? 'win' : ''}">${fmtNum(x)}</b><span>${label}</span><b class="${wy ? 'win' : ''}">${fmtNum(y)}</b>
    <div class="cmp-bar"><i style="width:${(x / tot) * 100}%;background:${ca}"></i><i style="width:${(y / tot) * 100}%;background:${cb}"></i></div></div>`;
}

// ======================================================================
// Strafen & Motorenkontingent
// ======================================================================
export async function penalties() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const p = ed?.penalties || {};
  const byId = id => core.drivers.find(s => s.Driver.driverId === id);
  const name = id => { const s = byId(id); return s ? driverName(s.Driver) : `<b>${esc(id)}</b>`; };
  const tid = id => byId(id)?.Constructors.at(-1).constructorId || '';
  const sl = [...(p.superlicence || [])].sort((a, b) => b.points - a.points);
  const grid = [...(p.grid || [])].sort((a, b) => b.round - a.round);
  const alloc = p.pu?.allocation || {};
  const comps = Object.keys(alloc);
  const usage = p.pu?.usage || {};

  return `${pageHead('Strafen & Motoren', 'Strafpunkte auf der Superlizenz, Startplatzstrafen und wie viele Power-Unit-Teile jeder Fahrer schon verbraucht hat.')}
    <div class="grid g-main">
      <div class="card">${cardHead('Superlizenz-Strafpunkte', '<span class="muted" style="font-size:12px">12 Punkte in 12 Monaten = 1 Rennen Sperre</span>')}
        ${sl.length ? tableOf(sl.map(x => `<tr ${teamStyle(tid(x.driverId))}><td><span class="who"><span class="team-bar"></span>${name(x.driverId)}</span></td><td style="width:45%"><div class="bar sl-bar"><i style="width:${Math.min(100, x.points / 12 * 100)}%;background:${x.points >= 10 ? 'var(--red)' : x.points >= 7 ? 'var(--warn)' : 'var(--team)'}"></i></div></td><td class="pts">${x.points}</td></tr>${x.note ? `<tr class="sub-row"><td colspan="3" class="muted">${esc(x.note)}</td></tr>` : ''}`).join('')) : empty('Wird beim nächsten Tagesupdate ergänzt.')}
      </div>
      <div class="card">${cardHead('Startplatzstrafen')}
        <div class="card-pad stack" style="gap:0">${grid.length ? grid.map(g => `<div class="pen-row" ${teamStyle(tid(g.driverId))}><span class="team-bar"></span><div><div class="split"><span>${name(g.driverId)}</span>${tag(g.penalty, 'red')}</div><div class="muted" style="font-size:13px">R${g.round} ${esc(raceShort(g.race || ''))} · ${esc(g.reason || '')}</div>${sourceLinks(g.sources)}</div></div>`).join('') : empty('Keine Startplatzstrafen erfasst.')}</div>
      </div>
    </div>
    <section class="section"><div class="card">${cardHead('Power-Unit-Teile im Einsatz', comps.length ? `<span class="muted" style="font-size:12px">Erlaubt: ${comps.map(c => `${esc(c)} ${alloc[c]}`).join(' · ')}</span>` : '')}
      ${comps.length && Object.keys(usage).length ? tableOf(core.drivers.filter(s => usage[s.Driver.driverId]).map(s => {
        const u = usage[s.Driver.driverId];
        return `<tr ${teamStyle(s.Constructors.at(-1).constructorId)}><td><span class="who"><span class="team-bar"></span>${driverName(s.Driver)}</span></td>${comps.map(c => { const v = u[c] ?? 0; const over = v > alloc[c]; return `<td class="num pu-cell ${over ? 'over' : v === alloc[c] ? 'limit' : ''}">${v}</td>`; }).join('')}</tr>`;
      }).join(''), `<thead><tr><th>Fahrer</th>${comps.map(c => `<th class="num">${esc(c)}</th>`).join('')}</tr></thead>`) : `<div class="card-pad">${empty('Die Motorenliste der FIA wird beim nächsten Tagesupdate eingelesen.')}</div>`}
      ${comps.length ? `<div class="card-pad muted" style="font-size:13px;padding-top:0"><span class="pu-cell limit" style="padding:2px 8px;border-radius:4px">am Limit</span> &nbsp; <span class="pu-cell over" style="padding:2px 8px;border-radius:4px">über dem Limit → Strafe</span>${p.pu?.asOf ? ` · Stand: ${esc(p.pu.asOf)}` : ''}</div>` : ''}
    </div></section>
    <section class="section"><div class="card card-pad prose">
      <h3>So funktionieren die Strafen</h3>
      <p>Wer mehr Power-Unit-Teile braucht als erlaubt, rückt in der Startaufstellung nach hinten: beim ersten Überschreiten pro Element 10 Plätze, bei jedem weiteren 5 Plätze. Mehrere Strafen am selben Wochenende werden addiert. Ab 15 Plätzen startet der Fahrer vom Ende des Feldes.</p>
      <p>Strafpunkte auf der Superlizenz verfallen nach 12 Monaten. Wer 12 Punkte erreicht, wird für ein Rennen gesperrt.</p>
    </div></section>
    ${ed?.generatedAt ? `<div class="src">Stand: ${fmtDate(new Date(ed.generatedAt), { day: 'numeric', month: 'long' })}</div>` : ''}`;
}

// ======================================================================
// Streckenguide
// ======================================================================
export async function circuits() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  return `${pageHead('Strecken ' + esc(core.season), 'Alle Strecken der Saison mit Layout, Eckdaten und Siegerliste.')}
    <div class="grid g3">${core.schedule.map(r => {
      const c = r.Circuit, info = ed?.circuits?.[c.circuitId] || {};
      return `<a class="circuit-card" href="#/circuit/${c.circuitId}">
        <div class="cc-map">${img('circuits', c.circuitId, c.url, { width: 500, alt: c.circuitName })}</div>
        <div class="cc-body"><div class="kicker">Round ${r.round} · ${weekendRange(r)}</div>
          <h3>${countryFlag(c.Location.country, 14)} ${esc(c.Location.locality)}</h3><div class="muted" style="font-size:13px">${esc(c.circuitName)}</div>
          ${info['Länge'] ? `<div class="cc-facts"><span><b>${esc(info['Länge'])}</b> Länge</span><span><b>${esc(info['Runden'] || '–')}</b> Runden</span><span><b>${esc(info['Kurven'] || '–')}</b> Kurven</span></div>` : ''}
        </div></a>`;
    }).join('')}</div>`;
}

export async function circuitDetail(id) {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const race = core.schedule.find(r => r.Circuit.circuitId === id);
  const hist = await circuitHistory(id).catch(() => []);
  const c = race?.Circuit || hist[0]?.Circuit;
  if (!c) return pageHead('Strecke nicht gefunden');
  const info = ed?.circuits?.[id] || {};
  const winners = hist.map(r => ({ year: r.season, d: r.Results[0].Driver, t: r.Results[0].Constructor, round: r.round }));
  const count = (arr, key, nameFn) => { const m = new Map(); arr.forEach(w => { const k = key(w); m.set(k, { n: (m.get(k)?.n || 0) + 1, w }); }); return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5); };
  const topD = count(winners, w => w.d.driverId), topT = count(winners, w => w.t.constructorId);
  const facts = Object.entries(info).filter(([k]) => k !== 'notes');

  return `<div class="page-head"><div class="kicker">${race ? `Round ${race.round} · ${weekendRange(race)}` : 'Strecke'}</div><h1>${esc(c.Location.locality)}</h1><p>${countryFlag(c.Location.country, 16)} &nbsp;${esc(c.circuitName)}, ${esc(c.Location.country)}</p></div>
    <div class="grid g-main">
      <div class="stack">
        <div class="card"><div class="card-pad"><div class="track-map" style="position:relative;min-height:340px">${img('circuits', id, c.url, { width: 800, alt: 'Streckenlayout' })}<button class="credit-btn" hidden style="position:absolute;right:8px;bottom:8px">i</button></div></div></div>
        ${info.notes ? `<div class="card card-pad"><div class="kicker">Charakter</div><p style="margin:8px 0 0">${esc(info.notes)}</p></div>` : ''}
        <div class="card">${cardHead('Alle Sieger', `<span class="muted" style="font-size:12px">${winners.length} Grands Prix</span>`)}
          ${tableOf([...winners].reverse().slice(0, 30).map(w => `<tr ${teamStyle(w.t.constructorId)}><td class="pos">${w.year}</td><td><span class="who"><span class="team-bar"></span>${driverName(w.d)}</span></td><td class="muted hide-sm">${esc(w.t.name)}</td></tr>`).join(''))}
        </div>
      </div>
      <div class="stack">
        ${facts.length ? `<div class="facts f2">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v small">${esc(v)}</div></div>`).join('')}</div>` : ''}
        <div class="facts f2"><div class="fact"><div class="k">Erster GP</div><div class="v">${winners[0]?.year || '–'}</div></div><div class="fact"><div class="k">Austragungen</div><div class="v">${winners.length}</div></div></div>
        ${race ? `<a class="btn" href="#/race/${race.round}">Zum Rennwochenende ${esc(core.season)}</a>` : ''}
        <div class="card">${cardHead('Meiste Siege · Fahrer')}${tableOf(topD.map(x => `<tr><td><span class="who">${driverName(x.w.d)}</span></td><td class="pts">${x.n}</td></tr>`).join(''))}</div>
        <div class="card">${cardHead('Meiste Siege · Teams')}${tableOf(topT.map(x => `<tr ${teamStyle(x.w.t.constructorId)}><td><span class="who"><span class="team-bar"></span><b>${esc(x.w.t.name)}</b></span></td><td class="pts">${x.n}</td></tr>`).join(''))}</div>
      </div>
    </div>`;
}

// ======================================================================
// Archiv
// ======================================================================
export async function archive() {
  const dc = await champions();
  const titles = new Map(), cTitles = new Map();
  dc.forEach(x => {
    titles.set(x.driver.driverId, { d: x.driver, n: (titles.get(x.driver.driverId)?.n || 0) + 1 });
    if (x.constructor) cTitles.set(x.constructor.constructorId, { c: x.constructor, n: (cTitles.get(x.constructor.constructorId)?.n || 0) + 1 });
  });
  const most = [...titles.values()].sort((a, b) => b.n - a.n).slice(0, 10);
  const mostC = [...cTitles.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  const years = [...dc].reverse();
  then(() => {
    const s = document.getElementById('yearpick');
    if (s) s.onchange = () => { location.hash = '#/archive/' + s.value; };
  });
  return `${pageHead('Archiv', `Alle Weltmeister seit 1950 und jede Saison zum Nachschlagen.`, '', `<select class="input" id="yearpick" style="max-width:200px"><option>Saison wählen…</option>${years.map(x => `<option value="${x.season}">${x.season}</option>`).join('')}</select>`)}
    <div class="grid g-main">
      <div class="card">${cardHead('Weltmeister')}
        ${tableOf(years.map(x => `<tr class="clickable" onclick="location.hash='#/archive/${x.season}'" ${teamStyle(x.teams.at(-1)?.constructorId)}><td class="pos">${x.season}</td><td><span class="who"><span class="team-bar"></span>${driverName(x.driver)} ${natFlag(x.driver.nationality, 12)}</span></td><td class="muted hide-sm">${esc(x.teams.map(c => c.name).join(' / '))}</td><td class="hide-sm">${x.constructor ? esc(x.constructor.name) : '<span class="dim">–</span>'}</td></tr>`).join(''), '<thead><tr><th>Jahr</th><th>Fahrer-WM</th><th class="hide-sm">Team</th><th class="hide-sm">Konstrukteurs-WM</th></tr></thead>')}
      </div>
      <div class="stack">
        <div class="card">${cardHead('Meiste WM-Titel · Fahrer')}${tableOf(most.map((m, i) => `<tr><td class="pos">${i + 1}</td><td><span class="who">${driverName(m.d)} ${natFlag(m.d.nationality, 12)}</span></td><td class="pts">${m.n}</td></tr>`).join(''))}</div>
        <div class="card">${cardHead('Meiste WM-Titel · Teams')}${tableOf(mostC.map((m, i) => `<tr ${teamStyle(m.c.constructorId)}><td class="pos">${i + 1}</td><td><span class="who"><span class="team-bar"></span><b>${esc(m.c.name)}</b></span></td><td class="pts">${m.n}</td></tr>`).join(''))}</div>
      </div>
    </div>`;
}

export async function archiveYear(year) {
  const a = await seasonArchive(year);
  if (!a.drivers.length) return pageHead('Saison ' + esc(year)) + empty('Für diese Saison gibt es keine Daten.');
  const champ = a.drivers[0];
  const maxD = +champ.points || 1, maxC = +a.constructors[0]?.points || 1;
  return `<div class="page-head"><div class="kicker"><a href="#/archive">Archiv</a> › ${esc(year)}</div><h1>Saison ${esc(year)}</h1>
      <p>Weltmeister: <b>${esc(champ.Driver.givenName)} ${esc(champ.Driver.familyName)}</b> (${esc(champ.Constructors.map(c => c.name).join(' / '))}) mit ${champ.points} Punkten und ${champ.wins} Siegen. ${a.schedule.length} Rennen.</p></div>
    <div class="grid g-main">
      <div class="card">${cardHead('Fahrer-WM')}${tableOf(a.drivers.slice(0, 20).map(s => `<tr ${teamStyle(s.Constructors.at(-1)?.constructorId)}><td class="pos">${s.positionText}</td><td><span class="who"><span class="team-bar"></span>${driverName(s.Driver)}<span class="muted hide-sm" style="font-size:13px">${esc(s.Constructors.map(c => c.name).join(' / '))}</span></span></td><td class="hide-sm" style="width:25%"><div class="bar"><i style="width:${(+s.points / maxD) * 100}%"></i></div></td><td class="r muted hide-sm">${s.wins > 0 ? s.wins + ' S' : ''}</td><td class="pts">${s.points}</td></tr>`).join(''))}</div>
      <div class="stack">
        ${a.constructors.length ? `<div class="card">${cardHead('Konstrukteurs-WM')}${tableOf(a.constructors.slice(0, 12).map(s => `<tr ${teamStyle(s.Constructor.constructorId)}><td class="pos">${s.positionText}</td><td><span class="who"><span class="team-bar"></span><b>${esc(s.Constructor.name)}</b></span></td><td class="pts">${s.points}</td></tr>`).join(''))}</div>` : ''}
        <div class="split"><a class="btn ghost" href="#/archive/${+year - 1}">‹ ${+year - 1}</a>${+year < new Date().getFullYear() - 1 ? `<a class="btn ghost" href="#/archive/${+year + 1}">${+year + 1} ›</a>` : ''}</div>
      </div>
    </div>
    <section class="section">${sectionHead('Rennsieger')}<div class="grid g-auto">${a.winners.map(r => { const w = r.Results[0]; return `<div class="race-card" ${teamStyle(w.Constructor.constructorId)} style="min-height:0"><span class="rc-round">Round ${r.round}</span><span class="rc-name">${esc(r.raceName)}</span><span class="rc-circ">${fmtDate(toDate(r.date), { day: 'numeric', month: 'long' })}</span><span class="mini-pod" style="margin-top:8px;align-self:flex-start"><span class="dot"></span>${esc(w.Driver.givenName)} ${esc(w.Driver.familyName)} · ${esc(w.Constructor.name)}</span></div>`; }).join('')}</div></section>`;
}

// ======================================================================
// Kalender-Export & TV
// ======================================================================
export function buildICS(core) {
  const pad = n => String(n).padStart(2, '0');
  const stamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pitwall//F1 Hub//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:F1 ${core.season}`, 'X-WR-TIMEZONE:Europe/Zurich'];
  const LEN = { Race: 120, Sprint: 60, Qualifying: 60, SprintQualifying: 45 };
  for (const r of core.schedule) for (const s of sessionsOf(r)) {
    const end = new Date(s.start.getTime() + (LEN[s.key] || 60) * 60e3);
    lines.push('BEGIN:VEVENT', `UID:${core.season}-${r.round}-${s.key}@pitwall`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(s.start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:F1 ${raceShort(r.raceName)} – ${s.name}`, `LOCATION:${r.Circuit.circuitName}\\, ${r.Circuit.Location.locality}`,
      `DESCRIPTION:Round ${r.round} der Saison ${core.season}. TV: SRF zwei / Play SRF`, 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${s.name} startet in 15 Minuten`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function calendarButtons(core) {
  then(() => {
    document.querySelectorAll('[data-ics]').forEach(b => b.onclick = () => {
      const blob = new Blob([buildICS(core)], { type: 'text/calendar' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `f1-${core.season}.ics`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  });
  const sub = location.protocol === 'https:' ? `webcal://${location.host}${location.pathname.replace(/index\.html$/, '')}data/calendar.ics` : '';
  return `<div class="cal-actions">${sub ? `<a class="btn" href="${sub}">Kalender abonnieren</a>` : ''}<button class="btn ${sub ? 'ghost' : ''}" data-ics>Kalender herunterladen (.ics)</button></div>`;
}

export function tvBox() {
  return `<div class="card">${cardHead('Live schauen in der Schweiz')}<div class="card-pad stack" style="gap:10px">
    ${TV_CH.map(t => `<a class="tv-row" href="${t.url}" target="_blank" rel="noopener"><b>${esc(t.name)}</b><span class="muted">${esc(t.note)}</span></a>`).join('')}
  </div></div>`;
}
