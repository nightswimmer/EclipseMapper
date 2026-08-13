# EclipseMapper

Interactive 3D map of every solar eclipse from **1926 to 2126** — a century back and
a century ahead — rendered over real satellite imagery of Earth (NASA Blue Marble).

## Features

- 🌍 **3D globe** with NASA satellite imagery; drag to spin it around the N/S axis,
  scroll to zoom.
- 📅 **Dual-handle timeline** spanning 200 years (defaults to the next 10 years).
  Path colors encode date within the selected window: pale orange = sooner,
  dark = later.
- ☀️ **Type filters** — total, annular, hybrid, and partial eclipses, with live counts.
- 🖱️ **Hover any path** for local circumstances at that exact spot: the time of
  maximum eclipse (UTC), whether it's total/annular/partial *there*, and the
  percentage of the Sun covered — computed live from each eclipse's Besselian
  elements.
- 🎯 **Click a path** to isolate an eclipse: everything else fades and the selected
  eclipse reveals its full visibility zone (everywhere at least a partial eclipse
  can be seen). Clicks cycle through overlapping paths; click empty space to release.
- 🔗 **Shareable views** via URL: `?start=1990&end=2005&kinds=total&sel=1999-08-11`.

## Running

```bash
npm install
npm run dev        # development server
npm run build      # static production build in dist/
```

The app is fully self-contained (no API keys, no external services). The production
build uses relative paths and can be hosted on GitHub Pages as-is.

## How the data is made

`npm run generate-data` (~30 min, only needed when the generator changes) computes
all 450 eclipses with the [astronomy-engine](https://github.com/cosinekitty/astronomy)
ephemeris:

1. Besselian-element polynomials are fitted for each eclipse.
2. On the WGS84 ellipsoid it derives the central line (with timestamps), the
   umbral/antumbral band, and the full penumbral visibility region (a union of
   instantaneous shadow footprints, with dense limb sampling so sunrise/sunset
   boundaries stay smooth).
3. Everything is written to `public/data/eclipses.json`; the browser reuses the same
   element polynomials to compute local timings under the cursor.

Validated against published NASA/Espenak data: greatest-eclipse points agree to
~0.03° and local timings to about a minute. Accuracy is roughly 1–2 km — built for
visualization, not for planning an expedition to the edge of totality.

## Credits

- Earth imagery: [NASA Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble)
  (public domain).
- Ephemeris: [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT).
- 3D rendering: [three.js](https://threejs.org/) (MIT).
