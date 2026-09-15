/**
 * Overpass fetch with lightweight projection, mirror fallback and sample fallback.
 * Must work with zero env keys (free APIs only).
 */

import { bboxFromCenter } from './bbox.js'

const PRIMARY = 'https://overpass-api.de/api/interpreter'
const MIRROR = 'https://overpass.kumi.systems/api/interpreter'

function buildQL(bbox) {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `[out:json][timeout:25];(way["building"](${b});way["highway"](${b});relation["building"](${b}););out geom;`
}

function projectElements(json, cap = 4000) {
  const els = Array.isArray(json?.elements) ? json.elements : []
  const capped = els.slice(0, cap)
  return {
    count: capped.length,
    total: els.length,
    truncated: els.length > capped.length,
    elements: capped.map((el) => {
      const out = { type: el.type, id: el.id }
      if (el.tags) {
        const t = {}
        if (el.tags.building) t.building = String(el.tags.building).slice(0, 32)
        if (el.tags.highway) t.highway = String(el.tags.highway).slice(0, 32)
        if (el.tags['building:levels']) t['building:levels'] = String(el.tags['building:levels']).slice(0, 4)
        if (el.tags.name) t.name = String(el.tags.name).slice(0, 80)
        if (Object.keys(t).length) out.tags = t
      }
      if (Array.isArray(el.geometry)) {
        out.geometry = el.geometry.map((pt) => ({
          lat: Number(Number(pt.lat).toFixed(7)),
          lon: Number(Number(pt.lon).toFixed(7)),
        }))
      }
      if (el.bounds) out.bounds = el.bounds
      return out
    }),
  }
}

export async function fetchViaOverpass(bbox, { signal } = {}) {
  const ql = buildQL(bbox)
  const body = `data=${encodeURIComponent(ql)}`
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  }
  // try primary then mirror
  try {
    const r = await fetch(PRIMARY, opts)
    if (!r.ok) throw new Error(`overpass primary ${r.status}`)
    const j = await r.json()
    return { bbox, source: 'overpass', ...projectElements(j) }
  } catch (e) {
    // mirror fallback
    const r2 = await fetch(MIRROR, opts)
    if (!r2.ok) throw new Error(`overpass mirror ${r2.status}: ${e?.message}`)
    const j2 = await r2.json()
    return { bbox, source: 'overpass-mirror', ...projectElements(j2) }
  }
}

export async function fetchViaProxy(lat, lon, size, { signal } = {}) {
  const u = `/api/osm/chunk?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&size=${encodeURIComponent(size)}`
  const r = await fetch(u, { signal })
  if (!r.ok) throw new Error(`proxy ${r.status}`)
  const j = await r.json()
  return j
}

export async function fetchOSMChunk({ lat, lon, size = 0.01 }, { signal } = {}) {
  const bbox = bboxFromCenter(lat, lon, size)
  // strategy: try direct Overpass first (no server load), fallback to proxy, fallback to sample
  try {
    const direct = await fetchViaOverpass(bbox, { signal })
    if (direct.elements && direct.elements.length > 0) return direct
    // empty but successful -> try proxy (might have cached richer)
    try {
      const prox = await fetchViaProxy(lat, lon, size, { signal })
      if (prox.elements?.length) return prox
    } catch (_) {}
    return direct
  } catch (errDirect) {
    try {
      const prox = await fetchViaProxy(lat, lon, size, { signal })
      return prox
    } catch (errProxy) {
      // sample fallback: keep UX working offline / rate-limited
      // eslint-disable-next-line no-console
      console.warn('[osm] overpass + proxy failed, serving sample', errDirect?.message, errProxy?.message)
      const sample = await import('./sampleOSM.json')
      const s = sample.default || sample
      // re-center sample to requested bbox to keep world consistent visually
      // we keep geometry as sample (small neighborhood feel)
      return { ...s, bbox, source: 'sample-fallback', _fallbackError: String(errDirect?.message || errProxy?.message) }
    }
  }
}

// Helpers for the UI layer

export function classifyElements(elements = []) {
  const buildings = []
  const roads = []
  for (const el of elements) {
    if (el.tags?.building) buildings.push(el)
    else if (el.tags?.highway) roads.push(el)
    else if (el.type === 'way' && el.geometry && el.tags?.highway) roads.push(el)
  }
  return { buildings, roads }
}
