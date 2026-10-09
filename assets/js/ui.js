// Kleine UI-Helfer: Escaping, Formatierung, wiederverwendbare Bausteine.

import { team, NATIONALITY, COUNTRY, SESSION_NAMES } from './config.js';
import { imageFor, sized } from './data.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const teamStyle = id => { const t = team(id); return `style="--team:${t.color};--team-dark:${t.dark}"`; };

export function flag(code, h = 14) {
  if (!code) return '';
  const w = Math.round(h * 4 / 3);
  return `<img class="flagimg" src="https://flagcdn.com/h40/${code}.png" alt="${code.toUpperCase()}" width="${w}" height="${h}" style="width:${w}px;height:${h}px;border-radius:2px;object-fit:cover;display:inline-block;vertical-align:-2px" loading="lazy">`;
}
export const natFlag = (nat, h) => flag(NATIONALITY[nat], h);
export const countryFlag = (c, h) => flag(COUNTRY[c], h);

const LOCALE = 'de-CH';
export const fmtDate = (d, opts = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(LOCALE, opts).format(d);
export const fmtTime = d => new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d);
export const fmtDay = d => new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }).format(d).replace('.', '');
export const fmtNum = n => new Intl.NumberFormat(LOCALE).format(n);

export function toDate(date, time) {
  if (!date) return null;
  return new Date(`${date}T${time || '12:00:00Z'}`);
}

// Sessions eines Rennwochenendes, chronologisch.
export function sessionsOf(race) {
  const keys = ['FirstPractice', 'SecondPractice', 'ThirdPractice', 'SprintQualifying', 'Sprint', 'Qualifying'];
  const list = keys.filter(k => race[k]).map(k => ({ key: k, name: SESSION_NAMES[k], start: toDate(race[k].date, race[k].time) }));
  list.push({ key: 'Race', name: 'Race', start: toDate(race.date, race.time) });
  return list.sort((a, b) => a.start - b.start);
}
const SESSION_LEN = { Race: 2 * 3600e3, Sprint: 3600e3, Qualifying: 3600e3, SprintQualifying: 45 * 60e3 };
export const sessionEnd = s => new Date(s.start.getTime() + (SESSION_LEN[s.key] || 3600e3));

export function weekendRange(race) {
  const s = sessionsOf(race);
  const a = s[0].start, b = s[s.length - 1].start;
  const sameMonth = a.getMonth() === b.getMonth();
  return sameMonth
    ? `${a.getDate()}–${fmtDate(b, { day: 'numeric', month: 'short' })}`
    : `${fmtDate(a)} – ${fmtDate(b)}`;
}

export const raceShort = name => name.replace(' Grand Prix', ' GP');

export function driverName(D, { upper = true } = {}) {
  return `<span class="name">${esc(D.givenName)} <b>${esc(upper ? D.familyName : D.familyName)}</b></span>`;
}

// Platzhalter-Bild, wird nach dem Rendern asynchron befüllt (hydrateImages).
// fallback: "kind:id" – wird verwendet, wenn für kind/id kein Bild existiert.
export function img(kind, id, wiki, { width = 500, cls = '', alt = '', fallback = '', eager = false } = {}) {
  return `<img class="${cls}" data-kind="${kind}" data-id="${esc(id)}" data-wiki="${esc(wiki || '')}" data-w="${width}" data-fb="${esc(fallback)}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" hidden>`;
}

export function hydrateImages(root = document) {
  root.querySelectorAll('img[data-kind]:not([data-done])').forEach(async el => {
    el.dataset.done = '1';
    let m = await imageFor(el.dataset.kind, el.dataset.id, el.dataset.wiki);
    if (!m && el.dataset.fb) { const [k, i] = el.dataset.fb.split(':'); m = await imageFor(k, i); }
    if (!m) { el.parentElement?.classList.add('no-img'); return; }
    const w = +el.dataset.w;
    // Kuratierte Bilder haben feste Grössen (800 / 1920), Wikipedia-Bilder lassen sich skalieren.
    // Kleine Darstellungen (Avatare) bekommen ein passendes Vorschaubild statt 800 px.
    el.src = m.curated ? (w > 800 && m.large ? m.large : w && w <= 500 ? sized(m.src, w) : m.src) : (w ? sized(m.src, w) : m.src);
    el.onerror = () => { if (el.src !== m.src) el.src = m.src; };
    el.onload = () => el.classList.add('loaded');
    el.title = `Foto: ${m.credit || 'Wikimedia Commons'}${m.license ? ' (' + m.license + ')' : ''}`;
    el.hidden = false;
    const btn = el.parentElement?.querySelector('.credit-btn');
    if (btn) { btn.hidden = false; btn.onclick = () => showCredit(m); }
  });
}

export function showCredit(m) {
  const box = document.getElementById('credit');
  box.innerHTML = `<button aria-label="Schliessen">×</button><b>Bildnachweis</b><br>${esc(m.credit || 'Wikimedia Commons')}${m.license ? ' · ' + esc(m.license) : ''}<br><a href="${esc(m.file || m.page)}" target="_blank" rel="noopener">Originaldatei auf Wikimedia Commons</a>`;
  box.hidden = false;
  box.querySelector('button').onclick = () => { box.hidden = true; };
}

export function tag(text, kind = '') { return `<span class="tag ${kind}">${esc(text)}</span>`; }

export function sourceLinks(list) {
  const arr = (Array.isArray(list) ? list : [list]).filter(Boolean);
  if (!arr.length) return '';
  return `<div class="src">Quelle: ${arr.map(s => typeof s === 'string'
    ? `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(hostOf(s))}</a>`
    : `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name || hostOf(s.url))}</a>`).join(', ')}</div>`;
}
export const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function relTime(d) {
  const diff = (d - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const empty = text => `<div class="empty">${esc(text)}</div>`;
