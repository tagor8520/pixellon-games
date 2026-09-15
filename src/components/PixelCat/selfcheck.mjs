/**
 * PixelCat self-check — `node src/components/PixelCat/selfcheck.mjs`
 *
 * Simulates the cat headlessly (fake canvas, fake cursor) for many minutes at
 * 60fps and asserts the invariants that are hard to eyeball: no NaN, nothing
 * drawn outside the sprite buffer, every rect on a whole device pixel, the cat
 * stays in its band, behavior does not repeat or chain, and the tablet /
 * mobile / reduced-motion capability gates actually hold.
 */
import assert from 'node:assert/strict';
import { ART, CAT_CONFIG } from './catConfig.js';
import CatRenderer from './CatRenderer.js';
import CatAnimation from './CatAnimation.js';
import CatBehavior from './CatBehavior.js';
import CursorTracker from './CursorTracker.js';
import { S } from './catStates.js';
import { GESTURES } from './catAnimations.js';

function fakeCanvas() {
  const rects = [];
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillRect: (x, y, w, h) => rects.push([x, y, w, h]),
    clearRect: () => {},
    drawImage: () => {},
  };
  return { canvas: { getContext: () => ctx, width: 0, height: 0, style: {} }, rects };
}

function simulate({ minutes = 10, vw = 1440, vh = 900, scale = 5, dpr = 2, caps, cursor = true, skipUnchanged = false }) {
  const maxSkippedDraws = CAT_CONFIG.quality?.maxSkippedDraws ?? 3;
  let skipped = 0;
  const { canvas, rects } = fakeCanvas();
  const renderer = new CatRenderer(canvas);
  renderer.resize(scale, dpr);

  const anim = new CatAnimation();
  const tracker = new CursorTracker();
  tracker.enabled = cursor;
  const behavior = new CatBehavior({ anim, tracker, scale, vw, vh, caps });

  const unit = renderer.unit;
  const stats = { states: new Map(), gestures: new Map(), transitions: [], frames: 0 };
  const dt = 1 / 60;
  const frames = Math.round(minutes * 60 * 60);
  let prev = behavior.state;

  for (let i = 0; i < frames; i++) {
    if (cursor) {
      // a plausible wandering cursor, sometimes parked, sometimes flicked fast
      const t = i * dt;
      tracker.x = vw / 2 + Math.sin(t * 0.23) * vw * 0.45;
      tracker.y = vh / 2 + Math.sin(t * 0.41) * vh * 0.42;
      tracker.seen = true;
      tracker.lastMove = performance.now();
      tracker.speed = 200 + Math.abs(Math.sin(t * 0.7)) * 1600;
    }
    behavior.update(dt);
    anim.update(dt);
    rects.length = 0;
    // Mirror PixelCat's budget: repaint unless the pose quantises to the same
    // art-pixel layout, and force one after N consecutive skips.
    const force = !skipUnchanged || skipped >= maxSkippedDraws;
    const drew = renderer.draw(anim.pose, { force });
    skipped = drew ? 0 : skipped + 1;
    stats.frames++;

    /* no NaN anywhere */
    assert.ok(Number.isFinite(behavior.x), `x NaN at frame ${i} (${behavior.state})`);
    assert.ok(Number.isFinite(behavior.offY), `offY NaN at frame ${i} (${behavior.state})`);
    for (const key in anim.pose) {
      const value = anim.pose[key];
      if (typeof value === 'number') {
        assert.ok(Number.isFinite(value), `pose.${key} = ${value} at frame ${i} (${behavior.state})`);
      }
    }

    /* crisp pixels: every rect on a whole device pixel, inside the buffer */
    for (const [x, y, w, h] of rects) {
      assert.ok(Number.isInteger(x) && Number.isInteger(y), `sub-pixel rect ${[x, y, w, h]}`);
      assert.equal(x % unit, 0, `rect x ${x} off the ${unit}px art grid`);
      assert.equal(y % unit, 0, `rect y ${y} off the ${unit}px art grid`);
      assert.ok(x >= 0 && y >= 0, `rect outside buffer (top/left): ${[x, y, w, h]}`);
      assert.ok(
        x + w <= canvas.width && y + h <= canvas.height,
        `rect outside buffer (bottom/right): ${[x, y, w, h]} in ${canvas.width}x${canvas.height} state=${behavior.state}/${behavior.phase} anim=${anim.clipName}`,
      );
    }

    /* stays in its band: never above the canvas, never miles below */
    assert.ok(
      behavior.offY <= (ART.H + 2) * scale && behavior.offY >= -12 * scale,
      `offY ${behavior.offY} out of band in ${behavior.state}`,
    );
    assert.ok(
      behavior.x > -3 * ART.W * scale && behavior.x < vw + 3 * ART.W * scale,
      `x ${behavior.x} ran away in ${behavior.state}`,
    );

    /* while fully on stage the cat must stay inside the viewport */
    if (behavior.state === S.IDLE || behavior.state === S.SITTING || behavior.state === S.SLEEPING) {
      assert.ok(
        behavior.x > -ART.W * scale && behavior.x < vw + ART.W * scale,
        `resting off-stage at x=${behavior.x}`,
      );
    }

    if (behavior.state !== prev) {
      stats.transitions.push([prev, behavior.state, i]);
      prev = behavior.state;
    }
    stats.states.set(behavior.state, (stats.states.get(behavior.state) || 0) + 1);
    if (anim.clip) stats.gestures.set(anim.clip.name, (stats.gestures.get(anim.clip.name) || 0) + 1);
  }
  stats.renderer = renderer;
  return stats;
}

