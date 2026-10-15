// Reaktionen auf einzelne Fahrer in den Tipps der Mitspieler.
// Feste Auswahl von zehn Emojis, pro Person und Pick genau eine Reaktion
// (dasselbe Emoji nochmal = wieder weg). Reagieren geht nur auf fremde Tipps
// und erst, wenn der Tipp aufgedeckt ist – dieselbe Regel wie in der Datenbank
// (tip_reactions, Funktion public.react).

import { esc } from '../ui.js';
import { then, onLeave } from '../shared.js';
import { rpc, live } from './api.js';
import { toast } from './common.js';

export const EMOJI = ['👍', '🔥', '😂', '😮', '🤯', '💀', '🤡', '🫡', '🤞', '❤️'];

const key = (uid, kind, slot) => `${uid}|${kind}|${slot}`;

// Reaktionen nach Pick gruppieren: Map('user|kind|slot' -> [{ user_id, emoji }])
function byPick(list) {
  const map = new Map();
  for (const r of list || []) {
    const k = key(r.target_user, r.kind, r.slot);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

// Wer hat womit reagiert? «Lena 🔥 · Marco 👍» – als Text für Tooltip und Liste.
const whoList = (rows, names, me) => (rows || [])
  .map(r => ({ name: r.user_id === me ? 'Du' : names.get(r.user_id) || 'Jemand', emoji: r.emoji }));

// Zähler für einen Pick: «🔥 2 👍», meine eigene Reaktion hervorgehoben.
function badges(rows, names, me) {
  if (!rows?.length) return '';
  const counts = new Map();
  for (const r of rows) counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
  const mine = rows.find(r => r.user_id === me)?.emoji;
  // Tooltip am ganzen Pick, nicht pro Emoji: sonst überdeckt er die Auswahl.
  return [...counts].sort((a, b) => b[1] - a[1] || EMOJI.indexOf(a[0]) - EMOJI.indexOf(b[0]))
    .map(([e, n]) => `<span class="tp-rx-b ${e === mine ? 'mine' : ''}">${e}${n > 1 ? `<b>${n}</b>` : ''}</span>`).join('');
}

// Ein Pick in einem Tipp. `can` = es darf reagiert werden (fremder, aufgedeckter
// Tipp). Auch sonst ist der Pick anklickbar, sobald Reaktionen da sind – dann
// zeigt er nur, wer reagiert hat (so sieht man es auch bei den eigenen Tipps).
export const pick = (inner, { uid, kind, slot, can }) =>
  `<button type="button" class="tp-rxp ${can ? 'can' : ''}" data-slot="${slot}" data-u="${uid}" data-k="${kind}"
    ${can ? 'aria-label="Reaktion wählen"' : 'disabled'}>${inner}<span class="tp-rx"></span></button>`;

// Hängt Reaktionen an eine schon gerenderte Tippübersicht:
// zeichnet die Zähler, öffnet die Auswahl und hört auf Änderungen der anderen.
export function wireReactions({ root, groupId, eventId, me, names, list }) {
  then(() => {
    const box = document.querySelector(root);
    if (!box) return;
    let current = list || [];
    let pop = null;

    const rowsOf = el => byPick(current).get(key(el.dataset.u, el.dataset.k, el.dataset.slot));

    const paint = () => {
      const map = byPick(current);
      box.querySelectorAll('.tp-rxp').forEach(el => {
        const slot = el.querySelector('.tp-rx');
        if (!slot) return;
        const rows = map.get(key(el.dataset.u, el.dataset.k, el.dataset.slot));
        const can = el.classList.contains('can');
        slot.innerHTML = badges(rows, names, me);
        el.classList.toggle('has', !!rows?.length);
        el.disabled = !can && !rows?.length;
        const who = whoList(rows, names, me).map(w => `${w.name} ${w.emoji}`).join(' · ');
        if (who) el.title = who; else el.removeAttribute('title');
      });
    };

    const close = () => { pop?.remove(); pop = null; };

    const open = el => {
      close();
      const rows = rowsOf(el);
      const can = el.classList.contains('can');
      const mine = (rows || []).find(r => r.user_id === me)?.emoji;
      const who = whoList(rows, names, me);
      pop = document.createElement('div');
      pop.className = 'tp-rx-pop';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', can ? 'Reaktion wählen' : 'Wer hat reagiert?');
      pop.innerHTML = (can ? `<div class="tp-rx-grid">${EMOJI.map(e => `<button type="button" class="${e === mine ? 'mine' : ''}" data-e="${e}">${e}</button>`).join('')}</div>` : '')
        + (who.length ? `<div class="tp-rx-who">${who.map(w => `<div><span>${w.emoji}</span>${esc(w.name)}</div>`).join('')}</div>` : '');
      document.body.append(pop);

      const r = el.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
      const above = r.top > h + 12;
      pop.style.left = `${left}px`;
      pop.style.top = `${(above ? r.top - h - 8 : r.bottom + 8) + scrollY}px`;

      pop.onclick = async ev => {
        const b = ev.target.closest('button[data-e]');
        if (!b) return;
        close();
        try {
          current = await rpc('react', {
            p_group: groupId, p_event: eventId, p_target: el.dataset.u,
            p_kind: el.dataset.k, p_slot: el.dataset.slot, p_emoji: b.dataset.e,
          });
          paint();
        } catch (e) { toast(e.message || 'Das hat nicht geklappt.', 'warn'); }
      };
      pop.querySelector('button')?.focus();
    };

    box.addEventListener('click', e => {
      const el = e.target.closest('.tp-rxp');
      if (!el || el.disabled) { close(); return; }
      const id = el.dataset.k + el.dataset.slot + el.dataset.u;
      if (pop?.dataset.for === id) { close(); return; }
      open(el);
      if (pop) pop.dataset.for = id;
    });
    const away = e => { if (pop && !pop.contains(e.target) && !e.target.closest('.tp-rxp')) close(); };
    const onEsc = e => { if (e.key === 'Escape') close(); };
    addEventListener('pointerdown', away);
    addEventListener('keydown', onEsc);
    addEventListener('resize', close);

    // Reaktionen der anderen sofort nachziehen (nur mit Supabase; im
    // Demo-Modus läuft die Datenbank allein auf diesem Gerät).
    let pending = null;
    const refresh = () => {
      clearTimeout(pending);
      pending = setTimeout(async () => {
        try { current = await rpc('event_reactions', { p_group: groupId, p_event: eventId }); paint(); }
        catch { /* beim nächsten Laden wieder */ }
      }, 250);
    };
    let off = null, gone = false;
    live(`rx-${eventId}`, { table: 'tip_reactions', filter: `group_id=eq.${groupId}` }, refresh)
      .then(f => { gone ? f() : (off = f); });

    onLeave(() => {
      gone = true;
      close();
      clearTimeout(pending);
      removeEventListener('pointerdown', away);
      removeEventListener('keydown', onEsc);
      removeEventListener('resize', close);
      off?.();
    });

    paint();
  });
}
