// UI: dual-handle date-range slider (the fill between handles wears the time
// gradient), eclipse-type filters with counts, and the hover tooltip.

import { RAMP, formatDate, formatTime, rgbCss, colorFor } from './data.js';

export class RangeSlider {
  // minMs/maxMs bound the slider; onChange(startMs, endMs) fires on every move.
  constructor(minMs, maxMs, onChange) {
    this.minMs = minMs;
    this.maxMs = maxMs;
    this.onChange = onChange;
    this.startMs = minMs;
    this.endMs = maxMs;

    this.slider = document.getElementById('slider');
    this.fill = document.getElementById('slider-fill');
    this.hStart = document.getElementById('handle-start');
    this.hEnd = document.getElementById('handle-end');
    this.labelStart = document.getElementById('label-start');
    this.labelEnd = document.getElementById('label-end');

    this.fill.style.background = `linear-gradient(90deg, ${RAMP.join(',')})`;

    // Tick labels, positioned at their true place on the time axis.
    const scale = document.getElementById('slider-scale');
    const y0 = new Date(minMs).getUTCFullYear(), y1 = new Date(maxMs).getUTCFullYear();
    document.getElementById('subtitle').textContent = `Solar & lunar eclipses ${y0} – ${y1}`;
    const step = y1 - y0 > 120 ? 25 : 20;
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const s = document.createElement('span');
      s.textContent = y;
      s.style.left = `${this.frac(Date.UTC(y, 0, 1)) * 100}%`;
      scale.appendChild(s);
    }

    this.bindHandle(this.hStart, 'start');
    this.bindHandle(this.hEnd, 'end');
    this.slider.addEventListener('pointerdown', (ev) => this.jumpTo(ev));
    new ResizeObserver(() => this.render()).observe(this.slider);
    this.render();
  }

  frac(ms) { return (ms - this.minMs) / (this.maxMs - this.minMs); }
  msAt(clientX) {
    const r = this.slider.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const DAY = 86400e3;
    return this.minMs + Math.round((f * (this.maxMs - this.minMs)) / DAY) * DAY;
  }

  bindHandle(el, which) {
    el.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation();
      el.setPointerCapture(ev.pointerId);
      const move = (e) => this.setValue(which, this.msAt(e.clientX));
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    // Keyboard: arrows move by a year, page keys by a decade.
    el.addEventListener('keydown', (ev) => {
      const YEAR = 365.25 * 86400e3;
      const step = { ArrowLeft: -YEAR, ArrowRight: YEAR, PageDown: -10 * YEAR, PageUp: 10 * YEAR }[ev.key];
      if (!step) return;
      ev.preventDefault();
      this.setValue(which, (which === 'start' ? this.startMs : this.endMs) + step);
    });
  }

  jumpTo(ev) {
    // Click on the track: move the nearest handle there.
    const ms = this.msAt(ev.clientX);
    const which = Math.abs(ms - this.startMs) <= Math.abs(ms - this.endMs) ? 'start' : 'end';
    this.setValue(which, ms);
  }

  setValue(which, ms) {
    ms = Math.max(this.minMs, Math.min(this.maxMs, ms));
    if (which === 'start') this.startMs = Math.min(ms, this.endMs);
    else this.endMs = Math.max(ms, this.startMs);
    this.render();
    this.onChange(this.startMs, this.endMs);
  }

  render() {
    const w = this.slider.clientWidth;
    const x0 = this.frac(this.startMs) * w, x1 = this.frac(this.endMs) * w;
    this.hStart.style.left = `${x0}px`;
    this.hEnd.style.left = `${x1}px`;
    this.fill.style.left = `${x0}px`;
    this.fill.style.width = `${Math.max(0, x1 - x0)}px`;
    this.labelStart.textContent = formatDate(this.startMs);
    this.labelEnd.textContent = formatDate(this.endMs);
    this.hStart.setAttribute('aria-valuetext', formatDate(this.startMs));
    this.hEnd.setAttribute('aria-valuetext', formatDate(this.endMs));
  }
}

// Filter keys are namespaced "body:kind" (e.g. "solar:total", "lunar:partial")
// since solar and lunar share kind names.
export const filterKey = (e) => `${e.body}:${e.kind}`;

export class Filters {
  constructor(onChange) {
    this.enabled = new Set();
    this.boxes = [...document.querySelectorAll('#filters input')];
    for (const box of this.boxes) {
      const key = `${box.dataset.body}:${box.dataset.kind}`;
      if (box.checked) this.enabled.add(key);
      box.addEventListener('change', () => {
        box.checked ? this.enabled.add(key) : this.enabled.delete(key);
        onChange();
      });
    }
  }

  updateCounts(eclipsesInRange) {
    const counts = {};
    for (const box of this.boxes) counts[`${box.dataset.body}:${box.dataset.kind}`] = 0;
    for (const e of eclipsesInRange) counts[filterKey(e)]++;
    for (const box of this.boxes) {
      document.getElementById(`count-${box.dataset.body}-${box.dataset.kind}`).textContent =
        counts[`${box.dataset.body}:${box.dataset.kind}`];
    }
  }
}

