// Tests in Node ausführen (lokal: npm test, auf GitHub: .github/workflows/tests.yml).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { runAll } from './harness.js';
import rules from './rules.test.js';
import news from './news.test.js';
import stats from './stats.test.js';
import db from './db.test.js';
import scoring from './scoring.test.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { PGlite, readText: p => fs.readFile(path.join(ROOT, p), 'utf8') };

let last = '';
const results = await runAll([rules, news, stats, db, scoring], ctx, r => {
  if (r.suite !== last) { console.log(`\n${r.suite}`); last = r.suite; }
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.title}${r.ok ? '' : `\n      ${r.error}`}`);
});
const bad = results.filter(r => !r.ok).length;
console.log(`\n${results.length - bad} von ${results.length} Tests bestanden.`);
process.exit(bad ? 1 : 0);
