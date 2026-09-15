/**
 * SmartImage — every remote image on the site goes through this.
 *
 * What it fixes, in order of impact on a slow device or a metered connection:
 *
 *   1. Bytes. Cards render at ~350–600 CSS px but were downloading 1920 px
 *      originals. We ask each provider's CDN for the size we actually paint
 *      (`?w=`, Twitch's `{width}x{height}` tokens) and emit a `srcset`.
 *   2. Layout shift. Space is reserved with an aspect ratio, so images no longer
 *      push the page around as they arrive (CLS).
 *   3. Main-thread cost. `decoding="async"` + `loading="lazy"` keeps decode work
 *      off the critical path; below-fold images never download at all.
 *   4. Broken sources. Providers hotlink-block, expire URLs and go down. On error
 *      we swap in a local data-URI placeholder instead of a broken icon or a
 *      second network request.
 *   5. Referrer leakage. `referrerPolicy="no-referrer"` stops us handing the
 *      current URL to a third-party CDN on every image.
 *
 * Usage: <SmartImage src={game.image} alt={game.title} ratio="16/10" widths={[320,480,640]} />
 */

import { useMemo, useState } from 'react'

import { isResizable, variantUrl } from '../utils/imageVariants.js'

const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40"><rect width="64" height="40" fill="#151A24"/><path d="M0 40l18-14 12 9 10-7 24 12z" fill="#1E2638"/><circle cx="46" cy="12" r="5" fill="#2563EB" opacity="0.55"/></svg>',
  )

export default function SmartImage({
  src,
  alt = '',
  ratio,
  widths = [320, 480, 640, 960],
  sizes = '(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 380px',
  className = '',
  priority = false,
  objectFit = 'cover',
  fallback = PLACEHOLDER,
  onLoad,
}) {
  const [failed, setFailed] = useState(false)

  const { srcSet, resolvedSrc } = useMemo(() => {
    if (!src) return { srcSet: undefined, resolvedSrc: fallback }
    if (!isResizable(src)) return { srcSet: undefined, resolvedSrc: src }
    const set = widths.map((width) => `${variantUrl(src, width)} ${width}w`).join(', ')
    return { srcSet: set, resolvedSrc: variantUrl(src, widths[Math.min(1, widths.length - 1)]) }
  }, [src, widths, fallback])

  const style = ratio ? { aspectRatio: ratio.replace('/', ' / ') } : undefined

  return (
    <img
      src={failed ? fallback : resolvedSrc}
      srcSet={failed ? undefined : srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      className={className}
      style={{ ...style, objectFit }}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      onLoad={() => onLoad?.()}
    />
  )
}
