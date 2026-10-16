// Gemeinsame Bausteine aller Seiten: Render-Hooks, Timer, Layout-Teile.

import { team, TEAMS } from './config.js';
import { weather } from './data.js';
import { esc, teamStyle, driverName, fmtNum, fmtDay, fmtDate, fmtTime, sessionsOf, sessionEnd, tag, img, relTime, hostOf } from './ui.js';
import { relatedNews, ageInDays } from './news-feed.js';

// ---------- Render-Lebenszyklus ----------
let queue = [];
export const then = fn => { queue.push(fn); };
export const takeAfterRender = () => { const q = queue; queue = []; return q; };
export const timers = [];
// Aufräumen beim Seitenwechsel – für alles, was kein Intervall ist
// (z. B. eine Realtime-Verbindung abmelden oder einen Dialog schliessen).
const leavers = [];
export const onLeave = fn => { leavers.push(fn); };
export const clearTimers = () => {
  timers.forEach(clearInterval); timers.length = 0;
  leavers.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
  leavers.length = 0;
};

// ---------- Zeit & Kalender ----------
export const now = () => new Date();
export const nextRace = core => core.schedule.find(r => sessionEnd(sessionsOf(r).at(-1)) > now()) || null;
export const lastRaceRound = core => [...core.schedule].reverse().find(r => sessionEnd(sessionsOf(r).at(-1)) < now());
export function liveSession(core) {
  const t = now();
  for (const r of core.schedule) for (const s of sessionsOf(r)) if (s.start <= t && sessionEnd(s) >= t) return { race: r, session: s };
  return null;
}

// ---------- Layout ----------
export const pageHead = (title, text = '', kicker = '', extra = '') => `<div class="page-head">${kicker ? `<div class="kicker">${kicker}</div>` : ''}<div class="split" style="align-items:flex-end;flex-wrap:wrap"><h1>${title}</h1>${extra}</div>${text ? `<p>${text}</p>` : ''}</div>`;
export const sectionHead = (title, link, linkText = 'Alle anzeigen') => `<div class="section-head"><h2>${title}</h2>${link ? `<a class="link" href="${link}">${linkText}</a>` : ''}</div>`;
export const tableOf = (rows, head = '', cls = '') => `<div class="table-wrap"><table class="tbl ${cls}">${head}<tbody>${rows}</tbody></table></div>`;
export const cardHead = (title, right = '') => `<div class="card-head"><h3>${title}</h3>${right}</div>`;

// Tabs: [{ id, label, html }] -> HTML + Umschaltlogik
let tabSeq = 0;
export function tabs(list, { active = 0 } = {}) {
  const gid = 'tg' + (++tabSeq);
  then(() => {
    document.querySelectorAll(`[data-tg="${gid}"]`).forEach(b => b.onclick = () => {
      document.querySelectorAll(`[data-tg="${gid}"]`).forEach(x => x.classList.toggle('active', x === b));
      document.querySelectorAll(`[data-tp="${gid}"]`).forEach(p => p.hidden = p.dataset.id !== b.dataset.id);
      b.dispatchEvent(new CustomEvent('tabshow', { bubbles: true, detail: b.dataset.id }));
    });
  });
  return {
    buttons: `<div class="chips" style="margin:0">${list.map((t, i) => `<button class="chip ${i === active ? 'active' : ''}" data-tg="${gid}" data-id="${t.id}">${t.label}</button>`).join('')}</div>`,
    panes: list.map((t, i) => `<div data-tp="${gid}" data-id="${t.id}" ${i === active ? '' : 'hidden'}>${t.html}</div>`).join(''),
  };
}

export function standingRow(s, max) {
  const D = s.Driver, C = s.Constructors.at(-1);
  return `<tr ${teamStyle(C.constructorId)}>
    <td class="pos">${s.positionText ?? s.position}</td>
    <td><a class="who" href="#/driver/${D.driverId}"><span class="team-bar"></span><span class="ava">${img('drivers', D.driverId, D.url, { width: 120 })}</span><span>${driverName(D)}<div class="sub">${esc(team(C.constructorId).short)}</div></span></a></td>
    <td class="hide-sm" style="width:30%"><div class="bar"><i style="width:${max ? (+s.points / max) * 100 : 0}%"></i></div></td>
    <td class="r hide-sm muted">${s.wins > 0 ? s.wins + (s.wins == 1 ? ' Sieg' : ' Siege') : ''}</td>
    <td class="pts">${fmtNum(+s.points)}</td></tr>`;
}
export function constructorRow(s, max) {
  const C = s.Constructor;
  return `<tr ${teamStyle(C.constructorId)}>
    <td class="pos">${s.positionText ?? s.position}</td>
    <td><a class="who" href="#/team/${C.constructorId}"><span class="team-bar"></span><span class="name"><b>${esc(team(C.constructorId).short)}</b></span></a></td>
    <td class="hide-sm" style="width:40%"><div class="bar"><i style="width:${max ? (+s.points / max) * 100 : 0}%"></i></div></td>
    <td class="r hide-sm muted">${s.wins > 0 ? s.wins + (s.wins == 1 ? ' Sieg' : ' Siege') : ''}</td>
    <td class="pts">${fmtNum(+s.points)}</td></tr>`;
}

