// Draws eclipse geometry onto an equirectangular canvas used as a transparent
// texture wrapped over the globe. x = (lon+180)/360 * W, y = (90-lat)/180 * H.

import { colorFor, rgbCss } from './data.js';

const W = 4096, H = 2048;
const X_PER_DEG = W / 360, Y_PER_DEG = H / 180;

export class Overlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.onRedraw = null; // set by globe: marks the texture dirty
  }

  // eclipses: visible, filtered list. range: {startMs, endMs}. hovered: Set of
  // ids. selectedId: eclipse id or null. Central eclipses normally draw only
  // their band + central line; the wide penumbral zone appears when selected.
  // Partial eclipses always draw their region — it is their only geometry.
  // While a selection is active, everything else fades back.
  draw(eclipses, range, hovered = new Set(), selectedId = null) {
    const { ctx } = this;
    ctx.clearRect(0, 0, W, H);

    // Painter's order: earlier first, hovered above, the selected one on top.
    const rank = (e) => (e.id === selectedId ? 2 : hovered.has(e.id) ? 1 : 0);
    const sorted = [...eclipses].sort((a, b) => (rank(a) - rank(b)) || (a.peakMs - b.peakMs));

    // With many overlapping partial-eclipse footprints, fade the fills so the
    // map stays readable; outlines and hover emphasis carry the identity.
    const partials = eclipses.filter((e) => !e.bandRing).length;
    const regionAlpha = Math.min(0.15, 2.5 / Math.max(1, partials));
    const crowded = eclipses.length > 60;

    for (const e of sorted) {
      const rgb = colorFor(e, range.startMs, range.endMs);
      const selected = e.id === selectedId;
      const faded = selectedId !== null && !selected;
      const hot = hovered.has(e.id) && !selected;
      // A faded eclipse under the cursor lifts a little so click targets are
      // previewable even while another eclipse is isolated.
      const dim = faded ? (hot ? 0.55 : 0.18) : 1;

      // Penumbral (partial visibility) zone.
      if (e.regionRings.length && (selected || !e.bandRing)) {
        const path = this.ringsPath(e.regionRings);
        ctx.fillStyle = rgbCss(rgb, selected ? 0.28 : (hot ? 0.3 : regionAlpha) * dim);
        ctx.fill(path, 'evenodd');
        ctx.strokeStyle = rgbCss(rgb, selected ? 0.95 : (hot ? 0.95 : 0.45) * dim);
        ctx.lineWidth = selected ? 2.5 : hot ? 3 : 1.5;
        ctx.stroke(path);
      }

      // Umbral/antumbral band: strong fill.
      if (e.bandRing) {
        const path = this.ringsPath([e.bandRing]);
        ctx.fillStyle = rgbCss(rgb, selected ? 0.85 : (hot ? 0.85 : crowded ? 0.45 : 0.6) * dim);
        ctx.fill(path, 'evenodd');
        if (selected || hot) {
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * dim})`;
          ctx.lineWidth = 2;
          ctx.stroke(path);
        }
      }

      // Central line.
      if (e.centralUnwrapped) {
        const path = this.linePath(e.centralUnwrapped);
        ctx.strokeStyle = rgbCss(rgb, (selected || hot ? 1 : 0.9) * dim);
        ctx.lineWidth = selected || hot ? 4 : 2.5;
        ctx.lineCap = 'round';
        ctx.stroke(path);
      }
    }

    if (this.onRedraw) this.onRedraw();
  }

  // Build a Path2D from unwrapped rings, replicated at -360/0/+360 so any
  // dateline crossing is covered. Consumers fill with 'evenodd'.
  ringsPath(rings) {
    const path = new Path2D();
    for (const dx of [-360, 0, 360]) {
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => {
          const x = (lon + dx + 180) * X_PER_DEG;
          const y = (90 - lat) * Y_PER_DEG;
          i === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
        });
        path.closePath();
      }
    }
    return path;
  }

  linePath(line) {
    const path = new Path2D();
    for (const dx of [-360, 0, 360]) {
      line.forEach(([lon, lat], i) => {
        const x = (lon + dx + 180) * X_PER_DEG;
        const y = (90 - lat) * Y_PER_DEG;
        i === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
      });
    }
    return path;
  }
}
