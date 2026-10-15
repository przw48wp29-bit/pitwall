// Tippspiel – Weltmeistertitel einer Gruppe.
// Wer eine Saison gewinnt, bekommt einen Titel, der dauerhaft in der Gruppe
// bleibt: Sterne beim Namen, «Hall of Fame» auf der Gruppenseite und ein
// Champion-Banner in der Rangliste. Vergeben wird der Titel vom Admin über
// «Saison abschliessen» (RPC close_season) – das ist endgültig.

import { esc, fmtDate } from '../ui.js';
import { then } from '../shared.js';
import { rpc } from './api.js';
import { avatar, busy, go, toast } from './common.js';

// user_id → Anzahl Titel. Ehemalige Mitglieder haben user_id = null.
export function titleMap(titles) {
  const m = new Map();
  for (const t of titles || []) if (t.user_id) m.set(t.user_id, (m.get(t.user_id) || 0) + 1);
  return m;
}

// Sterne hinter einem Namen. n = Anzahl Titel, seasons für den Tooltip.
export function stars(n, seasons = []) {
  if (!n) return '';
  const label = n === 1 ? 'Weltmeister' : `${n}-facher Weltmeister`;
  const title = seasons.length ? `${label} (${seasons.join(', ')})` : label;
  return `<span class="tp-wm" title="${esc(title)}" aria-label="${esc(title)}">★${n > 1 ? `<small>${n}</small>` : ''}</span>`;
}

// Fertige Sterne-Funktion für eine Titelliste: starsOf(titles)(user_id)
export function starsOf(titles) {
  const m = titleMap(titles);
  return uid => stars(m.get(uid) || 0, (titles || []).filter(t => t.user_id === uid).map(t => t.season));
}

// ---------------------------------------------------------------------------
// «Hall of Fame» – alle Titel der Gruppe, neueste Saison zuerst.
// ---------------------------------------------------------------------------
export function hallOfFame(titles, me) {
  if (!titles?.length) return '';
  const rows = titles.map(t => {
    const shared = titles.filter(x => x.season === t.season).length > 1;
    const sub = [
      `${t.points} Pkt.`,
      shared ? 'geteilter Titel' : t.lead > 0 ? `${t.lead} Pkt. Vorsprung` : 'knappster Sieg',
      `${t.members} ${t.members === 1 ? 'Mitglied' : 'Mitglieder'}`,
    ].join(' · ');
    return `<div class="tp-hof-row ${t.user_id === me ? 'me' : ''}">
      <span class="tp-hof-year">${t.season}</span>
      ${avatar({ name: t.name, avatar: t.avatar }, 34)}
      <span class="tp-hof-who"><b>${esc(t.name)}${t.user_id === me ? ' <span class="muted small">(du)</span>' : ''}</b><small class="muted">${esc(sub)}</small></span>
      <span class="tp-hof-cup" aria-hidden="true">🏆</span>
    </div>`;
  }).join('');
  return `<div class="card tp-hof"><div class="card-head"><h3>Hall of Fame</h3>
      <span class="muted" style="font-size:12px">${titles.length} ${titles.length === 1 ? 'Saison' : 'Saisons'}</span></div>
    <div class="tp-hof-list">${rows}</div></div>`;
}

// Banner in der Rangliste, sobald die angezeigte Saison abgeschlossen ist.
export function championBanner(titles, season, me) {
  const won = (titles || []).filter(t => String(t.season) === String(season));
  if (!won.length) return '';
  const names = won.map(t => `<b>${esc(t.name)}</b>${t.user_id === me ? ' (du)' : ''}`).join(' & ');
  const when = won[0].decided_at ? fmtDate(new Date(won[0].decided_at), { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return `<div class="tp-champ ${won.some(t => t.user_id === me) ? 'me' : ''}">
    <div class="tp-champ-cup" aria-hidden="true">🏆</div>
    <div><div class="kicker">Saison ${esc(season)} abgeschlossen</div>
      <h2>Weltmeister: ${names}</h2>
      <p class="muted small">${won[0].points} Punkte${won.length === 1 && won[0].lead > 0 ? ` · ${won[0].lead} Pkt. Vorsprung` : ''}${when ? ` · vergeben am ${esc(when)}` : ''}. Dieser Titel bleibt für immer in der Gruppe.</p></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Saison abschliessen (nur Admin, nur wenn alle Wochenenden gewertet sind).
// ---------------------------------------------------------------------------
export function closeSeasonCard(groupId, data) {
  if (!data.can_close) return '';
  then(() => {
    const btn = document.getElementById('tpClose');
    if (!btn) return;
    btn.onclick = () => {
      if (!confirm(`Saison ${data.season} abschliessen und den Weltmeistertitel vergeben?\n\nDas ist endgültig: Der Titel bleibt dauerhaft in der Gruppe stehen. Trage vorher alle Korrekturen ein.`)) return;
      busy(btn, async () => {
        await rpc('close_season', { p_group: groupId, p_season: data.season });
        toast('Saison abgeschlossen – der Titel ist vergeben. 🏆');
        go(`#/gruppe/${groupId}/rangliste`);
      });
    };
  });
  return `<div class="card tp-close"><div class="card-head"><h3>Saison abschliessen</h3></div>
    <div class="card-pad stack">
      <p class="muted small" style="margin:0">Alle Rennwochenenden der Saison ${esc(data.season)} sind gewertet. Mit dem Abschluss bekommt der Erste den <b>Weltmeistertitel</b> – dauerhaft sichtbar in der Gruppe. Bei Punktgleichheit entscheiden exakte Treffer, dann Wochenendsiege.</p>
      <p class="muted small" style="margin:0">Der Schritt lässt sich nicht rückgängig machen. Trage offene Korrekturen vorher ein.</p>
      <div><button class="btn" id="tpClose" type="button">Saison abschliessen 🏆</button></div>
    </div></div>`;
}
