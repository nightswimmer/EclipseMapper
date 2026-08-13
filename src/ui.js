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
    document.getElementById('subtitle').textContent = `Solar eclipses ${y0} – ${y1}`;
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

export class Filters {
  constructor(onChange) {
    this.enabled = new Set();
    this.boxes = [...document.querySelectorAll('#filters input')];
    for (const box of this.boxes) {
      if (box.checked) this.enabled.add(box.dataset.kind);
      box.addEventListener('change', () => {
        box.checked ? this.enabled.add(box.dataset.kind) : this.enabled.delete(box.dataset.kind);
        onChange();
      });
    }
  }

  updateCounts(eclipsesInRange) {
    const counts = { total: 0, annular: 0, hybrid: 0, partial: 0 };
    for (const e of eclipsesInRange) counts[e.kind]++;
    for (const kind of Object.keys(counts)) {
      document.getElementById(`count-${kind}`).textContent = counts[kind];
    }
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
      const pct = Math.min(local?.kind === 'partial' ? 99 : 100, Math.round((local?.coverage ?? 0) * 100));
      text.textContent = local
        ? `${formatTime(local.timeMs)} · ${local.kind} here · ${pct}% covered`
        : 'at the edge of visibility';
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
