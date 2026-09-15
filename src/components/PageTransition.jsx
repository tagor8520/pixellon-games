/**
 * PageTransition — CSS-only route transition.
 *
 * This used to be a `framer-motion` component. Because `App.jsx` wrapped every
 * route in `AnimatePresence`, that pulled the whole motion library (~126 KB raw,
 * ~41 KB gzip, plus a per-element measurement loop) onto *every* page of the
 * site — for what is visually just a 300 ms fade-and-lift.
 *
 * The CSS version costs nothing extra: it reuses the `fade-up` keyframe that
 * already exists in `index.css`, animates only `opacity`/`transform` (compositor
 * properties, no layout), and no-ops entirely under `prefers-reduced-motion`.
 *
 * Trade-off, stated honestly: `AnimatePresence mode="wait"` could animate the
 * *exit* as well. Without the library the old page is replaced immediately and
 * only the new one animates in. For a content site that is the right trade —
 * the perceived cost of a 200 ms exit animation is higher than its value, and
 * pages that genuinely need choreography (News, Streams, FreeGames, Profile)
 * still import `framer-motion` themselves, so it loads only where it is used.
 */
export default function PageTransition({ children, className = '' }) {
  return <div className={`animate-fade-up ${className}`}>{children}</div>
}
