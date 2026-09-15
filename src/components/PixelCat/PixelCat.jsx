/**
 * PixelCat — the only React surface of the cat system.
 *
 *   PixelCat (mount, lifecycle, adaptive quality)
 *     └ CatBehavior   (intent: state machine, position, decisions)
 *         └ CatAnimation (visual: pose channels, clips, smoothing)
 *             └ CatRenderer (pixel drawing)
 *         └ CursorTracker (pointer input)
 *
 * All animation state lives outside React — the component renders once and the
 * rAF loop mutates a canvas and one transform. Debug text is written straight to
 * a DOM node so the overlay never triggers a re-render either.
 *
 * ── Living inside a device budget ──────────────────────────────────────────
 * The cat is decoration, so it runs on whatever budget the device can spare:
 *
 *   • a *stride* (paint 1 frame in N) chosen from measured work per frame, the
 *     hardware's core/memory class, and `saveData`. The simulation is dt-based,
 *     so a stride lowers paint rate without changing how the cat moves.
 *   • unchanged-pose skips — an idle cat repaints only when a pixel would differ.
 *     Bounded by `maxSkippedDraws` so it can never look frozen.
 *   • the loop fully stops when the tab is hidden or the band is off-screen,
 *     instead of burning a frame callback per vsync forever.
 *   • DPR is capped, and the canvas is exactly as large as the sprite needs.
 *
 * Everything is observable through `?catDebug=true` (fps, stride, skip rate).
 */
import { useEffect, useRef } from 'react';
import { ART, CAT_CONFIG } from './catConfig.js';
import CatRenderer from './CatRenderer.js';
import CatAnimation from './CatAnimation.js';
import CatBehavior from './CatBehavior.js';
import CursorTracker from './CursorTracker.js';
import { S } from './catStates.js';
import { CLIPS } from './catAnimations.js';

/**
 * Read the `?catDebug=true` flag without assuming a browser global.
 * Effects only run in a browser, but defensive access keeps the module safe to
 * import anywhere (SSR, tests, a future worker) — which is what the render
 * smoke test checks.
 */
const debugRequested = () => {
  try {
    return new URLSearchParams(globalThis.location?.search || '').get('catDebug') === 'true';
  } catch {
    return false;
  }
};

const scaleForWidth = (w) => {
  const { scale, breakpoints } = CAT_CONFIG;
  if (w < breakpoints.mobile) return scale.mobile;
  if (w < breakpoints.tablet) return scale.tablet;
  return scale.desktop;
};

/**
 * Classify the device once, cheaply, using only hints that never require a
 * permission prompt or a network round trip.
 */
function detectBudget() {
  const nav = typeof navigator === 'undefined' ? {} : navigator;
  const cores = nav.hardwareConcurrency || 8;
  const memoryGb = nav.deviceMemory || 8;
  const saveData = nav.connection?.saveData === true;
  const Q = CAT_CONFIG.quality;
  const lowPower = saveData || cores <= Q.lowPowerCores || memoryGb <= Q.lowPowerMemoryGb;
  return {
    lowPower,
    cores,
    memoryGb,
    saveData,
    reason: saveData ? 'save-data' : cores <= Q.lowPowerCores ? `${cores}-cores` : memoryGb <= Q.lowPowerMemoryGb ? `${memoryGb}gb-ram` : 'capable',
  };
}

const DEBUG_KEYS = {
  i: S.IDLE,
  w: S.WALKING,
  h: S.HIDDEN,
  p: S.PEEKING,
  n: S.ENTERING,
  c: S.WATCHING_CURSOR,
  o: S.POUNCING,
  s: S.SITTING,
  z: S.SLEEPING,
  e: S.EXITING,
  r: S.RARE,
  u: S.CURSOR_CURIOUS,
};

