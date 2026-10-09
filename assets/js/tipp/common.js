// Gemeinsame Bausteine der Tippspiel-Seiten.

import { TEAMS, team } from '../config.js';
import { esc, img, fmtDate, fmtTime, fmtDay } from '../ui.js';
import { then, timers } from '../shared.js';
import { rpc, isDemo, backend } from './api.js';

export const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
export const go = hash => { if (location.hash === hash) rerender(); else location.hash = hash; };
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '');

// ---------- Saisondaten (Kalender + Fahrer aus der Datenbank) ----------
let sdCache = null;
export function seasonData(force = false) {
  if (force || !sdCache || Date.now() - sdCache.t > 60e3) {
    const p = rpc('season_data', {}).catch(e => { sdCache = null; throw e; });
    sdCache = { t: Date.now(), p };
  }
  return sdCache.p;
}
export const invalidateSeason = () => { sdCache = null; };

// Nächstes Rennwochenende (bis 3 Stunden nach dem Rennstart gilt es noch als aktuell).
export const upcoming = sd => sd.events.filter(e => e.status === 'scheduled' && Date.parse(e.race_start) > Date.now() - 3 * 3600e3);

// ---------- Zeit ----------
export const fmtWhen = d => `${fmtDay(d)} ${fmtDate(d, { day: 'numeric', month: 'numeric' })}, ${fmtTime(d)}`;
export function fmtLeft(ms) {
  if (ms <= 0) return 'geschlossen';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const p = n => String(n).padStart(2, '0');
  return d ? `${d} T ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`;
}
// Live-Countdown bis "target" (skew = Serverzeit − Browserzeit).
export function liveLeft(target, skew = 0, onZero) {
  const id = 'll' + Math.random().toString(36).slice(2, 8);
  let fired = false, iv = null;
  const tick = () => {
    const el = document.getElementById(id);
    if (!el) { clearInterval(iv); return; }   // neu gezeichnet oder weg navigiert
    const ms = target - (Date.now() + skew);
    el.textContent = fmtLeft(ms);
    el.classList.toggle('urgent', ms > 0 && ms < 3600e3);
    if (ms <= 0 && !fired) { fired = true; clearInterval(iv); onZero?.(); }
  };
  then(() => { tick(); iv = setInterval(tick, 1000); timers.push(iv); });
  return `<span class="tp-left" id="${id}"></span>`;
}

// ---------- Avatare ----------
const PALETTE = Object.values(TEAMS).map(t => t.color);
export const AVATAR_COLORS = ['#e10600', '#ff8000', '#ffd12e', '#3ddc84', '#27f4d2', '#00a1e8', '#3671c6', '#8a5cf6', '#ff4fa3', '#dee1e2', '#229971', '#8a8a93'];
const hashColor = s => PALETTE[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
export const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

export function avatar(p, size = 32) {
  const a = p?.avatar || {};
  const name = p?.name ?? p?.display_name ?? '?';
  const color = a.color || (a.driver ? team(null).color : hashColor(name));
  if (a.driver) return `<span class="tp-ava photo" style="--s:${size}px;--c:${color}" title="${esc(name)}">${img('drivers', a.driver, null, { width: 120, alt: '' })}<i>${esc(initials(name))}</i></span>`;
  return `<span class="tp-ava" style="--s:${size}px;--c:${color}" title="${esc(name)}"><i>${esc(initials(name))}</i></span>`;
}

// ---------- Meldungen ----------
export function toast(msg, kind = 'ok', ms = 3600) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms);
}
export const errorBox = msg => `<div class="notice bad">${esc(msg)}</div>`;

// Formular-Knopf während einer Aktion sperren und Fehler anzeigen.
export async function busy(btn, fn, errEl) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>';
  if (errEl) errEl.innerHTML = '';
  try { return await fn(); }
  catch (e) {
    console.error(e);
    if (errEl) errEl.innerHTML = errorBox(e.message); else toast(esc(e.message), 'bad', 6000);
    return undefined;
  } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
}