// ---------------------------------------------------------------------------
// Eclipse-type explainer popups (hover a filter label). Each entry pairs a
// short description with an SVG sketch of what an observer sees in the sky.
// Only one popup is mounted at a time, so gradient ids can repeat across svgs.
// ---------------------------------------------------------------------------

const SKY = '#0b0d14';
const STARS = `
  <circle cx="18" cy="14" r="1" fill="#fff" opacity=".5"/>
  <circle cx="132" cy="20" r="1.2" fill="#fff" opacity=".6"/>
  <circle cx="28" cy="78" r="1" fill="#fff" opacity=".4"/>
  <circle cx="121" cy="72" r="0.9" fill="#fff" opacity=".5"/>
  <circle cx="70" cy="10" r="0.8" fill="#fff" opacity=".4"/>`;
const svgWrap = (inner) =>
  `<svg viewBox="0 0 150 96" role="img"><rect width="150" height="96" fill="${SKY}"/>${STARS}${inner}</svg>`;

// Small building blocks reused by several sketches.
const CORONA = (cx, cy, r) => `
  <radialGradient id="corona" cx="50%" cy="50%" r="50%">
    <stop offset="38%" stop-color="#ffffff" stop-opacity=".95"/>
    <stop offset="62%" stop-color="#cdd6ff" stop-opacity=".35"/>
    <stop offset="100%" stop-color="#cdd6ff" stop-opacity="0"/>
  </radialGradient>
  <circle cx="${cx}" cy="${cy}" r="${r * 2.1}" fill="url(#corona)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#04050a"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="1.1"/>`;
const RING_OF_FIRE = (cx, cy, r) => `
  <radialGradient id="fireglow" cx="50%" cy="50%" r="50%">
    <stop offset="55%" stop-color="#ffb347" stop-opacity=".55"/>
    <stop offset="100%" stop-color="#ffb347" stop-opacity="0"/>
  </radialGradient>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.8}" fill="url(#fireglow)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffd66e"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 0.74}" fill="#04050a"/>`;
const GREY_MOON = `
  <radialGradient id="moon" cx="42%" cy="38%" r="70%">
    <stop offset="0%" stop-color="#e8e8ec"/>
    <stop offset="100%" stop-color="#9a9aa4"/>
  </radialGradient>`;

const TYPE_INFO = {
  'solar:total': {
    title: 'Total solar eclipse',
    text: 'The Moon completely covers the Sun for a few minutes. Day turns to deep twilight and the corona — the Sun’s outer atmosphere — appears around the black lunar disc.',
    svg: svgWrap(CORONA(75, 48, 17)),
  },
  'solar:annular': {
    title: 'Annular solar eclipse',
    text: 'The Moon is too far from Earth to cover the Sun completely, so a brilliant “ring of fire” remains around its silhouette. The sky dims but never goes dark.',
    svg: svgWrap(RING_OF_FIRE(75, 48, 18)),
  },
  'solar:hybrid': {
    title: 'Hybrid solar eclipse',
    text: 'A rare eclipse that changes character along its path: annular near the ends, total near the middle, because Earth’s curvature brings observers closer to the Moon mid-path.',
    svg: svgWrap(`
      ${CORONA(45, 44, 12)}
      ${RING_OF_FIRE(110, 44, 12.5)}
      <text x="45" y="86" text-anchor="middle" font-size="8.5" fill="#c3c2b7">mid-path</text>
      <text x="110" y="86" text-anchor="middle" font-size="8.5" fill="#c3c2b7">path ends</text>`),
  },
  'solar:partial': {
    title: 'Partial solar eclipse',
    text: 'The Moon covers only part of the Sun, which looks like it has a bite taken out of it. For these eclipses the Moon’s inner shadow misses Earth entirely, so no place sees totality.',
    svg: svgWrap(`
      <radialGradient id="sunglow" cx="50%" cy="50%" r="50%">
        <stop offset="55%" stop-color="#ffd66e" stop-opacity=".5"/>
        <stop offset="100%" stop-color="#ffd66e" stop-opacity="0"/>
      </radialGradient>
      <circle cx="70" cy="50" r="32" fill="url(#sunglow)"/>
      <circle cx="70" cy="50" r="18" fill="#ffd66e"/>
      <circle cx="83" cy="40" r="18" fill="${SKY}"/>`),
  },
  'lunar:total': {
    title: 'Total lunar eclipse',
    text: 'The full Moon passes entirely into Earth’s umbra. Sunlight bent through Earth’s atmosphere paints it a deep coppery red — a “blood moon”, visible from the whole night side of Earth.',
    svg: svgWrap(`
      <radialGradient id="blood" cx="40%" cy="36%" r="72%">
        <stop offset="0%" stop-color="#e06a3a"/>
        <stop offset="55%" stop-color="#b03d18"/>
        <stop offset="100%" stop-color="#6e1f0c"/>
      </radialGradient>
      <circle cx="75" cy="48" r="22" fill="url(#blood)"/>
      <circle cx="75" cy="48" r="22" fill="none" stroke="#ff9a66" stroke-opacity=".25" stroke-width="1.5"/>`),
  },
  'lunar:partial': {
    title: 'Partial lunar eclipse',
    text: 'Only part of the Moon enters Earth’s umbra: a dark, often reddish shadow creeps across one side of the disc while the rest stays bright.',
    svg: svgWrap(`
      ${GREY_MOON}
      <clipPath id="mclip"><circle cx="75" cy="48" r="22"/></clipPath>
      <circle cx="75" cy="48" r="22" fill="url(#moon)"/>
      <circle cx="97" cy="34" r="30" fill="#1d0d08" opacity=".93" clip-path="url(#mclip)"/>`),
  },
  'lunar:penumbral': {
    title: 'Penumbral lunar eclipse',
    text: 'The Moon crosses only Earth’s faint outer shadow. One side of the disc dims slightly — a subtle shading that is easy to miss with the naked eye.',
    svg: svgWrap(`
      ${GREY_MOON}
      <linearGradient id="shade" x1="0%" y1="0%" x2="100%" y2="35%">
        <stop offset="35%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity=".42"/>
      </linearGradient>
      <clipPath id="pclip"><circle cx="75" cy="48" r="22"/></clipPath>
      <circle cx="75" cy="48" r="22" fill="url(#moon)"/>
      <rect x="53" y="26" width="44" height="44" fill="url(#shade)" clip-path="url(#pclip)"/>`),
  },
};

