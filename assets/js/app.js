// Pitwall – Router und Hauptseiten.

import { team, TEAMS, NEWS_SOURCES } from './config.js';
import { loadCore, loadResults, loadLastRace, loadEditorial, loadNews, loadMeta, driverCareer, openf1, weather } from './data.js';
import {
  esc, teamStyle, natFlag, countryFlag, fmtDate, fmtTime, fmtDay, fmtNum, toDate, sessionsOf, sessionEnd,
  weekendRange, raceShort, driverName, img, hydrateImages, tag, sourceLinks, relTime, empty, hostOf,
} from './ui.js';
import { seasonStats, headToHead, pointsProgression, titleMath, titleOdds, classified } from './stats.js';
import {
  then, takeAfterRender, timers, clearTimers, now, nextRace, lastRaceRound, liveSession, pageHead, sectionHead,
  tableOf, cardHead, tabs, standingRow, constructorRow, countdown, sessionTable, loadingBox, contractTag, weatherBlock,
} from './shared.js';
import { lineChart, barChart } from './charts.js';
import {
  strategyPane, simulator, compare, penalties, circuits, circuitDetail, archive, archiveYear,
  calendarButtons, tvBox,
} from './features.js';
import * as T from './tipp/views.js';
import { onAuthChange, probablyLoggedIn, isDemo } from './tipp/api.js';

const app = document.getElementById('app');

// ======================================================================
// Router
// ======================================================================
const routes = [
  [/^\/?$/, home],
  [/^\/schedule$/, schedule],
  [/^\/race\/(\d+)$/, raceDetail],
  [/^\/results$/, resultsPage],
  [/^\/standings$/, standings],
  [/^\/drivers$/, drivers],
  [/^\/driver\/([\w-]+)$/, driverDetail],
  [/^\/teams$/, teams],
  [/^\/team\/([\w-]+)$/, teamDetail],
  [/^\/upgrades$/, upgrades],
  [/^\/transfers$/, transfers],
  [/^\/news$/, news],
  [/^\/stats$/, statsPage],
  [/^\/rules$/, rules],
  [/^\/live$/, live],
  [/^\/simulator$/, simulator],
  [/^\/compare$/, compare],
  [/^\/penalties$/, penalties],
  [/^\/circuits$/, circuits],
  [/^\/circuit\/([\w-]+)$/, circuitDetail],
  [/^\/archive$/, archive],
  [/^\/archive\/(\d{4})$/, archiveYear],
  // Tippspiel
  [/^\/tipp$/, T.tippHome],
  [/^\/tipp\/next$/, T.tippNext],
  [/^\/tipp\/(\d{4}-\d{2})$/, T.tipForm],
  [/^\/login$/, T.login],
  [/^\/profil$/, T.profile],
  [/^\/gruppe\/neu$/, T.groupNew],
  [/^\/gruppe\/([0-9a-f-]{36})$/, T.groupPage],
  [/^\/gruppe\/([0-9a-f-]{36})\/admin$/, T.groupAdmin],
  [/^\/gruppe\/([0-9a-f-]{36})\/rangliste$/, T.groupRanking],
  [/^\/gruppe\/([0-9a-f-]{36})\/rennen\/(\d{4}-\d{2})$/, T.groupEvent],
  [/^\/beitreten\/([A-Za-z0-9]{4,12})$/, T.join],
  [/^\/tippspiel$/, () => { location.replace('#/tipp'); return ''; }],
];
const SECTION_ALIAS = { '/race': '/schedule', '/driver': '/drivers', '/team': '/teams', '/circuit': '/circuits', '/archive': '/archive', '/gruppe': '/tipp', '/beitreten': '/tipp', '/login': '/tipp', '/profil': '/profil' };
const TITLES = { '/': 'Pitwall – F1 Hub', '/schedule': 'Schedule', '/results': 'Results', '/standings': 'Standings', '/drivers': 'Drivers', '/teams': 'Teams', '/upgrades': 'Upgrades', '/transfers': 'Transfers', '/news': 'News', '/stats': 'Stats', '/rules': 'Regeln', '/live': 'Live', '/simulator': 'WM-Simulator', '/compare': 'Fahrervergleich', '/penalties': 'Strafen & Motoren', '/circuits': 'Strecken', '/archive': 'Archiv', '/tipp': 'Tippspiel', '/profil': 'Profil' };

let renderSeq = 0;
async function router() {
  const seq = ++renderSeq;
  clearTimers();
  takeAfterRender();
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const match = routes.find(([re]) => re.test(path));
  const [re, view] = match || [/.*/, notFound];
  const args = path.match(re).slice(1);
  const section = '/' + (path.split('/')[1] || '');
  const navKey = SECTION_ALIAS[section] || section;
  document.querySelectorAll('.mainnav a, .more-menu a').forEach(a => a.classList.toggle('active', a.getAttribute('href').slice(1) === navKey));
  const tabKey = /^\/tipp\/(\d|next)/.test(path) ? 'tippen' : navKey === '/tipp' ? 'tipp' : navKey === '/profil' ? 'profil' : navKey === '/news' ? 'news' : 'f1';
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tabKey));
  document.querySelector('.more-btn')?.classList.toggle('active', !!document.querySelector('.more-menu a.active'));
  document.title = (TITLES[navKey] && navKey !== '/' ? TITLES[navKey] + ' · ' : '') + 'Pitwall – F1 Hub';
  closeMenus();
  app.innerHTML = '<div class="loader"><span></span></div>';
  try {
    const html = await view(...args);
    if (seq !== renderSeq) return;   // inzwischen weiternavigiert
    app.innerHTML = `<div class="fade-in">${html}</div>`;
    hydrateImages(app);
    window.scrollTo({ top: 0 });
    takeAfterRender().forEach(fn => fn());
  } catch (err) {
    if (seq !== renderSeq) return;
    console.error(err);
    app.innerHTML = `<div class="page-head"><h1>Ups</h1><p>Die Daten konnten gerade nicht geladen werden. Bitte versuch es später nochmals.</p></div><div class="notice">${esc(err.message)}</div>`;
  }
}
window.addEventListener('hashchange', router);

// ---------- Navigation ----------
const burger = document.getElementById('burger');
const nav = document.getElementById('mainnav');
const moreBtn = document.querySelector('.more-btn');
burger.addEventListener('click', () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open);
});
moreBtn?.addEventListener('click', e => { e.stopPropagation(); const open = moreBtn.getAttribute('aria-expanded') !== 'true'; moreBtn.setAttribute('aria-expanded', open); });
document.addEventListener('click', e => { if (!e.target.closest('.more')) moreBtn?.setAttribute('aria-expanded', 'false'); });
function closeMenus() { nav.classList.remove('open'); burger.setAttribute('aria-expanded', 'false'); moreBtn?.setAttribute('aria-expanded', 'false'); }

// ======================================================================
// Bausteine
// ======================================================================
function upgradeCard(u, { showRace = false } = {}) {
  const T = team(u.team);
  return `<article class="upg" data-team="${u.team}" ${teamStyle(u.team)}><span class="team-bar"></span><div class="upg-body">
    <div class="upg-head"><h3><a href="#/team/${u.team}">${esc(T.short)}</a>${showRace ? `<span class="muted" style="font-weight:400">· R${u.round} ${esc(raceShort(u.race || ''))}</span>` : ''}</h3>
      <span class="tag ghost">${u.items?.length ? u.items.length + ' Teil' + (u.items.length > 1 ? 'e' : '') : 'Keine neuen Teile'}</span></div>
    ${u.items?.length ? `<ul class="upg-list">${u.items.map(i => `<li><span class="area">${esc(i.area || '')}</span><span><span class="comp">${esc(i.component)}</span>${i.purpose ? ` – <span class="purpose">${esc(i.purpose)}</span>` : ''}${i.category ? ` ${tag(i.category, i.category === 'Performance' ? 'red' : i.category === 'Zuverlässigkeit' ? 'info' : '')}` : ''}</span></li>`).join('')}</ul>` : ''}
    ${u.notes ? `<div class="upg-note">${esc(u.notes)}</div>` : ''}
    ${sourceLinks(u.sources || u.url)}
  </div></article>`;
}

