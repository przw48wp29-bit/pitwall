// Tippspiel – Ranglisten (Saison, Monat, Rennen), Punkteverlauf und die
// Punkte-Aufschlüsselung eines Wochenendes. Sortierung in ranking.js.

import { esc, raceShort } from '../ui.js';
import { then, pageHead, cardHead } from '../shared.js';
import { rpc, backend } from './api.js';
import { ITEM_LABEL, KIND_LABEL } from './rules.js';
import { rankTable, months, progression, scoredEvents } from './ranking.js';
import { go, query, avatar, needLogin, demoBar } from './common.js';

const fmtPts = n => `${n > 0 ? '+' : ''}${n}`;
const placeLabel = r => `${r.rank}.`;

// Eine Zeile der Rangliste.
function row(r, me, extra = '') {
  return `<div class="tp-rk ${r.user_id === me ? 'me' : ''} ${r.rank <= 3 ? 'top' + r.rank : ''}">
    <span class="tp-rk-pos">${placeLabel(r)}</span>
    ${avatar(r, 30)}
    <span class="tp-rk-name"><span>${esc(r.name)}${r.user_id === me ? ' <span class="muted small">(du)</span>' : ''}</span>
      <small class="muted">${r.exact} exakt · ${r.wins} ${r.wins === 1 ? 'Sieg' : 'Siege'}${r.adjust ? ` · Korrektur ${fmtPts(r.adjust)}` : ''}</small></span>
    ${extra}
    <span class="tp-rk-pts">${r.points}<small>Pkt.</small></span>
  </div>`;
}

// Kompakte Rangliste für die Gruppenseite (Top 5, plus ich, falls weiter hinten).
export function standingsCard(groupId, data, me) {
  const evs = scoredEvents(data);
  const link = `<a class="muted small" href="#/gruppe/${groupId}/rangliste">Ganze Rangliste ›</a>`;
  if (!evs.length) {
    return `<div class="card">${cardHead('Rangliste')}<div class="card-pad"><p class="muted" style="margin:0">Die Punkte werden automatisch berechnet, sobald das offizielle Resultat vorliegt (meist wenige Stunden nach der Session). Die Rangliste erscheint nach dem ersten gewerteten Wochenende.</p></div></div>`;
  }
  const tab = rankTable(data);
  const last = evs.at(-1);
  const lastPts = new Map((data.scores || []).filter(s => s.event_id === last.id).map(s => [s.user_id, s.points]));
  let shown = tab.slice(0, 5);
  const mine = tab.find(r => r.user_id === me);
  if (mine && !shown.includes(mine)) shown = [...shown, mine];
  const delta = r => `<span class="tp-rk-last muted small" title="Punkte ${esc(raceShort(last.name))}">${lastPts.has(r.user_id) ? fmtPts(lastPts.get(r.user_id)) : '–'}</span>`;
  return `<div class="card">${cardHead(`Rangliste nach ${evs.length} ${evs.length === 1 ? 'Wochenende' : 'Wochenenden'}`, link)}
    <div class="tp-rks">${shown.map((r, i) => (i === 5 ? '<div class="tp-rk-gap">…</div>' : '') + row(r, me, delta(r))).join('')}</div>
    <p class="muted small card-pad" style="margin:0;padding-top:8px">Rechts: Punkte am letzten Wochenende (${esc(raceShort(last.name))}).</p>
  </div>`;
}

