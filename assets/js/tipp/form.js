// Das Tipp-Formular eines Rennwochenendes.
//   * Plätze antippen → Fahrer wählen. Danach springt die Auswahl automatisch
//     zum nächsten freien Platz (ein Podium ist in drei Tipps erledigt).
//   * Bereits gewählte Fahrer sind markiert; erneut wählen = Plätze tauschen.
//     So kann kein Fahrer doppelt vorkommen.
//   * Reihenfolge per Ziehen am Griff ändern (Maus und Touch).
//   * Vorschläge: WM-Stand, letztes Rennen, Startaufstellung, mein letzter Tipp.
//   * Ein Tipp gilt für alle gewählten Gruppen. Gespeichert wird nur, was offen ist;
//     den Tippschluss prüft am Ende ohnehin die Datenbank.

import { team } from '../config.js';
import { loadCore, loadResults, loadEditorial, circuitHistory } from '../data.js';
import { esc, img, tag, countryFlag, hydrateImages, fmtDate } from '../ui.js';
import { then, takeAfterRender, pageHead, cardHead, weatherBlock } from '../shared.js';
import { classified } from '../stats.js';
import { rpc, backend } from './api.js';
import { KIND_LABEL, KIND_HINT, SLOTS, slotLabel, EXTRAS, kindsFor, validatePicks, draftToPicks, samePicks } from './rules.js';
import { seasonData, fmtWhen, liveLeft, toast, busy, needLogin, demoBar, rerender } from './common.js';

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* egal */ } };

// Spickzettel-Daten pro Fahrer: WM-Stand, Form (letzte 3 Rennen), Strafen.
// "res" (alle Saisonresultate) darf fehlen – dann ohne Formkurve.
function fieldInfo(sd, ev, core, ed, res) {
  const st = new Map(core.drivers.map(s => [s.Driver.driverId, s]));
  const recent = res ? res.races.filter(r => +r.round < ev.round || String(r.season) !== String(ev.season)).slice(-3) : [];
  return sd.drivers.filter(d => d.active).map(d => {
    const s = st.get(d.driver_id);
    const form = recent.map(r => { const x = r.Results.find(y => y.Driver.driverId === d.driver_id); return x ? (classified(x) ? x.position : 'DNF') : '–'; });
    const pen = (ed?.penalties?.grid || []).filter(p => p.driverId === d.driver_id && +p.round === +ev.round);
    return {
      id: d.driver_id, code: d.code || d.family_name.slice(0, 3).toUpperCase(), first: d.given_name, last: d.family_name,
      team: d.team_id, number: d.number, wm: s ? +s.position : 99, pts: s ? +s.points : 0, form, pen,
    };
  }).sort((a, b) => a.wm - b.wm || a.last.localeCompare(b.last));
}

// Vorschläge für die Reihenfolge.
function suggestions(ev, field, prev, res) {
  const ids = new Set(field.map(d => d.id));
  const fill = list => { const out = list.filter(x => ids.has(x)); for (const d of field) if (!out.includes(d.id)) out.push(d.id); return out; };
  const out = { wm: { label: 'WM-Stand', order: field.map(d => d.id) } };
  const lastRace = res?.races.filter(r => +r.round < ev.round || String(r.season) !== String(ev.season)).at(-1);
  if (lastRace) out.last = { label: 'Letztes Rennen', order: fill(lastRace.Results.filter(classified).map(r => r.Driver.driverId)) };
  const q = res?.quali.find(r => +r.round === +ev.round && String(r.season) === String(ev.season));
  if (q) out.grid = { label: 'Qualifying-Resultat', order: fill(q.QualifyingResults.map(r => r.Driver.driverId)) };
  for (const k of ['quali', 'sprint', 'race']) if (prev?.[k]?.order) out['prev_' + k] = { label: 'Mein letzter Tipp', order: prev[k].order, kind: k };
  return out;
}

