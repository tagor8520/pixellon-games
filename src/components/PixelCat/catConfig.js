/**
 * PixelCat — centralized personality & tuning.
 * Every magic number lives here so the cat can be re-tuned without touching logic.
 */

/** Art buffer, in art pixels (1 art px = `scale` CSS px). */
export const ART = {
  W: 48,
  H: 40,
  BASELINE: 37, // ground row: paws rest here, leaving a few px below the viewport edge
};

export const PALETTE = {
  outline: '#0A0F1C',
  base: '#2563EB', // brand primary
  dark: '#1D4ED8',
  light: '#60A5FA', // brand accent
  soft: '#93C5FD',
  ice: '#DBEAFE',
  white: '#F8FAFC',
  ink: '#0B0F17',
};

export const CAT_CONFIG = {
  /* ── presentation ─────────────────────────────────────────── */
  scale: { desktop: 5, tablet: 4, mobile: 3 }, // → 125px / 100px / 75px tall
  breakpoints: { mobile: 640, tablet: 1024 },
  zIndex: 30, // below navbar (z-50) and wiki subnav (z-40)

  /* ── decision timing (ms) ─────────────────────────────────── */
  idleDecisionMin: 3000,
  idleDecisionMax: 12000,
  hiddenMin: 15000,
  hiddenMax: 60000,
  peekLookMin: 2200,
  peekLookMax: 5200,
  cursorInterestMin: 2000,
  cursorInterestMax: 6000,
  gestureGapMin: 900,
  gestureGapMax: 2800,
  sitMin: 4000,
  sitMax: 13000,
  sleepMin: 9000,
  sleepMax: 28000,
  bootDelayMin: 2500,
  bootDelayMax: 9000,

  /* ── movement (CSS px) ────────────────────────────────────── */
  walkSpeedMin: 30,
  walkSpeedMax: 65,
  runSpeed: 210,
  accel: 130, // px/s² — gives natural ramp up / ease down
  edgePad: 28, // stay this far inside the viewport unless exiting
  minWalkDist: 120,
  midWalkStopChance: 0.35,

  /* ── cursor awareness ─────────────────────────────────────── */
  noticeRadius: 300, // px from the cat's eyes
  noticeChance: 0.5, // rolled when the cursor first comes close
  glanceChance: 0.18, // spontaneous look, no cursor proximity needed
  approachChance: 0.3, // walk a little toward the cursor instead of just staring
  pounceChance: 0.14, // while watching — kept rare
  maxPounceDx: 90, // never travel far enough to be in the way
  alertSpeed: 1400, // px/s of cursor movement that startles the cat
  stareBonus: 2200, // extra interest ms when the cursor holds still

  /* ── device budget ────────────────────────────────────────────
     The cat is decorative. It must never be the reason a low-end phone is
     warm, out of battery, or dropping scroll frames. Everything here is a
     ceiling that the runtime lowers further when it measures that the device
     cannot keep up (see PixelCat.jsx `frame` loop).

       stride          draw 1 frame out of N. The simulation is dt-based, so a
                       stride only changes how often we paint, never how fast
                       the cat moves.
       slowFrameMs     measured work per frame above which we add a stride.
       maxSkippedDraws hard ceiling on consecutive skipped canvas draws, so a
                       nearly-static pose can never look frozen.
       skipUnchanged   skip repainting when the quantised pose would produce the
                       same pixels (the renderer snaps to whole art pixels, so
                       this is safe by construction, not an approximation). */
  quality: {
    highStride: 1,
    lowPowerStride: 2,
    slowStride: 2,
    verySlowStride: 3,
    slowFrameMs: 7,
    verySlowFrameMs: 12,
    recoverFrameMs: 4,
    evaluateEveryFrames: 90,
    maxSkippedDraws: 3,
    skipUnchanged: true,
    lowPowerCores: 4,
    lowPowerMemoryGb: 4,
    idleStride: 2, // when the pose is static, double the interval before giving up
  },

  /* ── animation limits (subtle on purpose) ─────────────────── */
  maxHeadTiltDeg: 15,
  headOffsetPx: 2.2, // art px of head travel when looking
  pupilPx: 1.3, // art px → ~4–7 CSS px depending on scale
  walkBobPx: 0.9, // art px → ~3–5 CSS px
  lerp: { head: 0.09, pupil: 0.17, ear: 0.13, body: 0.08, pose: 0.12 },
};

/** Weighted menu for "what should I do next" out of IDLE. */
export const IDLE_WEIGHTS = {
  WALKING: 30,
  GESTURE: 25,
  WATCHING_CURSOR: 15,
  SITTING: 10,
  EXITING: 10, // → HIDDEN → peek back in
  SLEEPING: 5,
  RARE: 5,
};

/** Easter eggs — discovered over time, never on demand. */
export const RARE_WEIGHTS = {
  dash: 30, // sprints across the viewport
  bughunt: 25, // chases an invisible bug
  startled: 20,
  upsideDown: 15, // hangs head-down from the bottom edge
  tailChase: 10,
};

export default CAT_CONFIG;
