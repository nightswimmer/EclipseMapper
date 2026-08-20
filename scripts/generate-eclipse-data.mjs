// Generates public/data/eclipses.json: every solar eclipse in the next 100 years,
// with Besselian-element polynomials plus precomputed geometry:
//   - central line (with per-point time offsets) for total/annular/hybrid eclipses
//   - umbral/antumbral band polygon (path of totality/annularity)
//   - penumbral region multipolygon (where at least a partial eclipse is visible)
//
// Run with: npm run generate-data

import * as A from 'astronomy-engine';
import pc from 'polygon-clipping';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elementsAt, intersectEllipsoid, evalPolyDeriv, DEG } from '../src/lib/bessel.js';
import { makeStereographic, rdp, pointInRing, round2, roundN } from './lib/geom.mjs';

// 100 years back, 100 years ahead.
const START = new Date('1926-08-13T00:00:00Z');
const END = new Date('2126-08-13T00:00:00Z');

const ER_KM = 6378.137;                    // Earth equatorial radius, km
const ER_PER_AU = 149597870.7 / ER_KM;     // Earth radii per AU
const SUN_RADIUS_ER = 696000 / ER_KM;      // Sun radius in Earth radii
const K_PENUMBRA = 0.2725076;              // Moon radius (penumbra convention)
const K_UMBRA = 0.272281;                  // Moon radius (umbra convention)

// ---------------------------------------------------------------------------
// Instantaneous Besselian elements from the ephemeris
// ---------------------------------------------------------------------------

function instantaneousElements(time) {
  const rot = A.Rotation_EQJ_EQD(time);
  const moonJ = A.GeoVector(A.Body.Moon, time, true);
  const sunJ = A.GeoVector(A.Body.Sun, time, true);
  const m = A.RotateVector(rot, moonJ);
  const s = A.RotateVector(rot, sunJ);
  const mv = [m.x * ER_PER_AU, m.y * ER_PER_AU, m.z * ER_PER_AU];
  const sv = [s.x * ER_PER_AU, s.y * ER_PER_AU, s.z * ER_PER_AU];

  const g = [sv[0] - mv[0], sv[1] - mv[1], sv[2] - mv[2]];
  const G = Math.hypot(...g);
  const a = [g[0] / G, g[1] / G, g[2] / G]; // shadow-axis direction (toward Sun)

  const d = Math.asin(a[2]);
  const alpha = Math.atan2(a[1], a[0]);
  const gastDeg = A.SiderealTime(time) * 15;
  let mu = gastDeg - alpha / DEG;
  mu = ((mu % 360) + 360) % 360;

  // Fundamental-plane frame in equator-of-date coords.
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const sd = Math.sin(d), cd = Math.cos(d);
  const ex = [-sa, ca, 0];
  const ey = [-ca * sd, -sa * sd, cd];
  const x = mv[0] * ex[0] + mv[1] * ex[1] + mv[2] * ex[2];
  const y = mv[0] * ey[0] + mv[1] * ey[1] + mv[2] * ey[2];
  const z = mv[0] * a[0] + mv[1] * a[1] + mv[2] * a[2];

  const sinF1 = (SUN_RADIUS_ER + K_PENUMBRA) / G;
  const sinF2 = (SUN_RADIUS_ER - K_UMBRA) / G;
  const f1 = Math.asin(sinF1), f2 = Math.asin(sinF2);
  const l1 = z * Math.tan(f1) + K_PENUMBRA / Math.cos(f1);
  const l2 = z * Math.tan(f2) - K_UMBRA / Math.cos(f2);

  return { x, y, d: d / DEG, mu, l1, l2, tanF1: Math.tan(f1), tanF2: Math.tan(f2) };
}

// ---------------------------------------------------------------------------
// Least-squares polynomial fit
// ---------------------------------------------------------------------------

