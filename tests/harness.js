// Mini-Testrahmen, der im Browser (tests/index.html) und in Node
// (node tests/run.mjs, GitHub Action) gleich funktioniert.

export function suite(name) {
  const list = [];
  const t = (title, fn) => list.push({ suite: name, title, fn });
  t.list = list;
  return t;
}

const show = v => JSON.stringify(v);
export const assert = {
  ok(v, msg = 'Bedingung nicht erfüllt') { if (!v) throw new Error(msg); },
  equal(a, b, msg = '') { if (a !== b) throw new Error(`${msg ? msg + ': ' : ''}erwartet ${show(b)}, erhalten ${show(a)}`); },
  deepEqual(a, b, msg = '') { if (show(a) !== show(b)) throw new Error(`${msg ? msg + ': ' : ''}erwartet ${show(b)}, erhalten ${show(a)}`); },
  async rejects(fn, re, msg = '') {
    try { await fn(); } catch (e) {
      if (re && !re.test(e.message)) throw new Error(`${msg ? msg + ': ' : ''}falsche Fehlermeldung «${e.message}»`);
      return e;
    }
    throw new Error(`${msg ? msg + ': ' : ''}Fehler erwartet, aber es lief durch`);
  },
};

export async function runAll(factories, ctx, onResult = () => {}) {
  const results = [];
  for (const factory of factories) {
    const t = await factory(ctx);
    for (const test of t.list) {
      const t0 = Date.now();
      let r;
      try { await test.fn(); r = { suite: test.suite, title: test.title, ok: true, ms: Date.now() - t0 }; }
      catch (e) { r = { suite: test.suite, title: test.title, ok: false, ms: Date.now() - t0, error: e.message }; }
      results.push(r);
      onResult(r);
    }
  }
  return results;
}
