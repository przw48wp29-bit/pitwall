// Schlanke SVG-Diagramme ohne externe Bibliothek.

import { esc } from './ui.js';

// Liniendiagramm. series: [{ label, color, values: [number|null], dash }]
// opts: { xLabels, height, yFmt, invert (Positionen: 1 oben), yMin, yMax, labelEvery }
export function lineChart(series, opts = {}) {
  const W = 900, H = opts.height || 320, P = { l: 46, r: 112, t: 14, b: 30 };
  const n = Math.max(...series.map(s => s.values.length), 1);
  const all = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
  if (!all.length) return '';
  let min = opts.yMin ?? Math.min(...all), max = opts.yMax ?? Math.max(...all);
  if (min === max) { min -= 1; max += 1; }
  const x = i => P.l + (n === 1 ? 0 : (i / (n - 1)) * (W - P.l - P.r));
  const y = v => {
    const f = (v - min) / (max - min);
    return opts.invert ? P.t + f * (H - P.t - P.b) : H - P.b - f * (H - P.t - P.b);
  };
  const fmt = opts.yFmt || (v => Math.round(v));
  const ticks = opts.yTicks || [0, .25, .5, .75, 1].map(f => min + f * (max - min));
  const grid = ticks.map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/><text x="${P.l - 8}" y="${y(v) + 4}" fill="#8a8a93" font-size="11" text-anchor="end">${esc(fmt(v))}</text>`).join('');
  const every = opts.labelEvery || Math.ceil(n / 14);
  const xl = (opts.xLabels || []).map((l, i) => (i % every === 0 || i === n - 1) ? `<text x="${x(i)}" y="${H - 9}" fill="#8a8a93" font-size="11" text-anchor="middle">${esc(l)}</text>` : '').join('');

  const ends = series.map(s => {
    let last = s.values.length - 1;
    while (last >= 0 && s.values[last] == null) last--;
    return { s, last, ly: last >= 0 ? y(s.values[last]) : -99 };
  }).filter(e => e.last >= 0).sort((a, b) => a.ly - b.ly);
  for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 14) ends[i].ly = ends[i - 1].ly + 14;

  const lines = series.map(s => {
    const segs = []; let cur = [];
    s.values.forEach((v, i) => { if (v == null || !isFinite(v)) { if (cur.length) segs.push(cur); cur = []; } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
    if (cur.length) segs.push(cur);
    return segs.map(seg => `<polyline fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round" stroke-linecap="round" points="${seg.join(' ')}"><title>${esc(s.label)}</title></polyline>`).join('');
  }).join('');
  const labels = ends.map(e => `<text x="${W - P.r + 8}" y="${e.ly + 4}" fill="${e.s.color}" font-size="12" font-weight="700">${esc(e.s.label)}${e.s.endLabel !== false ? ' ' + esc(fmt(e.s.values[e.last])) : ''}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.label || 'Diagramm')}">${grid}${xl}${lines}${labels}</svg>`;
}

// Reifenfarben wie in den TV-Grafiken.
export const COMPOUND = {
  SOFT: '#e10600', MEDIUM: '#ffd400', HARD: '#f0f0f0', INTERMEDIATE: '#39b54a', WET: '#2f7fff', UNKNOWN: '#6c6c74', TEST_UNKNOWN: '#6c6c74',
};

// Reifenstrategie: eine Zeile pro Fahrer, Stints als farbige Balken.
export function stintChart(rows, totalLaps) {
  const W = 900, rowH = 22, P = { l: 56, r: 12, t: 6, b: 26 };
  const H = P.t + rows.length * rowH + P.b;
  const x = lap => P.l + ((lap - 1) / Math.max(1, totalLaps)) * (W - P.l - P.r);
  const body = rows.map((r, i) => {
    const yy = P.t + i * rowH;
    return `<text x="${P.l - 8}" y="${yy + 15}" fill="#e0dedc" font-size="12" font-weight="700" text-anchor="end">${esc(r.code)}</text>` +
      r.stints.map(s => {
        const x1 = x(s.start), x2 = x(s.end + 1);
        const c = COMPOUND[s.compound] || COMPOUND.UNKNOWN;
        return `<rect x="${x1 + 1}" y="${yy + 3}" width="${Math.max(2, x2 - x1 - 2)}" height="${rowH - 6}" rx="4" fill="${c}" opacity="${s.new === false ? .65 : 1}"><title>${esc(r.code)}: ${esc(s.compound)} Runde ${s.start}–${s.end}${s.age ? ` (Reifenalter beim Start: ${s.age})` : ''}</title></rect>` +
          (x2 - x1 > 26 ? `<text x="${(x1 + x2) / 2}" y="${yy + 15}" font-size="10" font-weight="700" text-anchor="middle" fill="${s.compound === 'HARD' || s.compound === 'MEDIUM' ? '#15151e' : '#fff'}">${s.end - s.start + 1}</text>` : '');
      }).join('');
  }).join('');
  const ticks = [];
  for (let l = 1; l <= totalLaps; l += Math.max(5, Math.round(totalLaps / 10 / 5) * 5)) ticks.push(l);
  const axis = ticks.map(l => `<text x="${x(l)}" y="${H - 8}" fill="#8a8a93" font-size="11" text-anchor="middle">${l}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Reifenstrategie">${body}${axis}</svg>`;
}

// Einfaches Balkendiagramm (vertikal).
export function barChart(items, { color = '#e10600', height = 160, fmt = v => v } = {}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="bars" style="height:${height}px">${items.map(i => `<a class="bar-col" ${i.href ? `href="${i.href}"` : ''} title="${esc(i.title || '')}"><span class="bv">${i.value ? esc(fmt(i.value)) : ''}</span><i style="height:${(i.value / max) * (height - 40)}px;background:${i.color || color}"></i><span class="bl">${esc(i.label)}</span></a>`).join('')}</div>`;
}