function polyfit(ts, ys, degree) {
  const n = degree + 1;
  const ATA = Array.from({ length: n }, () => new Array(n).fill(0));
  const ATy = new Array(n).fill(0);
  for (let k = 0; k < ts.length; k++) {
    const pows = new Array(2 * n - 1).fill(1);
    for (let i = 1; i < pows.length; i++) pows[i] = pows[i - 1] * ts[k];
    for (let i = 0; i < n; i++) {
      ATy[i] += pows[i] * ys[k];
      for (let j = 0; j < n; j++) ATA[i][j] += pows[i + j];
    }
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(ATA[r][col]) > Math.abs(ATA[piv][col])) piv = r;
    [ATA[col], ATA[piv]] = [ATA[piv], ATA[col]];
    [ATy[col], ATy[piv]] = [ATy[piv], ATy[col]];
    for (let r = col + 1; r < n; r++) {
      const f = ATA[r][col] / ATA[col][col];
      for (let c = col; c < n; c++) ATA[r][c] -= f * ATA[col][c];
      ATy[r] -= f * ATy[col];
    }
  }
  const coeffs = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = ATy[r];
    for (let c = r + 1; c < n; c++) sum -= ATA[r][c] * coeffs[c];
    coeffs[r] = sum / ATA[r][r];
  }
  return coeffs;
}

