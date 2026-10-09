// Tippspiel – Seiten (Übersicht, Login, Profil, Gruppen, Einladung, Admin).
// Das Tipp-Formular selbst steckt in form.js.

import { team } from '../config.js';
import { loadCore } from '../data.js';
import { esc, img, tag, countryFlag, raceShort, fmtDate } from '../ui.js';
import { then, pageHead, sectionHead, cardHead } from '../shared.js';
import { rpc, auth, backend, isDemo, probablyLoggedIn } from './api.js';
import { KIND_LABEL, PRESETS, LOCK_LABEL, MISSING_LABEL, DEFAULT_SETTINGS, EXTRAS, kindsFor, pointsRows } from './rules.js';
import {
  go, rerender, query, seasonData, upcoming, fmtWhen, liveLeft, avatar, AVATAR_COLORS, toast, busy, needLogin, demoBar,
} from './common.js';
import { rankTable } from './ranking.js';
import { standingsCard, breakdown } from './standings.js';

export { tipForm } from './form.js';
export { groupRanking } from './standings.js';

const pointsTable = p => `<table class="tp-ptab">${pointsRows(p).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>`;

const raceOf = (core, ev) => core.schedule.find(r => +r.round === +ev.round && String(r.season) === String(ev.season));
const flagOf = (core, ev) => { const r = raceOf(core, ev); return r ? countryFlag(r.Circuit.Location.country, 14) : ''; };
const inviteLink = code => `${location.origin}${location.pathname}#/beitreten/${code}`;

// Status meiner Tipps für ein Wochenende: { kind: 'done' | 'open' | 'missed' | 'closed' }
export function myStatus(st) {
  const out = {};
  for (const k of kindsFor(st.event)) {
    const openMissing = st.groups.some(g => g.open[k] && !g.tips[k]);
    out[k] = openMissing ? 'open' : st.groups.some(g => g.tips[k]) ? 'done' : 'missed';
  }
  return out;
}
const statusChip = (k, s) => `<span class="tp-st ${s}">${s === 'done' ? '✓' : s === 'open' ? '○' : '–'} ${KIND_LABEL[k]}</span>`;
const nextLock = st => {
  const t = st.groups.flatMap(g => Object.entries(g.locks).filter(([k, v]) => v && g.open[k]).map(([, v]) => Date.parse(v)));
  return t.length ? Math.min(...t) : null;
};

// =============================================================================
// Übersicht
// =============================================================================
export async function tippHome() {
  const b = await backend();
  const user = b.user();
  const [sd, core] = await Promise.all([seasonData(), loadCore()]);
  const evs = upcoming(sd);
  const next = evs[0];

  if (!user) {
    return `${demoBar()}
    <section class="tp-hero">
      <div class="tp-hero-media">${img('driverCars', core.drivers[0]?.Driver.driverId, null, { width: 1920, eager: true, fallback: 'cars:' + (core.drivers[0]?.Constructors.at(-1).constructorId || '') })}</div>
      <div class="tp-hero-body">
        <div class="kicker">Pitwall Tippspiel ${esc(sd.season)}</div>
        <h1>Tippe die Formel 1 – gegen deine Freunde</h1>
        <p>Pole, Podium, Top 10, schnellste Runde und Safety Car: Gib vor jedem Rennwochenende deinen Tipp ab, sammle Punkte und schlage deine Gruppe.</p>
        <div class="tp-actions"><a class="btn" href="#/login?mode=neu&next=%23%2Ftipp">Konto erstellen</a><a class="btn ghost" href="#/login?next=%23%2Ftipp">Anmelden</a></div>
      </div>
    </section>
    <section class="section grid g3 tp-how">
      <div class="card card-pad"><div class="tp-step">1</div><h3>Gruppe gründen</h3><p class="muted">Erstelle eine private Gruppe und schick deinen Freunden den Einladungslink.</p></div>
      <div class="card card-pad"><div class="tp-step">2</div><h3>Tippen in 30 Sekunden</h3><p class="muted">Vorschlag übernehmen, Fahrer tauschen, speichern. Bis zum Tippschluss jederzeit änderbar.</p></div>
      <div class="card card-pad"><div class="tp-step">3</div><h3>Erst danach wird aufgedeckt</h3><p class="muted">Die Tipps der anderen siehst du erst nach dem Tippschluss. Die Datenbank sorgt dafür, nicht nur die Seite.</p></div>
    </section>`;
  }

  const [groups, st] = await Promise.all([rpc('my_groups'), next ? rpc('event_state', { p_event: next.id }) : null]);
  const skew = st ? Date.parse(st.now) - Date.now() : 0;
  const lockAt = st && nextLock(st);
  const status = st && groups.length ? myStatus(st) : null;
  const openCount = status ? Object.values(status).filter(s => s === 'open').length : 0;

  then(() => {
    const f = document.getElementById('joinForm');
    if (f) f.onsubmit = e => {
      e.preventDefault();
      const code = f.code.value.trim().toUpperCase();
      if (code) go('#/beitreten/' + encodeURIComponent(code));
    };
  });

  const nextCard = next ? `<section class="tp-next card" ${status ? '' : ''}>
      <div class="tp-next-media">${img('circuits', raceOf(core, next)?.Circuit.circuitId || next.circuit_id, null, { width: 500, cls: 'tp-map' })}</div>
      <div class="tp-next-body">
        <div class="kicker">Runde ${next.round} · ${flagOf(core, next)} ${esc(next.country || '')}</div>
        <h2>${esc(next.name)}</h2>
        ${groups.length ? `
          <div class="tp-sts">${Object.entries(status).map(([k, s]) => statusChip(k, s)).join('')}</div>
          ${lockAt ? `<div class="tp-lock">Nächster Tippschluss <b>${fmtWhen(new Date(lockAt))}</b> · noch ${liveLeft(lockAt, skew, rerender)}</div>` : '<div class="tp-lock">Alle Tipps für dieses Wochenende sind geschlossen.</div>'}
          <div class="tp-actions"><a class="btn" href="#/tipp/${next.id}">${openCount ? (Object.values(status).includes('done') ? 'Tipp ergänzen' : 'Jetzt tippen') : lockAt ? 'Tipp ändern' : 'Meine Tipps ansehen'}</a></div>`
        : '<p class="muted">Tritt zuerst einer Gruppe bei oder gründe eine, dann kannst du tippen.</p>'}
      </div>
    </section>` : '<div class="notice">Für diese Saison sind keine Rennen mehr offen. Der neue Kalender erscheint automatisch.</div>';

  return `${demoBar()}
    ${pageHead('Tippspiel', '', `Saison ${esc(sd.season)}`, `<a class="btn ghost small" href="#/profil">Profil</a>`)}
    ${nextCard}
    <section class="section">${sectionHead('Meine Gruppen')}
      ${groups.length ? `<div class="grid g3">${groups.map(g => `<a class="tp-group card hover-lift" href="#/gruppe/${g.id}">
          <div class="tp-group-top"><h3>${esc(g.name)}</h3>${g.role === 'admin' ? tag('Admin', 'red') : ''}</div>
          <div class="muted small">${g.members} ${g.members == 1 ? 'Mitglied' : 'Mitglieder'} · ${esc(PRESETS[g.settings.preset]?.label || 'Standard')} · Tippschluss ${g.settings.lock === 'late' ? 'spät' : 'früh'}</div>
        </a>`).join('')}</div>` : ''}
      <div class="grid g2 mt">
        <a class="card card-pad tp-cta hover-lift" href="#/gruppe/neu"><span class="tp-cta-ico">＋</span><div><b>Gruppe gründen</b><div class="muted small">Du wirst Admin und bekommst einen Einladungslink.</div></div></a>
        <form class="card card-pad tp-cta" id="joinForm" autocomplete="off"><span class="tp-cta-ico">🔑</span><div style="flex:1"><b>Mit Code beitreten</b><div class="tp-row mt-s"><input class="input" name="code" placeholder="z. B. K7M2Q9XA" maxlength="12" style="text-transform:uppercase"><button class="btn small">Los</button></div></div></form>
      </div>
    </section>
    ${evs.length > 1 ? `<section class="section">${sectionHead('Nächste Rennwochenenden')}<div class="tp-cal">${evs.slice(0, 6).map(e => `<a class="tp-cal-row" href="#/tipp/${e.id}"><span class="r">R${e.round}</span><span class="n">${flagOf(core, e)} ${esc(raceShort(e.name))}</span><span class="d muted">Quali ${fmtWhen(new Date(e.quali_start))}</span>${e.sprint_start ? tag('Sprint') : ''}<span class="go">›</span></a>`).join('')}</div></section>` : ''}
    <section class="section"><details class="card card-pad tp-rules"><summary><b>So funktioniert's</b></summary>
      <ul>
        <li><b>Qualifying:</b> Pole und Top 3 in der richtigen Reihenfolge.</li>
        <li><b>Rennen:</b> Top 10 im Ziel, P1 bis P3 ist dein Podium. <b>Sprint:</b> Podium.</li>
        <li><b>Zusatztipps:</b> schnellste Runde, Fahrer des Tages, Safety-Car-Einsätze, Anzahl Ausfälle und erster Ausfall.</li>
        <li><b>Tippschluss:</b> je nach Gruppe beim Qualifying-Start («früh») oder erst beim Start der jeweiligen Session («spät»). Bis dahin kannst du alles ändern.</li>
        <li><b>Verdeckt:</b> Was die anderen getippt haben, siehst du erst nach dem Tippschluss. Vorher nur, wer schon getippt hat.</li>
        <li><b>Vergessen?</b> Je nach Gruppe zählt dein letzter Tipp oder es gibt 0 Punkte.</li>
      </ul></details></section>`;
}

