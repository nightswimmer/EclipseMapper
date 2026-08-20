# EclipseMapper — Project Instructions

This file describes the current state of the project. It is the reference point for
future chat sessions.

## What the project is

An interactive web app that plots solar **and lunar** eclipses from 1926 to 2126
(100 years back, 100 years ahead) on a 3D Earth with real satellite imagery (NASA
Blue Marble). Solar eclipse geometry is computed from first principles (Besselian
elements) at build time and rendered as colored paths/zones on the globe; lunar
eclipses are rendered as visibility zones (where on Earth the eclipse can be seen).

## Tech stack

- **Vite** vanilla-JS web app (no framework), `npm run dev` / `npm run build`.
- **Three.js** for the 3D globe.
- **astronomy-engine** (dev dependency) for the ephemeris in the data generators.
- **polygon-clipping** (dev dependency) for unioning/intersecting footprints.
- No API keys, no external services at runtime — fully self-contained static site
  (`vite.config.js` uses `base: './'`, so the build works on GitHub Pages).

## Repository layout

- `scripts/generate-eclipse-data.mjs` — solar generator (`npm run generate-data`,
  takes ~30 min). Enumerates all solar eclipses 1926–2126 with astronomy-engine,
  fits Besselian-element polynomials per eclipse, and derives on the WGS84 ellipsoid:
  central line (with per-point times), umbral/antumbral band polygon, and the full
  penumbral visibility region (union of instantaneous shadow footprints in a
  stereographic projection, with dense limb sampling and adaptive time-stepping to
  keep sunrise/sunset boundaries smooth). Output: `public/data/eclipses.json`
  (~3.8 MB, 450 eclipses; committed artifact — only regenerate when the generator
  changes).
- `scripts/generate-lunar-data.mjs` — lunar generator (`npm run generate-lunar-data`,
  runs in seconds). Enumerates all 457 lunar eclipses in the same span. Each eclipse
  gets two zones built from 90°-radius spherical caps around the moving sub-lunar
  point (union/intersection via polygon-clipping in a stereographic projection):
  `zoneAll` (Moon above the horizon for the whole umbral phase — entire eclipse
  visible) and `zoneAny` (Moon rises/sets during it — partly visible). Penumbral
  eclipses use the penumbral phase as their window. Output:
  `public/data/lunar-eclipses.json` (~1.6 MB, committed artifact).
- `scripts/lib/geom.mjs` — geometry helpers shared by both generators
  (stereographic projection, RDP simplification, point-in-ring, pole flagging).
- `src/lib/bessel.js` — Besselian-element math **shared by generator and app**
  (element evaluation, geo⇄fundamental-plane transforms, ellipsoid intersection,
  local circumstances at an observer point).
- `src/globe.js` — Three.js scene: unlit Blue Marble sphere, transparent canvas-
  texture overlay sphere, atmosphere shader, stars; drag rotation constrained to the
  N/S axis (vertical drag only tilts the camera) with **either mouse button**
  (context menu suppressed on the canvas), wheel zoom, UV-based picking, click
  detection (left-button press without movement).
- `src/overlay.js` — draws eclipse geometry onto a 4096×2048 equirectangular canvas
  used as the overlay texture; handles dateline wrap (±360° replication) and
  pole-encircling rings; three visual states: normal / faded / selected. Lunar
  zones draw beneath solar geometry: faint fringe fill with a **dashed outline**
  (the dash distinguishes lunar boundaries from solar), stronger core-zone fill.
- `src/data.js` — data loading & prep for both datasets (longitude unwrapping, pole
  closure), hit testing, time→color ramps (solar: orange sequential; lunar: blue
  sequential; pale = sooner, dark = later).
- `src/ui.js` — dual-handle date-range slider (gradient fill between handles),
  type filters in two groups (filter keys are namespaced `body:kind`), hover
  tooltip, and `TypePopups`: hover a filter label (300 ms delay) for an explainer
  card with an inline-SVG sky-view illustration of that eclipse type.
- `src/main.js` — orchestration, selection state, URL params.
- `public/textures/earth.jpg` — NASA Blue Marble (public domain), 5400×2700.

## Features (current behavior)

- Timeline slider with two handles over 1926–2126; **default selection = current
  date → +10 years** (computed at load). Color of each eclipse encodes its date
  within the selected window (legend has one ramp row per body: solar orange,
  lunar blue).
- Filters in two groups with live counts: **Solar** Total / Annular / Hybrid /
  Partial (Partial off by default — footprints are hemisphere-sized) and **Lunar**
  Total / Partial / Penumbral (all off by default). Any combination can be shown
  together. Hovering a filter label pops up a description + illustration of that
  eclipse type.
- Default rendering: central solar eclipses show band + central line only; partial
  solar eclipses show their faint footprint; lunar eclipses show both zones (faint
  fringe + stronger core).
- **Click a path/region to isolate an eclipse**: all others fade; a selected solar
  eclipse shows its full partial-visibility zone. Click empty space (or it again)
  to release; clicks cycle through overlapping hits. Hover lifts faded paths.
  Right-clicks rotate only — they never select.
- Hover tooltip: for solar eclipses, local circumstances **at the hovered point**
  from the Besselian elements (local max time UTC, local kind, % of Sun covered).
  For lunar eclipses: peak time (UTC), whether the entire eclipse is visible there
  or only part (moonrise/moonset during the eclipse), and % in umbra for partials.
  Multiple overlapping eclipses all listed.
- URL params: `?start=1990&end=2005&kinds=total,annular&lunar=total,partial&sel=1999-08-11`
  (`kinds` = solar types, `lunar` = lunar types, `sel` matches a peak date).

## Accuracy

Solar: validated against published data (NASA/Espenak): greatest-eclipse points
match to ~0.03°, local max times to ~1 min (checked 1955, 1991, 1999, 2017, 2024,
2026, 2027, 2029, 2045). Typical accuracy ~1–2 km; intended for visualization, not
expedition planning. Hybrid classification derives from the sign change of the
umbral radius along the visible path.

Lunar: visibility zones use exact 90° caps around the geocentric sub-lunar point
(no refraction/parallax/semidiameter correction — those nearly cancel, net error
well under 1°). Spot-checked against published visibility maps (Mar/Sep 2025).

## Conventions / gotchas

- The overlay canvas and earth texture share the sphere's UV layout, so they are
  aligned by construction; picking converts `uv` → lat/lon directly.
- Region rings are stored unwrapped (consecutive lons never jump >180°);
  pole-encircling rings carry a pole flag (`regionPoles` / `zoneAllPoles` /
  `zoneAnyPoles`) and are closed over the pole at load. Canvas fills use even-odd
  rule; hit tests mirror it.
- Eclipse ids are namespaced at load (`s<id>` solar, `l<id>` lunar) since the two
  datasets both number from 0; filter keys are `body:kind` since kind names
  collide (total/partial exist for both).
- Times in the solar dataset are hours relative to each eclipse's `t0` (peak
  rounded to the hour, UTC). Lunar zones carry absolute `start`/`end`/`peak` ISO
  times.
- Dev-server note: several other Vite projects may be running on this machine;
  Vite auto-increments ports (check the log for the actual port).

## Possible future work (not committed to)

Click-to-pin list panel; animate the shadow sweeping a selected path; "eclipses
visible from my location" search; graticule/city labels; texture zoom levels;
marker at the sub-lunar point (Moon overhead at maximum); per-point moonrise/
moonset times in the lunar tooltip; split the lunar fringe into "misses the start"
vs "misses the end" halves like NASA's maps.
