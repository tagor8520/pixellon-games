/**
 * CatRenderer — draws the cat into a canvas from a plain pose object.
 *
 * The cat is assembled from independently transformable pixel parts (tail, legs,
 * body, head, ears, eyes, paws) laid out on an integer art-pixel grid. Every rect
 * snaps to whole art pixels and is scaled by an integer factor, so edges stay
 * perfectly crisp — no rotation, no sub-pixel fills, no smoothing artifacts.
 *
 * Sprite-sheet ready: call setSpriteSheet() and any pose whose `anim` has frames
 * defined is blitted from the sheet instead of being drawn procedurally.
 *
 * Cheap repaints: every rect is snapped to whole art pixels, so two poses that
 * quantise to the same art-pixel layout produce byte-identical output. `draw()`
 * takes a `force` flag: when false it compares a quantised signature and returns
 * without touching the canvas when nothing would change. That is what lets an
 * idle cat cost ~0% CPU instead of redrawing ~150 rects 60 times a second.
 */
import { ART, PALETTE as C } from './catConfig.js';

const R = Math.round;

/** Neutral pose. The animation controller mutates a copy of this. */
export const basePose = () => ({
  anim: 'idle',
  frame: 0,
  bob: 0, // body lift, art px (negative = up)
  lean: 0, // -1..1 body weight shift
  crouch: 0, // 0..1
  sit: 0, // 0..1
  loaf: 0, // 0..1
  stretch: 0, // 0..1
  squash: 0, // -1 (tall) .. 1 (squat)
  headX: 0, // art px
  headY: 0, // art px
  tilt: 0, // -1..1 head tilt
  lookX: 0, // -1..1 gaze / pupil
  lookY: 0, // -1..1
  earL: 0, // -1..1 (negative = flattened back)
  earR: 0,
  eyeOpen: 1, // 0..1
  tailWave: 0.3, // 0..1 sway amplitude
  tailPhase: 0,
  tailUp: 0.25, // 0..1 raised
  legPhase: 0,
  legMove: 0, // 0..1 how much of the walk cycle to apply
  pawUp: 0, // 0..1 near front paw lifted
  pawReach: 0, // 0..1 extended forward
  sleep: 0, // 0..1
  zPhase: 0,
  faceAway: 0, // 0..1 looking behind itself
  alpha: 1,
  hangPaws: 0, // 0..1 paws hooked over the viewport edge (paw peek)
  edgeRow: ART.H, // art row where the viewport bottom edge currently cuts
});

/* Layout, in art pixels, cat facing right. Parts deliberately overlap so the
   silhouette reads as one animal rather than a pile of boxes. */
const L = {
  bodyX: 14,
  bodyY: 24,
  bodyW: 18,
  bodyH: 11,
  headX: 24,
  headY: 17,
  headW: 13,
  headH: 11,
  earLX: 25,
  earRX: 32,
  earW: 5,
  earH: 3,
  eyeLX: 27,
  eyeRX: 32,
  eyeY: 4, // relative to head top
  legW: 4,
  hindLegX: 16,
  frontLegX: 25,
};