// Weiterleitung zum nächsten offenen Tipp.
export async function tippNext() {
  const b = await backend();
  if (!b.user()) return needLogin('#/tipp/next');
  const sd = await seasonData();
  for (const e of upcoming(sd).slice(0, 3)) {
    const st = await rpc('event_state', { p_event: e.id });
    if (!st.groups.length) { location.replace('#/tipp'); return ''; }
    if (st.groups.some(g => Object.values(g.open).some(Boolean))) { location.replace('#/tipp/' + e.id); return ''; }
  }
  location.replace('#/tipp');
  return '';
}

// =============================================================================
// Anmelden / Registrieren
// =============================================================================
export async function login() {
  const q = query();
  const next = q.get('next') || '#/tipp';
  const b = await backend();
  if (b.user()) { location.replace(next); return ''; }
  const register = q.get('mode') === 'neu';
  then(() => {
    const show = reg => {
      document.querySelectorAll('[data-auth]').forEach(x => x.classList.toggle('active', (x.dataset.auth === 'neu') === reg));
      document.getElementById('fLogin').hidden = reg;
      document.getElementById('fReg').hidden = !reg;
    };
    document.querySelectorAll('[data-auth]').forEach(x => x.onclick = () => show(x.dataset.auth === 'neu'));
    const fl = document.getElementById('fLogin'), fr = document.getElementById('fReg');
    fl.onsubmit = e => {
      e.preventDefault();
      busy(fl.querySelector('button[type=submit]'), async () => {
        await auth.signIn({ email: fl.email.value, password: fl.password.value });
        toast('Willkommen zurück!');
        go(next);
      }, fl.querySelector('[data-err]'));
    };
    fr.onsubmit = e => {
      e.preventDefault();
      if (fr.password.value.length < 8) { fr.querySelector('[data-err]').innerHTML = '<div class="notice bad">Das Passwort braucht mindestens 8 Zeichen.</div>'; return; }
      busy(fr.querySelector('button[type=submit]'), async () => {
        await auth.signUp({ email: fr.email.value, password: fr.password.value, name: fr.name.value });
        toast(`Willkommen, ${esc(fr.name.value.trim())}!`);
        go(next);
      }, fr.querySelector('[data-err]'));
    };
  });
  const field = (label, name, type, extra = '') => `<label class="tp-field"><span>${label}</span><input class="input" name="${name}" type="${type}" required ${extra}></label>`;
  return `${demoBar()}
    <div class="tp-auth">
      <div class="tp-auth-head"><div class="kicker">Pitwall Tippspiel</div><h1>${register ? 'Konto erstellen' : 'Anmelden'}</h1></div>
      <div class="card">
        <div class="tp-tabs"><button class="${register ? '' : 'active'}" data-auth="login">Anmelden</button><button class="${register ? 'active' : ''}" data-auth="neu">Konto erstellen</button></div>
        <form class="card-pad stack" id="fLogin" ${register ? 'hidden' : ''}>
          ${field('E-Mail', 'email', 'email', 'autocomplete="email" inputmode="email"')}
          ${field('Passwort', 'password', 'password', 'autocomplete="current-password"')}
          <div data-err></div>
          <button class="btn" type="submit">Anmelden</button>
          <p class="muted small">Passwort vergessen? Melde dich beim Admin deiner Gruppe, er kann es zurücksetzen lassen.</p>
        </form>
        <form class="card-pad stack" id="fReg" ${register ? '' : 'hidden'}>
          ${field('Name (sehen die anderen in der Gruppe)', 'name', 'text', 'maxlength="30" autocomplete="nickname"')}
          ${field('E-Mail (nur für die Anmeldung)', 'email', 'email', 'autocomplete="email" inputmode="email"')}
          ${field('Passwort (mindestens 8 Zeichen)', 'password', 'password', 'minlength="8" autocomplete="new-password"')}
          <div data-err></div>
          <button class="btn" type="submit">Konto erstellen</button>
          <p class="muted small">Gespeichert werden nur E-Mail, Name, Avatar und deine Tipps. Du kannst dein Konto jederzeit im Profil samt allen Daten löschen.</p>
        </form>
      </div>
    </div>`;
}