// News-Karte. Bebildert mit unseren eigenen Fotos: Auto des erstgenannten
// Fahrers, sonst das Auto des Teams. Pressefotos der Quelle werden nicht übernommen.
function newsCard(n, lead = false, { image = true } = {}) {
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

function newsStamp(nw) {
  if (!nw?.updatedAt) return '';
  const d = new Date(nw.updatedAt);
  return `<div class="src">${nw.rss ? 'Schlagzeilen und Kurztexte von Formel1.de und Formula1.com, automatisch alle 2 Stunden abgerufen. Der ganze Artikel öffnet sich auf der Seite der Quelle.' : 'Redaktionelle Zusammenfassung'} · Stand ${fmtDate(d, { day: 'numeric', month: 'long' })}, ${fmtTime(d)}</div>`;
}

function editorialStamp(ed) {
  if (!ed?.generatedAt) return '';
  return `<div class="src">Stand: ${fmtDate(new Date(ed.generatedAt), { day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(new Date(ed.generatedAt))} · ${ed.source === 'ai' ? 'automatisch recherchiert und zusammengefasst (KI)' : 'manuell recherchiert'}</div>`;
}

function podiumMini(race) {
  return race.Results.slice(0, 3).map(r => `<span class="mini-pod" ${teamStyle(r.Constructor.constructorId)}><i>${r.position}</i><span class="dot"></span>${esc(r.Driver.code || r.Driver.familyName)}</span>`).join('');
}


const contractFor = (ed, id) => (ed?.contracts || []).find(c => c.driverId === id);
const teamOf = s => s.Constructors.at(-1).constructorId;

// Fahrerkarte: einheitliches Action-Foto des Autos + rundes Porträt.
function driverCard(s, ed, { size = '' } = {}) {
  const D = s.Driver, tid = teamOf(s), T = team(tid);
  const c = contractFor(ed, D.driverId);
  return `<a class="driver-card ${size}" href="#/driver/${D.driverId}" ${teamStyle(tid)} data-search="${esc((D.givenName + ' ' + D.familyName + ' ' + T.short + ' ' + D.code).toLowerCase())}" data-team="${tid}">
    <div class="dc-photo">${img('driverCars', D.driverId, null, { width: 800, alt: `${D.familyName} im ${T.car}`, fallback: 'cars:' + tid })}</div>
    <div class="dc-shade"></div>
    <div class="dc-top"><span class="dc-pos">P${s.position || '–'}</span>${natFlag(D.nationality, 14)}</div>
    <div class="dc-info">
      <div class="dc-num">${esc(D.permanentNumber || '')}</div>
      <div class="dc-first">${esc(D.givenName)}</div><div class="dc-last">${esc(D.familyName)}</div>
      <div class="dc-team">${esc(T.short)}</div>
    </div>
    <div class="dc-ava">${img('drivers', D.driverId, D.url, { width: 330, alt: '' })}</div>
    <div class="dc-foot"><span class="dc-pts">${s.points} <small>PKT</small></span>${c ? contractTag(c) : s.active === false ? tag('Kein Stammplatz') : ''}</div>
  </a>`;
}

function shareButton(title) {
  then(() => document.querySelectorAll('[data-share]').forEach(b => b.onclick = async () => {
    const data = { title, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); b.textContent = 'Link kopiert ✓'; } } catch { /* abgebrochen */ }
  }));
  return `<button class="btn ghost small" data-share>Teilen</button>`;
}

// ======================================================================
// Startseite
// ======================================================================
async function home() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const next = nextRace(core);
  const last = lastRaceRound(core);
  const maxD = +core.drivers[0]?.points || 1, maxC = +core.constructors[0]?.points || 1;
  const tm = titleMath(core);
  const leader = core.drivers[0];
  const lastRace = last ? await loadLastRace().catch(() => null) : null;
  const ls = liveSession(core);

  const hero = next ? `<section class="hero">
      <div class="hero-media">${img('driverCars', leader?.Driver.driverId, null, { width: 1920, eager: true, fallback: 'cars:' + (leader ? teamOf(leader) : '') })}</div>
      <div class="hero-body">
        <div>
          <div class="round">${tag('Round ' + next.round, 'red')} ${next.Sprint ? tag('Sprint-Wochenende') : ''} ${ls ? '<a href="#/live" class="tag red live-tag">● LIVE · ' + esc(ls.session.name) + '</a>' : ''}</div>
          <h1>${esc(next.raceName)}</h1>
          <div class="sub">${countryFlag(next.Circuit.Location.country, 16)} &nbsp;${esc(next.Circuit.circuitName)} · ${weekendRange(next)}</div>
          <div class="hero-actions"><a class="btn" href="#/race/${next.round}">Rennwochenende</a><a class="btn ghost" href="#/live">Live-Center</a><a class="btn ghost" href="#/tipp/next">Jetzt tippen</a></div>
        </div>
        <div class="hero-side">${countdown(sessionsOf(next).find(s => s.start > now())?.start || toDate(next.date, next.time))}${sessionTable(next)}</div>
      </div></section>` : `<section class="page-head"><h1>Saison ${esc(core.season)} beendet</h1><p>Die neue Saison erscheint hier automatisch, sobald der Kalender veröffentlicht ist.</p></section>`;

  // KI-Texte nur zeigen, solange sie frisch sind (die KI-Recherche ist optional).
  const aiFresh = ed?.source === 'ai' && Date.now() - Date.parse(ed.generatedAt) < 3 * 86400e3;
  const prog = aiFresh ? ed?.predictions : null;
  // Titelchancen: eigene Simulation, sobald die Saisonresultate da sind.
  if (!tm.clinched && tm.races) then(async () => {
    const box = document.getElementById('odds');
    const res = await loadResults().catch(() => null);
    if (!box || !res?.races.length) return;
    // Alle, die rechnerisch noch Weltmeister werden können – auch wenn die
    // Simulation sie nie vorne sah ("< 0,1 %"), und nie "100 %" vor der Entscheidung.
    const sim = new Map(titleOdds(core, res).map(o => [o.driverId, o]));
    const lead = +core.drivers[0].points;
    const fmt = n => n.toLocaleString('de-CH', { maximumFractionDigits: 1 });
    const odds = core.drivers.filter(s => s.active !== false && +s.points + tm.maxDriver >= lead).map(s => {
      const c = sim.get(s.Driver.driverId)?.chance || 0;
      return { name: s.Driver.familyName, team: teamOf(s), chance: c, label: c >= 99.95 ? '>99,9' : c < 0.1 ? '<0,1' : fmt(c) };
    }).sort((a, b) => b.chance - a.chance).slice(0, 4);
    if (odds.length) box.innerHTML = `<div class="kicker">Titelchancen</div>${odds.map(probRow).join('')}<div class="muted" style="font-size:12px;margin-top:6px">Simulation: restliche Rennen 4000-mal ausgespielt, gewichtet nach der Form der letzten 6 Rennen.</div>`;
  });
  const titleBox = `<div class="card">${cardHead('Titelkampf', tm.clinched ? tag('Entschieden', 'ok') : tag(`${tm.races} Rennen · ${tm.sprints} Sprint${tm.sprints === 1 ? '' : 's'} übrig`))}<div class="card-pad">
      <div class="grid g2" style="gap:12px">
        <div class="stat compact"><span class="k">Vorsprung</span><span class="v">${tm.gap}</span><span class="s">${tm.leader ? esc(tm.leader.Driver.familyName) : ''} vor ${tm.second ? esc(tm.second.Driver.familyName) : ''}</span></div>
        <div class="stat compact"><span class="k">Noch zu holen</span><span class="v">${tm.maxDriver}</span><span class="s">Punkte maximal</span></div>
      </div>
      <div class="mt" id="odds"></div>
      ${prog?.summary ? `<p class="muted" style="font-size:14px;margin:12px 0 0">${esc(prog.summary)}</p>` : ''}
      <a class="link-arrow mt" href="#/simulator">Selbst durchrechnen im WM-Simulator</a>
    </div></div>`;

  const nw = await loadNews().catch(() => null);
  const newsList = (nw?.items || []).slice(0, 5);
  const latestUpg = latestUpgradeRound(ed);

  then(() => T.homeTipCard(document.getElementById('tipcard')));
  return `<div id="tipcard" class="tipcard-slot"></div>${hero}
  <section class="section grid g-main">
    <div class="card">${cardHead('Fahrer-WM', '<a class="muted" href="#/standings" style="font-size:13px">Komplett ›</a>')}${tableOf(core.drivers.slice(0, 10).map(s => standingRow(s, maxD)).join(''))}</div>
    <div class="stack">
      ${titleBox}
      <div class="card">${cardHead('Konstrukteurs-WM', '<a class="muted" href="#/standings?c" style="font-size:13px">Komplett ›</a>')}${tableOf(core.constructors.slice(0, 6).map(s => constructorRow(s, maxC)).join(''))}</div>
    </div>
  </section>
  ${newsList.length ? `<section class="section">${sectionHead('Latest', '#/news')}<div class="grid g3 news-grid">${newsList.map((n, i) => newsCard(n, i === 0)).join('')}</div>${newsStamp(nw)}</section>` : ''}
  <section class="section grid g2">
    ${lastRace ? `<div class="card">${cardHead(esc(lastRace.raceName), `<a class="muted" href="#/race/${lastRace.round}" style="font-size:13px">Ergebnis & Strategie ›</a>`)}
        ${tableOf(lastRace.Results.slice(0, 10).map(r => `<tr ${teamStyle(r.Constructor.constructorId)}><td class="pos">${r.positionText}</td><td><a class="who" href="#/driver/${r.Driver.driverId}"><span class="team-bar"></span>${driverName(r.Driver)}</a></td><td class="r muted hide-sm num">${esc(r.Time?.time || r.status)}</td><td class="pts">${+r.points ? '+' + r.points : ''}</td></tr>`).join(''))}</div>` : ''}
    ${latestUpg ? `<div><div class="section-head"><h2>Neue Teile · ${esc(raceShort(latestUpg.race))}</h2><a class="link" href="#/upgrades">Alle Upgrades</a></div><div class="stack">${latestUpg.list.filter(u => u.items?.length).slice(0, 4).map(u => upgradeCard(u)).join('')}</div></div>` : ''}
  </section>
  ${prog?.storylines?.length ? `<section class="section">${sectionHead('Storylines')}<div class="grid g3">${prog.storylines.map(s => `<div class="card card-pad story"><h3>${esc(s.title)}</h3><p class="muted" style="margin:8px 0 0;font-size:14px">${esc(s.text)}</p></div>`).join('')}</div></section>` : ''}
  <section class="section">${sectionHead('Drivers', '#/drivers')}<div class="grid g4">${core.drivers.slice(0, 4).map(s => driverCard(s, ed)).join('')}</div></section>
  <section class="section grid g3 quick">
    <a class="quick-card" href="#/simulator"><span class="qi">🧮</span><b>WM-Simulator</b><span>Wer wird Weltmeister, wenn …?</span></a>
    <a class="quick-card" href="#/compare"><span class="qi">⚖️</span><b>Fahrervergleich</b><span>Zwei Fahrer im direkten Duell</span></a>
    <a class="quick-card" href="#/tipp"><span class="qi">🏆</span><b>Tippspiel</b><span>Mit Freunden tippen, Punkte sammeln</span></a>
  </section>`;
}

