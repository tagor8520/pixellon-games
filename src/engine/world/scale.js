/**
 * WGS84 → local metres (equirectangular) at 1:10 scale.
 * Accurate enough for <5km extents; far cheaper than proj4.
 */

const R = 6378137
export const SCALE = 0.1 // 1:10

export function latLonToMeters(lat, lon, originLat, originLon) {
  const dLat = (lat - originLat) * (Math.PI / 180)
  const dLon = (lon - originLon) * (Math.PI / 180)
  const x = dLon * R * Math.cos((originLat * Math.PI) / 180)
  const z = dLat * R
  return { x: x * SCALE, z: z * SCALE }
}

export function metersToLatLon(xScaled, zScaled, originLat, originLon) {
  const x = xScaled / SCALE
  const z = zScaled / SCALE
  const dLat = z / R
  const dLon = x / (R * Math.cos((originLat * Math.PI) / 180))
  return {
    lat: originLat + (dLat * 180) / Math.PI,
    lon: originLon + (dLon * 180) / Math.PI,
  }
}

export function chunkWorldSize(sizeDeg, originLat) {
  const bHalf = sizeDeg / 2
  // width in metres real, then scaled
  const lat0 = originLat
  const widthReal = ((bHalf * 2 * Math.PI) / 180) * R * Math.cos((lat0 * Math.PI) / 180)
  const heightReal = ((bHalf * 2 * Math.PI) / 180) * R
  return { width: widthReal * SCALE, height: heightReal * SCALE }
}

// seeded pseudo-random height from id (stable across reloads)
export function seededHeight(id, levels) {
  if (levels) {
    const n = parseInt(String(levels), 10)
    if (!Number.isNaN(n) && n > 0 && n < 30) return n * 3 * SCALE // 3m per level
  }
  // hash id → 0..1
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const t = (h % 1000) / 1000
  // 8m..28m real
  const real = 8 + t * 20
  return real * SCALE
}

// friendly colour bucket by height (scaled)
export function heightColor(hScaled) {
  // Mapbox-like pastel palette, vertex colors
  const h = hScaled / SCALE // back to real
  if (h < 10) return [0.78, 0.83, 0.88] // light grey
  if (h < 16) return [0.82, 0.78, 0.71] // sand
  if (h < 22) return [0.72, 0.78, 0.84] // blue-grey
  return [0.66, 0.72, 0.82]
}

export function roadWidth(highway) {
  // real widths → scaled
  const map = {
    motorway: 10,
    trunk: 9,
    primary: 8,
    secondary: 7,
    tertiary: 6,
    residential: 5,
    unclassified: 5,
    service: 3.5,
    living_street: 4,
    pedestrian: 4,
    footway: 1.5,
    path: 1.2,
  }
  const w = map[highway] || 5
  return w * SCALE
}

export function roadColor(highway) {
  if (['motorway', 'trunk'].includes(highway)) return [0.95, 0.32, 0.32]
  if (['primary', 'secondary'].includes(highway)) return [0.96, 0.75, 0.22]
  if (['tertiary', 'residential', 'unclassified'].includes(highway)) return [0.42, 0.45, 0.52]
  if (['service', 'living_street'].includes(highway)) return [0.62, 0.62, 0.62]
  return [0.55, 0.55, 0.55]
}
