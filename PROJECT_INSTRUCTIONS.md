# EclipseMapper — Project Instructions

This file describes the current state of the project. It is the reference point for
future chat sessions.

## What the project is

An interactive web app that plots solar eclipses from 1926 to 2126 (100 years back,
100 years ahead) on a 3D Earth with real satellite imagery (NASA Blue Marble).
Eclipse geometry is computed from first principles (Besselian elements) at build
time and rendered as colored paths/zones on the globe.

## Tech stack

- **Vite** vanilla-JS web app (no framework), `npm run dev` / `npm run build`.
- **Three.js** for the 3D globe.
- **astronomy-engine** (dev dependency) for the ephemeris in the data generator.
- **polygon-clipping** (dev dependency) for unioning shadow footprints.
- No API keys, no external services at runtime — fully self-contained static site
  (`vite.config.js` uses `base: './'`, so the build works on GitHub Pages).

## Repository layout

- `scripts/generate-eclipse-data.mjs` — build-time generator (`npm run generate-data`,
  takes ~30 min). Enumerates all solar eclipses 1926–2126 with astronomy-engine,
  fits Besselian-element polynomials per eclipse, and derives on the WGS84 ellipsoid:
  central line (with per-point times), umbral/antumbral band polygon, and the full
  penumbral visibility region (union of instantaneous shadow footprints in a
  stereographic projection, with dense limb sampling and adaptive time-stepping to
  keep sunrise/sunset boundaries smooth). Output: `public/data/eclipses.json`
  (~3.8 MB, 450 eclipses; committed artifact — only regenerate when the generator
  changes).
- `src/lib/bessel.js` — Besselian-element math **shared by generator and app**
  (element evaluation, geo⇄fundamental-plane transforms, ellipsoid intersection,
  local circumstances at an observer point).
- `src/globe.js` — Three.js scene: unlit Blue Marble sphere, transparent canvas-
  texture overlay sphere, atmosphere shader, stars; drag rotation constrained to the
  N/S axis (vertical drag only tilts the camera), wheel zoom, UV-based picking,
  click detection (press without movement).
- `src/overlay.js` — draws eclipse geometry onto a 4096×2048 equirectangular canvas
  used as the overlay texture; handles dateline wrap (±360° replication) and
  pole-encircling rings; three visual states: normal / faded / selected.
- `src/data.js` — data loading & prep (longitude unwrapping, pole closure), hit
  testing, time→color ramp (orange sequential: pale = sooner, dark = later).
- `src/ui.js` — dual-handle date-range slider (gradient fill between handles),
  type filters with counts, tooltip.
- `src/main.js` — orchestration, selection state, URL params.
- `public/textures/earth.jpg` — NASA Blue Marble (public domain), 5400×2700.

## Features (current behavior)

- Timeline slider with two handles over 1926–2126; **default selection = current
  date → +10 years** (computed at load). Color of each eclipse encodes its date
  within the selected window (legend: sooner→later).
- Filters: Total / Annular / Hybrid / Partial checkboxes with live counts
  (Partial off by default — footprints are hemisphere-sized).
- Default rendering: central eclipses show band + central line only; partial
  eclipses show their faint footprint.
- **Click a path to isolate an eclipse**: all others fade, the selected one shows
  its full partial-visibility zone. Click empty space (or it again) to release;
  clicks cycle through overlapping paths. Hover lifts faded paths for preview.
- Hover tooltip computes local circumstances **at the hovered point** from the
  Besselian elements: local max time (UTC), local kind (total/annular/partial),
  and % of Sun covered. Multiple overlapping eclipses all listed.
- URL params: `?start=1990&end=2005&kinds=total,annular&sel=1999-08-11`.

## Accuracy

Validated against published data (NASA/Espenak): greatest-eclipse points match to
~0.03°, local max times to ~1 min (checked 1955, 1991, 1999, 2017, 2024, 2026,
2027, 2029, 2045). Typical accuracy ~1–2 km; intended for visualization, not
expedition planning. Hybrid classification derives from the sign change of the
umbral radius along the visible path.

## Conventions / gotchas

- The overlay canvas and earth texture share the sphere's UV layout, so they are
  aligned by construction; picking converts `uv` → lat/lon directly.
- Region rings are stored unwrapped (consecutive lons never jump >180°);
  pole-encircling rings carry a flag (`regionPoles`) and are closed over the pole
  at load. Canvas fills use even-odd rule; hit tests mirror it.
- Times in the dataset are hours relative to each eclipse's `t0` (peak rounded to
  the hour, UTC).
- Dev-server note: several other Vite projects may be running on this machine;
  Vite auto-increments ports (check the log for the actual port).

## Possible future work (not committed to)

Click-to-pin list panel; animate the shadow sweeping a selected path; "eclipses
visible from my location" search; graticule/city labels; texture zoom levels.