/* ── 1. full desktop run ──────────────────────────────────────── */
const desktop = simulate({ minutes: 12, caps: { motion: true, cursor: true, rare: true } });

for (const state of [S.HIDDEN, S.PEEKING, S.ENTERING, S.IDLE, S.WALKING, S.GESTURE]) {
  assert.ok(desktop.states.has(state), `desktop run never reached ${state}`);
}
assert.ok(
  desktop.states.has(S.WATCHING_CURSOR) || desktop.states.has(S.CURSOR_CURIOUS),
  'cursor awareness never triggered on desktop',
);

/* no gesture immediately chained into another gesture */
for (const [from, to] of desktop.transitions) {
  assert.notEqual(from + '->' + to, S.GESTURE + '->' + S.GESTURE, 'gestures chained back-to-back');
}

/* decisions are spaced out, not fired every second */
const gaps = desktop.transitions.slice(1).map((t, i) => (t[2] - desktop.transitions[i][2]) / 60);
const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
assert.ok(meanGap > 1.2, `state changes too frequent: mean gap ${meanGap.toFixed(2)}s`);
assert.ok(desktop.transitions.length > 20, 'suspiciously few transitions — is it stuck?');

/* variety: it should not sit in one behavior forever */
const busiest = Math.max(...[...desktop.states.values()]) / desktop.frames;
assert.ok(busiest < 0.75, `one state dominates ${(busiest * 100) | 0}% of frames`);
assert.ok(desktop.gestures.size >= 8, `only ${desktop.gestures.size} distinct clips played`);

/* ── 2. mobile: no cursor tracking, smaller scale ─────────────── */
const mobile = simulate({
  minutes: 8,
  vw: 390,
  vh: 780,
  scale: CAT_CONFIG.scale.mobile,
  dpr: 3,
  cursor: false,
  caps: { motion: true, cursor: false, rare: false },
});
for (const state of [S.WATCHING_CURSOR, S.CURSOR_CURIOUS, S.POUNCING, S.RARE]) {
  assert.ok(!mobile.states.has(state), `mobile run entered ${state}`);
}
assert.ok(mobile.states.has(S.WALKING) && mobile.states.has(S.GESTURE), 'mobile cat is inert');

/* ── 3. reduced motion: quiet gestures only ───────────────────── */
const calm = simulate({
  minutes: 8,
  cursor: false,
  caps: { motion: false, cursor: false, rare: false },
});
for (const state of [S.WALKING, S.POUNCING, S.EXITING, S.RARE, S.CURSOR_CURIOUS]) {
  assert.ok(!calm.states.has(state), `reduced-motion run entered ${state}`);
}
const loud = [...calm.gestures.keys()].filter(
  (name) => !['blink', 'doubleBlink', 'earTwitch', 'tailFlick', 'sit', 'peek'].includes(name),
);
assert.deepEqual(loud, [], `reduced motion played ${loud.join(', ')}`);

/* ── 4. responsive scale ladder + band height ─────────────────── */
const scaleFor = (w) =>
  w < CAT_CONFIG.breakpoints.mobile
    ? CAT_CONFIG.scale.mobile
    : w < CAT_CONFIG.breakpoints.tablet
      ? CAT_CONFIG.scale.tablet
      : CAT_CONFIG.scale.desktop;

// cat height = ear tip (art row 14) to the baseline, per the renderer layout
const catHeight = (scale) => (ART.BASELINE - 14) * scale;
for (const [width, min, max] of [
  [375, 55, 90],
  [768, 70, 110],
  [1440, 90, 140],
  [2560, 90, 140],
]) {
  const h = catHeight(scaleFor(width));
  assert.ok(h >= min && h <= max, `at ${width}px the cat is ${h}px tall, wanted ${min}–${max}`);
}
// the whole sprite buffer must fit the bottom band it is allowed to occupy
assert.ok(ART.H * CAT_CONFIG.scale.desktop <= 220, 'cat band taller than 220px');

/* ── 5. every declared gesture is reachable and finite ────────── */
for (const gesture of GESTURES) {
  assert.ok(gesture.dur > 0 && gesture.dur < 1e8, `${gesture.name} has a silly duration`);
  assert.equal(typeof gesture.update, 'function', `${gesture.name} has no update()`);
  assert.ok(gesture.weight > 0, `${gesture.name} can never be picked`);
}

/* ── 6. device budget: an idle cat must not repaint every frame ── */
const budget = simulate({
  minutes: 3,
  caps: { motion: true, cursor: false, rare: false },
  skipUnchanged: true,
});
const drawRatio = budget.renderer.stats.draws / (budget.renderer.stats.draws + budget.renderer.stats.skips);
assert.ok(
  drawRatio < 0.8,
  `idle cat still repaints ${(drawRatio * 100).toFixed(0)}% of frames — skip logic is not working`,
);
assert.ok(
  budget.renderer.stats.skips > 0 && budget.renderer.stats.draws > 0,
  'skip logic either never skipped or never drew',
);
console.log(
  `  draw efficiency: ${(drawRatio * 100).toFixed(1)}% of frames painted (${budget.renderer.stats.draws} draws, ${budget.renderer.stats.skips} skipped)`,
);

console.log('PixelCat self-check passed');
console.log(
  '  desktop states:',
  [...desktop.states.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${((v / desktop.frames) * 100).toFixed(1)}%`)
    .join(', '),
);
console.log('  transitions:', desktop.transitions.length, `mean gap ${meanGap.toFixed(1)}s`);
console.log('  clips played:', [...desktop.gestures.keys()].join(', '));