function probRow(p) {
  return `<div class="prob-row" ${teamStyle(p.team || '')}><span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name || p.driverId || p.team)}</span><div class="bar"><i style="width:${Math.min(100, p.chance)}%"></i></div><span class="pct">${esc(p.label ?? p.chance)}%</span></div>`;
}

function latestUpgradeRound(ed) {
  const ups = (ed?.upgrades || []).filter(u => u.items?.length);
  if (!ups.length) return null;
  const maxRound = Math.max(...ups.map(u => +u.round));
  const list = (ed.upgrades).filter(u => +u.round === maxRound);
  return { round: maxRound, race: list[0].race, list };
}

// ======================================================================
// Kalender & Rennen
// ======================================================================
async function schedule() {
  const core = await loadCore();
  const next = nextRace(core);
  then(async () => {
    const res = await loadResults().catch(() => null);
    if (!res) return;
    for (const r of res.races) {
      const el = document.querySelector(`[data-pod="${r.round}"]`);
      if (el) el.innerHTML = podiumMini(r);
    }
  });
  return `${pageHead(`F1 Schedule ${esc(core.season)}`, `${core.schedule.length} Rennwochenenden, davon ${core.schedule.filter(r => r.Sprint).length} mit Sprint. Zeiten in deiner lokalen Zeitzone.`)}
  ${calendarButtons(core)}
  <div class="grid g-auto mt">${core.schedule.map(r => {
    const done = sessionEnd(sessionsOf(r).at(-1)) < now();
    const isNext = next && next.round === r.round;
    return `<a class="race-card ${done ? 'past' : ''} ${isNext ? 'next' : ''}" href="#/race/${r.round}">
      <div class="rc-map">${img('circuits', r.Circuit.circuitId, r.Circuit.url, { width: 330, alt: '' })}</div>
      <span class="rc-flag">${countryFlag(r.Circuit.Location.country, 22)}</span>
      <span class="rc-round">Round ${r.round}${r.Sprint ? ' · Sprint' : ''}${isNext ? ' · Next' : ''}</span>
      <span class="rc-dates">${weekendRange(r)}</span>
      <span class="rc-name">${esc(r.raceName)}</span>
      <span class="rc-circ">${esc(r.Circuit.circuitName)}</span>
      <span class="rc-podium" data-pod="${r.round}">${done ? '<span class="skeleton" style="width:160px;height:22px"></span>' : ''}</span>
    </a>`;
  }).join('')}</div>`;
}

async function raceDetail(round) {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const race = core.schedule.find(r => r.round === round);
  if (!race) return notFound();
  const done = sessionEnd(sessionsOf(race).at(-1)) < now();
  const started = sessionsOf(race)[0].start < now();
  const res = started ? await loadResults().catch(() => null) : null;
  const R = res?.races.find(r => r.round === round);
  const S = res?.sprints.find(r => r.round === round);
  const Q = res?.quali.find(r => r.round === round);
  const ups = (ed?.upgrades || []).filter(u => u.round == round).sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0));
  const pens = (ed?.penalties?.grid || []).filter(p => p.round == round);
  const info = ed?.circuits?.[race.Circuit.circuitId] || {};
  const wx = await weatherBlock(race);

  const list = [
    R && { id: 'race', label: 'Race', html: resultTable(R.Results) },
    R && { id: 'strat', label: 'Strategie', html: strategyPane(core, race, 'Race') },
    S && { id: 'sprint', label: 'Sprint', html: resultTable(S.SprintResults) },
    Q && { id: 'quali', label: 'Qualifying', html: qualiTable(Q.QualifyingResults) },
  ].filter(Boolean);
  const t = list.length ? tabs(list) : null;
  const facts = Object.entries(info).filter(([k]) => k !== 'notes');

  return `<div class="page-head">
      <div class="kicker">Round ${race.round} · ${weekendRange(race)} ${race.Sprint ? '· Sprint-Wochenende' : ''}</div>
      <div class="split" style="align-items:flex-end;flex-wrap:wrap"><h1>${esc(race.raceName)}</h1>${shareButton(race.raceName)}</div>
      <p>${countryFlag(race.Circuit.Location.country, 16)} &nbsp;${esc(race.Circuit.circuitName)}, ${esc(race.Circuit.Location.locality)}, ${esc(race.Circuit.Location.country)}</p>
    </div>
    <div class="grid g-main">
      <div class="stack">
        ${t ? `<div class="card"><div class="card-head">${t.buttons}</div>${t.panes}</div>` : `<div class="card card-pad">${empty(done ? 'Ergebnisse folgen in Kürze.' : started ? 'Das Wochenende läuft. Ergebnisse erscheinen hier nach Sprint, Qualifying und Rennen. Live-Daten gibt es im Live-Center.' : 'Noch keine Ergebnisse. Das Wochenende hat noch nicht begonnen.')}</div>`}
        ${pens.length ? `<div class="card">${cardHead('Strafen an diesem Wochenende')}<div class="card-pad">${pens.map(p => { const s = core.drivers.find(d => d.Driver.driverId === p.driverId); return `<div class="pen-row" ${teamStyle(s ? teamOf(s) : '')}><span class="team-bar"></span><div><div class="split"><span>${s ? driverName(s.Driver) : esc(p.driverId)}</span>${tag(p.penalty, 'red')}</div><div class="muted" style="font-size:13px">${esc(p.reason || '')}</div></div></div>`; }).join('')}</div></div>` : ''}
        ${ups.length ? `<div>${sectionHead('Upgrades an diesem Wochenende', '#/upgrades', 'Alle Upgrades')}<div class="stack">${ups.map(u => upgradeCard(u)).join('')}</div></div>` : ''}
      </div>
      <div class="stack">
        <div class="card">${cardHead('Zeitplan', '<span class="muted" style="font-size:12px">Lokale Zeit</span>')}<div class="card-pad">${sessionTable(race)}</div></div>
        ${wx}
        <div class="card">${cardHead('Strecke', `<a class="muted" style="font-size:12px" href="#/circuit/${race.Circuit.circuitId}">Streckenguide ›</a>`)}
          <div class="card-pad"><div class="track-map" style="position:relative">${img('circuits', race.Circuit.circuitId, race.Circuit.url, { width: 800, alt: 'Streckenlayout' })}<button class="credit-btn" hidden style="position:absolute;right:8px;bottom:8px">i</button></div>
          ${facts.length ? `<div class="facts f2 mt">${facts.map(([k, v]) => `<div class="fact"><div class="k">${esc(k)}</div><div class="v small">${esc(v)}</div></div>`).join('')}</div>` : ''}
          ${info.notes ? `<p class="muted" style="font-size:14px;margin-bottom:0">${esc(info.notes)}</p>` : ''}
          </div></div>
        ${!done ? tvBox() : ''}
      </div>
    </div>`;
}

function resultTable(rows) {
  const fl = rows.find(r => r.FastestLap?.rank === '1');
  return tableOf(rows.map(r => {
    const gained = classified(r) && +r.grid > 0 ? +r.grid - +r.position : null;
    return `<tr ${teamStyle(r.Constructor.constructorId)}>
      <td class="pos">${r.positionText}</td>
      <td><a class="who" href="#/driver/${r.Driver.driverId}"><span class="team-bar"></span><span class="ava">${img('drivers', r.Driver.driverId, r.Driver.url, { width: 120 })}</span><span>${driverName(r.Driver)}<div class="sub">${esc(team(r.Constructor.constructorId).short)}</div></span></a></td>
      <td class="hide-sm muted num">${r.grid === '0' ? 'Box' : 'P' + r.grid}${gained ? ` <span style="color:${gained > 0 ? '#5fe39a' : '#ff6b6b'}">${gained > 0 ? '▲' : '▼'}${Math.abs(gained)}</span>` : ''}</td>
      <td class="r num">${esc(r.Time?.time || r.status)}${fl === r ? ' <span class="fastest" title="Schnellste Runde">⏱</span>' : ''}</td>
      <td class="pts">${+r.points ? r.points : ''}</td></tr>`;
  }).join(''), `<thead><tr><th>Pos</th><th>Fahrer</th><th class="hide-sm">Start</th><th class="r">Zeit/Status</th><th class="r">Pkt</th></tr></thead>`);
}
function qualiTable(rows) {
  return tableOf(rows.map(r => `<tr ${teamStyle(r.Constructor.constructorId)}>
      <td class="pos">${r.position}</td>
      <td><a class="who" href="#/driver/${r.Driver.driverId}"><span class="team-bar"></span>${driverName(r.Driver)}</a></td>
      <td class="num hide-sm">${esc(r.Q1 || '')}</td><td class="num hide-sm">${esc(r.Q2 || '')}</td><td class="num">${esc(r.Q3 || '')}</td></tr>`).join(''),
    `<thead><tr><th>Pos</th><th>Fahrer</th><th class="hide-sm">Q1</th><th class="hide-sm">Q2</th><th>Q3</th></tr></thead>`);
}