export function countdown(target) {
  const id = 'cd' + Math.random().toString(36).slice(2, 7);
  const tick = () => {
    const el = document.getElementById(id);
    if (!el) return;
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    el.innerHTML = [[d, 'Tage'], [h, 'Std'], [m, 'Min'], [s, 'Sek']].map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
  };
  then(() => { tick(); timers.push(setInterval(tick, 1000)); });
  return `<div class="countdown" id="${id}"></div>`;
}

export function sessionTable(race) {
  const t = now();
  return `<div class="sessions">${sessionsOf(race).map(s => {
    const state = sessionEnd(s) < t ? 'done' : s.start <= t ? 'live' : '';
    return `<div class="session-row ${state}"><span class="s-name">${state === 'live' ? '● ' : ''}${s.name}</span><span class="s-day">${fmtDay(s.start)} ${fmtDate(s.start, { day: 'numeric', month: 'numeric' })}</span><span class="s-time">${fmtTime(s.start)}</span></div>`;
  }).join('')}</div>`;
}

// Wetterprognose fürs Rennwochenende (Open-Meteo, nur bis 15 Tage voraus).
const WX = { 0: ['☀️', 'Sonnig'], 1: ['🌤️', 'Heiter'], 2: ['⛅', 'Wolkig'], 3: ['☁️', 'Bedeckt'], 45: ['🌫️', 'Nebel'], 48: ['🌫️', 'Nebel'], 51: ['🌦️', 'Niesel'], 53: ['🌦️', 'Niesel'], 55: ['🌦️', 'Niesel'], 61: ['🌧️', 'Regen'], 63: ['🌧️', 'Regen'], 65: ['🌧️', 'Starkregen'], 80: ['🌦️', 'Schauer'], 81: ['🌧️', 'Schauer'], 82: ['⛈️', 'Starke Schauer'], 95: ['⛈️', 'Gewitter'], 96: ['⛈️', 'Gewitter'], 99: ['⛈️', 'Gewitter'] };
export async function weatherBlock(race, { bare = false, short = false } = {}) {
  const s = sessionsOf(race);
  const start = s[0].start, end = s.at(-1).start;
  if ((start - Date.now()) / 86400e3 > 15 || end < Date.now() - 86400e3) return '';
  try {
    const iso = d => d.toISOString().slice(0, 10);
    const w = await weather(race.Circuit.Location.lat, race.Circuit.Location.long, iso(start), iso(end));
    const D = w.daily;
    if (short) {
      const i = D.time.length - 1;   // Renntag = letzter Tag der Vorhersage
      const [ico] = WX[D.weather_code[i]] || ['🌡️', ''];
      return `${ico} ${Math.round(D.temperature_2m_max[i])}°/${Math.round(D.temperature_2m_min[i])}° · 💧${D.precipitation_probability_max[i] ?? '–'}%`;
    }
    const body = `<div class="weather">${D.time.map((t, i) => {
      const [ico, txt] = WX[D.weather_code[i]] || ['🌡️', ''];
      return `<div class="wx"><div class="d">${fmtDay(new Date(t))}</div><div class="i" title="${txt}">${ico}</div><div class="t">${Math.round(D.temperature_2m_max[i])}° / ${Math.round(D.temperature_2m_min[i])}°</div><div class="p">💧 ${D.precipitation_probability_max[i] ?? '–'}%</div><div class="dim" style="font-size:12px">${Math.round(D.wind_speed_10m_max[i])} km/h</div></div>`;
    }).join('')}</div>`;
    return bare ? body : `<div class="card">${cardHead('Wetter an der Strecke', '<span class="muted" style="font-size:12px">Open-Meteo</span>')}<div class="card-pad">${body}</div></div>`;
  } catch { return ''; }
}

