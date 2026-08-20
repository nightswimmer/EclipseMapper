# EclipseMapper

Interactive 3D map of every solar **and lunar** eclipse from **1926 to 2126** — a
century back and a century ahead — rendered over real satellite imagery of Earth
(NASA Blue Marble). 450 solar and 457 lunar eclipses, mixable in any combination.

## Features

- 🌍 **3D globe** with NASA satellite imagery; drag with either mouse button to
  spin it around the N/S axis, scroll to zoom.
- 📅 **Dual-handle timeline** spanning 200 years (defaults to the next 10 years).
  Colors encode date within the selected window: pale = sooner, dark = later —
  orange for solar eclipses, blue for lunar.
- ☀️ **Solar filters** — total, annular, hybrid, and partial eclipses, drawn as
  umbral bands, central lines, and visibility footprints.
- 🌙 **Lunar filters** — total, partial, and penumbral eclipses, drawn as zoned
  visibility regions: a stronger core where the *entire* eclipse is visible, and a
  dash-outlined fringe where the Moon rises or sets mid-eclipse.
- ❓ **Hover a filter label** for a pop-up explaining that eclipse type, with an
  illustration of what an observer actually sees in the sky.
- 🖱️ **Hover any path or region** for local details at that exact spot. Solar:
  time of maximum (UTC), whether it's total/annular/partial *there*, and the
  percentage of the Sun covered — computed live from each eclipse's Besselian
  elements. Lunar: peak time and whether the whole eclipse fits between moonrise
  and moonset there.
- 🎯 **Click** to isolate one eclipse: everything else fades and the selection
  reveals its full visibility zone. Clicks cycle through overlapping hits; click
  empty space to release.
- 🔗 **Shareable views** via URL:
  `?start=1990&end=2005&kinds=total&lunar=total,partial&sel=1999-08-11`.

## Running

```bash
npm install
npm run dev        # development server
npm run build      # static production build in dist/
```

The app is fully self-contained (no API keys, no external services). The production
build uses relative paths and can be hosted on GitHub Pages as-is.

## How the data is made

Both datasets are committed build artifacts — regenerate only when a generator
changes.

**Solar** — `npm run generate-data` (~30 min) computes all 450 eclipses with the
[astronomy-engine](https://github.com/cosinekitty/astronomy) ephemeris:

1. Besselian-element polynomials are fitted for each eclipse.
2. On the WGS84 ellipsoid it derives the central line (with timestamps), the
   umbral/antumbral band, and the full penumbral visibility region (a union of
   instantaneous shadow footprints, with dense limb sampling so sunrise/sunset
   boundaries stay smooth).
3. Everything is written to `public/data/eclipses.json`; the browser reuses the same
   element polynomials to compute local timings under the cursor.

**Lunar** — `npm run generate-lunar-data` (seconds) computes all 457 eclipses. A
lunar eclipse looks the same from everywhere the Moon is up, so each eclipse's
zones are built from 90°-radius spherical caps around the moving sub-lunar point:
the intersection of the caps over the eclipse window is where the *whole* eclipse
is visible, their union is where at least part of it is. Output:
`public/data/lunar-eclipses.json`.

Solar geometry is validated against published NASA/Espenak data: greatest-eclipse
points agree to ~0.03° and local timings to about a minute; accuracy is roughly
1–2 km. Lunar visibility zones were spot-checked against published visibility maps.
Built for visualization, not for planning an expedition to the edge of totality.

## Credits

- Earth imagery: [NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble)
  (public domain).
- Ephemeris: [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT).
- 3D rendering: [three.js](https://threejs.org/) (MIT).