// Fit element polynomials over +/-4h around t0 (an AstroTime).
function fitElements(t0) {
  const ts = [], samples = [];
  for (let h = -4; h <= 4.001; h += 0.1) {
    ts.push(h);
    samples.push(instantaneousElements(t0.AddDays(h / 24)));
  }
  // Unwrap mu so it is continuous before fitting.
  const mus = samples.map((s) => s.mu);
  for (let i = 1; i < mus.length; i++) {
    while (mus[i] - mus[i - 1] > 180) mus[i] -= 360;
    while (mus[i] - mus[i - 1] < -180) mus[i] += 360;
  }
  const mid = samples[Math.floor(samples.length / 2)];
  return {
    x: polyfit(ts, samples.map((s) => s.x), 3),
    y: polyfit(ts, samples.map((s) => s.y), 3),
    d: polyfit(ts, samples.map((s) => s.d), 2),
    mu: polyfit(ts, mus, 2),
    l1: polyfit(ts, samples.map((s) => s.l1), 2),
    l2: polyfit(ts, samples.map((s) => s.l2), 2),
    tanF1: mid.tanF1,
    tanF2: mid.tanF2,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// (latLonToVec / makeStereographic / rdp / pointInRing now live in lib/geom.mjs,
// shared with the lunar generator.)

// ---------------------------------------------------------------------------
// Per-eclipse geometry
// ---------------------------------------------------------------------------

// Find [tMin, tMax] where the penumbra touches the Earth disc.
function penumbralWindow(el) {
  let tMin = null, tMax = null;
  for (let t = -4; t <= 4; t += 1 / 60) {
    const e = elementsAt(el, t);
    if (Math.hypot(e.x, e.y) <= 1 + e.l1) {
      if (tMin === null) tMin = t;
      tMax = t;
    }
  }
  return { tMin, tMax };
}

// Central line points: [lonDeg, latDeg, minutes from t0].
function centralLine(el) {
  const pts = [];
  for (let t = el.tMin; t <= el.tMax; t += 2 / 60) {
    const e = elementsAt(el, t);
    const hit = intersectEllipsoid(e.x, e.y, e.d, e.mu);
    if (!hit) continue;
    pts.push([round2(hit.lon), round2(hit.lat), Math.round(t * 60)]);
  }
  return pts;
}

// Umbral/antumbral band polygon around the central line (lon/lat ring),
// plus local-kind samples used to classify hybrid eclipses.
function umbralBand(el) {
  const north = [], south = [];
  const kinds = new Set();
  for (let t = el.tMin; t <= el.tMax; t += 1.5 / 60) {
    const e = elementsAt(el, t);
    const hitC = intersectEllipsoid(e.x, e.y, e.d, e.mu);
    if (!hitC) continue;
    const L2 = e.l2 - hitC.zeta * e.tanF2;
    kinds.add(L2 < 0 ? 'total' : 'annular');
    const w = Math.abs(L2);
    let vx = evalPolyDeriv(el.x, t), vy = evalPolyDeriv(el.y, t);
    const vl = Math.hypot(vx, vy) || 1;
    vx /= vl; vy /= vl;
    for (const [arr, sign] of [[north, 1], [south, -1]]) {
      const px = e.x - sign * vy * w, py = e.y + sign * vx * w;
      let hit = intersectEllipsoid(px, py, e.d, e.mu);
      if (!hit) hit = limbClamp(px, py, e)?.hit; // edge beyond the limb: pull onto it
      if (!hit) continue;
      arr.push([hit.lon, hit.lat]);
    }
  }
  if (north.length < 2) return { ring: null, kinds };
  const ring = north.concat(south.reverse());
  ring.push(ring[0]);
  return { ring: ring.map(([lo, la]) => [round2(lo), round2(la)]), kinds };
}

// Penumbral visibility region: union of instantaneous shadow footprints.
// Each footprint is the intersection of the penumbra disc with the visible
// disc of the Earth — both convex in the fundamental plane — so its boundary
// is a shadow-circle arc plus (when the shadow spills past the limb) a limb
// arc, and points can safely be ordered by angle around the centroid.
function penumbralRegion(el, lat0, lon0) {
  const proj = makeStereographic(lat0, lon0);
  const polys = [];
  const NTH = 96;
  // Adaptive stepping: while the shadow spills past the limb, the union edge
  // is limb-magnified, so successive footprints must sit close together.
  let t = el.tMin;
  while (t <= el.tMax + 1e-9) {
    const e = elementsAt(el, t);
    t += Math.hypot(e.x, e.y) + e.l1 > 0.995 ? 0.75 / 60 : 2 / 60;
    const pts = []; // { px, py, lat, lon }
    let spills = false;

    // Shadow-circle part (only points that land on the Earth's surface).
    for (let i = 0; i < NTH; i++) {
      const th = (i / NTH) * 2 * Math.PI;
      const ct = Math.cos(th), st = Math.sin(th);
      let zeta = 0, px = 0, py = 0, hit = null;
      for (let it = 0; it < 4; it++) {
        const L1 = e.l1 - zeta * e.tanF1;
        px = e.x + L1 * ct;
        py = e.y + L1 * st;
        hit = intersectEllipsoid(px, py, e.d, e.mu);
        zeta = hit ? hit.zeta : 0;
      }
      if (hit) pts.push({ px, py, lat: hit.lat, lon: hit.lon });
      else spills = true;
    }

    // Limb-arc part: sample the sunrise/sunset boundary between the shadow
    // circle's limb crossings. Sparse chords here would jitter by hundreds of
    // km once projected, so the limb gets its own dense sampling.
    if (spills) {
      const cr = Math.hypot(e.x, e.y);
      if (cr > 1e-9) {
        const cosHalf = (1 + cr * cr - e.l1 * e.l1) / (2 * cr);
        const half = cosHalf >= 1 ? 0 : cosHalf <= -1 ? Math.PI : Math.acos(cosHalf);
        if (half > 0) {
          const phiC = Math.atan2(e.y, e.x);
          const STEPS = 120;
          for (let i = 0; i <= STEPS; i++) {
            const psi = phiC - half + (2 * half * i) / STEPS;
            const qx = Math.cos(psi) * 1.05, qy = Math.sin(psi) * 1.05;
            const lc = limbClamp(qx, qy, e);
            if (!lc) continue;
            const L1 = e.l1 - lc.hit.zeta * e.tanF1;
            if (Math.hypot(lc.px - e.x, lc.py - e.y) <= L1) {
              pts.push({ px: lc.px, py: lc.py, lat: lc.hit.lat, lon: lc.hit.lon });
            }
          }
        }
      }
    }

    if (pts.length < 3) continue;
    const mx = pts.reduce((s, p) => s + p.px, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.py, 0) / pts.length;
    pts.sort((a, b) => Math.atan2(a.py - my, a.px - mx) - Math.atan2(b.py - my, b.px - mx));
    const ring = pts.map((p) => proj.project(p.lat, p.lon));
    ring.push(ring[0]);
    polys.push([ring.map(([a, b]) => [roundN(a, 7), roundN(b, 7)])]);
  }
  if (!polys.length) return { rings: [], poles: [] };

  let union;
  try {
    union = pc.union(...polys);
  } catch {
    // Fallback: union incrementally, skipping any polygon that breaks the library.
    union = [polys[0]];
    for (let i = 1; i < polys.length; i++) {
      try { union = pc.union(union.length === 1 ? union[0] : union.flat(), polys[i]); } catch { /* skip */ }
      if (union.length && !Array.isArray(union[0][0][0])) union = [union];
    }
  }

  const rings = [], poles = [];
  for (const polygon of union) {
    for (const ring of polygon) {
      const simplified = rdp(ring, 0.002);
      if (simplified.length < 4) continue;
      const npole = pointInRing(proj.project(89.999, 0), simplified);
      const spole = pointInRing(proj.project(-89.999, 0), simplified);
      rings.push(simplified.map(([X, Y]) => {
        const g = proj.unproject(X, Y);
        return [round2(g.lon), round2(g.lat)];
      }));
      poles.push(npole ? 1 : spole ? -1 : 0);
    }
  }
  return { rings, poles };
}

// Pull a fundamental-plane point that misses the ellipsoid radially inward
// until it grazes the limb, refined by bisection so the boundary stays smooth
// (a coarse step here turns into degrees of geographic jitter at the limb).
function limbClamp(px, py, e) {
  let lo = 0.8, hi = 1;
  if (!intersectEllipsoid(px * lo, py * lo, e.d, e.mu)) return null;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (intersectEllipsoid(px * mid, py * mid, e.d, e.mu)) lo = mid;
    else hi = mid;
  }
  const hit = intersectEllipsoid(px * lo, py * lo, e.d, e.mu);
  return hit && { hit, px: px * lo, py: py * lo };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const eclipses = [];
let ev = A.SearchGlobalSolarEclipse(A.MakeTime(START));
let count = 0;
while (ev.peak.date < END) {
  const t0 = A.MakeTime(new Date(Math.round(ev.peak.date.getTime() / 3.6e6) * 3.6e6)); // nearest hour
  const el = fitElements(t0);
  const win = penumbralWindow(el);
  if (win.tMin === null) {
    console.warn(`  ! no penumbral contact found for ${ev.peak.date.toISOString()} — skipped`);
    ev = A.NextGlobalSolarEclipse(ev.peak);
    continue;
  }
  el.tMin = roundN(win.tMin, 3);
  el.tMax = roundN(win.tMax, 3);

  let kind = ev.kind; // 'partial' | 'annular' | 'total'
  let central = [], band = null;
  if (kind !== 'partial') {
    central = centralLine(el);
    const b = umbralBand(el);
    band = b.ring;
    if (b.kinds.has('total') && b.kinds.has('annular')) kind = 'hybrid';
  }

  // Point of greatest eclipse. astronomy-engine only defines it for central
  // eclipses; for partials, use the surface point nearest the shadow axis
  // (on the limb) at peak time.
  let peakLat = ev.latitude, peakLon = ev.longitude;
  if (!Number.isFinite(peakLat) || !Number.isFinite(peakLon)) {
    const tPeak = (ev.peak.date.getTime() - t0.date.getTime()) / 3.6e6;
    const e = elementsAt(el, tPeak);
    const r = Math.hypot(e.x, e.y) || 1;
    const lc = limbClamp((e.x / r) * 1.1, (e.y / r) * 1.1, e);
    if (lc) {
      peakLat = lc.hit.lat;
      peakLon = lc.hit.lon;
    } else {
      console.warn(`  ! no limb point for partial eclipse ${ev.peak.date.toISOString()}`);
      peakLat = e.d;
      peakLon = 0;
    }
  }
  const region = penumbralRegion(el, peakLat, peakLon);

  eclipses.push({
    id: count,
    kind,
    peak: ev.peak.date.toISOString().slice(0, 16) + 'Z',
    peakLat: round2(peakLat),
    peakLon: round2(peakLon),
    obscuration: Number.isFinite(ev.obscuration) ? roundN(ev.obscuration, 3) : null,
    t0: t0.date.toISOString().slice(0, 16) + 'Z',
    elements: {
      x: el.x.map((c) => roundN(c, 7)),
      y: el.y.map((c) => roundN(c, 7)),
      d: el.d.map((c) => roundN(c, 6)),
      mu: el.mu.map((c) => roundN(c, 6)),
      l1: el.l1.map((c) => roundN(c, 7)),
      l2: el.l2.map((c) => roundN(c, 7)),
      tanF1: roundN(el.tanF1, 7),
      tanF2: roundN(el.tanF2, 7),
      tMin: el.tMin,
      tMax: el.tMax,
    },
    central,
    band,
    region: region.rings,
    regionPoles: region.poles,
  });
  count++;
  if (count % 20 === 0) console.log(`  ${count} eclipses processed (latest: ${ev.peak.date.toISOString().slice(0, 10)})`);
  ev = A.NextGlobalSolarEclipse(ev.peak);
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'eclipses.json');
fs.writeFileSync(outFile, JSON.stringify({ generated: START.toISOString().slice(0, 10), eclipses }));

const byKind = {};
for (const e of eclipses) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
console.log(`\nWrote ${eclipses.length} eclipses to ${outFile}`);
console.log('By kind:', byKind);
console.log(`File size: ${(fs.statSync(outFile).size / 1e6).toFixed(2)} MB`);
