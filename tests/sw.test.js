// Prüft den Service Worker gegen den echten Quellcode: Jedes Modul, das die
// Seite fest importiert, muss in SHELL stehen – sonst fehlt es offline.
// Am 07.11.2026 fehlten roster.js, tipp/reactions.js und tipp/titles.js.

import { suite, assert } from './harness.js';

// Alle fest (nicht dynamisch) importierten Module ab einem Einstiegspunkt.
async function staticImports(entry, readText) {
  const seen = new Set();
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = await readText(file); } catch { continue; }
    const dir = file.slice(0, file.lastIndexOf('/'));
    // Nur `import … from '…'` – `import(…)` als Funktionsaufruf bleibt draussen.
    for (const m of src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*['"](\.[^'"]+)['"]/g)) {
      const parts = (dir + '/' + m[1]).split('/');
      const out = [];
      for (const p of parts) {
        if (p === '.' || p === '') continue;
        if (p === '..') out.pop(); else out.push(p);
      }
      todo.push(out.join('/'));
    }
  }
  seen.delete(entry);
  return [...seen];
}

export default async function swTests({ readText }) {
  const t = suite('Service Worker');
  const sw = await readText('sw.js');
  const block = sw.slice(sw.indexOf('const SHELL = ['), sw.indexOf('];'));
  const shell = new Set([...block.matchAll(/'([^']+)'/g)].map(m => m[1]));

  t('Service Worker kennt alle fest importierten Module', async () => {
    const used = await staticImports('assets/js/app.js', readText);
    const fehlt = used.filter(f => f.endsWith('.js') && !shell.has(f));
    assert.deepEqual(fehlt, [], 'diese Module fehlen in SHELL und waeren offline nicht da');
  });

  t('SHELL verweist nur auf Dateien, die es gibt', async () => {
    const kaputt = [];
    for (const f of shell) {
      if (f === './') continue;
      try { await readText(f); } catch { kaputt.push(f); }
    }
    // addAll() bricht komplett ab, wenn eine einzige Datei fehlt – dann
    // installiert sich der Service Worker gar nicht mehr.
    assert.deepEqual(kaputt, [], 'fehlende Dateien verhindern die Installation');
  });

  t('Version wird mitgezogen, wenn sich SHELL ändert', () => {
    const v = sw.match(/const VERSION = '([^']+)'/);
    assert.ok(v, 'VERSION muss gesetzt sein');
    assert.ok(/^pitwall-v\d+$/.test(v[1]), `unerwartetes Format: ${v?.[1]}`);
  });

  return t;
}