// Hovering a filter label pops up the matching explainer under it.
export class TypePopups {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'type-popup';
    this.el.hidden = true;
    document.body.appendChild(this.el);
    for (const label of document.querySelectorAll('#filters label')) {
      const box = label.querySelector('input');
      const key = `${box.dataset.body}:${box.dataset.kind}`;
      label.addEventListener('mouseenter', () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.show(label, key), 300);
      });
      label.addEventListener('mouseleave', () => this.hide());
    }
  }

  show(label, key) {
    const info = TYPE_INFO[key];
    if (!info) return;
    this.el.innerHTML =
      `${info.svg}<div class="tp-title">${info.title}</div><div class="tp-text">${info.text}</div>`;
    this.el.hidden = false;
    const r = label.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left + r.width / 2 - this.el.offsetWidth / 2,
      window.innerWidth - this.el.offsetWidth - 8));
    this.el.style.left = `${x}px`;
    this.el.style.top = `${r.bottom + 10}px`;
  }

  hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
  }
}

export class Tooltip {
  constructor() {
    this.el = document.getElementById('tooltip');
  }

  // hits: [{eclipse, local}] where local = {timeMs, coverage, kind} | null
  show(hits, range, clientX, clientY) {
    this.el.replaceChildren();
    const shown = hits.slice(0, 4);
    for (const { eclipse, local } of shown) {
      const row = document.createElement('div');
      row.className = 'tt-row';

      const value = document.createElement('div');
      value.className = 'tt-value';
      const key = document.createElement('span');
      key.className = 'tt-key';
      key.style.background = rgbCss(colorFor(eclipse, range.startMs, range.endMs));
      value.appendChild(key);
      const text = document.createElement('span');
      if (eclipse.body === 'lunar') {
        // A lunar eclipse looks the same from everywhere the Moon is up; what
        // varies by place is whether the whole eclipse fits between moonrise
        // and moonset.
        const umbra = eclipse.kind === 'partial' && eclipse.obscuration != null
          ? ` · ${Math.round(eclipse.obscuration * 100)}% in umbra` : '';
        text.textContent = local?.fully
          ? `peak ${formatTime(eclipse.peakMs)} · entire eclipse visible${umbra}`
          : `peak ${formatTime(eclipse.peakMs)} · partly visible (moonrise/moonset)${umbra}`;
      } else {
        const pct = Math.min(local?.kind === 'partial' ? 99 : 100, Math.round((local?.coverage ?? 0) * 100));
        text.textContent = local
          ? `${formatTime(local.timeMs)} · ${local.kind} here · ${pct}% covered`
          : 'at the edge of visibility';
      }
      value.appendChild(text);
      row.appendChild(value);

      const name = document.createElement('div');
      name.className = 'tt-name';
      name.textContent = `${eclipse.label} — ${eclipse.dateLabel}`;
      row.appendChild(name);

      this.el.appendChild(row);
    }
    if (hits.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'tt-more';
      more.textContent = `+${hits.length - shown.length} more eclipse(s) here`;
      this.el.appendChild(more);
    }

    this.el.hidden = false;
    const pad = 14;
    const r = this.el.getBoundingClientRect();
    let x = clientX + pad, y = clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = clientY - r.height - pad;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  hide() {
    this.el.hidden = true;
  }
}