async function resultsPage() {
  const [core, res] = await Promise.all([loadCore(), loadResults()]);
  const poles = new Map(res.quali.map(q => [q.round, q.QualifyingResults[0]]));
  const rows = [...res.races].reverse().map(r => {
    const w = r.Results[0], p = poles.get(r.round), fl = r.Results.find(x => x.FastestLap?.rank === '1');
    return `<tr ${teamStyle(w.Constructor.constructorId)} class="clickable" onclick="location.hash='#/race/${r.round}'">
      <td class="pos">${r.round}</td>
      <td>${countryFlag(r.Circuit.Location.country, 12)} <b>${esc(raceShort(r.raceName))}</b><div class="muted" style="font-size:13px">${fmtDate(toDate(r.date), { day: 'numeric', month: 'short' })}</div></td>
      <td><span class="who"><span class="team-bar"></span><span class="ava">${img('drivers', w.Driver.driverId, w.Driver.url, { width: 120 })}</span>${driverName(w.Driver)}</span></td>
      <td class="hide-sm">${p ? esc(p.Driver.familyName) : '–'}</td>
      <td class="hide-sm">${fl ? `<span class="fastest">${esc(fl.Driver.familyName)}</span>` : '–'}</td>
      <td class="r num hide-sm">${esc(w.Time?.time || '')}</td></tr>`;
  }).join('');
  return `${pageHead(`Results ${esc(core.season)}`, 'Alle bisherigen Grands Prix. Ein Klick auf ein Rennen zeigt Rennen, Strategie, Sprint und Qualifying.')}
    <div class="card">${tableOf(rows, '<thead><tr><th>Rd</th><th>Grand Prix</th><th>Sieger</th><th class="hide-sm">Pole</th><th class="hide-sm">Schnellste Runde</th><th class="r hide-sm">Zeit</th></tr></thead>')}</div>`;
}

// ======================================================================
// WM-Stand
// ======================================================================
async function standings() {
  const core = await loadCore();
  const showC = location.hash.includes('?c');
  const maxD = +core.drivers[0]?.points || 1, maxC = +core.constructors[0]?.points || 1;
  const t = tabs([
    { id: 'd', label: 'Fahrer', html: `<div class="card">${tableOf(core.drivers.map(s => standingRow(s, maxD)).join(''), '<thead><tr><th>Pos</th><th>Fahrer</th><th class="hide-sm"></th><th class="r hide-sm">Siege</th><th class="r">Pkt</th></tr></thead>')}</div>` },
    { id: 'c', label: 'Konstrukteure', html: `<div class="card">${tableOf(core.constructors.map(s => constructorRow(s, maxC)).join(''), '<thead><tr><th>Pos</th><th>Team</th><th class="hide-sm"></th><th class="r hide-sm">Siege</th><th class="r">Pkt</th></tr></thead>')}</div>` },
  ], { active: showC ? 1 : 0 });
  then(async () => {
    const res = await loadResults().catch(() => null);
    const box = document.getElementById('chart');
    if (!res || !box) return;
    const { rounds, series } = pointsProgression(res);
    const top = core.drivers.slice(0, 6);
    box.innerHTML = lineChart(top.map((s, i) => ({
      label: s.Driver.code, color: team(teamOf(s)).color, values: series.get(s.Driver.driverId) || [],
      dash: top.findIndex(x => teamOf(x) === teamOf(s)) !== i,
    })), { xLabels: rounds.map(r => 'R' + r), label: 'Punkteverlauf' });
  });
  return `${pageHead(`Standings ${esc(core.season)}`, `Stand nach Runde ${core.standingsRound}.`)}
    <div style="margin-bottom:16px">${t.buttons}</div>${t.panes}
    <section class="section"><div class="card">${cardHead('Punkteverlauf Top 6', '<span class="muted" style="font-size:12px">Rennen + Sprints, kumuliert</span>')}<div class="card-pad" id="chart">${loadingBox(300)}</div></div></section>`;
}

// ======================================================================
// Fahrer
// ======================================================================
async function drivers() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const teamsIn = [...new Set(core.drivers.map(teamOf))];
  then(() => {
    const q = document.getElementById('q');
    let teamF = '';
    const apply = () => {
      const v = q.value.trim().toLowerCase();
      document.querySelectorAll('.driver-card').forEach(c => c.hidden = (v && !c.dataset.search.includes(v)) || (teamF && c.dataset.team !== teamF));
    };
    q.oninput = apply;
    document.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => {
      teamF = b.dataset.tf;
      document.querySelectorAll('[data-tf]').forEach(x => x.classList.toggle('active', x === b));
      apply();
    });
  });
  const active = core.drivers.filter(s => s.active !== false), others = core.drivers.filter(s => s.active === false);
  return `${pageHead(`F1 Drivers ${esc(core.season)}`, 'Alle Fahrer der aktuellen Saison, sortiert nach WM-Stand. Das Badge zeigt den Vertragsstatus für die nächste Saison.', '', '<a class="btn ghost small" href="#/compare">Fahrer vergleichen</a>')}
    <div class="toolbar"><input class="input" id="q" type="search" placeholder="Fahrer, Team oder Kürzel suchen…"></div>
    <div class="chips"><button class="chip active" data-tf="">Alle</button>${teamsIn.map(t => `<button class="chip" data-tf="${t}" ${teamStyle(t)}><span class="dot"></span>${esc(team(t).short)}</button>`).join('')}</div>
    <div class="grid g3">${active.map(s => driverCard(s, ed)).join('')}</div>
    ${others.length ? `<section class="section">${sectionHead('Weitere Fahrer dieser Saison')}<div class="grid g3">${others.map(s => driverCard(s, ed)).join('')}</div></section>` : ''}`;
}

