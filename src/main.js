import { loadEclipses, hitTest, localAt } from './data.js';
import { Overlay } from './overlay.js';
import { Globe } from './globe.js';
import { RangeSlider, Filters, Tooltip } from './ui.js';

const container = document.getElementById('globe-container');
const tooltip = new Tooltip();

let eclipses = [];
let visible = [];
let range = { startMs: 0, endMs: 0 };
let hovered = new Set();
let selectedId = null;
let redrawQueued = false;

const overlay = new Overlay();
const globe = new Globe(container, overlay.canvas, {
  onHover: handleHover,
  onLeave: () => {
    tooltip.hide();
    if (hovered.size) { hovered = new Set(); queueRedraw(); }
  },
  onClick: handleClick,
});
overlay.onRedraw = () => globe.markOverlayDirty();

function queueRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    overlay.draw(visible, range, hovered, selectedId);
  });
}

function refreshVisible() {
  const inRange = eclipses.filter((e) => e.peakMs >= range.startMs && e.peakMs <= range.endMs);
  filters.updateCounts(inRange);
  visible = inRange.filter((e) => filters.enabled.has(e.kind));
  if (selectedId !== null && !visible.some((e) => e.id === selectedId)) selectedId = null;
  document.getElementById('range-count').textContent =
    `${visible.length} of ${eclipses.length} eclipses shown`;
  queueRedraw();
}

// Where an eclipse responds to the pointer: central eclipses on their band
// (plus the full zone once selected), partial eclipses on their region.
function hitRings(e) {
  return e.bandRing && e.id !== selectedId ? [e.bandRing] : e.regionRings;
}

function hitsAt(lat, lon) {
  const hits = visible.filter((e) => hitTest(e, lat, lon, hitRings(e)));
  hits.sort((a, b) => a.peakMs - b.peakMs);
  return hits;
}

function handleHover(lat, lon, clientX, clientY) {
  const hits = hitsAt(lat, lon);
  container.style.cursor = hits.length ? 'pointer' : '';

  const ids = new Set(hits.map((e) => e.id));
  if (!setsEqual(ids, hovered)) {
    hovered = ids;
    queueRedraw();
  }
  hits.length
    ? tooltip.show(hits.map((e) => ({ eclipse: e, local: localAt(e, lat, lon) })), range, clientX, clientY)
    : tooltip.hide();
}

function handleClick(lat, lon) {
  let next = null;
  if (lat !== null) {
    const hits = hitsAt(lat, lon);
    if (hits.length === 1 && hits[0].id === selectedId) {
      next = null; // clicking the isolated eclipse again releases it
    } else if (hits.length) {
      // Repeated clicks on overlapping paths cycle through them.
      const idx = hits.findIndex((e) => e.id === selectedId);
      next = hits[(idx + 1) % hits.length].id;
    }
  }
  if (next !== selectedId) {
    selectedId = next;
    queueRedraw();
  }
}

const setsEqual = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));

let filters;

loadEclipses().then((list) => {
  eclipses = list;
  const minMs = Math.min(...list.map((e) => e.peakMs)) - 86400e3;
  const maxMs = Math.max(...list.map((e) => e.peakMs)) + 86400e3;

  // Default window: today through ten years from now.
  const clampMs = (ms) => Math.max(minMs, Math.min(maxMs, ms));
  const now = new Date();
  const defStart = clampMs(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defEnd = clampMs(Date.UTC(now.getUTCFullYear() + 10, now.getUTCMonth(), now.getUTCDate()));

  // Optional URL params: ?start=2026&end=2040&kinds=total,annular
  const params = new URLSearchParams(location.search);
  const yearMs = (y, fallback) => {
    const n = parseInt(y, 10);
    return Number.isFinite(n) ? clampMs(Date.UTC(n, 0, 1)) : fallback;
  };
  range = { startMs: yearMs(params.get('start'), defStart), endMs: yearMs(params.get('end'), defEnd) };
  if (params.get('kinds')) {
    const wanted = new Set(params.get('kinds').split(','));
    for (const box of document.querySelectorAll('#filters input')) {
      box.checked = wanted.has(box.dataset.kind);
    }
  }
  // ?sel=2027-08-02 pre-selects the eclipse peaking on that date.
  if (params.get('sel')) {
    selectedId = eclipses.find((e) => e.peak.startsWith(params.get('sel')))?.id ?? null;
  }

  filters = new Filters(refreshVisible);
  const slider = new RangeSlider(minMs, maxMs, (s, e) => {
    range = { startMs: s, endMs: e };
    refreshVisible();
  });
  slider.startMs = range.startMs;
  slider.endMs = range.endMs;
  slider.render();

  document.getElementById('loading').remove();
  refreshVisible();
}).catch((err) => {
  document.getElementById('loading').textContent = `Failed to load data: ${err.message}`;
});
