// Besselian-element math shared by the data generator (Node) and the app (browser).
//
// Conventions (Explanatory Supplement to the Astronomical Almanac, ch. 11):
// - The "fundamental plane" passes through Earth's center, perpendicular to the
//   Moon's shadow axis. Axes: x east, y north (in the plane), z toward the Moon/Sun.
// - Distances are in Earth equatorial radii; the Earth is the WGS84 ellipsoid.
// - Angles d (declination of shadow axis) and mu (Greenwich hour angle of the
//   shadow axis) are in degrees; times are hours relative to the element epoch t0.

export const DEG = Math.PI / 180;

const F = 1 / 298.257223563;        // WGS84 flattening
const E2 = F * (2 - F);             // eccentricity squared
const B2 = (1 - F) * (1 - F);       // (polar/equatorial radius)^2

export function evalPoly(coeffs, t) {
  let v = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) v = v * t + coeffs[i];
  return v;
}

export function evalPolyDeriv(coeffs, t) {
  let v = 0;
  for (let i = coeffs.length - 1; i >= 1; i--) v = v * t + i * coeffs[i];
  return v;
}

// Evaluate all Besselian elements of an eclipse at time t (hours from t0).
export function elementsAt(el, t) {
  return {
    x: evalPoly(el.x, t),
    y: evalPoly(el.y, t),
    d: evalPoly(el.d, t),
    mu: evalPoly(el.mu, t),
    l1: evalPoly(el.l1, t),
    l2: evalPoly(el.l2, t),
    tanF1: el.tanF1,
    tanF2: el.tanF2,
  };
}

// Earth-fixed frame vectors of the fundamental-plane axes for given d, mu (degrees).
export function frame(d, mu) {
  const sd = Math.sin(d * DEG), cd = Math.cos(d * DEG);
  const sm = Math.sin(mu * DEG), cm = Math.cos(mu * DEG);
  return {
    ex: [sm, cm, 0],                 // x-axis (east)
    ey: [-cm * sd, sm * sd, cd],     // y-axis (north)
    ez: [cm * cd, -sm * cd, sd],     // z-axis (toward Moon)
  };
}

// Earth-fixed cartesian point -> geodetic lat/lon (degrees). Exact for points
// on the ellipsoid, good approximation very near it.
export function earthFixedToGeo(X, Y, Z) {
  const p = Math.hypot(X, Y);
  const lat = Math.atan2(Z, B2 * p) / DEG;
  const lon = Math.atan2(Y, X) / DEG;
  return { lat, lon };
}

// Geodetic lat/lon -> Earth-fixed cartesian position of a sea-level observer
// (in equatorial Earth radii), accounting for flattening.
export function geoToEarthFixed(lat, lon) {
  const sl = Math.sin(lat * DEG), cl = Math.cos(lat * DEG);
  const C = 1 / Math.sqrt(cl * cl + B2 * sl * sl);
  const S = B2 * C;
  return [C * cl * Math.cos(lon * DEG), C * cl * Math.sin(lon * DEG), S * sl];
}

// Geodetic lat/lon (degrees) -> fundamental-plane coords for given d, mu.
export function geoToFundamental(lat, lon, d, mu) {
  const v = geoToEarthFixed(lat, lon);
  const f = frame(d, mu);
  return {
    xi: v[0] * f.ex[0] + v[1] * f.ex[1] + v[2] * f.ex[2],
    eta: v[0] * f.ey[0] + v[1] * f.ey[1] + v[2] * f.ey[2],
    zeta: v[0] * f.ez[0] + v[1] * f.ez[1] + v[2] * f.ez[2],
  };
}

// Intersect the line { (xi, eta, zeta) : zeta free } (parallel to the shadow
// axis through fundamental-plane point (xi, eta)) with the ellipsoid.
// Returns { zeta, lat, lon } for the intersection nearest the Moon, or null.
export function intersectEllipsoid(xi, eta, d, mu) {
  const f = frame(d, mu);
  // Earth-fixed point at zeta = 0 and direction along ez.
  const P = [
    xi * f.ex[0] + eta * f.ey[0],
    xi * f.ex[1] + eta * f.ey[1],
    xi * f.ex[2] + eta * f.ey[2],
  ];
  const D = f.ez;
  // Solve (Px+s Dx)^2 + (Py+s Dy)^2 + (Pz+s Dz)^2/B2 = 1
  const A = D[0] * D[0] + D[1] * D[1] + D[2] * D[2] / B2;
  const B = 2 * (P[0] * D[0] + P[1] * D[1] + P[2] * D[2] / B2);
  const C = P[0] * P[0] + P[1] * P[1] + P[2] * P[2] / B2 - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = (-B + Math.sqrt(disc)) / (2 * A); // root nearest the Moon (largest zeta)
  const X = P[0] + s * D[0], Y = P[1] + s * D[1], Z = P[2] + s * D[2];
  return { zeta: s, ...earthFixedToGeo(X, Y, Z) };
}

// Local circumstances of an eclipse at an observer location.
// el: elements record  {x,y,d,mu,l1,l2 (poly coeff arrays), tanF1, tanF2, tMin, tMax}
// Returns null if no eclipse is visible there, else:
//   { t: hours from t0 at local maximum, coverage: 0..1 magnitude,
//     kind: 'partial'|'total'|'annular' locally }
export function localCircumstances(el, lat, lon) {
  // Scan for the time of minimum shadow-axis distance with the Sun up.
  let best = null;
  const step = 2 / 60; // 2 minutes
  for (let t = el.tMin; t <= el.tMax; t += step) {
    const m = separation(el, lat, lon, t);
    if (m.zeta < -0.02) continue; // Sun below horizon (small tolerance at limb)
    if (!best || m.dist < best.dist) best = { t, ...m };
  }
  if (!best) return null;

  // Parabolic refinement around the best sample.
  for (let iter = 0; iter < 2; iter++) {
    const h = step / (iter + 1);
    const d0 = separation(el, lat, lon, best.t - h).dist;
    const d1 = best.dist;
    const d2 = separation(el, lat, lon, best.t + h).dist;
    const denom = d0 - 2 * d1 + d2;
    if (Math.abs(denom) < 1e-12) break;
    const dt = 0.5 * h * (d0 - d2) / denom;
    if (Math.abs(dt) < h * 2) {
      const t = best.t + dt;
      const m = separation(el, lat, lon, t);
      if (m.dist < best.dist) best = { t, ...m };
    }
  }

  const e = elementsAt(el, best.t);
  const L1 = e.l1 - best.zeta * e.tanF1; // local penumbra radius
  const L2 = e.l2 - best.zeta * e.tanF2; // local umbra/antumbra radius (signed)
  if (best.dist > L1) return null;       // outside penumbra: not visible here

  // Eclipse magnitude (fraction of Sun's diameter covered); 1.0 at the edge
  // of totality. L2 is signed (negative for total), per the standard formula.
  const mag = (L1 - best.dist) / (L1 + L2);
  let kind = 'partial';
  if (best.dist <= Math.abs(L2)) kind = L2 < 0 ? 'total' : 'annular';
  return { t: best.t, coverage: Math.max(0, mag), kind };
}

function separation(el, lat, lon, t) {
  const e = elementsAt(el, t);
  const o = geoToFundamental(lat, lon, e.d, e.mu);
  const dx = o.xi - e.x, dy = o.eta - e.y;
  return { dist: Math.hypot(dx, dy), zeta: o.zeta };
}