async function driverDetail(id) {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const s = core.drivers.find(x => x.Driver.driverId === id);
  if (!s) return notFound();
  const D = s.Driver, tid = teamOf(s), T = team(tid);
  const res = await loadResults().catch(() => null);
  const st = res ? seasonStats(res).get(id) : null;
  const h2h = res ? headToHead(res).find(p => p.team === tid && (p.a === id || p.b === id)) : null;
  const mate = h2h ? (h2h.a === id ? h2h.b : h2h.a) : null;
  const mateD = core.drivers.find(x => x.Driver.driverId === mate)?.Driver;
  const contract = contractFor(ed, id);
  const note = ed?.driverNotes?.[id];
  const age = D.dateOfBirth ? Math.floor((Date.now() - new Date(D.dateOfBirth)) / (365.25 * 86400e3)) : null;
  const news = ((await loadNews().catch(() => null))?.items || []).filter(n => (n.drivers || []).includes(id));
  const sl =(ed?.penalties?.superlicence || []).find(x => x.driverId === id);
  const pu = ed?.penalties?.pu?.usage?.[id];

  then(async () => {
    const box = document.getElementById('career');
    const c = await driverCareer(id).catch(() => null);
    if (!c || !box) return;
    box.innerHTML = [['Saisons', c.seasons], ['Starts', c.starts], ['Siege', c.wins], ['Podien', c.podiums], ['Poles', c.poles], ['WM-Titel', c.titles]].map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v ?? '–'}</div></div>`).join('');
  });

  // Formkurve: Punkte pro Wochenende
  const form = res ? res.races.map(r => {
    const x = r.Results.find(y => y.Driver.driverId === id);
    const sp = res.sprints.find(y => y.round === r.round)?.SprintResults.find(y => y.Driver.driverId === id);
    return { label: String(r.round), value: (x ? +x.points : 0) + (sp ? +sp.points : 0), href: `#/race/${r.round}`, title: `${r.raceName}: ${x ? (classified(x) ? 'P' + x.position : x.status) : 'nicht gestartet'}` };
  }) : [];

  const raceRows = res ? res.races.map(r => {
    const x = r.Results.find(y => y.Driver.driverId === id);
    const sp = res.sprints.find(y => y.round === r.round)?.SprintResults.find(y => y.Driver.driverId === id);
    const q = res.quali.find(y => y.round === r.round)?.QualifyingResults.find(y => y.Driver.driverId === id);
    if (!x) return '';
    const pts = +x.points + (sp ? +sp.points : 0);
    return `<tr class="clickable" onclick="location.hash='#/race/${r.round}'"><td class="pos">${r.round}</td><td>${countryFlag(r.Circuit.Location.country, 12)} &nbsp;${esc(raceShort(r.raceName))}</td><td class="num hide-sm">${q ? 'P' + q.position : '–'}</td><td class="num hide-sm">${sp ? 'P' + sp.positionText : ''}</td><td class="num"><b>${classified(x) ? 'P' + x.position : esc(x.status)}</b>${x.FastestLap?.rank === '1' ? ' <span class="fastest">⏱</span>' : ''}</td><td class="pts">${pts || ''}</td></tr>`;
  }).reverse().join('') : '';

  return `<section class="detail-hero" ${teamStyle(tid)}>
      <div class="dh-photo">${img('driverCars', id, null, { width: 1920, eager: true, alt: `${D.familyName} im ${T.car}`, fallback: 'cars:' + tid })}<button class="credit-btn" hidden title="Bildnachweis">i</button></div>
      <div class="dh-shade"></div>
      <div class="dh-body">
        <div class="dh-ava">${img('drivers', id, D.url, { width: 330, alt: D.familyName })}</div>
        <div>
          <div class="dh-meta">${natFlag(D.nationality, 16)} <span class="dh-num">${esc(D.permanentNumber || '')}</span> ${contract ? contractTag(contract) : ''}</div>
          <h1>${esc(D.givenName)} <span class="hl">${esc(D.familyName)}</span></h1>
          <div class="dh-sub"><a href="#/team/${tid}">${esc(T.short)}</a> · P${s.position} · ${s.points} Punkte</div>
        </div>
      </div>
    </section>
    <div class="actions-row">${shareButton(`${D.givenName} ${D.familyName}`)}<a class="btn ghost small" href="#/compare?a=${id}${mate ? '&b=' + mate : ''}">Vergleichen</a></div>

    <section class="section">${sectionHead('Saison ' + esc(core.season))}
      <div class="facts f5">
        ${[['WM-Position', 'P' + s.position], ['Punkte', s.points], ['Siege', st?.wins ?? s.wins], ['Podien', st?.podiums ?? '–'], ['Poles', st?.poles ?? '–'], ['Schnellste Runden', st?.fastest ?? '–'], ['Ausfälle', st?.dnf ?? '–'], ['Ø Zielposition', st?.avg ? st.avg.toFixed(1) : '–'], ['Plätze gutgemacht', st ? (st.gained > 0 ? '+' : '') + st.gained : '–'], ['Sprint-Siege', st?.sprintWins ?? '–']].map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}
      </div>
      ${form.length ? `<div class="card mt">${cardHead('Punkte pro Wochenende')}<div class="card-pad">${barChart(form, { color: T.color })}</div></div>` : ''}
    </section>

    <section class="section grid g-main">
      <div class="stack">
        ${note ? `<div class="card card-pad"><div class="kicker">Formkurve & Einordnung</div><p style="margin:8px 0 0">${esc(note.text || note)}</p>${note.form ? `<div class="mt">${tag('Form: ' + note.form, note.form === 'stark' ? 'ok' : note.form === 'schwach' ? 'warn' : '')}</div>` : ''}${editorialStamp(ed)}</div>` : ''}
        <div class="card">${cardHead('Rennen ' + esc(core.season))}${raceRows ? tableOf(raceRows, '<thead><tr><th>Rd</th><th>GP</th><th class="hide-sm">Quali</th><th class="hide-sm">Sprint</th><th>Rennen</th><th class="r">Pkt</th></tr></thead>') : empty('Noch keine Rennen.')}</div>
      </div>
      <div class="stack">
        <div class="card">${cardHead('Vertrag & Zukunft')}<div class="card-pad">
          ${contract ? `<div class="split"><span class="muted">Nächste Saison</span><b>${contract.team2027 ? esc(team(contract.team2027).short) : 'offen'}</b></div>
            <div class="split mt"><span class="muted">Status</span>${contractTag(contract)}</div>
            ${contract.until ? `<div class="split mt"><span class="muted">Vertrag bis</span><b>${esc(contract.until)}</b></div>` : ''}
            ${contract.note ? `<p class="muted" style="font-size:14px">${esc(contract.note)}</p>` : ''}${sourceLinks(contract.sources)}` : empty('Keine Vertragsinfos vorhanden.')}
        </div></div>
        ${h2h && mateD ? `<div class="card">${cardHead('Teamduell', `<a class="muted" style="font-size:13px" href="#/compare?a=${id}&b=${mate}">vs. ${esc(mateD.familyName)} ›</a>`)}<div class="card-pad">
          ${[['Qualifying', h2h.quali], ['Rennen', h2h.race]].map(([l, o]) => duel(l, o[id] || 0, o[mate] || 0, T.color)).join('')}
        </div></div>` : ''}
        ${sl || pu ? `<div class="card">${cardHead('Strafen & Motor', '<a class="muted" style="font-size:13px" href="#/penalties">Alle ›</a>')}<div class="card-pad stack" style="gap:8px">
          ${sl ? `<div class="split"><span class="muted">Strafpunkte Superlizenz</span><b>${sl.points} / 12</b></div>` : ''}
          ${pu ? Object.entries(pu).map(([k, v]) => `<div class="split"><span class="muted">${esc(k)}</span><b>${v}${ed.penalties.pu.allocation?.[k] ? ' / ' + ed.penalties.pu.allocation[k] : ''}</b></div>`).join('') : ''}
        </div></div>` : ''}
        <div class="card">${cardHead('Karriere')}<div class="facts f3" id="career" style="border:0;border-radius:0">${'<div class="fact"><div class="skeleton" style="height:44px"></div></div>'.repeat(6)}</div></div>
        <div class="card">${cardHead('Persönlich')}<div class="card-pad stack" style="gap:8px">
          <div class="split"><span class="muted">Nationalität</span><b>${natFlag(D.nationality)} ${esc(D.nationality)}</b></div>
          <div class="split"><span class="muted">Geboren</span><b>${D.dateOfBirth ? fmtDate(new Date(D.dateOfBirth), { day: 'numeric', month: 'long', year: 'numeric' }) : '–'}${age ? ` (${age})` : ''}</b></div>
          <div class="split"><span class="muted">Kürzel / Nr.</span><b>${esc(D.code)} · #${esc(D.permanentNumber)}</b></div>
          <div class="split"><span class="muted">Auto</span><b>${esc(ed?.teamInfo?.[tid]?.car || T.car)}</b></div>
          <a class="muted" href="${esc(D.url)}" target="_blank" rel="noopener" style="font-size:13px">Wikipedia ›</a>
        </div></div>
      </div>
    </section>
    ${news.length ? `<section class="section">${sectionHead('News')}<div class="grid g3">${news.slice(0, 6).map(n => newsCard(n)).join('')}</div></section>` : ''}`;
}

function duel(label, a, b, color) {
  const tot = a + b || 1;
  return `<div style="margin-bottom:14px"><div class="split" style="font-size:14px"><b>${a}</b><span class="muted">${label}</span><b>${b}</b></div>
    <div class="duel-bar"><i style="width:${(a / tot) * 100}%;background:${color}"></i><i style="width:${(b / tot) * 100}%;background:rgba(255,255,255,.35)"></i></div></div>`;
}

// ======================================================================
// Teams
// ======================================================================
async function teams() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  return `${pageHead(`F1 Teams ${esc(core.season)}`, 'Alle Teams mit Auto, Motor, Fahrern und WM-Stand.')}
    <div class="grid g2">${core.constructors.map(s => {
      const id = s.Constructor.constructorId, T = team(id);
      const ds = core.drivers.filter(d => d.active !== false && teamOf(d) === id);
      const info = ed?.teamInfo?.[id] || {};
      return `<a class="team-card" href="#/team/${id}" ${teamStyle(id)}>
        <div class="tc-car">${img('cars', id, null, { width: 800, alt: T.car })}</div>
        <div class="tc-shade"></div>
        <div class="tc-top"><div><div class="tc-name display">${esc(T.short)}</div><div class="tc-sub">${esc(info.car || T.car)} · ${esc(info.powerUnit || T.pu)}</div></div><div class="tc-pos">P${s.position}</div></div>
        <div class="tc-drivers">${ds.map(d => `<span class="tc-drv"><span class="ava">${img('drivers', d.Driver.driverId, d.Driver.url, { width: 120 })}</span>${esc(d.Driver.givenName)} <b>${esc(d.Driver.familyName)}</b></span>`).join('')}</div>
        <div class="tc-foot"><span>${s.wins} ${s.wins == 1 ? 'Sieg' : 'Siege'}</span><b>${s.points} Pkt</b></div>
      </a>`;
    }).join('')}</div>`;
}

