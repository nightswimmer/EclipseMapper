// Generates public/data/lunar-eclipses.json: every lunar eclipse in the same
// 200-year span as the solar dataset, each with two visibility zones:
//   - zoneAll: where the ENTIRE eclipse is visible (Moon above the horizon for
//     the whole umbral phase — penumbral phase for penumbral eclipses)
//   - zoneAny: where at least part of it is visible (Moon rises or sets during
//     the eclipse somewhere in the fringe between the two zones)
//
// A lunar eclipse looks the same from everywhere the Moon is up, so the zones
// are unions/intersections of 90-degree spherical caps centered on the moving
// sub-lunar point. Runs in seconds — separate from the ~30 min solar generator.
//
// Run with: npm run generate-lunar-data

import * as A from 'astronomy-engine';
import pc from 'polygon-clipping';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEG } from '../src/lib/bessel.js';
import { latLonToVec, makeStereographic, zoneToGeo, round2, roundN } from './lib/geom.mjs';

// Same span as the solar dataset.
const START = new Date('1926-08-13T00:00:00Z');
const END = new Date('2126-08-13T00:00:00Z');

// Geocentric sub-lunar point (where the Moon is at the zenith).
function subLunarPoint(time) {
  const rot = A.Rotation_EQJ_EQD(time);
  const m = A.RotateVector(rot, A.GeoVector(A.Body.Moon, time, true));
  const r = Math.hypot(m.x, m.y, m.z);
  const lat = Math.asin(m.z / r) / DEG;
  let lon = Math.atan2(m.y, m.x) / DEG - A.SiderealTime(time) * 15;
  lon = ((lon % 360) + 540) % 360 - 180;
  return { lat, lon };
}

// Projected polygon for the "Moon above horizon" cap (90 deg around center).
function capPolygon(lat, lon, proj, n = 240) {
  const c = latLonToVec(lat, lon);
  let u = [-c[1], c[0], 0];
  const ul = Math.hypot(...u);
  u = ul < 1e-9 ? [1, 0, 0] : u.map((v) => v / ul);
  const v = [
    c[1] * u[2] - c[2] * u[1],
    c[2] * u[0] - c[0] * u[2],
    c[0] * u[1] - c[1] * u[0],
  ];
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * 2 * Math.PI;
    const ct = Math.cos(th), st = Math.sin(th);
    const p = [u[0] * ct + v[0] * st, u[1] * ct + v[1] * st, u[2] * ct + v[2] * st];
    const plat = Math.asin(Math.max(-1, Math.min(1, p[2]))) / DEG;
    const plon = Math.atan2(p[1], p[0]) / DEG;
    const [X, Y] = proj.project(plat, plon);
    ring.push([roundN(X, 7), roundN(Y, 7)]);
  }
  return [ring];
}

const eclipses = [];
let ev = A.SearchLunarEclipse(A.MakeTime(START));
let count = 0;
while (ev.peak.date < END) {
  const kind = ev.kind; // 'penumbral' | 'partial' | 'total'
  // Zone window: the umbral phase for partial/total eclipses (the watchable
  // part), the penumbral phase for penumbral-only eclipses.
  const sdMin = kind === 'penumbral' ? ev.sd_penum : ev.sd_partial;
  const phase = kind === 'penumbral' ? 'penumbral' : 'umbral';
  const startDate = new Date(ev.peak.date.getTime() - sdMin * 60e3);
  const endDate = new Date(ev.peak.date.getTime() + sdMin * 60e3);

  const sub0 = subLunarPoint(ev.peak);
  const proj = makeStereographic(sub0.lat, sub0.lon);

  // Sample the sub-lunar point through the window (10-min steps, endpoints
  // included) and build one 90-degree cap per sample.
  const caps = [];
  const steps = Math.max(2, Math.ceil((2 * sdMin) / 10));
  for (let i = 0; i <= steps; i++) {
    const t = A.MakeTime(new Date(startDate.getTime() + ((2 * sdMin * 60e3) * i) / steps));
    const s = subLunarPoint(t);
    caps.push(capPolygon(s.lat, s.lon, proj));
  }

  // zoneAny = union of the caps; zoneAll = intersection of the caps.
  const union = pc.union(...caps);
  let inter = [caps[0]];
  for (let i = 1; i < caps.length; i++) inter = pc.intersection(inter, caps[i]);

  const any = zoneToGeo(union, proj);
  const all = zoneToGeo(inter, proj);

  eclipses.push({
    id: count,
    kind,
    peak: ev.peak.date.toISOString().slice(0, 16) + 'Z',
    obscuration: Number.isFinite(ev.obscuration) ? roundN(ev.obscuration, 3) : null,
    phase,
    start: startDate.toISOString().slice(0, 16) + 'Z',
    end: endDate.toISOString().slice(0, 16) + 'Z',
    subLat: round2(sub0.lat),
    subLon: round2(sub0.lon),
    zoneAll: all.rings,
    zoneAllPoles: all.poles,
    zoneAny: any.rings,
    zoneAnyPoles: any.poles,
  });
  count++;
  if (count % 50 === 0) console.log(`  ${count} lunar eclipses processed (latest: ${ev.peak.date.toISOString().slice(0, 10)})`);
  ev = A.NextLunarEclipse(ev.peak);
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'lunar-eclipses.json');
fs.writeFileSync(outFile, JSON.stringify({ generated: START.toISOString().slice(0, 10), eclipses }));

const byKind = {};
for (const e of eclipses) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
console.log(`\nWrote ${eclipses.length} lunar eclipses to ${outFile}`);
console.log('By kind:', byKind);
console.log(`File size: ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB`);
