// News-Update: holt die RSS-Feeds seriöser F1-Medien und schreibt data/news.json.
// Läuft alle 2 Stunden als GitHub Action (.github/workflows/news.yml) und
// zusätzlich im täglichen Update. Gratis, ohne KI und ohne Schlüssel.
//
// Die Seite zeigt Titel, Kurztext und Link zum Originalartikel. Bebildert wird
// mit unseren eigenen Wikimedia-Fotos (Fahrer/Team), nicht mit Pressefotos.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEWS_FEEDS, API } from '../assets/js/config.js';
import { parseFeed, tagNews, mergeNews, swiss } from '../assets/js/news-feed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'data', 'news.json');
const UA = 'Mozilla/5.0 (compatible; PitwallF1Hub/1.0; private fan site)';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function roster() {
  // Aktuelle Fahrer mit Team, damit die Meldungen zugeordnet werden können.
  try {
    const snap = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'season.json'), 'utf8'));
    if (snap?.core?.drivers?.length) return snap.core.drivers;
  } catch { /* kein Snapshot */ }
  const res = await fetch(`${API.jolpica}/current/driverStandings.json`, { headers: { 'User-Agent': UA } });
  return (await res.json()).MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
}

export async function updateNews() {
  const drivers = (await roster()).map(s => ({
    driverId: s.Driver.driverId, givenName: s.Driver.givenName, familyName: s.Driver.familyName,
    team: s.Constructors.at(-1)?.constructorId,
  }));
  let prev = {};
  try { prev = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { /* erster Lauf */ }

  const fresh = [];
  const status = {};
  for (const feed of NEWS_FEEDS) {
    try {
      const res = await fetch(feed.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const items = parseFeed(await res.text()).slice(0, 30);
      const fix = feed.lang === 'de' ? swiss : s => s;
      for (const it of items) {
        fresh.push({
          title: fix(it.title), summary: fix(it.summary.slice(0, 320)), url: it.url, date: it.date,
          source: feed.name, sourceId: feed.id, lang: feed.lang,
          ...tagNews(it, drivers),
        });
      }
      status[feed.id] = { ok: true };
      log(`${feed.name}: ${items.length} Meldungen`);
    } catch (e) {
      status[feed.id] = { ok: false, error: e.message };
      log(`${feed.name}: FEHLER ${e.message}`);
    }
  }

  // Die Datei ändert sich nur bei neuen Meldungen oder geändertem Feed-Status,
  // damit die Action nicht alle 2 Stunden einen leeren Commit macht.
  const items = mergeNews(prev.items || [], fresh);
  const changed = JSON.stringify(items) !== JSON.stringify(prev.items || []);
  const out = { updatedAt: changed || !prev.updatedAt ? new Date().toISOString() : prev.updatedAt, feeds: status, items };
  await fs.writeFile(FILE, JSON.stringify(out, null, 1) + '\n');
  log(changed ? `news.json aktualisiert (${items.length} Meldungen)` : 'keine neuen Meldungen');
  return out;
}

// Direkt gestartet (node scripts/news.mjs)?
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await updateNews();
}