async function teamDetail(id) {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const s = core.constructors.find(x => x.Constructor.constructorId === id);
  if (!s) return notFound();
  const T = team(id);
  const info = ed?.teamInfo?.[id] || {};
  const ds = core.drivers.filter(d => d.active !== false && teamOf(d) === id);
  const res = await loadResults().catch(() => null);
  const ups = (ed?.upgrades || []).filter(u => u.team === id).sort((a, b) => b.round - a.round);
  const news = ((await loadNews().catch(() => null))?.items || []).filter(n => n.team === id || (n.teams || []).includes(id));
  let podiums = 0, dnf = 0, poles = 0;
  if (res) {
    res.races.forEach(r => r.Results.forEach(x => { if (x.Constructor.constructorId === id) { if (classified(x) && +x.position <= 3) podiums++; if (!classified(x)) dnf++; } }));
    res.quali.forEach(q => { if (q.QualifyingResults[0]?.Constructor.constructorId === id) poles++; });
  }
  const perRace = res ? res.races.map(r => {
    const pts = r.Results.filter(x => x.Constructor.constructorId === id).reduce((a, x) => a + +x.points, 0)
      + (res.sprints.find(y => y.round === r.round)?.SprintResults.filter(x => x.Constructor.constructorId === id).reduce((a, x) => a + +x.points, 0) || 0);
    return { label: String(r.round), value: pts, href: `#/race/${r.round}`, title: `${r.raceName}: ${pts} Pkt` };
  }) : [];
  const partCount = ups.reduce((a, u) => a + (u.items?.length || 0), 0);

  return `<section class="detail-hero car" ${teamStyle(id)}>
      <div class="dh-photo">${img('cars', id, null, { width: 1920, eager: true, alt: T.car })}<button class="credit-btn" hidden title="Bildnachweis">i</button></div>
      <div class="dh-shade"></div>
      <div class="dh-body">
        <div>
          <div class="dh-meta"><span class="tag" style="background:var(--team);color:#000">P${s.position} Konstrukteurs-WM</span></div>
          <h1>${esc(T.short)}</h1>
          <div class="dh-sub">${esc(s.Constructor.name)} · ${esc(info.car || T.car)}</div>
          <div class="display" style="font-size:40px;margin-top:8px">${esc(s.points)} <span style="font-size:18px">PKT</span></div>
        </div>
      </div>
    </section>
    <div class="actions-row">${shareButton(T.short)}</div>
    <section class="section"><div class="facts f4">
      ${[['Auto', info.car || T.car], ['Power Unit', info.powerUnit || T.pu], ['Teamchef', info.principal || T.principal], ['Basis', info.base || T.base], ['Siege', s.wins], ['Podien', podiums], ['Poles', poles], ['Neue Teile', partCount]].map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v ${typeof v === 'string' && v.length > 6 ? 'small' : ''}">${esc(v === '' || v == null ? '–' : v)}</div></div>`).join('')}
    </div>${info.note ? `<p class="prose mt">${esc(info.note)}</p>` : ''}</section>
    <section class="section">${sectionHead('Fahrer')}<div class="grid g2">${ds.map(d => driverCard(d, ed)).join('')}</div></section>
    ${perRace.length ? `<section class="section"><div class="card">${cardHead('Punkte pro Wochenende')}<div class="card-pad">${barChart(perRace, { color: T.color })}</div></div></section>` : ''}
    <section class="section">${sectionHead('Upgrades ' + esc(core.season), '#/upgrades')}${ups.length ? `<div class="stack">${ups.map(u => upgradeCard(u, { showRace: true })).join('')}</div>` : empty('Keine Upgrades erfasst.')}</section>
    ${news.length ? `<section class="section">${sectionHead('News')}<div class="grid g3">${news.slice(0, 6).map(n => newsCard(n)).join('')}</div></section>` : ''}`;
}

// ======================================================================
// Upgrades
// ======================================================================
async function upgrades() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const ups = ed?.upgrades || [];
  if (!ups.length) return pageHead('Upgrades') + empty('Noch keine Upgrade-Daten vorhanden.');
  const teamIds = core.constructors.map(c => c.Constructor.constructorId);
  const counts = teamIds.map(t => ({ t, n: ups.filter(u => u.team === t).reduce((a, u) => a + (u.items?.length || 0), 0) })).sort((a, b) => b.n - a.n);
  const maxN = Math.max(1, ...counts.map(c => c.n));
  const rounds = [...new Set(ups.map(u => +u.round))].sort((a, b) => b - a);
  const areas = [...new Set(ups.flatMap(u => (u.items || []).map(i => i.area)).filter(Boolean))].sort();

  then(() => {
    let tf = '', af = '', onlyNew = false;
    const apply = () => {
      document.querySelectorAll('.upg[data-team]').forEach(c => {
        const hasArea = !af || [...c.querySelectorAll('.area')].some(a => a.textContent === af);
        const empty = !c.querySelector('.upg-list');
        c.hidden = (tf && c.dataset.team !== tf) || !hasArea || (onlyNew && empty);
      });
      document.querySelectorAll('.tl-race').forEach(r => r.hidden = ![...r.querySelectorAll('.upg[data-team]')].some(c => !c.hidden));
    };
    document.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => { tf = b.dataset.tf; document.querySelectorAll('[data-tf]').forEach(x => x.classList.toggle('active', x === b)); apply(); });
    document.getElementById('areaF').onchange = e => { af = e.target.value; apply(); };
    document.getElementById('onlyNew').onchange = e => { onlyNew = e.target.checked; apply(); };
  });

  return `${pageHead('Upgrades & Technik', 'Jedes Teil, das die Teams bei der FIA als neu angemeldet haben, mit Bereich und Zweck. Dazu technische Änderungen wie Motorwechsel oder aufgeteilte Spezifikationen.')}
    <div class="card">${cardHead('Neue Teile pro Team', `<span class="muted" style="font-size:12px">${rounds.length} Rennwochenenden erfasst</span>`)}<div class="card-pad">
      ${counts.map(c => `<div class="prob-row" ${teamStyle(c.t)}><a href="#/team/${c.t}" style="font-weight:700">${esc(team(c.t).short)}</a><div class="bar"><i style="width:${(c.n / maxN) * 100}%"></i></div><span class="pct">${c.n}</span></div>`).join('')}
    </div></div>
    <div class="toolbar mt-l"><select class="input" id="areaF"><option value="">Alle Bereiche</option>${areas.map(a => `<option>${esc(a)}</option>`).join('')}</select><label class="check"><input type="checkbox" id="onlyNew"> Nur Teams mit neuen Teilen</label></div>
    <div class="chips"><button class="chip active" data-tf="">Alle Teams</button>${teamIds.map(t => `<button class="chip" data-tf="${t}" ${teamStyle(t)}><span class="dot"></span>${esc(team(t).short)}</button>`).join('')}</div>
    <div class="timeline">${rounds.map(rd => {
      const list = ups.filter(u => +u.round === rd).sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0));
      const race = core.schedule.find(r => +r.round === rd);
      return `<div class="tl-race"><div class="tl-when"><div class="r">R${rd}</div><div class="n">${esc(raceShort(list[0].race || race?.raceName || ''))}</div><div class="d">${race ? weekendRange(race) : ''}</div></div>
        <div class="tl-items">${list.map(u => upgradeCard(u)).join('')}</div></div>`;
    }).join('')}</div>
    ${editorialStamp(ed)}`;
}

// ======================================================================
// Transfers / Verträge
// ======================================================================
async function transfers() {
  const [core, ed] = await Promise.all([loadCore(), loadEditorial()]);
  const contracts = ed?.contracts || [];
  const next = (+core.season || new Date().getFullYear()) + 1;
  const teamIds = core.constructors.map(c => c.Constructor.constructorId);
  const byTeam = id => contracts.filter(c => c.team2027 === id);
  const nameOf = c => {
    const s = core.drivers.find(d => d.Driver.driverId === c.driverId);
    return s ? `<span class="who"><span class="ava">${img('drivers', s.Driver.driverId, s.Driver.url, { width: 120 })}</span>${driverName(s.Driver)}</span>` : `<b>${esc(c.name || c.driverId)}</b>`;
  };
  const confirmed = contracts.filter(c => c.status === 'bestätigt').length;
  const seats = teamIds.length * 2;
  const filled = contracts.filter(c => c.team2027 && ['bestätigt', 'erwartet'].includes(c.status)).length;

  return `${pageHead(`Transfers & Verträge ${next}`, 'Wer fährt nächstes Jahr wo? Status pro Cockpit, Vertragslaufzeiten und die aktuellen Gerüchte.')}
    <div class="grid g4">
      <div class="stat"><span class="k">Cockpits ${next}</span><span class="v">${seats}</span></div>
      <div class="stat"><span class="k">Bestätigt</span><span class="v" style="color:#5fe39a">${confirmed}</span></div>
      <div class="stat"><span class="k">Erwartet</span><span class="v" style="color:#9fb8ff">${contracts.filter(c => c.status === 'erwartet').length}</span></div>
      <div class="stat"><span class="k">Offen</span><span class="v" style="color:#ffcf4d">${Math.max(0, seats - filled)}</span></div>
    </div>
    <section class="section">${sectionHead(`Grid ${next}`)}
      <div class="grid g2 grid-next">${teamIds.map(id => {
        const list = byTeam(id).filter(c => ['bestätigt', 'erwartet'].includes(c.status));
        const seat = i => list[i] ? `<div class="seat">${nameOf(list[i])}<div class="seat-meta">${contractTag(list[i])}${list[i].until ? `<span class="muted">bis ${esc(list[i].until)}</span>` : ''}</div></div>` : `<div class="seat open"><span class="tag warn">Cockpit offen</span></div>`;
        return `<div class="seat-card" ${teamStyle(id)}><div class="seat-team"><span class="team-bar"></span><a href="#/team/${id}"><b>${esc(team(id).short)}</b></a></div>${seat(0)}${seat(1)}</div>`;
      }).join('')}</div>
    </section>
    ${contracts.some(c => c.note) ? `<section class="section">${sectionHead('Details & Gerüchte')}<div class="grid g3">${contracts.filter(c => c.note).map(c => `<div class="card card-pad" ${teamStyle(c.team2027 || c.currentTeam)}><div class="split">${nameOf(c)}${contractTag(c)}</div><p class="muted" style="font-size:14px;margin:10px 0 0">${esc(c.note)}</p>${sourceLinks(c.sources)}</div>`).join('')}</div></section>` : ''}
    ${(ed?.rumours || []).length ? `<section class="section">${sectionHead('Gerüchteküche')}<div class="stack">${ed.rumours.map(r => `<div class="card card-pad"><div class="split"><h3>${esc(r.title)}</h3>${tag(r.likelihood ? 'Wahrscheinlichkeit: ' + r.likelihood : 'Gerücht', 'warn')}</div><p class="muted" style="margin:8px 0 0;font-size:14px">${esc(r.text)}</p>${sourceLinks(r.sources)}</div>`).join('')}</div></section>` : ''}
    ${editorialStamp(ed)}`;
}

// ======================================================================
// News
// ======================================================================
async function news() {
  const nw = await loadNews();
  const list = nw.items || [];
  const order = ['Rennen', 'Technik', 'Transfer', 'Regeln', 'Business', 'News'];
  const cats = [...new Set(list.map(n => n.category).filter(Boolean))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const sources = [...new Set(list.map(n => n.source).filter(Boolean))];
  then(() => {
    let cf = '', sf = '';
    const apply = () => document.querySelectorAll('.news-card[data-cat]').forEach(c => { c.hidden = (cf && c.dataset.cat !== cf) || (sf && c.dataset.src !== sf); });
    document.querySelectorAll('[data-cf]').forEach(b => b.onclick = () => {
      cf = b.dataset.cf;
      document.querySelectorAll('[data-cf]').forEach(x => x.classList.toggle('active', x === b));
      apply();
    });
    document.querySelectorAll('[data-sf]').forEach(b => b.onclick = () => {
      sf = b.dataset.sf;
      document.querySelectorAll('[data-sf]').forEach(x => x.classList.toggle('active', x === b));
      apply();
    });
  });
  return `${pageHead('Latest News', 'Die neusten Schlagzeilen aus dem Fahrerlager, alle 2 Stunden frisch. Ein Klick öffnet den ganzen Artikel bei der Quelle.')}
    ${cats.length ? `<div class="chips"><button class="chip active" data-cf="">Alle</button>${cats.map(c => `<button class="chip" data-cf="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    ${sources.length > 1 ? `<div class="chips"><button class="chip active" data-sf="">Alle Quellen</button>${sources.map(s => `<button class="chip" data-sf="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    ${list.length ? `<div class="grid g3 news-grid">${list.map((n, i) => newsCard(n, i === 0).replace('class="news-card', `data-src="${esc(n.source || '')}" class="news-card`)).join('')}</div>${newsStamp(nw)}` : empty('Noch keine News vorhanden.')}
    <section class="section">${sectionHead('Quellen')}<div class="grid g3">${NEWS_SOURCES.map(s => `<a class="card card-pad hover-lift" href="${s.url}" target="_blank" rel="noopener"><h3>${esc(s.name)} ↗</h3><p class="muted" style="margin:6px 0 0;font-size:14px">${esc(s.note)}</p></a>`).join('')}</div></section>`;
}

// ======================================================================
// Statistiken
// ======================================================================
async function statsPage() {
  const [core, res, ed] = await Promise.all([loadCore(), loadResults(), loadEditorial()]);
  const st = [...seasonStats(res).values()];
  const top = (key, n = 5, dir = -1, filter = () => true) => st.filter(filter).sort((a, b) => dir * (a[key] - b[key])).slice(0, n);
  const board = (title, key, fmt = v => v, opts = {}) => {
    const rows = top(key, 5, opts.asc ? 1 : -1, opts.filter).filter(s => opts.asc || s[key] > 0);
    return `<div class="card">${cardHead(title)}${rows.length ? tableOf(rows.map((s, i) => `<tr ${teamStyle(s.team)}><td class="pos">${i + 1}</td><td><a class="who" href="#/driver/${s.driver.driverId}"><span class="team-bar"></span><span class="ava">${img('drivers', s.driver.driverId, s.driver.url, { width: 120 })}</span>${driverName(s.driver)}</a></td><td class="pts">${fmt(s[key])}</td></tr>`).join('')) : empty('–')}</div>`;
  };
  const totalRaces = res.races.length;
  const winners = new Set(res.races.map(r => r.Results[0].Driver.driverId)).size;
  const poleWins = res.races.filter(r => res.quali.find(q => q.round === r.round)?.QualifyingResults[0]?.Driver.driverId === r.Results[0].Driver.driverId).length;
  const dnfs = st.reduce((a, s) => a + s.dnf, 0);
  const h2h = headToHead(res);
  const nm = id => core.drivers.find(d => d.Driver.driverId === id)?.Driver.familyName || id;

  return `${pageHead(`Stats ${esc(core.season)}`, `Zahlen und Rekorde der Saison, berechnet aus allen ${totalRaces} bisherigen Rennen.`)}
    <div class="grid g4">
      <div class="stat"><span class="k">Rennen gefahren</span><span class="v">${totalRaces}<span style="font-size:18px" class="muted">/${core.schedule.length}</span></span></div>
      <div class="stat"><span class="k">Verschiedene Sieger</span><span class="v">${winners}</span></div>
      <div class="stat"><span class="k">Siege von der Pole</span><span class="v">${poleWins}</span><span class="s">${totalRaces ? Math.round(poleWins / totalRaces * 100) : 0}% der Rennen</span></div>
      <div class="stat"><span class="k">Ausfälle total</span><span class="v">${dnfs}</span></div>
    </div>
    <section class="section grid g3">
      ${board('Siege', 'wins')}
      ${board('Podien', 'podiums')}
      ${board('Pole Positions', 'poles')}
      ${board('Schnellste Runden', 'fastest')}
      ${board('Ø Zielposition', 'avg', v => v.toFixed(1), { asc: true, filter: s => s.finishes >= Math.max(3, totalRaces / 2) })}
      ${board('Plätze gutgemacht', 'gained', v => (v > 0 ? '+' : '') + v)}
      ${board('Punkteränge', 'pointsFinishes')}
      ${board('Ausfälle', 'dnf')}
      ${board('Sprint-Siege', 'sprintWins')}
    </section>
    <section class="section">${sectionHead('Teamduelle')}
      <div class="card">${tableOf(h2h.filter(p => (Object.values(p.race).reduce((a, b) => a + b, 0)) >= 3).map(p => `<tr ${teamStyle(p.team)} class="clickable" onclick="location.hash='#/compare?a=${p.a}&b=${p.b}'"><td><span class="who"><span class="team-bar"></span><b>${esc(team(p.team).short)}</b></span></td><td>${esc(nm(p.a))} <b>${p.quali[p.a] || 0}</b> : <b>${p.quali[p.b] || 0}</b> ${esc(nm(p.b))}</td><td>${esc(nm(p.a))} <b>${p.race[p.a] || 0}</b> : <b>${p.race[p.b] || 0}</b> ${esc(nm(p.b))}</td></tr>`).join(''), '<thead><tr><th>Team</th><th>Qualifying</th><th>Rennen</th></tr></thead>')}</div>
    </section>
    ${(ed?.records || []).length ? `<section class="section">${sectionHead('Rekorde & Meilensteine')}<div class="grid g3">${ed.records.map(r => `<div class="stat"><span class="k">${esc(r.title)}</span><span class="v" style="font-size:26px">${esc(r.value)}</span><span class="s">${esc(r.text || '')}</span></div>`).join('')}</div></section>` : ''}
    <section class="section grid g3 quick">
      <a class="quick-card" href="#/archive"><span class="qi">📚</span><b>Archiv</b><span>Alle Weltmeister seit 1950</span></a>
      <a class="quick-card" href="#/penalties"><span class="qi">⚠️</span><b>Strafen & Motoren</b><span>Strafpunkte und PU-Kontingent</span></a>
      <a class="quick-card" href="#/circuits"><span class="qi">🗺️</span><b>Streckenguide</b><span>Layouts, Eckdaten, Sieger</span></a>
    </section>`;
}

// ======================================================================
// Regeln
// ======================================================================
async function rules() {
  const ed = await loadEditorial();
  const list = ed?.rules || [];
  const years = [...new Set(list.map(r => r.year))].sort();
  return `${pageHead('Regeln & Reglement', 'Was gilt aktuell, was ändert sich, mit den Fachbegriffen erklärt.')}
    ${years.map(y => `<section class="section">${sectionHead(esc(String(y)))}<div class="grid g2">${list.filter(r => r.year === y).map(r => `<div class="card card-pad"><div class="split"><h3>${esc(r.title)}</h3>${r.tag ? tag(r.tag, r.tag === 'Neu' ? 'red' : r.tag === 'Beschlossen' ? 'info' : '') : ''}</div><p class="muted" style="margin:8px 0 0;font-size:15px">${esc(r.text)}</p>${sourceLinks(r.sources)}</div>`).join('')}</div></section>`).join('') || empty('Noch keine Regel-Infos.')}
    ${editorialStamp(ed)}`;
}

// ======================================================================
// Live-Center
// ======================================================================
async function live() {
  const core = await loadCore();
  const ls = liveSession(core);
  const next = nextRace(core);
  const upcoming = next ? sessionsOf(next).find(s => s.start > now()) : null;

  const render = async () => {
    const box = document.getElementById('livebox');
    if (!box) return;
    try {
      const [sess] = await openf1('sessions?session_key=latest');
      const [results, wx, rc, drv] = await Promise.all([
        openf1('session_result?session_key=latest').catch(() => []),
        openf1('weather?session_key=latest').catch(() => []),
        openf1('race_control?session_key=latest').catch(() => []),
        openf1('drivers?session_key=latest').catch(() => []),
      ]);
      const byNum = new Map(drv.map(d => [d.driver_number, d]));
      const w = wx.at(-1);
      const rows = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
      box.innerHTML = `<div class="grid g-main">
        <div class="card">${cardHead(`${esc(sess.session_name)} · ${esc(sess.circuit_short_name || sess.location)}`, `<span class="muted" style="font-size:12px">OpenF1 · ${fmtTime(new Date())}</span>`)}
          ${rows.length ? tableOf(rows.map(r => { const d = byNum.get(r.driver_number) || {}; return `<tr style="--team:#${d.team_colour || '888'}"><td class="pos">${r.position ?? '–'}</td><td><span class="who"><span class="team-bar"></span><span class="name">${esc(d.first_name || '')} <b>${esc((d.last_name || r.driver_number) + '')}</b></span></span></td><td class="r num">${esc(fmtGap(r))}</td><td class="r muted num hide-sm">${r.number_of_laps ?? ''} Rd</td></tr>`; }).join('')) : empty('Noch keine Klassierung für diese Session.')}
        </div>
        <div class="stack">
          ${w ? `<div class="card">${cardHead('Wetter an der Strecke')}<div class="facts f2" style="border:0;border-radius:0">${[['Luft', w.air_temperature + '°C'], ['Asphalt', w.track_temperature + '°C'], ['Feuchte', w.humidity + '%'], ['Wind', w.wind_speed + ' m/s'], ['Regen', w.rainfall ? 'Ja' : 'Nein']].map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('')}</div></div>` : ''}
          <div class="card">${cardHead('Race Control')}<div class="card-pad" style="max-height:420px;overflow:auto;padding-top:4px">${rc.slice(-25).reverse().map(m => `<div class="rc-msg"><time>${fmtTime(new Date(m.date))}</time><span>${m.flag ? `<span class="flag-sq" style="background:${flagColor(m.flag)}"></span>` : ''}${esc(m.message)}</span></div>`).join('') || empty('Keine Meldungen.')}</div></div>
        </div></div>`;
    } catch (e) {
      // Die 401-Antwort von OpenF1 hat keine CORS-Header; der Browser meldet
      // dann nur "Failed to fetch". Läuft gerade eine Session, ist das die Sperre.
      const locked = e.locked || (!e.status && liveSession(core));
      box.innerHTML = locked
        ? `<div class="grid g-main"><div class="notice"><div><b>Live-Timing ist während laufender Sessions gesperrt.</b><br>Der kostenlose Datendienst OpenF1 gibt Live-Daten nur mit kostenpflichtigem Zugang heraus. Sobald die Session vorbei ist, erscheinen hier Klassierung, Wetter und Race-Control-Meldungen automatisch.</div></div>${tvBox()}</div>`
        : `<div class="notice">Live-Daten derzeit nicht erreichbar (${esc(e.message)}).</div>`;
    }
  };
  then(() => { render(); timers.push(setInterval(render, 30e3)); });

  return `${pageHead('Live-Center', 'Session-Status, Klassierung, Wetter und Race-Control-Meldungen. Aktualisiert sich automatisch alle 30 Sekunden.')}
    <div class="live-banner ${ls ? 'on' : ''}">
      ${ls ? `<span class="live-dot"></span><div><div class="kicker" style="color:#fff">Jetzt live</div><h2>${esc(ls.session.name)} · ${esc(raceShort(ls.race.raceName))}</h2></div>`
        : upcoming ? `<div style="flex:1"><div class="kicker">Nächste Session</div><h2>${esc(upcoming.name)} · ${esc(raceShort(next.raceName))}</h2><div class="muted">${fmtDay(upcoming.start)}, ${fmtDate(upcoming.start)} · ${fmtTime(upcoming.start)} (${relTime(upcoming.start)})</div></div>${countdown(upcoming.start)}`
        : `<h2>Keine weiteren Sessions</h2>`}
    </div>
    <section class="section" id="livebox">${loadingBox(300)}</section>`;
}
function fmtGap(r) {
  if (r.dnf) return 'DNF'; if (r.dns) return 'DNS'; if (r.dsq) return 'DSQ';
  const v = Array.isArray(r.duration) ? r.duration.filter(Boolean).at(-1) : r.duration;
  if (r.position === 1 && v) { const m = Math.floor(v / 60); return m ? `${m}:${(v % 60).toFixed(3).padStart(6, '0')}` : v.toFixed(3); }
  const g = Array.isArray(r.gap_to_leader) ? r.gap_to_leader.filter(x => x != null).at(-1) : r.gap_to_leader;
  return g == null ? '' : typeof g === 'number' ? `+${g.toFixed(3)}` : g;
}
const flagColor = f => ({ GREEN: '#27c26c', YELLOW: '#ffd400', 'DOUBLE YELLOW': '#ffd400', RED: '#e10600', BLUE: '#3b82f6', CHEQUERED: '#fff', CLEAR: '#27c26c', 'BLACK AND WHITE': '#888' }[f] || '#888');

function notFound() {
  return `${pageHead('Nicht gefunden', 'Diese Seite gibt es nicht (mehr).')}<a class="btn" href="#/">Zur Startseite</a>`;
}

// ======================================================================
// Globale Suche (Taste "/" oder Ctrl+K)
// ======================================================================
async function setupSearch() {
  const dlg = document.getElementById('search');
  const input = document.getElementById('searchInput');
  const out = document.getElementById('searchOut');
  const open = () => { dlg.hidden = false; input.value = ''; input.focus(); draw(''); };
  const close = () => { dlg.hidden = true; };
  document.querySelectorAll('[data-open-search]').forEach(b => b.onclick = open);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  document.addEventListener('keydown', e => {
    if ((e.key === '/' && !/input|select|textarea/i.test(e.target.tagName)) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); open(); }
    if (e.key === 'Escape') close();
  });
  const core = await loadCore().catch(() => null);
  const pages = Object.entries(TITLES).filter(([k]) => k !== '/').map(([k, v]) => ({ t: v, s: 'Seite', h: '#' + k }));
  const idx = core ? [
    ...core.drivers.map(s => ({ t: `${s.Driver.givenName} ${s.Driver.familyName}`, s: `Fahrer · ${team(teamOf(s)).short} · #${s.Driver.permanentNumber}`, h: `#/driver/${s.Driver.driverId}`, k: s.Driver.code })),
    ...core.constructors.map(c => ({ t: team(c.Constructor.constructorId).short, s: `Team · ${c.Constructor.name}`, h: `#/team/${c.Constructor.constructorId}` })),
    ...core.schedule.map(r => ({ t: r.raceName, s: `Rennen · Round ${r.round} · ${r.Circuit.Location.locality}`, h: `#/race/${r.round}`, k: r.Circuit.Location.country })),
    ...core.schedule.map(r => ({ t: r.Circuit.circuitName, s: `Strecke · ${r.Circuit.Location.country}`, h: `#/circuit/${r.Circuit.circuitId}` })),
    ...pages,
  ] : pages;
  let sel = 0, hits = [];
  const draw = q => {
    const v = q.trim().toLowerCase();
    hits = (v ? idx.filter(x => (x.t + ' ' + x.s + ' ' + (x.k || '')).toLowerCase().includes(v)) : pages).slice(0, 10);
    sel = 0;
    out.innerHTML = hits.map((h, i) => `<a href="${h.h}" class="${i === 0 ? 'sel' : ''}"><b>${esc(h.t)}</b><span>${esc(h.s)}</span></a>`).join('') || '<div class="empty">Nichts gefunden.</div>';
    out.querySelectorAll('a').forEach(a => a.onclick = close);
  };
  input.oninput = () => draw(input.value);
  input.onkeydown = e => {
    const as = out.querySelectorAll('a');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + as.length) % as.length; as.forEach((a, i) => a.classList.toggle('sel', i === sel)); }
    if (e.key === 'Enter' && hits[sel]) { location.hash = hits[sel].h; close(); }
  };
}