export default function PixelCat() {
  const canvasRef = useRef(null);
  const debugRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const quality = CAT_CONFIG.quality;
    const debugMode = debugRequested();
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const budget = detectBudget();

    const caps = {
      motion: !motionQuery.matches,
      cursor: hoverQuery.matches && window.innerWidth >= CAT_CONFIG.breakpoints.tablet,
      rare: window.innerWidth >= CAT_CONFIG.breakpoints.mobile && !motionQuery.matches,
    };

    let vw = window.innerWidth;
    let vh = window.innerHeight;
    let scale = scaleForWidth(vw);
    // DPR 2 is the point of diminishing returns for a 48px-wide sprite and it
    // quadruples fill cost on the pixel-art redraw. 1.5 is plenty.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);

    const renderer = new CatRenderer(canvas);
    renderer.resize(scale, dpr);

    const anim = new CatAnimation();
    const tracker = new CursorTracker();
    tracker.enabled = caps.cursor;
    if (caps.cursor) tracker.attach();

    const behavior = new CatBehavior({ anim, tracker, scale, vw, vh, caps });

    // reduced motion: skip the sneaking-in act, just sit quietly on the right
    if (!caps.motion) {
      behavior.x = Math.max(vw - 160, vw * 0.72);
      behavior.offY = 0;
      behavior.facing = -1;
      behavior.go(S.IDLE);
    }

    /* ── the loop ─────────────────────────────────────────────── */
    let raf = 0;
    let running = false;
    let last = performance.now();
    let lastDebug = 0;
    let lastTransform = '';

    /* adaptive budget state */
    let stride = budget.lowPower ? quality.lowPowerStride : quality.highStride;
    let tick = 0; // frames offered by the compositor
    let executed = 0; // frames we actually simulated
    let workEma = 16.7; // ms of main-thread work per executed frame
    let skippedDraws = 0;
    let pausedFrames = 0; // frames the stride dropped (the work we did not do)
    let evalAt = { executed: 0, time: performance.now() };
    let measured = { fps: 0, stride, skipRate: 0 };

    const writeTransform = () => {
      const left = Math.round((behavior.x - (ART.W * scale) / 2) * dpr) / dpr;
      const top = Math.round(behavior.offY * dpr) / dpr;
      const transform =
        'translate3d(' +
        left +
        'px,' +
        top +
        'px,0) scale(' +
        (behavior.facing < 0 ? -1 : 1) +
        ',' +
        (behavior.flipY ? -1 : 1) +
        ')';
      if (transform !== lastTransform) {
        canvas.style.transform = transform;
        lastTransform = transform;
      }
    };

    /** Re-pick the stride from measured work, hardware class and motion prefs. */
    const rebalance = () => {
      const previous = stride;
      if (!caps.motion) {
        // Reduced motion runs cool on purpose: no walk cycles to keep smooth.
        stride = quality.highStride;
      } else if (workEma > quality.verySlowFrameMs) {
        stride = quality.verySlowStride;
      } else if (workEma > quality.slowFrameMs) {
        stride = quality.slowStride;
      } else if (workEma < quality.recoverFrameMs) {
        stride = budget.lowPower ? quality.lowPowerStride : quality.highStride;
      }
      // Never smooth a struggling device further into jank:
      if (budget.saveData && stride < quality.lowPowerStride) stride = quality.lowPowerStride;
      if (stride !== previous) tick = 0; // realign the stride window
    };

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      if (!running) return;

      tick++;
      // Drop this frame entirely (do NOT move `last`): the next executed frame
      // then integrates the full elapsed dt, so wall-clock speed is preserved.
      if (tick % stride !== 0) {
        pausedFrames++;
        return;
      }
      executed++;

      const dt = Math.min(0.05, (now - last) / 1000); // cap after tab switches
      last = now;

      const workStart = performance.now();
      tracker.update(dt);
      behavior.update(dt);
      anim.update(dt);

      // Repaint only when the quantised pose would change pixels; the hard cap
      // guarantees a bounded staleness if it does not.
      const force = skippedDraws >= quality.maxSkippedDraws || !quality.skipUnchanged;
      const drew = renderer.draw(anim.pose, { force });
      skippedDraws = drew ? 0 : skippedDraws + 1;

      writeTransform();

      // Rolling measure of what this device can actually afford.
      const workMs = performance.now() - workStart;
      workEma = workEma * 0.9 + workMs * 0.1;
      if (executed - evalAt.executed >= quality.evaluateEveryFrames) {
        const elapsedSec = Math.max(0.001, (now - evalAt.time) / 1000);
        const draws = renderer.stats.draws + renderer.stats.skips;
        measured = {
          fps: Math.round((executed - evalAt.executed) / elapsedSec),
          effectiveFps: Math.round((executed - evalAt.executed) / elapsedSec / stride),
          stride,
          workMs: +workEma.toFixed(2),
          skipRate: draws ? +(renderer.stats.skips / draws).toFixed(3) : 0,
        };
        evalAt = { executed, time: now };
        rebalance();
      }

      if (debugMode && debugRef.current && now - lastDebug > 150) {
        lastDebug = now;
        const aim = tracker.seen ? behavior.aim() : { dist: Infinity };
        debugRef.current.textContent =
          'state    ' + behavior.state + (behavior.phase ? ' / ' + behavior.phase : '') +
          '\nanim     ' + anim.clipName +
          '\nx        ' + Math.round(behavior.x) + '  offY ' + Math.round(behavior.offY) +
          '\ntarget   ' + (behavior.targetX != null ? Math.round(behavior.targetX) : '—') +
          '  facing ' + (behavior.facing > 0 ? '→' : '←') +
          '\ntimer    ' + Math.max(0, Math.round(behavior.timer)) + 'ms' +
          '\ncursor   ' + (caps.cursor ? Math.round(aim.dist) + 'px  v=' + Math.round(tracker.speed) : 'off') +
          '\nnoticed  ' + behavior.noticed +
          '\nbudget   stride ' + stride + '  work ' + workEma.toFixed(1) + 'ms' +
          '\nperf     draws ' + renderer.stats.draws + '  skipped ' + renderer.stats.skips +
          '  dropped ' + pausedFrames +
          '\nscale    ' + scale + '  dpr ' + dpr + '  device ' + budget.reason;
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    start();

    /* ── viewport + visibility ────────────────────────────────── */
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        vw = window.innerWidth;
        vh = window.innerHeight;
        const next = scaleForWidth(vw);
        caps.cursor = hoverQuery.matches && vw >= CAT_CONFIG.breakpoints.tablet;
        caps.rare = vw >= CAT_CONFIG.breakpoints.mobile && !motionQuery.matches;
        tracker.enabled = caps.cursor;
        if (next !== scale) {
          scale = next;
          renderer.resize(scale, dpr);
        }
        behavior.setViewport(vw, vh, scale);
        lastTransform = '';
      }, 120);
    };

    // Hidden tab → stop the loop outright rather than schedule work per vsync.
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const onMotionChange = () => {
      caps.motion = !motionQuery.matches;
      caps.rare = caps.rare && caps.motion;
      stride = quality.highStride;
    };

    // Off-screen band (display:none, an ancestor hidden, or a print layout) →
    // no reason to simulate at all.
    let observer = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.some((entry) => entry.isIntersecting);
          if (visible) start();
          else stop();
        },
        { threshold: 0 },
      );
      observer.observe(canvas);
    }

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    motionQuery.addEventListener('change', onMotionChange);

    /* ── debug shortcuts ──────────────────────────────────────── */
    const gestureNames = Object.keys(CLIPS);
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (DEBUG_KEYS[key]) behavior.force(DEBUG_KEYS[key]);
      else if (key === 'g') behavior.forceGesture(gestureNames[Math.floor(Math.random() * gestureNames.length)]);
      else if (key === 'q') behavior.forceGesture('startled');
    };
    if (debugMode) {
      window.addEventListener('keydown', onKey);
      window.__pixelCat = { behavior, anim, renderer, tracker, caps, budget, perf: () => measured };
    }

    return () => {
      stop();
      clearTimeout(resizeTimer);
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      window.removeEventListener('keydown', onKey);
      tracker.detach();
      delete window.__pixelCat;
    };
  }, []);

  const debugMode = debugRequested();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed bottom-0 left-0 w-full select-none"
      style={{ height: ART.H * CAT_CONFIG.scale.desktop, zIndex: CAT_CONFIG.zIndex }}
    >
      <canvas
        ref={canvasRef}
        className="absolute bottom-0 left-0"
        style={{ imageRendering: 'pixelated', willChange: 'transform' }}
      />
      {debugMode && (
        <div
          className="pointer-events-auto absolute bottom-2 left-2 rounded border border-brand-primary/60 bg-brand-bg/90 p-2 font-mono text-[10px] leading-relaxed text-brand-accent2"
          style={{ whiteSpace: 'pre' }}
        >
          <div ref={debugRef}>cat debug…</div>
          <div className="mt-1 text-brand-muted">
            keys: i idle · w walk · h hide · p peek · c cursor · o pounce · s sit · z sleep · e exit ·
            r rare · g gesture · q startle
          </div>
        </div>
      )}
    </div>
  );
}