export const loadingBox = (h = 240) =>`<div class="skeleton" style="height:${h}px"></div>`;
// Platzhalter in Seitenform (Titel + Zeilen). Wirkt beim Laden ruhiger als ein
// Spinner, weil die Seite schon ihre spätere Struktur andeutet.
export const pageSkeleton = (rows = 7) => `<div class="sk-page" aria-busy="true" aria-label="Seite wird geladen">
  <div class="skeleton sk-title"></div><div class="skeleton sk-sub"></div>
  <div class="sk-rows">${'<div class="skeleton sk-row"></div>'.repeat(rows)}</div>
</div>`;
export const contractTag = c => {
  if (!c) return '';
  const map = { bestätigt: 'ok', erwartet: 'info', offen: 'warn', 'Gerücht': 'warn', weg: '' };
  return tag(c.status === 'bestätigt' ? `2027 ✓ ${team(c.team2027).short}` : `2027: ${c.status}`, map[c.status] || '');
};

// ---------- News ----------
// News-Karte. Bebildert mit unseren eigenen Fotos: Auto des erstgenannten
// Fahrers, sonst das Auto des Teams. Pressefotos der Quelle werden nicht übernommen.
export function newsCard(n, lead = false, { image = true } = {}) {
  const tid = n.team && TEAMS[n.team] ? n.team : null;
  const did = n.drivers?.[0];
  const pic = image && (did || tid) ? `<div class="nc-img">${did ? img('driverCars', did, null, { width: lead ? 1200 : 800, fallback: tid ? 'cars:' + tid : '' }) : img('cars', tid, null, { width: lead ? 1200 : 800 })}</div>` : '';
  const d = n.date ? new Date(n.date) : null;
  const when = d ? (Date.now() - d < 20 * 3600e3 ? relTime(d) : fmtDate(d, { day: 'numeric', month: 'short' })) : '';
  return `<a class="news-card ${lead ? 'news-lead' : ''} ${pic ? 'has-img' : ''}" data-cat="${esc(n.category || '')}" href="${esc(n.url || '#/news')}" ${n.url ? 'target="_blank" rel="noopener"' : ''} ${tid ? teamStyle(tid) : 'style="--team:var(--red)"'}>
    ${pic}<div class="nc-top"></div><div class="nc-body">
      <div class="nc-tags">${tag(n.category || 'News')}${n.lang === 'en' ? '<span class="tag ghost" title="Artikel auf Englisch">EN</span>' : ''}</div>
      <h3>${esc(n.title)}</h3>${n.summary ? `<p>${esc(n.summary)}</p>` : ''}
      <div class="nc-meta"><span>${esc(n.source || hostOf(n.url || ''))} ↗</span><span>${esc(when)}</span></div>
    </div></a>`;
}

export function newsStamp(nw) {
  if (!nw?.updatedAt) return '';
  const d = new Date(nw.updatedAt);
  return `<div class="src">${nw.rss ? 'Schlagzeilen und Kurztexte von Formel1.de und Formula1.com, automatisch alle 2 Stunden abgerufen. Der ganze Artikel öffnet sich auf der Seite der Quelle.' : 'Redaktionelle Zusammenfassung'} · Stand ${fmtDate(d, { day: 'numeric', month: 'long' })}, ${fmtTime(d)}</div>`;
}

// Frische Meldungen zum Thema einer Fachseite. Die redaktionellen Daten in
// editorial.json altern (die KI-Recherche kostet Geld und ist darum aus),
// die RSS-News kommen aber gratis alle zwei Stunden – so bleibt die Seite aktuell.
export function newsSection(nw, title, opts) {
  const list = relatedNews(nw?.items || [], opts);
  if (!list.length) return '';
  return `<section class="section">${sectionHead(title, '#/news', 'Alle News')}
    <div class="grid g3 news-grid">${list.map(n => newsCard(n)).join('')}</div>${newsStamp(nw)}</section>`;
}

// Hinweis, wenn die recherchierten Daten alt sind – lieber ehrlich sagen,
// seit wann nichts mehr dazugekommen ist, als stillschweigend veralten.
export function staleNote(ed, what, { warnAfter = 10 } = {}) {
  const age = ageInDays(ed?.generatedAt);
  if (age == null || age < warnAfter) return '';
  return `<div class="notice">${esc(what)} ${age === 1 ? 'wurde gestern' : `wurde zuletzt vor ${age} Tagen`} recherchiert. Neuere Entwicklungen stehen in den <a href="#/news">News</a>, die alle zwei Stunden automatisch aktualisiert werden.</div>`;
}