// ======================================================================
// Start
// ======================================================================
// Konto-Knopf im Kopf und in der Tab-Leiste (angemeldet → Profil, sonst Login).
function updateAccount() {
  const logged = probablyLoggedIn();
  document.querySelectorAll('[data-account]').forEach(a => {
    a.setAttribute('href', logged ? '#/profil' : '#/login');
    a.classList.toggle('in', logged);
    a.setAttribute('aria-label', logged ? 'Mein Profil' : 'Anmelden');
    const l = a.querySelector('[data-label]');
    if (l) l.textContent = logged ? 'Profil' : 'Login';
  });
}

async function boot() {
  updateAccount();
  onAuthChange(() => { updateAccount(); router(); });
  router();
  setupSearch();
  try {
    const [core, meta] = await Promise.all([loadCore(), loadMeta()]);
    document.getElementById('seasonLabel').textContent = core.season;
    const upd = meta?.updatedAt ? new Date(meta.updatedAt) : null;
    document.getElementById('updateLabel').textContent = core.live
      ? `Live-Daten · Tagesupdate ${upd ? fmtDate(upd, { day: 'numeric', month: 'short' }) + ', ' + fmtTime(upd) : 'ausstehend'}`
      : `Offline-Snapshot vom ${fmtDate(new Date(core.snapshotAt))}`;
    const t = document.getElementById('ticker');
    t.innerHTML = core.drivers.filter(s => s.active !== false).map(s => `<a class="ticker-chip" href="#/driver/${s.Driver.driverId}" ${teamStyle(teamOf(s))} title="${esc(s.Driver.givenName + ' ' + s.Driver.familyName)}"><span class="av">${img('drivers', s.Driver.driverId, s.Driver.url, { width: 120 })}</span><span><b>${s.position}</b>${esc(s.Driver.code)}</span></a>`).join('');
    hydrateImages(t);
    const tickLive = () => document.querySelector('.nav-live').classList.toggle('is-live', !!liveSession(core));
    tickLive(); setInterval(tickLive, 60e3);
  } catch (e) { console.warn(e); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