// Punkteverlauf als SVG-Linien: ich in Rot, Führender hell, alle anderen grau.
export function progressChart(data, me) {
  const evs = scoredEvents(data);
  if (evs.length < 2) return '';
  const series = progression(data);
  const tab = rankTable(data);
  const leader = tab[0]?.user_id;
  const W = 640, H = 240, L = 36, R = 92, T = 12, B = 26;
  const max = Math.max(10, ...series.flatMap(s => s.points));
  const step = max <= 50 ? 10 : max <= 120 ? 20 : max <= 300 ? 50 : 100;
  const top = Math.ceil(max / step) * step;
  const x = i => L + (i * (W - L - R)) / (evs.length - 1);
  const y = v => T + (H - T - B) * (1 - v / top);
  const grid = [];
  for (let v = 0; v <= top; v += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`);
  const xl = evs.map((e, i) => `<text x="${x(i)}" y="${H - 6}" class="ax" text-anchor="middle">R${e.round}</text>`).join('');
  const role = s => (s.user_id === me ? 'me' : s.user_id === leader ? 'lead' : 'rest');
  const order = [...series].sort((a, b) => ['rest', 'lead', 'me'].indexOf(role(a)) - ['rest', 'lead', 'me'].indexOf(role(b)));
  const lines = order.map(s => {
    const d = s.points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const last = s.points.length - 1;
    const label = role(s) !== 'rest' ? `<text x="${x(last) + 8}" y="${y(s.points[last]) + 4}" class="lbl">${esc(s.name.slice(0, 12))} ${s.points[last]}</text>` : '';
    return `<g class="ln ${role(s)}"><path d="${d}"/><circle cx="${x(last)}" cy="${y(s.points[last])}" r="4"/>${label}</g>`;
  }).join('');
  const hits = evs.map((e, i) => `<rect class="hit" data-i="${i}" x="${x(i) - (W - L - R) / (evs.length - 1) / 2}" y="${T}" width="${(W - L - R) / (evs.length - 1)}" height="${H - T - B}"/>`).join('');

  then(() => {
    const box = document.getElementById('tpChart');
    if (!box) return;
    const tip = box.querySelector('.tp-chart-tip');
    const cross = box.querySelector('.cross');
    box.querySelectorAll('.hit').forEach(h => {
      const show = () => {
        const i = +h.dataset.i;
        const ranked = series.map(s => ({ name: s.name, v: s.points[i], me: s.user_id === me })).sort((a, b) => b.v - a.v);
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.style.opacity = 1;
        tip.innerHTML = `<b>R${evs[i].round} · ${esc(raceShort(evs[i].name))}</b>${ranked.slice(0, 6).map(r => `<div class="${r.me ? 'me' : ''}"><span>${esc(r.name)}</span><b>${r.v}</b></div>`).join('')}${ranked.length > 6 ? `<div class="muted">+ ${ranked.length - 6} weitere</div>` : ''}`;
        tip.hidden = false;
        const pct = x(i) / W;
        tip.style.left = pct > 0.6 ? '' : `${pct * 100 + 2}%`;
        tip.style.right = pct > 0.6 ? `${(1 - pct) * 100 + 2}%` : '';
      };
      h.onpointerenter = show; h.onclick = show;
    });
    box.querySelector('svg').onpointerleave = () => { tip.hidden = true; cross.style.opacity = 0; };
  });

  return `<div class="card">${cardHead('Punkteverlauf')}
    <div class="card-pad">
      <div class="tp-legend"><span><i class="me"></i>Du</span><span><i class="lead"></i>Führung</span><span><i class="rest"></i>Übrige</span></div>
      <div class="tp-chart" id="tpChart">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kumulierte Punkte pro Wochenende">${grid.join('')}${xl}
          <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" style="opacity:0"/>${lines}${hits}</svg>
        <div class="tp-chart-tip" hidden></div>
      </div>
    </div></div>`;
}

// =============================================================================
// Seite: Rangliste einer Gruppe
// =============================================================================
export async function groupRanking(id) {
  const b = await backend();
  if (!b.user()) return needLogin(`#/gruppe/${id}/rangliste`);
  const me = b.user().id;
  const [g, data] = await Promise.all([rpc('group_detail', { p_group: id }), rpc('group_standings', { p_group: id })]);
  const q = query();
  const view = ['saison', 'monat', 'rennen'].includes(q.get('ansicht')) ? q.get('ansicht') : 'saison';
  const evs = scoredEvents(data);
  const ms = months(data);
  const base = `#/gruppe/${id}/rangliste`;

  then(() => {
    document.querySelectorAll('[data-pick]').forEach(s => s.onchange = () => go(`${base}?ansicht=${view}&${s.dataset.pick}=${encodeURIComponent(s.value)}`));
  });

  let scope = null, title = `Saison ${esc(data.season)}`, picker = '';
  if (view === 'monat' && ms.length) {
    const cur = ms.find(m => m.key === q.get('m')) || ms.at(-1);
    scope = cur.ids; title = esc(cur.label);
    picker = `<select class="input tp-pick" data-pick="m">${ms.map(m => `<option value="${m.key}" ${m === cur ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>`;
  } else if (view === 'rennen' && evs.length) {
    const cur = evs.find(e => e.id === q.get('e')) || evs.at(-1);
    scope = new Set([cur.id]); title = `R${cur.round} · ${esc(raceShort(cur.name))}`;
    picker = `<select class="input tp-pick" data-pick="e">${[...evs].reverse().map(e => `<option value="${e.id}" ${e === cur ? 'selected' : ''}>R${e.round} · ${esc(raceShort(e.name))}</option>`).join('')}</select>`;
  }
  const tab = rankTable(data, scope);
  const seg = (v, label) => `<a class="${view === v ? 'active' : ''}" href="${base}?ansicht=${v}">${label}</a>`;
  const adj = data.adjustments || [];
  const evName = eid => { const e = data.events.find(x => x.id === eid); return e ? `R${e.round} ${raceShort(e.name)}` : ''; };
  const nameOf = uid => data.members.find(m => m.user_id === uid)?.name || 'Ehemaliges Mitglied';

  return `${demoBar()}
    ${pageHead('Rangliste', '', esc(g.name), `<a class="btn ghost small" href="#/gruppe/${id}">Zur Gruppe</a>`)}
    <div class="tp-seg">${seg('saison', 'Saison')}${seg('monat', 'Monat')}${seg('rennen', 'Rennen')}</div>
    ${!evs.length ? `<div class="notice mt">Noch keine Punkte. Sobald das erste Resultat da ist, wertet Pitwall automatisch aus.</div>` : `
    <div class="card mt">${cardHead(title, picker)}<div class="tp-rks">${tab.map(r => row(r, me)).join('')}</div>
      <p class="muted small card-pad" style="margin:0">Bei Punktgleichheit entscheiden die exakten Treffer, dann die Wochenendsiege. Sonst teilen sich die Spieler den Platz.</p></div>
    ${view === 'saison' ? progressChart(data, me) : ''}
    ${view === 'saison' && adj.length ? `<div class="card">${cardHead('Korrekturen')}<div class="tp-adjs">${adj.map(a => `<div class="tp-adj"><b class="${a.points > 0 ? 'pos' : 'neg'}">${fmtPts(a.points)}</b><span>${esc(nameOf(a.user_id))}${a.event_id ? ` <span class="muted small">· ${esc(evName(a.event_id))}</span>` : ''}<small class="muted">${esc(a.reason)} – ${esc(a.by || 'Admin')}</small></span></div>`).join('')}</div></div>` : ''}`}`;
}

// =============================================================================
// Punkte-Aufschlüsselung (Gruppe → Wochenende)
// =============================================================================
const drvCode = (drv, id) => { const d = drv.get(id); return d ? (d.code || d.family_name.slice(0, 3).toUpperCase()) : id || '?'; };

export function itemText(it, drv) {
  const who = it.d ? `<b>${esc(drvCode(drv, it.d))}</b> ` : '';
  const slot = it.s ? `P${it.s}${it.a && it.a !== it.s ? ` → P${it.a}` : ''} · ` : '';
  if (it.k === 'outsider') return `${who}${ITEM_LABEL.outsider}${it.alone ? ' (als Einziger)' : ''}`;
  return `${who}${slot}${ITEM_LABEL[it.k] || it.k}`;
}

// Liste aller Posten eines Spielers für ein Wochenende.
export function breakdown(score, drv) {
  if (!score) return '<p class="muted small">Keine Punkte an diesem Wochenende.</p>';
  return Object.entries(score.detail || {}).sort(([a], [b]) => ['quali', 'sprint', 'race', 'extras'].indexOf(a) - ['quali', 'sprint', 'race', 'extras'].indexOf(b)).map(([k, d]) => `
    <div class="tp-bd"><div class="tp-bd-head"><b>${KIND_LABEL[k]}</b><b>${d.points}</b></div>
      ${d.items.length ? d.items.map(it => `<div class="tp-bd-row"><span>${itemText(it, drv)}</span><span>${fmtPts(it.p)}</span></div>`).join('') : '<div class="tp-bd-row muted"><span>keine Treffer</span><span>0</span></div>'}
      ${d.open?.length ? `<div class="tp-bd-row muted"><span>Noch offen: ${d.open.map(o => ({ dotd: 'Fahrer des Tages', sc: 'Safety Car', fastest: 'schnellste Runde' }[o] || o)).join(', ')}</span><span></span></div>` : ''}
    </div>`).join('');
}
