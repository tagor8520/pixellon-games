/**
 * Bounding-box helpers for 1×1 chunk tiling.
 * Keep geometries in degrees; conversion to metres happens in scale.js.
 */

export function bboxFromCenter(lat, lon, sizeDeg = 0.01) {
  const half = sizeDeg / 2
  return {
    south: lat - half,
    north: lat + half,
    west: lon - half,
    east: lon + half,
    size: sizeDeg,
    center: { lat, lon },
  }
}

export function bboxToString(b) {
  return `${b.south},${b.west},${b.north},${b.east}`
}

export function bboxContains(b, lat, lon) {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east
}

export function neighborBbox(centerLat, centerLon, sizeDeg, dir) {
  // dir: 'n','s','e','w','ne','nw','se','sw'
  const dLat = sizeDeg
  const dLon = sizeDeg // approx; longitudinal scale handled in metres later
  let lat = centerLat
  let lon = centerLon
  if (dir.includes('n')) lat += dLat
  if (dir.includes('s')) lat -= dLat
  if (dir.includes('e')) lon += dLon
  if (dir.includes('w')) lon -= dLon
  return bboxFromCenter(lat, lon, sizeDeg)
}

export const DIRECTIONS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function chunkKey(lat, lon, sizeDeg = 0.01) {
  // quantize to grid to ensure stable keys
  const latIdx = Math.floor(lat / sizeDeg)
  const lonIdx = Math.floor(lon / sizeDeg)
  return `${latIdx}_${lonIdx}`
}