// ---------- Anmeldung nötig ----------
export function needLogin(next, text = 'Melde dich an, um mitzutippen.') {
  return `<div class="tp-gate card card-pad">
    <div class="tp-gate-ico">🏁</div>
    <h2>Mitspielen</h2>
    <p class="muted">${esc(text)}</p>
    <div class="tp-actions"><a class="btn" href="#/login?next=${encodeURIComponent(next)}">Anmelden</a><a class="btn ghost" href="#/login?mode=neu&next=${encodeURIComponent(next)}">Konto erstellen</a></div>
  </div>`;
}

// ---------- Demo-Modus: Hinweis und Werkzeuge ----------
export function demoBar() {
  if (!isDemo()) return '';
  then(async () => {
    const btn = document.getElementById('demoBtn');
    const panel = document.getElementById('demoPanel');
    if (!btn) return;
    btn.onclick = async () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden) return;
      const { demoTools } = await import('./dev.js');
      const b = await backend();
      const me = b.user();
      const [users, groups] = await Promise.all([demoTools.users(), me ? rpc('my_groups').catch(() => []) : []]);
      panel.querySelector('[data-body]').innerHTML = `
        <label class="tp-field"><span>Angemeldet als</span><select class="input" data-user><option value="">– niemand –</option>${users.map(u => `<option value="${u.id}" ${me?.id === u.id ? 'selected' : ''}>${esc(u.name || u.email)}</option>`).join('')}</select></label>
        ${groups.length ? `<label class="tp-field"><span>Testspieler holen in</span><div class="tp-row"><select class="input" data-group>${groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select><button class="btn small" data-add>Holen</button></div></label>` : '<p class="muted small">Erstelle zuerst eine Gruppe, dann kannst du Testspieler (Lena, Marco, Sven, Nora) holen. Sie tippen das nächste Rennen automatisch.</p>'}
        <div class="tp-field"><span>Tippschluss nächstes Rennen</span><div class="tp-row"><button class="btn small ghost" data-tt="soon">in 3 Min.</button><button class="btn small ghost" data-tt="locked">vorbei</button><button class="btn small ghost" data-tt="reset">wie im Kalender</button></div></div>
        <div class="tp-field"><span>Auswertung testen (nächstes Rennen gilt als gefahren)</span><div class="tp-row"><button class="btn small ghost" data-res="1">Zufallsresultat eintragen</button></div></div>
        <button class="btn small ghost danger" data-reset>Demo komplett zurücksetzen</button>`;
      panel.querySelector('[data-user]').onchange = async e => { if (e.target.value) await demoTools.switchUser(e.target.value); else await b.signOut(); panel.hidden = true; rerender(); };
      const add = panel.querySelector('[data-add]');
      if (add) add.onclick = () => busy(add, async () => { await demoTools.addTestPlayers(panel.querySelector('[data-group]').value); toast('Testspieler sind dabei und haben getippt.'); panel.hidden = true; rerender(); });
      panel.querySelectorAll('[data-tt]').forEach(x => x.onclick = () => busy(x, async () => { await demoTools.timeTravel(x.dataset.tt); invalidateSeason(); toast('Zeiten angepasst.'); panel.hidden = true; rerender(); }));
      panel.querySelectorAll('[data-res]').forEach(x => x.onclick = () => busy(x, async () => { const id = await demoTools.fakeResults(); invalidateSeason(); toast(id ? 'Resultat eingetragen, Punkte berechnet.' : 'Kein Rennen gefunden.'); panel.hidden = true; rerender(); }));
      panel.querySelector('[data-reset]').onclick = async () => {
        if (!confirm('Alle Demo-Daten (Konten, Gruppen, Tipps) in diesem Browser löschen?')) return;
        await demoTools.reset();
        location.reload();
      };
    };
    panel.querySelector('[data-close]').onclick = () => { panel.hidden = true; };
  });
  return `<div class="demo-note"><b>Demo-Modus</b> Alles wird nur in diesem Browser gespeichert. Für das gemeinsame Spiel mit Freunden wird ein Gratis-Server (Supabase) eingerichtet.
      <button class="demo-btn" id="demoBtn" type="button">Werkzeuge</button></div>
    <div class="demo-panel card" id="demoPanel" hidden><div class="card-head"><h3>Demo-Werkzeuge</h3><button class="icon-x" data-close aria-label="Schliessen">×</button></div><div class="card-pad stack" data-body><div class="spin"></div></div></div>`;
}