// =============================================================================
// Profil
// =============================================================================
export async function profile() {
  const b = await backend();
  const user = b.user();
  if (!user) return needLogin('#/profil', 'Melde dich an, um dein Profil zu sehen.');
  const [me, sd] = await Promise.all([rpc('my_profile'), seasonData()]);
  let av = { ...(me.avatar || {}) };
  const drivers = sd.drivers.filter(d => d.active).sort((a, b) => a.family_name.localeCompare(b.family_name));

  then(() => {
    const prev = document.getElementById('avaPrev');
    const paint = () => {
      prev.innerHTML = avatar({ name: document.getElementById('pName').value || me.display_name, avatar: av }, 72);
      document.querySelectorAll('[data-col]').forEach(x => x.classList.toggle('on', av.color === x.dataset.col && !av.driver));
      document.querySelectorAll('[data-drv]').forEach(x => x.classList.toggle('on', av.driver === x.dataset.drv));
      import('../ui.js').then(m => m.hydrateImages(prev));
    };
    document.querySelectorAll('[data-col]').forEach(x => x.onclick = () => { av = { color: x.dataset.col }; paint(); });
    document.querySelectorAll('[data-drv]').forEach(x => x.onclick = () => { av = { driver: x.dataset.drv, color: team(x.dataset.team).color }; paint(); });
    document.getElementById('pName').oninput = paint;
    paint();
    const fp = document.getElementById('fProfile');
    fp.onsubmit = e => {
      e.preventDefault();
      busy(fp.querySelector('button[type=submit]'), async () => { await rpc('update_profile', { p_name: fp.name.value, p_avatar: av }); toast('Profil gespeichert.'); }, fp.querySelector('[data-err]'));
    };
    const fw = document.getElementById('fPw');
    fw.onsubmit = e => {
      e.preventDefault();
      if (fw.pw.value !== fw.pw2.value) { fw.querySelector('[data-err]').innerHTML = '<div class="notice bad">Die Passwörter stimmen nicht überein.</div>'; return; }
      busy(fw.querySelector('button[type=submit]'), async () => { await auth.updatePassword(fw.pw.value); fw.reset(); toast('Passwort geändert.'); }, fw.querySelector('[data-err]'));
    };
    document.getElementById('logout').onclick = async () => { await auth.signOut(); toast('Abgemeldet.'); go('#/tipp'); };
    const fd = document.getElementById('fDelete');
    fd.onsubmit = e => {
      e.preventDefault();
      if (fd.confirm.value.trim().toUpperCase() !== 'LÖSCHEN') { fd.querySelector('[data-err]').innerHTML = '<div class="notice bad">Bitte tippe LÖSCHEN zur Bestätigung.</div>'; return; }
      busy(fd.querySelector('button[type=submit]'), async () => {
        await rpc('delete_account');
        await auth.signOut().catch(() => {});
        toast('Dein Konto und alle Daten wurden gelöscht.');
        go('#/tipp');
      }, fd.querySelector('[data-err]'));
    };
  });

  return `${demoBar()}
    ${pageHead('Profil', '', 'Tippspiel')}
    <div class="grid g-main">
      <form class="card" id="fProfile">${cardHead('Name & Avatar')}<div class="card-pad stack">
        <div class="tp-ava-edit"><div id="avaPrev"></div><label class="tp-field" style="flex:1"><span>Name</span><input class="input" id="pName" name="name" maxlength="30" value="${esc(me.display_name)}" required></label></div>
        <div><div class="tp-label">Farbe</div><div class="tp-swatches">${AVATAR_COLORS.map(c => `<button type="button" class="tp-sw" data-col="${c}" style="--c:${c}" aria-label="Farbe ${c}"></button>`).join('')}</div></div>
        <div><div class="tp-label">Oder dein Lieblingsfahrer</div><div class="tp-drvs">${drivers.map(d => `<button type="button" class="tp-drv-ava" data-drv="${d.driver_id}" data-team="${d.team_id}" style="--c:${team(d.team_id).color}" title="${esc(d.given_name + ' ' + d.family_name)}">${img('drivers', d.driver_id, null, { width: 120, alt: d.family_name })}<span>${esc(d.code || d.family_name.slice(0, 3).toUpperCase())}</span></button>`).join('')}</div></div>
        <div data-err></div>
        <button class="btn" type="submit">Speichern</button>
      </div></form>
      <div class="stack">
        <div class="card">${cardHead('Konto')}<div class="card-pad stack">
          <div class="split"><span class="muted">E-Mail</span><b>${esc(user.email || '')}</b></div>
          <div class="split"><span class="muted">Dabei seit</span><b>${fmtDate(new Date(me.created_at), { day: 'numeric', month: 'long', year: 'numeric' })}</b></div>
          <button class="btn ghost" id="logout" type="button">Abmelden</button>
        </div></div>
        <form class="card" id="fPw">${cardHead('Passwort ändern')}<div class="card-pad stack">
          <label class="tp-field"><span>Neues Passwort</span><input class="input" name="pw" type="password" minlength="8" autocomplete="new-password" required></label>
          <label class="tp-field"><span>Wiederholen</span><input class="input" name="pw2" type="password" minlength="8" autocomplete="new-password" required></label>
          <div data-err></div><button class="btn ghost" type="submit">Passwort ändern</button>
        </div></form>
        <form class="card danger-zone" id="fDelete">${cardHead('Konto löschen')}<div class="card-pad stack">
          <p class="muted small">Löscht dein Konto, dein Profil, deine Mitgliedschaften und alle deine Tipps sofort und endgültig. Bist du der einzige Admin einer Gruppe, übernimmt das älteste Mitglied.</p>
          <label class="tp-field"><span>Zur Bestätigung LÖSCHEN eintippen</span><input class="input" name="confirm" autocomplete="off"></label>
          <div data-err></div><button class="btn danger" type="submit">Konto endgültig löschen</button>
        </div></form>
      </div>
    </div>`;
}

