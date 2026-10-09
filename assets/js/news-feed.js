// News aus RSS-Feeds seriöser F1-Medien: einlesen, zuordnen, zusammenführen.
// Reine Funktionen ohne Browser- oder Node-Abhängigkeiten. Sie werden vom
// Update-Skript (scripts/news.mjs) und von den Tests benutzt.

import { TEAMS } from './config.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ss', eacute: 'é', egrave: 'è', aacute: 'á', iacute: 'í', oacute: 'ó', ccedil: 'ç' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
}

// HTML entfernen, Entities auflösen, Weissraum glätten, "Weiterlesen"-Reste kappen.
export function cleanText(s) {
  return decodeEntities(String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<a [^>]*class=.?more[\s\S]*$/i, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*(\.\.\.|…)\s*(Weiterlesen|Read more)?\s*$/i, ' …')
    .trim();
}

// Tracking-Parameter entfernen, damit dieselbe Meldung nicht doppelt erscheint.
export function canonicalUrl(u) {
  try {
    const url = new URL(decodeEntities(u).trim());
    [...url.searchParams.keys()].filter(k => /^utm_/i.test(k)).forEach(k => url.searchParams.delete(k));
    url.hash = '';
    return url.toString();
  } catch { return String(u || '').trim(); }
}

const tagValue = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};

// RSS 2.0 und Atom. Gibt rohe Einträge zurück: { title, url, summary, date, categories }.
export function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = text.match(/<item[\s>][\s\S]*?<\/item>/gi) || text.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    let url = cleanText(tagValue(b, 'link'));
    if (!url) url = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    if (!url && /isPermaLink="true"/i.test(b)) url = cleanText(tagValue(b, 'guid'));
    const rawDate = cleanText(tagValue(b, 'pubDate') || tagValue(b, 'published') || tagValue(b, 'updated') || tagValue(b, 'dc:date'));
    const d = rawDate ? new Date(rawDate) : null;
    return {
      title: cleanText(tagValue(b, 'title')),
      url: canonicalUrl(url),
      summary: cleanText(tagValue(b, 'description') || tagValue(b, 'summary') || tagValue(b, 'content')),
      date: d && !isNaN(d) ? d.toISOString() : null,
      categories: [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)].map(m => cleanText(m[1])),
    };
  }).filter(i => i.title && /^https?:\/\//.test(i.url));
}

// ---------------------------------------------------------------------------
// Zuordnung zu Fahrern, Teams und Kategorien
// ---------------------------------------------------------------------------
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Zusätzliche Schreibweisen der Teams in deutschen und englischen Medien.
const TEAM_ALIASES = {
  red_bull: ['red bull'], rb: ['racing bulls', 'vcarb', 'visa cash app'], aston_martin: ['aston martin'],
  audi: ['audi', 'sauber'], ferrari: ['ferrari', 'scuderia'], mercedes: ['mercedes', 'silberpfeil'],
};

// Reihenfolge = Vorrang. Die erste passende Kategorie gewinnt.
const CATEGORIES = [
  ['Regeln', /\b(fia|stewards?|rennkommissare?|strafe|strafpunkte|penalty|penalt|reglement|regel\w*|rules?|disqualifi\w*|untersuchung|investigat\w*|verdict|urteil|protest|verwarnung|reprimand)\b/],
  ['Technik', /\b(upgrades?|updates?|unterboden|frontflugel|heckflugel|flugel|technik\w*|technical|floor|wing|aero\w*|power unit|antrieb|motor(en)?wechsel|getriebe|gearbox|chassis|sidepods?|diffusor|diffuser)\b/],
  ['Transfer', /\b(vertrag\w*|cockpit|transfer\w*|contract|seat|signs?|unterschreibt|fahrermarkt|silly season|nachfolger|teamkollege 20\d\d|rookie)\b/],
  ['Rennen', /\b(qualifying|training|sprint|rennen|grand prix|gp|practice|race|pole|sieg|siegt|gewinnt|wins?|podium|startplatz|grid|fp[123]|q[123]|sq[123])\b/],
  ['Business', /\b(sponsor\w*|business|liberty|kalender|calendar|tv|ubertragung|finanz\w*|budget|cost cap|budgetgrenze|zuschauer|tickets?)\b/],
];

export function categorize(text) {
  const t = fold(text);
  return (CATEGORIES.find(([, re]) => re.test(t)) || ['News'])[0];
}

// roster: [{ driverId, familyName, givenName, team }]
export function tagNews(item, roster = []) {
  const title = fold(item.title), all = fold(`${item.title} ${item.summary}`);
  const hit = (text, word) => new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text);
  const pos = (text, word) => { const m = text.match(new RegExp(`(^|[^a-z])${word}([^a-z]|$)`)); return m ? m.index : Infinity; };

  const drivers = roster
    .map(d => ({ d, at: Math.min(pos(title, fold(d.familyName)) - 1e4, pos(all, fold(d.familyName))) }))
    .filter(x => x.at < Infinity && hit(all, fold(x.d.familyName)))
    .sort((a, b) => a.at - b.at)
    .map(x => x.d);

  // "Racing Bulls" enthält "Bull" – deshalb zuerst die längeren Namen entfernen.
  let rest = all;
  const teams = [];
  const names = Object.keys(TEAMS).flatMap(id => [...new Set([fold(TEAMS[id].short), ...(TEAM_ALIASES[id] || [])])].map(n => [id, n]))
    .sort((a, b) => b[1].length - a[1].length);
  for (const [id, n] of names) {
    const re = new RegExp(`(^|[^a-z])${n.replace(/ /g, '[\\s-]')}([^a-z]|$)`, 'g');
    if (re.test(rest)) {
      if (!teams.includes(id)) teams.push(id);
      rest = rest.replace(re, ' ');
    }
  }
  const team = teams.find(id => hit(title, fold(TEAMS[id].short))) || drivers[0]?.team || teams[0] || null;
  return {
    drivers: drivers.slice(0, 6).map(d => d.driverId),
    teams,
    team,
    category: categorize(`${item.title} ${item.categories?.join(' ') || ''} ${item.summary}`),
  };
}

// Neue Einträge mit den bisherigen zusammenführen (neueste zuerst, ohne Doppelte).
// Einträge ohne Datum bekommen den Zeitpunkt, an dem sie zum ersten Mal auftauchten.
export function mergeNews(prev = [], fresh = [], { now = new Date().toISOString(), max = 60 } = {}) {
  const byUrl = new Map(prev.map(n => [n.url, n]));
  const seenTitles = new Set(prev.map(n => fold(n.title)));
  let undated = 0;
  for (const n of fresh) {
    const old = byUrl.get(n.url);
    if (old) { byUrl.set(n.url, { ...old, ...n, firstSeen: old.firstSeen, date: n.date || old.date }); continue; }
    if (seenTitles.has(fold(n.title))) continue;
    seenTitles.add(fold(n.title));
    // Ohne Datum: Reihenfolge des Feeds beibehalten (je eine Minute älter).
    const date = n.date || new Date(Date.parse(now) - undated++ * 60e3).toISOString();
    byUrl.set(n.url, { ...n, firstSeen: now, date });
  }
  return [...byUrl.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, max);
}

// Schweizer Rechtschreibung für deutschsprachige Schlagzeilen.
export const swiss = s => String(s ?? '').replace(/ß/g, 'ss');
