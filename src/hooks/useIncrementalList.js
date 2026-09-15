import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * useIncrementalList — render lists in windows instead of all at once.
 *
 * This is the "larger maps" fix on the client. A catalog page that maps 5 000
 * games to DOM nodes costs ~5 000 React elements, ~5 000 image requests and a
 * main-thread stall on every filter change — fatal on a low-end phone.
 *
 * Windowing keeps the initial render bounded (default 24 rows), mounts more
 * only when the user asks (button) or approaches the bottom (IntersectionObserver),
 * and resets cleanly when the filter/source changes.
 *
 * Why not a full virtualiser? Grid cards have variable heights and the pages are
 * CSS-grid based: measuring and repositioning thousands of tiles costs more
 * main-thread time than it saves here. Incremental mounting plus
 * `content-visibility: auto` (see index.css) gets most of the win with none of
 * the scroll-anchoring bugs.
 */
export default function useIncrementalList(items, { pageSize = 24, auto = true, autoMargin = '600px' } = {}) {
  const list = useMemo(() => items || [], [items])
  const sentinelRef = useRef(null)

  // Resetting the window when the dataset changes is *derived* state, so it
  // happens during render (React's documented pattern) rather than in an effect:
  // no wasted render pass, no cascading update, and the first paint of a new
  // filter is already correct.
  const [window, setWindow] = useState({ list, count: pageSize })
  if (window.list !== list) {
    window.list = list
    window.count = pageSize
  }

  const hasMore = window.count < list.length
  const visible = useMemo(
    () => (hasMore ? list.slice(0, window.count) : list),
    [list, window.count, hasMore],
  )
  const loadMore = useCallback(() => setWindow((prev) => ({ ...prev, count: prev.count + pageSize })), [pageSize])

  useEffect(() => {
    if (!auto || !hasMore) return undefined
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: autoMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [auto, hasMore, loadMore, autoMargin])

  return {
    visible,
    total: list.length,
    remaining: Math.max(0, list.length - visible.length),
    hasMore,
    loadMore,
    sentinelRef,
  }
}