export async function tipForm(evId) {
  const b = await backend();
  if (!b.user()) return needLogin(`#/tipp/${evId}`, 'Melde dich an, um für dieses Rennwochenende zu tippen.');
  let st = await rpc('event_state', { p_event: evId });
  const [sd, core] = await Promise.all([seasonData(), loadCore()]);
  const ev = st.event;
  const race = core.schedule.find(r => +r.round === ev.round && String(r.season) === String(ev.season));
  const flag = race ? countryFlag(race.Circuit.Location.country, 16) : '';
  const head = pageHead(`${flag} ${esc(ev.name)}`, '', `Runde ${ev.round} · Dein Tipp`, `<a class="btn ghost small" href="#/race/${ev.round}">Infos zum Wochenende</a>`);

  if (!st.groups.length) {
    return `${demoBar()}${head}<div class="card card-pad tp-gate"><div class="tp-gate-ico">👥</div><h2>Noch keine Gruppe</h2><p class="muted">Tipps gelten immer für eine Gruppe. Gründe eine oder tritt mit einem Einladungscode bei.</p><div class="tp-actions"><a class="btn" href="#/gruppe/neu">Gruppe gründen</a><a class="btn ghost" href="#/tipp">Mit Code beitreten</a></div></div>`;
  }

  // Die Saisonresultate (für Formkurve und Vorschläge) höchstens kurz abwarten,
  // damit das Formular sofort da ist. Kommen sie später, wird ergänzt.
  const ed = await loadEditorial();
  const resP = loadResults().catch(() => null);
  let res = await Promise.race([resP, new Promise(r => setTimeout(() => r(undefined), 1200))]);
  let field = fieldInfo(sd, ev, core, ed, res);
  let byId = new Map(field.map(d => [d.id, d]));
  const allowed = new Set(field.map(d => d.id));
  const kinds = kindsFor(ev);
  let sugg = suggestions(ev, field, st.previous, res);
  if (res === undefined) resP.then(r => {
    if (!r || !root()) return;
    res = r;
    field = fieldInfo(sd, ev, core, ed, res);
    byId = new Map(field.map(d => [d.id, d]));
    sugg = suggestions(ev, field, st.previous, res);
    render();
  });
  const DKEY = 'tippdraft:' + evId;
  const GKEY = 'tipp:groups';

  // ---------- Zustand ----------
  let skew = Date.parse(st.now) - Date.now();
  const allGroups = () => st.groups.map(g => g.id);
  let sel = new Set((lsGet(GKEY, null) || allGroups()).filter(id => allGroups().includes(id)));
  if (!sel.size) sel = new Set(allGroups());
  const selected = () => st.groups.filter(g => sel.has(g.id));
  const isOpen = k => selected().some(g => g.open[k] && Date.parse(g.locks[k]) > Date.now() + skew);
  const savedOf = k => selected().find(g => g.tips[k])?.tips[k].picks ?? null;
  const toDraft = (k, picks) => (k === 'extras' ? { ...(picks || {}) } : Array.from({ length: SLOTS[k] }, (_, i) => picks?.order?.[i] ?? null));

  const stored = lsGet(DKEY, {});
  const draft = {};
  for (const k of kinds) draft[k] = stored[k] && isOpen(k) ? stored[k] : toDraft(k, savedOf(k));
  const persist = () => lsSet(DKEY, draft);
  const dirty = k => isOpen(k) && selected().some(g => g.open[k] && !samePicks(draftToPicks(k, draft[k]), g.tips[k]?.picks ?? null));
  let errors = {};

  // ---------- Darstellung ----------
  const chip = d => `<span class="tp-dc"><span class="tp-dc-num">${esc(d.number || '')}</span><span class="tp-dc-name">${esc(d.first)} <b>${esc(d.last)}</b></span><span class="tp-dc-team">${esc(team(d.team).short)}</span></span>`;
  const lockInfo = k => {
    const locks = selected().map(g => ({ g, t: g.locks[k] ? Date.parse(g.locks[k]) : null })).filter(x => x.t);
    if (!locks.length) return '';
    const first = Math.min(...locks.map(x => x.t));
    const later = locks.filter(x => x.t > first);
    const open = first > Date.now() + skew;
    return `<div class="tp-lockline ${open ? '' : 'closed'}">${open ? `Tippschluss <b>${fmtWhen(new Date(first))}</b> · ${liveLeft(first, skew, () => { toast(`Tippschluss ${KIND_LABEL[k]} – Tipps sind jetzt aufgedeckt.`, 'info'); rerender(); })}` : '<b>Tippschluss vorbei</b>'}
      ${later.length ? `<span class="muted small">(in ${later.map(x => `«${esc(x.g.name)}» bis ${fmtWhen(new Date(x.t))}`).join(', ')})</span>` : ''}</div>`;
  };
  const differs = k => {
    const tips = selected().map(g => g.tips[k]?.picks ?? null);
    return tips.length > 1 && tips.some(t => !samePicks(t, tips[0]));
  };

  function slotsHtml(k, editable) {
    return `<ol class="tp-slots ${k}" data-kind="${k}">${draft[k].map((id, i) => {
      const d = byId.get(id) || (id ? { id, first: '', last: id, team: null, number: '' } : null);
      return `<li class="tp-slot ${d ? '' : 'is-empty'} ${k === 'race' && i < 3 ? 'podium' : ''}" data-i="${i}" ${d ? `style="--team:${team(d.team).color}"` : ''}>
        <span class="tp-pos">${slotLabel(k, i)}</span>
        <button type="button" class="tp-pick" data-pick="${k}:${i}" ${editable ? '' : 'disabled'}>${d ? chip(d) : `<span class="tp-ph">${editable ? '+ Fahrer wählen' : '–'}</span>`}</button>
        ${editable && d ? `<span class="tp-handle" data-drag="${k}" title="Ziehen zum Verschieben" aria-hidden="true"><i></i><i></i><i></i></span>` : ''}
      </li>`;
    }).join('')}</ol>`;
  }

  function extrasHtml(editable) {
    const x = draft.extras;
    return `<div class="tp-extras">${Object.entries(EXTRAS).map(([key, def]) => {
      let ctl;
      if (def.type === 'driver') {
        const d = byId.get(x[key]);
        ctl = `<button type="button" class="tp-pick ${d ? '' : 'is-empty'}" data-xpick="${key}" ${editable ? '' : 'disabled'} ${d ? `style="--team:${team(d.team).color}"` : ''}>${d ? chip(d) : `<span class="tp-ph">${editable ? '+ Fahrer wählen' : '–'}</span>`}</button>`;
      } else {
        ctl = `<div class="tp-seg" role="group">${def.options.map(n => `<button type="button" class="${x[key] === n ? 'on' : ''}" data-xset="${key}:${n}" ${editable ? '' : 'disabled'}>${def.fmt(n)}</button>`).join('')}</div>`;
      }
      return `<div class="tp-x"><div class="tp-xl"><b>${def.label}</b>${def.note ? `<small>${esc(def.note)}</small>` : ''}</div>${ctl}</div>`;
    }).join('')}</div>`;
  }

  function fillBar(k) {
    const opts = Object.entries(sugg).filter(([key, s]) => !s.kind || s.kind === k).filter(([key]) => !(key === 'grid' && k === 'quali'));
    return `<div class="tp-fill"><span class="muted small">Vorschlag:</span>${opts.map(([key, s]) => `<button type="button" class="chip" data-fill="${k}:${key}">${esc(s.label)}</button>`).join('')}<button type="button" class="chip ghost" data-fill="${k}:clear">Leeren</button></div>`;
  }

  function sectionHtml(k) {
    const editable = isOpen(k);
    const saved = selected().some(g => g.tips[k]);
    const state = dirty(k) ? '<span class="tag warn">nicht gespeichert</span>' : saved ? '<span class="tag ok">gespeichert ✓</span>' : editable ? '<span class="tag">offen</span>' : '<span class="tag">kein Tipp</span>';
    const groupLinks = !editable ? `<div class="tp-reveal">${selected().map(g => `<a class="link-arrow" href="#/gruppe/${g.id}/rennen/${evId}">Tipps in «${esc(g.name)}»</a>`).join('')}</div>` : '';
    return `<section class="tp-sec card ${editable ? '' : 'locked'}" id="sec-${k}">
      <div class="tp-sec-head"><div><h2>${KIND_LABEL[k]}</h2><div class="muted small">${KIND_HINT[k]}</div></div>${state}</div>
      ${lockInfo(k)}
      ${differs(k) ? '<div class="notice small">In deinen Gruppen ist hier Unterschiedliches gespeichert. Beim Speichern gilt dieser Tipp für alle gewählten Gruppen.</div>' : ''}
      ${k === 'extras' ? extrasHtml(editable) : slotsHtml(k, editable)}
      ${editable && k !== 'extras' ? fillBar(k) : ''}
      ${errors[k] ? `<div class="notice bad small">${esc(errors[k])}</div>` : ''}
      ${groupLinks}
    </section>`;
  }

  function groupsHtml() {
    if (st.groups.length < 2) return `<div class="tp-for muted small">Tipp für «${esc(st.groups[0].name)}»</div>`;
    return `<div class="tp-for"><span class="muted small">Tipp gilt für:</span>${st.groups.map(g => `<label class="chip ${sel.has(g.id) ? 'active' : ''}"><input type="checkbox" data-gsel="${g.id}" ${sel.has(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div>`;
  }

  function saveBarHtml() {
    const changed = kinds.filter(dirty);
    const anyOpen = kinds.some(isOpen);
    if (!anyOpen) return `<div class="tp-savebar"><span class="muted">Alle Tipps für dieses Wochenende sind geschlossen.</span></div>`;
    const anySaved = kinds.some(k => selected().some(g => g.tips[k]));
    return `<div class="tp-savebar ${changed.length ? 'dirty' : ''}"><span>${changed.length ? `${changed.map(k => KIND_LABEL[k]).join(', ')} noch nicht gespeichert` : anySaved ? 'Alles gespeichert ✓' : 'Noch kein Tipp abgegeben'}</span>
      <button class="btn" id="tpSave" ${changed.length ? '' : 'disabled'}>Tipp speichern</button></div>`;
  }

  const root = () => document.getElementById('tpForm');
  function render() {
    const el = root();
    if (!el) return;
    el.innerHTML = `${groupsHtml()}${kinds.map(sectionHtml).join('')}${saveBarHtml()}`;
    hydrateImages(el);
    bind();
    takeAfterRender().forEach(fn => fn());   // z. B. Countdowns starten
  }
  const changed = () => { persist(); errors = {}; render(); };

  // ---------- Fahrer-Auswahl (Bottom Sheet) ----------
  let sheet = null;
  function openPicker(target) {   // target: { kind, i } für Plätze oder { extra } für Zusatztipps
    closePicker();
    sheet = document.createElement('div');
    sheet.className = 'tp-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    document.body.appendChild(sheet);
    document.body.classList.add('no-scroll');
    const pen = d => d.pen.length ? `<span class="tp-pen" title="${esc(d.pen.map(p => `${p.penalty}: ${p.reason || ''}`).join('; '))}">${esc(d.pen[0].penalty)}</span>` : '';
    const paint = () => {
      const k = target.kind;
      const used = k ? new Map(draft[k].map((id, i) => [id, i]).filter(([id]) => id)) : new Map();
      const current = k ? draft[k][target.i] : draft.extras[target.extra];
      const title = k ? `${slotLabel(k, target.i)} · ${KIND_LABEL[k]}` : EXTRAS[target.extra].label;
      sheet.innerHTML = `<div class="tp-sheet-bg" data-close></div><div class="tp-sheet-in">
        <div class="tp-sheet-head"><div><b>${esc(title)}</b><div class="muted small">${k ? 'Gewählte Fahrer tauschen beim Antippen den Platz.' : 'Fahrer antippen'}</div></div><button class="icon-x" data-close aria-label="Schliessen">×</button></div>
        <div class="tp-grid">${field.map(d => {
          const u = used.get(d.id);
          return `<button type="button" class="tp-drv ${u != null ? 'used' : ''} ${current === d.id ? 'cur' : ''}" data-id="${d.id}" style="--team:${team(d.team).color}">
            <span class="ava">${img('drivers', d.id, null, { width: 120, alt: '' })}</span>
            <span class="tp-drv-n"><b>${esc(d.last)}</b><small>${esc(team(d.team).short)}</small></span>
            <span class="tp-drv-m">P${d.wm < 99 ? d.wm : '–'} WM${d.form.length ? ` · ${d.form.join('-')}` : ''}</span>
            ${u != null ? `<span class="tp-used">${slotLabel(k, u)}</span>` : ''}${pen(d)}
          </button>`;
        }).join('')}</div>
        ${current ? '<button type="button" class="btn ghost small" data-clear>Auswahl entfernen</button>' : ''}
      </div>`;
      hydrateImages(sheet);
      sheet.querySelectorAll('[data-close]').forEach(x => x.onclick = closePicker);
      const clr = sheet.querySelector('[data-clear]');
      if (clr) clr.onclick = () => { if (k) draft[k][target.i] = null; else draft.extras[target.extra] = null; changed(); closePicker(); };
      sheet.querySelectorAll('[data-id]').forEach(x => x.onclick = () => choose(x.dataset.id));
    };
    const choose = id => {
      if (!target.kind) {
        draft.extras[target.extra] = id;
        if (target.extra === 'firstDnf' && draft.extras.dnf === 0) draft.extras.dnf = null;
        changed(); closePicker(); return;
      }
      const arr = draft[target.kind];
      const j = arr.indexOf(id);
      if (j >= 0 && j !== target.i) arr[j] = arr[target.i];   // tauschen
      arr[target.i] = id;
      changed();
      // Weiter zum nächsten freien Platz
      const nextFree = arr.findIndex((x, i) => !x && i > target.i);
      const anyFree = nextFree >= 0 ? nextFree : arr.findIndex(x => !x);
      if (anyFree >= 0 && j < 0) { target = { kind: target.kind, i: anyFree }; paint(); } else closePicker();
    };
    paint();
    document.addEventListener('keydown', escClose);
  }
  const escClose = e => { if (e.key === 'Escape') closePicker(); };
  function closePicker() {
    if (sheet) { sheet.remove(); sheet = null; }
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', escClose);
  }

  // ---------- Ziehen zum Sortieren ----------
  function bindDrag(list, k) {
    // Die Ereignisse hören am ganzen Fenster mit: Verschiebt man die Zeile im DOM,
    // geht die Zeiger-Bindung (pointer capture) verloren.
    list.querySelectorAll('[data-drag]').forEach(h => h.onpointerdown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      const li = h.closest('li');
      li.classList.add('dragging');
      list.classList.add('sorting');
      const move = ev => {
        ev.preventDefault();
        const others = [...list.children].filter(x => x !== li);
        const over = others.find(x => { const r = x.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY <= r.bottom; });
        if (!over) return;
        const r = over.getBoundingClientRect();
        const before = ev.clientY < r.top + r.height / 2 ? over : over.nextSibling;
        if (before !== li && before !== li.nextSibling) list.insertBefore(li, before);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        draft[k] = [...list.children].map(x => draft[k][+x.dataset.i] ?? null);
        changed();
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  // ---------- Ereignisse ----------
  function bind() {
    const el = root();
    el.querySelectorAll('[data-pick]').forEach(x => x.onclick = () => { const [k, i] = x.dataset.pick.split(':'); openPicker({ kind: k, i: +i }); });
    el.querySelectorAll('[data-xpick]').forEach(x => x.onclick = () => openPicker({ extra: x.dataset.xpick }));
    el.querySelectorAll('[data-xset]').forEach(x => x.onclick = () => {
      const [key, n] = x.dataset.xset.split(':');
      draft.extras[key] = draft.extras[key] === +n ? null : +n;   // nochmals antippen = abwählen
      if (key === 'dnf' && draft.extras.dnf === 0) draft.extras.firstDnf = null;
      changed();
    });
    el.querySelectorAll('[data-fill]').forEach(x => x.onclick = () => {
      const [k, key] = x.dataset.fill.split(':');
      draft[k] = key === 'clear' ? Array(SLOTS[k]).fill(null) : Array.from({ length: SLOTS[k] }, (_, i) => sugg[key].order[i] ?? null);
      changed();
    });
    el.querySelectorAll('.tp-slots').forEach(l => bindDrag(l, l.dataset.kind));
    el.querySelectorAll('[data-gsel]').forEach(x => x.onchange = () => {
      if (x.checked) sel.add(x.dataset.gsel); else if (sel.size > 1) sel.delete(x.dataset.gsel); else x.checked = true;
      lsSet(GKEY, [...sel]);
      render();
    });
    const save = document.getElementById('tpSave');
    if (save) save.onclick = () => busy(save, doSave);
  }

  async function doSave() {
    errors = {};
    const todo = kinds.filter(dirty);
    for (const k of todo) {
      const picks = draftToPicks(k, draft[k]);
      const err = picks && validatePicks(k, picks, allowed);
      if (err) errors[k] = err;
    }
    if (Object.keys(errors).length) { render(); document.getElementById('sec-' + Object.keys(errors)[0])?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    const report = [];
    for (const k of todo) {
      const groups = selected().filter(g => g.open[k]).map(g => g.id);
      const res = await rpc('save_tips', { p_event: evId, p_kind: k, p_picks: draftToPicks(k, draft[k]), p_groups: groups });
      const bad = res.filter(r => !r.ok);
      if (bad.length) errors[k] = bad.map(r => `${st.groups.find(g => g.id === r.group_id)?.name}: ${r.error}`).join(' · ');
      report.push({ k, ok: res.length - bad.length, bad: bad.length });
    }
    st = await rpc('event_state', { p_event: evId });
    skew = Date.parse(st.now) - Date.now();
    const keep = {};
    for (const k of kinds) if (errors[k]) keep[k] = draft[k]; else draft[k] = toDraft(k, savedOf(k));
    lsSet(DKEY, Object.keys(keep).length ? keep : null);
    render();
    const okKinds = report.filter(r => r.ok).map(r => KIND_LABEL[r.k]);
    if (okKinds.length) toast(`Gespeichert: ${okKinds.join(', ')}${selected().length > 1 ? ` · für ${selected().length} Gruppen` : ''} ✓`);
    if (report.some(r => r.bad)) toast('Nicht alles gespeichert – siehe Hinweise.', 'bad', 6000);
  }

  // ---------- Infos zum Wochenende (Spickzettel) ----------
  then(async () => {
    render();
    const box = document.getElementById('tpInfo');
    if (!box) return;
    const ed = await loadEditorial();
    const pens = (ed?.penalties?.grid || []).filter(p => +p.round === +ev.round);
    const [wx, hist] = await Promise.all([race ? weatherBlock(race, { bare: true }) : '', race ? circuitHistory(race.Circuit.circuitId).catch(() => []) : []]);
    const winners = (hist || []).slice(-5).reverse();
    const top = field.slice(0, 6);
    const parts = [];
    if (pens.length) parts.push(`<div><div class="tp-label">Rückversetzungen</div>${pens.map(p => { const d = byId.get(p.driverId); return `<div class="tp-info-row"><b>${esc(d ? d.last : p.driverId)}</b><span>${esc(p.penalty)}</span><span class="muted small">${esc(p.reason || '')}</span></div>`; }).join('')}</div>`);
    parts.push(`<div><div class="tp-label">Form (letzte 3 Rennen)</div>${top.map(d => `<div class="tp-info-row" style="--team:${team(d.team).color}"><span class="tp-bar"></span><b>${esc(d.last)}</b><span class="muted small">WM P${d.wm}</span><span class="tp-form">${d.form.map(f => `<i class="${f === 1 || f === '1' ? 'win' : +f <= 3 ? 'pod' : f === 'DNF' ? 'dnf' : ''}">${f}</i>`).join('')}</span></div>`).join('')}</div>`);
    if (winners.length) parts.push(`<div><div class="tp-label">Sieger hier zuletzt</div>${winners.map(w => `<div class="tp-info-row"><span class="muted small">${esc(w.season)}</span><b>${esc(w.Results?.[0]?.Driver?.familyName || '')}</b><span class="muted small">${esc(team(w.Results?.[0]?.Constructor?.constructorId).short)}</span></div>`).join('')}</div>`);
    if (wx) parts.push(`<div><div class="tp-label">Wetter</div>${wx}</div>`);
    box.innerHTML = parts.join('');
  });

  return `${demoBar()}${head}
    <details class="card tp-info"><summary>${cardHead('Spickzettel: Form, Strafen, Wetter', '<span class="muted small">aufklappen</span>')}</summary><div class="card-pad tp-info-grid" id="tpInfo"><div class="spin"></div></div></details>
    <div id="tpForm" class="tp-form"></div>`;
}