// =============================================================================
// Gruppe gründen
// =============================================================================
function settingsFields(s = DEFAULT_SETTINGS) {
  const radio = (name, value, label, text) => `<label class="tp-opt"><input type="radio" name="${name}" value="${value}" ${s[name] === value ? 'checked' : ''}><span><b>${label}</b>${text ? `<small>${text}</small>` : ''}</span></label>`;
  return `
    <div><div class="tp-label">Punktesystem</div><div class="tp-opts">${Object.entries(PRESETS).map(([k, p]) => radio('preset', k, p.label, p.text)).join('')}</div></div>
    <div><div class="tp-label">Tippschluss</div><div class="tp-opts">${radio('lock', 'early', 'Früh', 'Alles schliesst beim Qualifying-Start (Sprint-Tipps beim Sprint-Qualifying).')}${radio('lock', 'late', 'Spät', 'Quali-Tipps beim Qualifying, Renn- und Sprint-Tipps erst beim Start. Wer will, kennt dann schon die Startaufstellung.')}</div></div>
    <div><div class="tp-label">Wenn jemand nicht tippt</div><div class="tp-opts">${radio('missing', 'carry', MISSING_LABEL.carry, 'Der letzte Tipp derselben Art zählt nochmals.')}${radio('missing', 'zero', MISSING_LABEL.zero, '')}</div></div>
    <label class="tp-field"><span>Joker pro Saison (verdoppeln die Punkte eines Wochenendes – einsetzbar ab einem späteren Update)</span><select class="input" name="jokers">${[0, 1, 2, 3, 4, 5].map(n => `<option ${+s.jokers === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
}
const readSettings = f => ({ preset: f.preset.value, lock: f.lock.value, missing: f.missing.value, jokers: +f.jokers.value });

export async function groupNew() {
  const b = await backend();
  if (!b.user()) return needLogin('#/gruppe/neu', 'Melde dich an, um eine Gruppe zu gründen.');
  then(() => {
    const f = document.getElementById('fGroup');
    f.onsubmit = e => {
      e.preventDefault();
      busy(f.querySelector('button[type=submit]'), async () => {
        const r = await rpc('create_group', { p_name: f.name.value, p_settings: readSettings(f) });
        toast('Gruppe erstellt. Jetzt Freunde einladen!');
        go(`#/gruppe/${r.id}?neu=1`);
      }, f.querySelector('[data-err]'));
    };
  });
  return `${demoBar()}${pageHead('Gruppe gründen', 'Du wirst Admin und kannst die Einstellungen später jederzeit ändern.', 'Tippspiel')}
    <form class="card tp-narrow" id="fGroup"><div class="card-pad stack">
      <label class="tp-field"><span>Name der Gruppe</span><input class="input" name="name" maxlength="40" placeholder="z. B. Bierrunde Boxengasse" required></label>
      ${settingsFields()}
      <div data-err></div>
      <button class="btn" type="submit">Gruppe gründen</button>
    </div></form>`;
}

// =============================================================================
// Einladung
// =============================================================================
export async function join(code) {
  code = decodeURIComponent(code).toUpperCase();
  const b = await backend();
  const pv = await rpc('group_preview', { p_code: code }).catch(() => null);
  if (!pv) return `${demoBar()}${pageHead('Einladung ungültig')}<div class="notice">Diesen Einladungscode gibt es nicht (mehr). Frag nach einem neuen Link.</div><p><a class="btn ghost" href="#/tipp">Zum Tippspiel</a></p>`;
  if (pv.is_member) { location.replace('#/gruppe/' + pv.id); return ''; }
  const user = b.user();
  then(() => {
    const btn = document.getElementById('doJoin');
    if (btn) btn.onclick = () => busy(btn, async () => {
      const r = await rpc('join_group', { p_code: code });
      toast(`Willkommen in «${esc(pv.name)}»!`);
      go('#/gruppe/' + r.id);
    }, document.getElementById('joinErr'));
  });
  return `${demoBar()}<div class="tp-invite card">
      <div class="tp-gate-ico">🏆</div>
      <div class="kicker">Einladung zum Tippspiel</div>
      <h1>${esc(pv.name)}</h1>
      <p class="muted">${pv.members} ${pv.members == 1 ? 'Mitglied' : 'Mitglieder'} tippen hier schon die Formel 1.</p>
      ${user ? `<div id="joinErr"></div><button class="btn" id="doJoin">Gruppe beitreten</button>`
        : `<p>Erstelle ein Konto oder melde dich an. Danach bist du mit einem Klick dabei.</p>
           <div class="tp-actions"><a class="btn" href="#/login?mode=neu&next=${encodeURIComponent('#/beitreten/' + code)}">Konto erstellen</a><a class="btn ghost" href="#/login?next=${encodeURIComponent('#/beitreten/' + code)}">Anmelden</a></div>`}
    </div>`;
}

// =============================================================================
// Gruppe
// =============================================================================
function inviteBox(g) {
  const link = inviteLink(g.invite_code);
  then(() => {
    document.querySelectorAll('[data-invite]').forEach(btn => btn.onclick = async () => {
      const text = `Tipp mit mir die Formel 1 in der Gruppe «${g.name}» auf Pitwall:`;
      try {
        if (navigator.share && btn.dataset.invite === 'share') await navigator.share({ title: 'Pitwall Tippspiel', text, url: link });
        else { await navigator.clipboard.writeText(link); toast('Einladungslink kopiert.'); }
      } catch { /* abgebrochen */ }
    });
  });
  return `<div class="card tp-invitebox">${cardHead('Freunde einladen')}<div class="card-pad stack">
    <div class="tp-code"><span class="muted small">Code</span><b>${esc(g.invite_code)}</b></div>
    <div class="tp-link"><input class="input" readonly value="${esc(link)}" onclick="this.select()"></div>
    <div class="tp-row"><button class="btn small" data-invite="share">Link teilen</button><button class="btn small ghost" data-invite="copy">Kopieren</button></div>
  </div></div>`;
}

export async function groupPage(id) {
  const b = await backend();
  if (!b.user()) return needLogin(`#/gruppe/${id}`);
  const [g, sd, core, standings] = await Promise.all([rpc('group_detail', { p_group: id }), seasonData(), loadCore(), rpc('group_standings', { p_group: id })]);
  const me = b.user().id;
  const evs = upcoming(sd);
  const next = evs[0];
  const ge = next ? await rpc('group_event', { p_group: id, p_event: next.id }) : null;
  const skew = ge ? Date.parse(ge.now) - Date.now() : 0;
  const past = sd.events.filter(e => Date.parse(e.quali_start) < Date.now()).reverse();
  const fresh = query().get('neu');
  const kinds = next ? kindsFor(next) : [];
  const tipped = (uid, k) => ge?.status.some(s => s.user_id === uid && s.kind === k);

  return `${demoBar()}
    <div class="tp-ghead">
      <div><div class="kicker">Tippspiel-Gruppe · Saison ${esc(g.season)}</div><h1>${esc(g.name)}</h1>
        <div class="tp-avas">${g.members.slice(0, 12).map(m => avatar(m, 30)).join('')}<span class="muted small">${g.members.length} ${g.members.length == 1 ? 'Mitglied' : 'Mitglieder'}</span></div></div>
      ${g.role === 'admin' ? `<a class="btn ghost small" href="#/gruppe/${id}/admin">Einstellungen</a>` : ''}
    </div>
    ${fresh ? `<div class="notice ok">Deine Gruppe ist bereit. Schick deinen Freunden den Einladungslink unten.</div>` : ''}
    <section class="grid g-main section">
      <div class="stack">
        ${next ? `<div class="card">${cardHead(`${flagOf(core, next)} ${esc(next.name)}`, `<a class="muted small" href="#/gruppe/${id}/rennen/${next.id}">Alle Tipps ›</a>`)}
          <div class="card-pad">
            <div class="tp-locks">${kinds.map(k => {
              const lt = ge.locks[k] ? Date.parse(ge.locks[k]) : null;
              const open = lt && lt > Date.now() + skew;
              return `<div class="tp-lockrow"><span>${KIND_LABEL[k]}</span><span class="muted small">${lt ? fmtWhen(new Date(lt)) : ''}</span><span>${open ? liveLeft(lt, skew) : '<span class="tag">geschlossen</span>'}</span></div>`;
            }).join('')}</div>
            <div class="tp-who">${ge.members.map(m => {
              const n = kinds.filter(k => tipped(m.user_id, k)).length;
              return `<div class="tp-whorow">${avatar(m, 28)}<span>${esc(m.name)}</span><span class="tp-dots">${kinds.map(k => `<i class="${tipped(m.user_id, k) ? 'on' : ''}" title="${KIND_LABEL[k]}"></i>`).join('')}</span><span class="muted small">${n === kinds.length ? 'fertig' : n ? 'teilweise' : 'offen'}</span></div>`;
            }).join('')}</div>
            <div class="tp-actions"><a class="btn" href="#/tipp/${next.id}">Mein Tipp</a><a class="btn ghost" href="#/gruppe/${id}/rennen/${next.id}">Tipps der Gruppe</a></div>
          </div></div>` : ''}
        ${standingsCard(id, standings, me)}
        ${past.length ? `<div class="card">${cardHead('Bisherige Wochenenden')}<div class="tp-cal">${past.slice(0, 8).map(e => {
          const mine = standings.scores.find(s => s.user_id === me && s.event_id === e.id);
          const scored = standings.events.find(x => x.id === e.id)?.scored;
          return `<a class="tp-cal-row" href="#/gruppe/${id}/rennen/${e.id}"><span class="r">R${e.round}</span><span class="n">${flagOf(core, e)} ${esc(raceShort(e.name))}</span><span class="d muted">${scored ? `<b class="tp-mypts">${mine ? mine.points : 0} Pkt.</b>` : fmtDate(new Date(e.race_start), { day: 'numeric', month: 'short' })}</span><span class="go">›</span></a>`;
        }).join('')}</div></div>` : ''}
      </div>
      <div class="stack">
        ${inviteBox(g)}
        <div class="card">${cardHead('Mitglieder')}<div class="tp-members">${g.members.map(m => `<div class="tp-mrow">${avatar(m, 34)}<span class="tp-mname">${esc(m.name)}</span>${m.role === 'admin' ? tag('Admin', 'red') : ''}</div>`).join('')}</div></div>
        <details class="card card-pad tp-rules small"><summary><b>Regeln & Punkte dieser Gruppe</b></summary>
          <p class="muted">Punktesystem «${esc(PRESETS[g.settings.preset]?.label || 'Standard')}», Tippschluss ${g.settings.lock === 'late' ? 'spät' : 'früh'}, ${esc(MISSING_LABEL[g.settings.missing] || '')}.</p>
          ${pointsTable(g.points)}
          <p class="muted">Aussenseiter-Bonus gibt es ab 3 Tippern pro Tipp-Art. Ausfall = im Rennen ausgeschieden; Safety Car = nur echtes SC, kein VSC.</p>
        </details>
      </div>
    </section>`;
}

// =============================================================================
// Tipps einer Gruppe für ein Wochenende
// =============================================================================
export async function groupEvent(id, evId) {
  const b = await backend();
  if (!b.user()) return needLogin(`#/gruppe/${id}/rennen/${evId}`);
  const [g, ge, sd, core] = await Promise.all([rpc('group_detail', { p_group: id }), rpc('group_event', { p_group: id, p_event: evId }), seasonData(), loadCore()]);
  const ev = sd.events.find(e => e.id === evId) || { id: evId, name: evId, round: +evId.slice(5) };
  const skew = Date.parse(ge.now) - Date.now();
  const drv = new Map(sd.drivers.map(d => [d.driver_id, d]));
  const me = b.user().id;
  const kinds = kindsFor(ev);
  const chip = id2 => { const d = drv.get(id2); return d ? `<span class="tp-code-chip" style="--team:${team(d.team_id).color}">${esc(d.code || d.family_name.slice(0, 3).toUpperCase())}</span>` : `<span class="tp-code-chip">?</span>`; };
  const tipOf = (uid, k) => ge.tips.find(t => t.user_id === uid && t.kind === k);
  const tipped = (uid, k) => ge.status.some(s => s.user_id === uid && s.kind === k);
  const scoreOf = uid => ge.scores.find(s => s.user_id === uid);
  const res = ge.results || {};
  const isAdmin = g.role === 'admin';
  const raceOver = Date.parse(ev.race_start) <= Date.now() + skew || !!res.race;

  // Treffer pro getipptem Platz markieren: exakt (grün) oder Teilpunkte (gelb).
  const hitClass = (uid, k, slot) => {
    const it = scoreOf(uid)?.detail?.[k]?.items?.find(i => i.s === slot && i.k !== 'outsider');
    return !it ? '' : it.x ? 'hit' : 'part';
  };
  const show = (t, k, uid) => {
    if (!t) return '';
    if (k === 'extras') {
      const p = t.picks, out = [];
      const items = scoreOf(uid)?.detail?.extras?.items || [];
      const ok = key => (items.some(i => i.k === key) ? ' class="tp-x-hit"' : '');
      if (p.fastest) out.push(`<span${ok('fastest')}>⏱ ${chip(p.fastest)}</span>`);
      if (p.dotd) out.push(`<span${ok('dotd')}>⭐ ${chip(p.dotd)}</span>`);
      if (p.sc != null) out.push(`<span${ok('sc') || ok('scYes')}>SC ${EXTRAS.sc.fmt(p.sc)}</span>`);
      if (p.dnf != null) out.push(`<span${ok('dnf') || ok('dnfNear')}>Ausfälle ${EXTRAS.dnf.fmt(p.dnf)}</span>`);
      if (p.firstDnf) out.push(`<span${ok('firstDnf')}>1. Ausfall ${chip(p.firstDnf)}</span>`);
      return out.join(' · ');
    }
    return t.picks.order.map((d, i) => `<span class="tp-slotchip ${hitClass(uid, k, i + 1)}">${chip(d)}</span>`).join('');
  };
  const resultLine = k => {
    if (k === 'extras') {
      if (!res.race) return '';
      const out = [`⏱ ${res.fastest ? chip(res.fastest) : '?'}`, `⭐ ${ge.dotd ? chip(ge.dotd) : '<span class="muted">offen</span>'}`,
        `SC ${res.sc != null ? res.sc : '<span class="muted">offen</span>'}`, `Ausfälle ${(res.dnf || []).length}`];
      if (res.firstDnf?.length) out.push(`1. Ausfall ${res.firstDnf.map(chip).join('')}`);
      return `<div class="tp-result"><span class="tp-result-l">Resultat</span><span class="tp-tbody">${out.join(' · ')}</span></div>`;
    }
    const list = res[k];
    if (!list) return '';
    return `<div class="tp-result"><span class="tp-result-l">Resultat</span><span class="tp-tbody ${k === 'race' ? 'wrap' : ''}">${list.slice(0, k === 'race' ? 10 : 3).map(chip).join('')}</span></div>`;
  };
  const dotdForm = () => {
    if (!isAdmin || !raceOver) return '';
    then(() => {
      const f = document.getElementById('fDotd');
      if (f) f.onsubmit = e => {
        e.preventDefault();
        busy(f.querySelector('button'), async () => {
          await rpc('set_dotd', { p_group: id, p_event: evId, p_driver: f.drv.value || null });
          toast('Fahrer des Tages gespeichert. Punkte neu berechnet.');
          rerender();
        }, f.querySelector('[data-err]'));
      };
    });
    const opts = sd.drivers.filter(d => d.active).sort((a, b) => a.family_name.localeCompare(b.family_name));
    return `<form class="tp-dotd" id="fDotd"><span class="small"><b>Admin:</b> Fahrer des Tages (Fan-Wahl auf F1.com)</span>
      <select class="input" name="drv"><option value="">– offen –</option>${opts.map(d => `<option value="${d.driver_id}" ${ge.dotd === d.driver_id ? 'selected' : ''}>${esc(d.given_name + ' ' + d.family_name)}</option>`).join('')}</select>
      <button class="btn small">Speichern</button><div data-err></div></form>`;
  };

  const sections = kinds.map(k => {
    const lt = ge.locks[k] ? Date.parse(ge.locks[k]) : null;
    const locked = !lt || lt <= Date.now() + skew;
    return `<div class="card">${cardHead(KIND_LABEL[k], locked ? '<span class="tag">aufgedeckt</span>' : `<span class="muted small">aufgedeckt in ${liveLeft(lt, skew, rerender)}</span>`)}
      ${resultLine(k)}
      <div class="tp-tips">${ge.members.map(m => {
        const t = tipOf(m.user_id, k);
        const pts = scoreOf(m.user_id)?.detail?.[k];
        const body = t ? show(t, k, m.user_id) : locked ? '<span class="muted small">kein Tipp</span>' : tipped(m.user_id, k) ? '<span class="tp-hidden">getippt · verdeckt</span>' : '<span class="muted small">noch kein Tipp</span>';
        return `<div class="tp-tiprow ${m.user_id === me ? 'me' : ''}">${avatar(m, 28)}<span class="tp-tname">${esc(m.name)}${t?.source === 'auto' ? ' <span class="tag" title="Letzter Tipp übernommen">übernommen</span>' : ''}</span><span class="tp-tbody ${k === 'race' ? 'wrap' : ''}">${body}</span>${pts ? `<span class="tp-kpts">${pts.points}</span>` : ''}</div>`;
      }).join('')}</div>
      ${k === 'extras' ? dotdForm() : ''}</div>`;
  }).join('');

  // Punkte des Wochenendes (sobald ausgewertet)
  const evTab = ge.scores.length ? rankTable({ members: ge.members, scores: ge.scores.map(s => ({ ...s, event_id: evId })), adjustments: ge.adjustments.map(a => ({ ...a, event_id: evId })) }, new Set([evId])) : [];
  const summary = ge.scores.length ? `<div class="card">${cardHead('Punkte dieses Wochenendes', `<span class="muted small">${ge.results_at ? 'Resultat vom ' + fmtWhen(new Date(ge.results_at)) : ''}</span>`)}
      <div class="tp-rks">${evTab.map(r => `<details class="tp-rkd ${r.user_id === me ? 'me' : ''}"><summary class="tp-rk"><span class="tp-rk-pos">${r.rank}.</span>${avatar(r, 30)}<span class="tp-rk-name">${esc(r.name)}<small class="muted">${r.exact} exakt${r.adjust ? ` · Korrektur ${r.adjust > 0 ? '+' : ''}${r.adjust}` : ''} · Details</small></span><span class="tp-rk-pts">${r.points}<small>Pkt.</small></span></summary>
        <div class="tp-bds">${breakdown(scoreOf(r.user_id), drv)}${ge.adjustments.filter(a => a.user_id === r.user_id).map(a => `<div class="tp-bd"><div class="tp-bd-row"><span>Korrektur: ${esc(a.reason)}</span><span>${a.points > 0 ? '+' : ''}${a.points}</span></div></div>`).join('')}</div></details>`).join('')}</div>
      <p class="muted small card-pad" style="margin:0">Grün = exakt, gelb = Teilpunkte. Ändert sich das Resultat nachträglich (z. B. durch eine Strafe), wird automatisch neu gerechnet.</p></div>`
    : raceOver || res.quali ? `<div class="notice">Die Punkte erscheinen automatisch, sobald das offizielle Resultat da ist (meist 1–3 Stunden nach der Session).</div>` : '';

  return `${demoBar()}
    ${pageHead(`${flagOf(core, ev)} ${esc(ev.name)}`, `Tipps in «${esc(g.name)}». Fremde Tipps werden erst nach dem Tippschluss aufgedeckt.`, `Runde ${ev.round}`, `<a class="btn small" href="#/tipp/${evId}">Mein Tipp</a>`)}
    <div class="stack">${summary}${sections}</div>
    <p class="mt"><a class="link-arrow" href="#/gruppe/${id}">Zurück zur Gruppe</a> &nbsp; <a class="link-arrow" href="#/gruppe/${id}/rangliste">Rangliste</a> &nbsp; <a class="link-arrow" href="#/race/${ev.round}">Infos zum Rennwochenende</a></p>`;
}

// =============================================================================
// Admin
// =============================================================================
export async function groupAdmin(id) {
  const b = await backend();
  if (!b.user()) return needLogin(`#/gruppe/${id}/admin`);
  const g = await rpc('group_detail', { p_group: id });
  if (g.role !== 'admin') return `${pageHead('Nur für Admins')}<div class="notice">Diese Seite ist für die Admins der Gruppe.</div>`;
  const me = b.user().id;
  const st = await rpc('group_standings', { p_group: id });
  const doneEvs = st.events.filter(e => e.has_results).reverse();
  then(() => {
    const fa = document.getElementById('fAdj');
    fa.onsubmit = e => {
      e.preventDefault();
      busy(fa.querySelector('button[type=submit]'), async () => {
        await rpc('add_adjustment', { p_group: id, p_user: fa.user.value, p_points: Math.round(+fa.points.value), p_reason: fa.reason.value, p_event: fa.event.value || null });
        toast('Korrektur gespeichert.');
        rerender();
      }, fa.querySelector('[data-err]'));
    };
    document.querySelectorAll('[data-deladj]').forEach(x => x.onclick = () => {
      if (confirm('Diese Korrektur löschen?')) busy(x, async () => { await rpc('delete_adjustment', { p_group: id, p_id: +x.dataset.deladj }); toast('Korrektur gelöscht.'); rerender(); });
    });
    const f = document.getElementById('fSettings');
    f.onsubmit = e => {
      e.preventDefault();
      busy(f.querySelector('button[type=submit]'), async () => { await rpc('update_group', { p_group: id, p_name: f.name.value, p_settings: readSettings(f) }); toast('Einstellungen gespeichert.'); rerender(); }, f.querySelector('[data-err]'));
    };
    const regen = document.getElementById('regen');
    regen.onclick = () => { if (confirm('Neuen Code erstellen? Der alte Link funktioniert danach nicht mehr.')) busy(regen, async () => { await rpc('regenerate_invite', { p_group: id }); toast('Neuer Einladungscode erstellt.'); rerender(); }); };
    document.querySelectorAll('[data-role]').forEach(x => x.onclick = () => busy(x, async () => { await rpc('set_member_role', { p_group: id, p_user: x.dataset.uid, p_role: x.dataset.role }); rerender(); }));
    document.querySelectorAll('[data-kick]').forEach(x => x.onclick = () => {
      if (!confirm(`${x.dataset.name} aus der Gruppe entfernen? Seine Tipps in dieser Gruppe werden gelöscht.`)) return;
      busy(x, async () => { await rpc('remove_member', { p_group: id, p_user: x.dataset.kick }); toast('Mitglied entfernt.'); rerender(); });
    });
    const leave = document.getElementById('leave');
    leave.onclick = () => { if (confirm('Gruppe wirklich verlassen? Deine Tipps in dieser Gruppe werden gelöscht.')) busy(leave, async () => { await rpc('leave_group', { p_group: id }); toast('Du hast die Gruppe verlassen.'); go('#/tipp'); }); };
    const del = document.getElementById('fDel');
    del.onsubmit = e => {
      e.preventDefault();
      if (del.confirm.value.trim() !== g.name) { del.querySelector('[data-err]').innerHTML = '<div class="notice bad">Bitte den Gruppennamen genau eintippen.</div>'; return; }
      busy(del.querySelector('button[type=submit]'), async () => { await rpc('delete_group', { p_group: id }); toast('Gruppe gelöscht.'); go('#/tipp'); }, del.querySelector('[data-err]'));
    };
  });
  return `${demoBar()}${pageHead('Einstellungen', '', esc(g.name), `<a class="btn ghost small" href="#/gruppe/${id}">Zur Gruppe</a>`)}
    <div class="grid g-main">
      <form class="card" id="fSettings">${cardHead('Gruppe & Regeln')}<div class="card-pad stack">
        <label class="tp-field"><span>Name</span><input class="input" name="name" maxlength="40" value="${esc(g.name)}" required></label>
        ${settingsFields(g.settings)}
        <p class="muted small">Änderungen gelten ab sofort für die laufende Saison ${esc(g.season)}. Ein geänderter Tippschluss wirkt auf alle Tipps, die noch offen sind. Ein anderes Punktesystem rechnet alle bisherigen Wochenenden neu.</p>
        <div data-err></div><button class="btn" type="submit">Speichern</button>
      </div></form>
      <div class="stack">
        <form class="card" id="fAdj">${cardHead('Punkte korrigieren')}<div class="card-pad stack">
          <p class="muted small" style="margin:0">Für Sonderfälle, z. B. ein Tipp, der wegen eines Problems per Nachricht kam. Jede Korrektur ist mit Begründung für alle sichtbar.</p>
          <label class="tp-field"><span>Spieler</span><select class="input" name="user" required>${g.members.map(m => `<option value="${m.user_id}">${esc(m.name)}</option>`).join('')}</select></label>
          <div class="tp-row"><label class="tp-field" style="width:110px"><span>Punkte</span><input class="input" name="points" type="number" min="-100" max="100" step="1" required placeholder="z. B. 3"></label>
            <label class="tp-field" style="flex:1"><span>Wochenende (optional)</span><select class="input" name="event"><option value="">– ganze Saison –</option>${doneEvs.map(e => `<option value="${e.id}">R${e.round} · ${esc(raceShort(e.name))}</option>`).join('')}</select></label></div>
          <label class="tp-field"><span>Begründung</span><input class="input" name="reason" maxlength="120" required placeholder="z. B. Tipp kam per WhatsApp vor dem Tippschluss"></label>
          <div data-err></div><button class="btn ghost" type="submit">Korrektur speichern</button>
          ${st.adjustments.length ? `<div class="tp-adjs">${st.adjustments.map(a => `<div class="tp-adj"><b class="${a.points > 0 ? 'pos' : 'neg'}">${a.points > 0 ? '+' : ''}${a.points}</b><span>${esc(g.members.find(m => m.user_id === a.user_id)?.name || '?')}<small class="muted">${esc(a.reason)}</small></span><button type="button" class="btn tiny ghost danger" data-deladj="${a.id}">Löschen</button></div>`).join('')}</div>` : ''}
        </div></form>
        <div class="card">${cardHead('Einladung')}<div class="card-pad stack"><div class="tp-code"><span class="muted small">Aktueller Code</span><b>${esc(g.invite_code)}</b></div><button class="btn ghost small" id="regen">Neuen Code erstellen</button><p class="muted small">Nützlich, wenn der Link in falsche Hände geraten ist.</p></div></div>
        <div class="card">${cardHead('Mitglieder')}<div class="tp-members">${g.members.map(m => `<div class="tp-mrow">${avatar(m, 32)}<span class="tp-mname">${esc(m.name)}${m.user_id === me ? ' <span class="muted small">(du)</span>' : ''}</span>
          ${m.role === 'admin' ? `<button class="btn tiny ghost" data-role="member" data-uid="${m.user_id}">Admin ✓</button>` : `<button class="btn tiny ghost" data-role="admin" data-uid="${m.user_id}">Zum Admin</button>`}
          ${m.user_id === me ? '' : `<button class="btn tiny ghost danger" data-kick="${m.user_id}" data-name="${esc(m.name)}">Entfernen</button>`}</div>`).join('')}</div></div>
        <div class="card">${cardHead('Austreten')}<div class="card-pad"><button class="btn ghost" id="leave">Gruppe verlassen</button></div></div>
        <form class="card danger-zone" id="fDel">${cardHead('Gruppe löschen')}<div class="card-pad stack"><p class="muted small">Löscht die Gruppe mit allen Tipps endgültig.</p><label class="tp-field"><span>Zur Bestätigung den Gruppennamen eintippen</span><input class="input" name="confirm" autocomplete="off"></label><div data-err></div><button class="btn danger" type="submit">Gruppe löschen</button></div></form>
      </div>
    </div>`;
}

// =============================================================================
// Karte auf der Startseite
// =============================================================================
export async function homeTipCard(el) {
  if (!el) return;
  if (!probablyLoggedIn()) {
    el.innerHTML = `<a class="tp-homecard teaser" href="#/tipp"><span class="tp-hc-ico">🏆</span><span><b>Tippspiel</b><span class="muted"> · Tippe Pole, Podium und Top 10 gegen deine Freunde</span></span><span class="btn small">Mitspielen</span></a>`;
    return;
  }
  try {
    const b = await backend();
    if (!b.user()) { el.innerHTML = ''; return homeTipCard(el); }
    const sd = await seasonData();
    const next = upcoming(sd)[0];
    if (!next) { el.innerHTML = ''; return; }
    const st = await rpc('event_state', { p_event: next.id });
    if (!st.groups.length) { el.innerHTML = `<a class="tp-homecard" href="#/tipp"><span class="tp-hc-ico">🏆</span><span><b>Tippspiel</b><span class="muted"> · Gründe eine Gruppe oder tritt einer bei</span></span><span class="btn small">Los</span></a>`; return; }
    const s = myStatus(st);
    const lockAt = nextLock(st);
    const open = Object.values(s).filter(x => x === 'open').length;
    const skew = Date.parse(st.now) - Date.now();
    el.innerHTML = `<a class="tp-homecard ${open ? 'due' : ''}" href="#/tipp/${next.id}"><span class="tp-hc-ico">${open ? '✏️' : '✅'}</span>
      <span class="tp-hc-main"><b>${open ? 'Dein Tipp' : 'Getippt'}: ${esc(raceShort(next.name))}</b><span class="tp-sts">${Object.entries(s).map(([k, v]) => statusChip(k, v)).join('')}</span></span>
      ${lockAt ? `<span class="tp-hc-left muted small">${open ? 'Tippschluss in' : 'Änderbar noch'} <b data-left></b></span>` : ''}<span class="btn small">${open ? 'Jetzt tippen' : 'Ansehen'}</span></a>`;
    const lb = el.querySelector('[data-left]');
    if (lb) {
      const { fmtLeft } = await import('./common.js');
      const tick = () => { if (!lb.isConnected) return clearInterval(iv); lb.textContent = fmtLeft(lockAt - (Date.now() + skew)); };
      const iv = setInterval(tick, 1000); tick();
    }
  } catch (e) { console.warn('Tippkarte', e); el.innerHTML = ''; }
}