export default class CatRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 4;
    this.dpr = 1;
    this.unit = 4;
    this.sheet = null;
    this._signature = '';
    this.stats = { draws: 0, skips: 0 };
  }

  /**
   * Quantised fingerprint of everything that can change pixels, rounded to the
   * granularity the renderer actually paints at (whole art pixels). Trig terms
   * are quantised on their *result*, so a tail sway only counts as a change when
   * it would move a node by at least half an art pixel.
   */
  poseSignature(p) {
    const q = (value, step = 0.5) => Math.round((value || 0) / step);
    return [
      p.anim,
      q(p.frame, 1),
      q(p.bob),
      q(p.lean),
      q(p.crouch, 0.34),
      q(p.sit, 0.34),
      q(p.loaf, 0.34),
      q(p.stretch, 0.34),
      q(p.squash, 0.34),
      q(p.headX, 0.34),
      q(p.headY, 0.34),
      q(p.tilt, 0.34),
      q(p.lookX, 0.34),
      q(p.lookY, 0.34),
      q(p.earL, 0.34),
      q(p.earR, 0.34),
      q(p.eyeOpen, 0.5),
      q(p.tailWave, 0.2),
      q(Math.sin(p.tailPhase || 0), 0.25),
      q(p.tailUp, 0.2),
      q(Math.sin(p.legPhase || 0), 0.25),
      q(p.legMove, 0.34),
      q(p.pawUp, 0.34),
      q(p.pawReach, 0.34),
      q(p.sleep, 0.5),
      q(p.faceAway, 0.5),
      q(p.alpha, 0.34),
      q(p.hangPaws, 0.5),
      q(p.edgeRow, 1),
      q(p.zPhase, 0.3),
    ].join('|');
  }

  /** @param {number} scale art px -> CSS px. @param {number} dpr device pixel ratio. */
  resize(scale, dpr = 1) {
    this.scale = scale;
    this.dpr = dpr;
    this.unit = Math.max(1, R(scale * dpr));
    this.canvas.width = ART.W * this.unit;
    this.canvas.height = ART.H * this.unit;
    this.canvas.style.width = ART.W * scale + 'px';
    this.canvas.style.height = ART.H * scale + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Optional real sprite sheet: { image, frameW, frameH, frames: { walk: [[col,row]] } } */
  setSpriteSheet(sheet) {
    this.sheet = sheet;
  }

  /* ── pixel primitives ───────────────────────────────────────── */

  px(x, y, w, h, color) {
    const u = this.unit;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(R(x) * u, R(y) * u, R(w) * u, R(h) * u);
  }

  /** Outlined blob with cut corners — the pixel-art rounded rectangle. */
  blob(x, y, w, h, fill, outline = C.outline) {
    if (w < 4 || h < 4) return;
    this.px(x + 1, y, w - 2, h, outline);
    this.px(x, y + 1, w, h - 2, outline);
    this.px(x + 2, y + 1, w - 4, h - 2, fill);
    this.px(x + 1, y + 2, w - 2, h - 4, fill);
  }

  /** Outlined rect, square corners — limbs. */
  bar(x, y, w, h, fill, outline = C.outline) {
    this.px(x, y, w, h, outline);
    this.px(x + 1, y + 1, w - 2, h - 2, fill);
  }

  /* ── main entry ─────────────────────────────────────────────── */

  /**
   * @param {object} pose
   * @param {{ force?: boolean }} [opts] force=true always repaints (default).
   *        force=false lets the renderer skip a frame whose quantised pose is
   *        identical to the last one — the caller is expected to bound how long
   *        it will tolerate skips.
   * @returns {boolean} true when the canvas was repainted
   */
  draw(pose, { force = true } = {}) {
    const signature = this.poseSignature(pose);
    if (!force && signature === this._signature) {
      this.stats.skips++;
      return false;
    }
    this._signature = signature;
    this.stats.draws++;

    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (pose.alpha <= 0.01) return true;
    ctx.globalAlpha = pose.alpha;

    if (this.sheet && this.sheet.frames && this.sheet.frames[pose.anim]) this.drawSprite(pose);
    else this.drawParts(pose);

    ctx.globalAlpha = 1;
    return true;
  }

  drawSprite(pose) {
    const { image, frameW, frameH, frames } = this.sheet;
    const list = frames[pose.anim];
    const [col, row] = list[Math.floor(pose.frame) % list.length];
    const u = this.unit;
    this.ctx.drawImage(
      image,
      col * frameW,
      row * frameH,
      frameW,
      frameH,
      0,
      (ART.H - frameH) * u,
      frameW * u,
      frameH * u,
    );
  }

  drawParts(p) {
    /* ── derive geometry from the pose ──────────────────────── */
    const sit = p.sit;
    const loaf = Math.max(p.loaf, p.sleep);
    const squat = p.crouch * 2 + loaf * 4 + sit;
    const breathe = p.sleep > 0.4 ? Math.sin(p.zPhase * 0.9) * 0.5 : 0;
    const sitting = sit > 0.5;

    let bodyW = L.bodyW + R(p.squash * 2 + loaf * 2 + p.stretch * 3);
    const bodyH = L.bodyH - R(p.squash * 1.5 + loaf * 2) + R(breathe);
    let bodyX = L.bodyX - R(p.stretch * 2) + R(p.lean * 1.5) + R(sit * 2);
    const bodyY = L.bodyY + R(squat + p.bob + p.squash);

    if (sitting) {
      bodyW -= 5;
      bodyX += 4;
    }

    const legTop = bodyY + bodyH - 3;
    const legH = Math.max(2, ART.BASELINE - legTop);
    const walking = p.legMove > 0.05 && loaf < 0.5 && !sitting;

    const headX = L.headX + R(p.headX + p.lean * 1.5 + p.stretch * 2 + sit * 2);
    const headY =
      L.headY + R(squat * 0.9 + p.headY + p.bob + p.stretch * 3 + loaf * 3 - sit + breathe);

    /* ── tail (behind everything) ───────────────────────────── */
    this.drawTail(p, bodyX, bodyY, sitting);

    /* ── far legs ───────────────────────────────────────────── */
    if (loaf < 0.5) {
      if (!sitting) {
        this.leg(L.hindLegX - 2, legTop, legH, C.dark, p.legPhase, walking ? p.legMove : 0);
      }
      this.leg(
        L.frontLegX - 2,
        legTop,
        legH,
        C.dark,
        p.legPhase + Math.PI,
        walking ? p.legMove : 0,
      );
    }

    /* ── body ───────────────────────────────────────────────── */
    // sitting: rear haunch goes behind the chest, which is a column to the floor
    if (sitting) {
      const hy = ART.BASELINE - 11;
      this.blob(bodyX - 6, hy, 11, 11, C.base);
      this.px(bodyX - 4, hy + 4, 5, 4, C.dark); // thigh shading
      this.px(bodyX - 5, ART.BASELINE - 3, 6, 1, C.outline);
      this.px(bodyX - 5, ART.BASELINE - 2, 6, 2, C.soft); // rear paw on the floor
    }
    const drawnH = sitting ? ART.BASELINE - bodyY : bodyH;
    this.blob(bodyX, bodyY, bodyW, drawnH, C.base);
    this.px(bodyX + 3, bodyY + bodyH - 3, bodyW - 7, 2, C.dark); // belly shade
    this.px(bodyX + bodyW - 7, bodyY + 2, 4, 3, C.light); // shoulder highlight
    this.px(bodyX + 5, bodyY + 1, 2, 1, C.dark); // back stripes
    this.px(bodyX + 9, bodyY + 1, 2, 1, C.dark);

    // chest/neck wedge: fills the joint so the head never looks detached
    const neckX = headX + 2;
    const neckTop = headY + L.headH - 4;
    this.px(neckX, neckTop, 7, bodyY + 4 - neckTop, C.outline);
    this.px(neckX + 1, neckTop, 5, bodyY + 3 - neckTop, C.base);

    /* ── near legs ──────────────────────────────────────────── */
    if (loaf < 0.5) {
      if (!sitting) {
        this.leg(L.hindLegX, legTop, legH, C.base, p.legPhase + Math.PI, walking ? p.legMove : 0);
      }
      // pawUp 0..1 lifts the near front paw off the ground (leg shortens from below)
      const pawLift = R(Math.max(0, p.pawUp) * 4);
      const pawFwd = R(p.pawReach * 4);
      this.leg(
        L.frontLegX + pawFwd,
        legTop,
        Math.max(2, legH - pawLift),
        C.base,
        p.legPhase,
        walking ? p.legMove : 0,
      );
    } else {
      this.px(bodyX + bodyW - 9, ART.BASELINE - 3, 6, 1, C.outline); // tucked paws
      this.px(bodyX + bodyW - 9, ART.BASELINE - 2, 6, 2, C.soft);
    }

    /* ── head ───────────────────────────────────────────────── */
    this.drawHead(p, headX, headY);

    if (p.sleep > 0.5) this.drawZs(p, headX, headY);
    if (p.hangPaws > 0.01) this.drawHangPaws(p);
  }

  /** Two paws hooked over the bottom edge of the viewport — the paw peek. */
  drawHangPaws(p) {
    const y = Math.max(0, Math.min(ART.H - 3, Math.round(p.edgeRow) - 2));
    for (const x of [21, 28]) {
      this.px(x, y, 6, 3, C.outline);
      this.px(x + 1, y + 1, 4, 2, C.base);
      this.px(x + 1, y + 1, 4, 1, C.soft); // toes
      this.px(x + 2, y + 1, 1, 1, C.outline);
      this.px(x + 4, y + 1, 1, 1, C.outline);
    }
  }

  leg(x, top, h, color, phase, move) {
    const swing = R(Math.sin(phase) * 2 * move);
    const lift = R(Math.max(0, Math.sin(phase)) * 2 * move);
    const height = Math.max(2, h - lift);
    this.bar(x + swing, top, L.legW, height, color);
    this.px(x + swing + 1, top + height - 2, L.legW - 2, 1, C.soft); // paw
  }

  drawTail(p, bodyX, bodyY, sitting) {
    const baseX = bodyX + 2;
    const baseY = bodyY + 6;
    const up = sitting ? 0.1 : p.tailUp;
    const nodes = [];
    for (let i = 0; i <= 7; i++) {
      const t = i / 7;
      const wave = Math.sin(p.tailPhase + t * 2.4) * p.tailWave * (1 + 4 * t);
      nodes.push({
        x: baseX - t * (10 - 6 * up) + wave * 0.5,
        y: baseY - t * (1 + 13 * up) - wave * 0.3,
        thick: i < 5 ? 3 : 2,
      });
    }
    for (const n of nodes) this.px(n.x - 1, n.y - 1, n.thick + 2, n.thick + 2, C.outline);
    for (const n of nodes) this.px(n.x, n.y, n.thick, n.thick, C.base);
    const tip = nodes[nodes.length - 1];
    this.px(tip.x, tip.y, 2, 2, C.light);
  }

  drawHead(p, x, y) {
    const tilt = R(p.tilt * 1.6);
    const w = L.headW;
    const h = L.headH;

    this.blob(x, y, w, h, C.base);
    this.ear(x + (L.earLX - L.headX), y, -1, p.earL, tilt);
    this.ear(x + (L.earRX - L.headX), y, 1, p.earR, tilt);
    this.px(x + 2, y + 1, w - 4, 1, C.light); // forehead sheen
    this.px(x + 3, y + h - 2, w - 6, 1, C.dark); // chin shade

    if (p.faceAway > 0.5) {
      this.px(x + 3, y + 3, w - 6, h - 6, C.dark); // back of the head, no face
      return;
    }

    /* muzzle — small, tucked into the lower half of the face */
    const mx = x + 5 + R(p.lookX * 0.5);
    const my = y + 7 + R(p.lookY * 0.5);
    this.px(mx, my, 4, 2, C.ice);
    this.px(mx + 1, my, 2, 1, C.soft); // nose
    this.px(mx + 1, my + 1, 1, 1, C.outline); // mouth
    this.px(x + w - 1, my + 1, 2, 1, C.soft); // whiskers, clear of the muzzle
    this.px(x - 1, my + 1, 2, 1, C.soft);

    /* eyes */
    const open = p.sleep > 0.5 ? 0 : p.eyeOpen;
    const ey = y + L.eyeY + R(p.lookY * 0.6);
    this.eye(x + (L.eyeLX - L.headX), ey - tilt, open, p);
    this.eye(x + (L.eyeRX - L.headX), ey + tilt, open, p);
  }

  ear(x, headTop, side, earPose, tilt) {
    if (earPose < -0.4) {
      this.px(x - 1, headTop - 1, L.earW + 2, 2, C.outline); // flattened back
      this.px(x, headTop - 1, L.earW, 1, C.dark);
      return;
    }
    const lean = R(earPose * 2) * side + tilt * side;
    // rows run tip → base and the base row overlaps the skull, so no seam appears
    for (let row = 0; row < L.earH; row++) {
      const width = 1 + row * 2; // 1 → 3 → 5
      const shift = R((lean * (L.earH - row)) / L.earH);
      const ex = R(x + (L.earW - width) / 2 + shift);
      const ey = headTop - L.earH + row;
      if (row === 0) this.px(ex - 1, ey - 1, width + 2, 1, C.outline); // tip cap
      this.px(ex - 1, ey, 1, 1, C.outline); // sides only
      this.px(ex + width, ey, 1, 1, C.outline);
      this.px(ex, ey, width, 1, C.base);
    }
    const baseShift = R(lean * 0.4);
    this.px(x + baseShift, headTop, L.earW, 1, C.base); // seat into the skull
    this.px(x + 1 + baseShift, headTop - 2, 3, 1, C.soft); // inner ear
  }

  eye(x, y, open, p) {
    if (open <= 0.12) {
      this.px(x, y + 1, 3, 1, C.outline); // closed / mid-blink
      return;
    }
    const h = open > 0.6 ? 3 : 2;
    this.px(x, y, 3, h, C.ice);
    const dx = R(p.lookX);
    const dy = open > 0.6 ? Math.max(0, R(p.lookY)) : 0;
    this.px(x + 1 + dx, y + dy, 2, 2, C.ink); // pupil
    if (open > 0.6) this.px(x + 1 + dx, y, 1, 1, C.white); // catch-light
  }

  drawZs(p, headX, headY) {
    const { ctx } = this;
    for (let i = 0; i < 3; i++) {
      const t = (p.zPhase * 0.35 + i / 3) % 1;
      const zy = headY - 3 - t * 9;
      const zx = headX + 8 + Math.sin(t * 3 + i) * 2;
      ctx.globalAlpha = p.alpha * Math.max(0, 1 - t) * p.sleep;
      this.px(zx, zy, 3, 1, C.soft);
      this.px(zx + 1, zy + 1, 1, 1, C.soft);
      this.px(zx, zy + 2, 3, 1, C.soft);
    }
    ctx.globalAlpha = p.alpha;
  }
}
