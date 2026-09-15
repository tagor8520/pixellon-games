/**
 * Provider-aware image URL resizing.
 *
 * Kept out of the component file on purpose: SmartImage is a component module
 * (fast refresh only works when a module exports components), and this is a pure
 * helper that deserves its own tests.
 *
 * Rule: only rewrite hosts whose sizing API we actually know. Anything else is
 * passed through untouched — a wrong query string is a broken image.
 */

export const RESIZABLE_HOSTS = /images\.unsplash\.com|media\.rawg\.io|static-cdn\.jtvnw\.net/

export function variantUrl(url, width) {
  if (!url || !width) return url
  try {
    if (/images\.unsplash\.com/.test(url)) {
      return `${url}${url.includes('?') ? '&' : '?'}w=${width}&q=70&auto=format`
    }
    if (/media\.rawg\.io/.test(url)) {
      return `${url}${url.includes('?') ? '&' : '?'}w=${width}&q=70`
    }
    if (/static-cdn\.jtvnw\.net/.test(url)) {
      const height = Math.round((width * 9) / 16)
      return url.replace('{width}', String(width)).replace('{height}', String(height))
    }
    return url
  } catch {
    return url
  }
}

export const isResizable = (url = '') => RESIZABLE_HOSTS.test(url)

export default variantUrl
