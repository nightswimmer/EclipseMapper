// Data loading and per-eclipse preprocessing: longitude unwrapping, pole
// closure, hit-testing, and the time->color ramp.

import { localCircumstances } from './lib/bessel.js';

// Orange sequential ramp (light = sooner, dark = later), monotone lightness.
export const RAMP = ['#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'];

const KIND_LABEL = {
  total: 'Total',
  annular: 'Annular',
  hybrid: 'Hybrid',
  partial: 'Partial',
};

export async function loadEclipses(url = 'data/eclipses.json') {
  const res = await fetch(import.meta.env.BASE_URL + url);
  if (!res.ok) throw new Error(`Failed to load eclipse data (${res.status})`);
  return prepareEclipses(await res.json());
}

export function prepareEclipses(raw) {
  return raw.eclipses.map((e) => {
    const peakMs = Date.parse(e.peak);
    const t0Ms = Date.parse(e.t0);
    return {
      ...e,
      peakMs,
      t0Ms,
      label: `${KIND_LABEL[e.kind]} solar eclipse`,
      dateLabel: formatDate(peakMs),
      // Rings unwrapped so consecutive longitudes never jump more than 180.
      regionRings: e.region.map((ring, i) => unwrapRing(ring, e.regionPoles[i])),
      bandRing: e.band ? unwrapRing(e.band, 0) : null,
      centralUnwrapped: e.central.length ? unwrapLine(e.central) : null,
    };
  });
}

export function formatDate(ms) {
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export function formatTime(ms) {
  return new Date(ms).toISOString().slice(11, 16) + ' UTC';
}

// Unwrap a [lon,lat] ring; if pole is +1/-1, close it over that pole so both
// canvas even-odd filling and the point-in-polygon test work on the flat map.
function unwrapRing(ring, pole) {
  const out = [];
  let prev = ring[0][0];
  for (const [lon, lat] of ring) {
    let lo = lon;
    while (lo - prev > 180) lo -= 360;
    while (lo - prev < -180) lo += 360;
    out.push([lo, lat]);
    prev = lo;
  }
  if (pole) {
    const poleLat = pole > 0 ? 90.5 : -90.5;
    const first = out[0], last = out[out.length - 1];
    // A pole-encircling ring unwraps to end 360 deg from its start; close it by
    // walking up to the pole, across, and back down to the first point.
    out.push([last[0], poleLat], [first[0], poleLat]);
  }
  return out;
}

function unwrapLine(line) {
  const out = [];
  let prev = line[0][0];
  for (const [lon, lat, tMin] of line) {
    let lo = lon;
    while (lo - prev > 180) lo -= 360;
    while (lo - prev < -180) lo += 360;
    out.push([lo, lat, tMin]);
    prev = lo;
  }
  return out;
}

// Even-odd point-in-region test across the given rings (default: the full
// visibility region), tolerant of the +/-360 longitude ambiguity.
export function hitTest(eclipse, lat, lon, rings = eclipse.regionRings) {
  for (const cand of [lon - 360, lon, lon + 360]) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && cand < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
    }
    if (inside) return true;
  }
  return false;
}

// Local circumstances at a point, with absolute times. Returns null when the
// eclipse is not visible there.
export function localAt(eclipse, lat, lon) {
  const lc = localCircumstances(eclipse.elements, lat, lon);
  if (!lc) return null;
  return {
    timeMs: eclipse.t0Ms + lc.t * 3.6e6,
    coverage: Math.min(1, lc.coverage),
    kind: lc.kind,
  };
}

// ---------------------------------------------------------------------------
// Color: position of the eclipse's peak within the selected window -> ramp.
// ---------------------------------------------------------------------------

const rampRgb = RAMP.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

export function rampColor(f) {
  const x = Math.max(0, Math.min(1, f)) * (rampRgb.length - 1);
  const i = Math.min(rampRgb.length - 2, Math.floor(x));
  const u = x - i;
  const a = rampRgb[i], b = rampRgb[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
  ];
}

export function colorFor(eclipse, rangeStartMs, rangeEndMs) {
  const span = Math.max(1, rangeEndMs - rangeStartMs);
  return rampColor((eclipse.peakMs - rangeStartMs) / span);
}

export const rgbCss = ([r, g, b], a = 1) => `rgba(${r},${g},${b},${a})`;
