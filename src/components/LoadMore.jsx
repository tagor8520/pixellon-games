/**
 * LoadMore — the sentinel + button for `useIncrementalList`.
 *
 * The button is the accessible path (keyboard, screen readers, reduced-data
 * users); the sentinel is what most users actually trigger by scrolling. Both
 * are cheap: the sentinel is an invisible 1px div, and once everything is
 * mounted the whole component disappears.
 */
export default function LoadMore({ sentinelRef, remaining = 0, onLoadMore, label = 'Load more' }) {
  if (remaining <= 0) return null

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
      <button
        type="button"
        onClick={onLoadMore}
        className="rounded-xl border border-[#1E2638] bg-[#0B0F17] px-5 py-2.5 text-xs font-mono font-bold text-brand-text transition-all hover:border-brand-accent/50 hover:bg-[#10151F] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/60"
      >
        {label} · {remaining} left
      </button>
      <p className="text-[11px] font-mono text-brand-muted">
        Rendering in windows keeps this page light on low-end devices.
      </p>
    </div>
  )
}
