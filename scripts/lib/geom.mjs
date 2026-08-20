// Geometry helpers shared by the data generators: stereographic projection,
// Ramer-Douglas-Peucker simplification, point-in-ring test, rounding.

import { DEG } from '../../src/lib/bessel.js';

export function latLonToVec(lat, lon) {
  const cl = Math.cos(lat * DEG);
  return [cl * Math.cos(lon * DEG), cl * Math.sin(lon * DEG), Math.sin(lat * DEG)];
}

export function makeStereographic(lat0, lon0) {
  const c = latLonToVec(lat0, lon0);
  let east = [-c[1], c[0], 0];
  const el = Math.hypot(...east);
  east = el < 1e-9 ? [1, 0, 0] : east.map((v) => v / el);
  const north = [
    c[1] * east[2] - c[2] * east[1],
    c[2] * east[0] - c[0] * east[2],
    c[0] * east[1] - c[1] * east[0],
  ];
  return {
    project(lat, lon) {
      const v = latLonToVec(lat, lon);
      const dotc = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
      const k = 2 / (1 + Math.max(-0.999, dotc));
      return [
        k * (v[0] * east[0] + v[1] * east[1] + v[2] * east[2]),
        k * (v[0] * north[0] + v[1] * north[1] + v[2] * north[2]),
      ];
    },
    unproject(X, Y) {
      const r2 = X * X + Y * Y;
      const f = 4 / (4 + r2);
      const v = [
        c[0] * (4 - r2) / (4 + r2) + f * (X * east[0] + Y * north[0]),
        c[1] * (4 - r2) / (4 + r2) + f * (X * east[1] + Y * north[1]),
        c[2] * (4 - r2) / (4 + r2) + f * (X * east[2] + Y * north[2]),
      ];
      return {
        lat: Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG,
        lon: Math.atan2(v[1], v[0]) / DEG,
      };
    },
  };
}

// Ramer-Douglas-Peucker simplification of an open or closed point list.
export function rdp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [x0, y0] = points[i0], [x1, y1] = points[i1];
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, maxI = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 < 1e-18) d = Math.hypot(px - x0, py - y0);
      else {
        const u = ((px - x0) * dx + (py - y0) * dy) / len2;
        const cu = Math.max(0, Math.min(1, u));
        d = Math.hypot(px - (x0 + cu * dx), py - (y0 + cu * dy));
      }
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol) {
      keep[maxI] = true;
      stack.push([i0, maxI], [maxI, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export function pointInRing([px, py], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Convert a clipped multipolygon (in projected coords) back to geographic
// rings: simplify, unproject, and flag rings that encircle a pole.
export function zoneToGeo(multiPoly, proj, tol = 0.002) {
  const rings = [], poles = [];
  for (const polygon of multiPoly) {
    for (const ring of polygon) {
      const simplified = rdp(ring, tol);
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

export const round2 = (v) => Math.round(v * 100) / 100;
export const roundN = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
