/**
 * ChunkManager — LRU grid of 1×1 world chunks with background prefetch.
 * Budget: max 9 chunks (player + 8 neighbours). Evict farthest when over.
 */

import { chunkKey, DIRECTIONS, neighborBbox } from './bbox.js'

export class ChunkManager {
  constructor({ sizeDeg = 0.01, maxChunks = 9 } = {}) {
    this.sizeDeg = sizeDeg
    this.maxChunks = maxChunks
    this.chunks = new Map() // key -> { bbox, group, lat, lon, loadedAt }
    this.pending = new Set() // keys currently fetching
  }

  has(lat, lon) {
    return this.chunks.has(chunkKey(lat, lon, this.sizeDeg)) || this.pending.has(chunkKey(lat, lon, this.sizeDeg))
  }

  getKey(lat, lon) {
    return chunkKey(lat, lon, this.sizeDeg)
  }

  keys() {
    return [...this.chunks.keys()]
  }

  size() {
    return this.chunks.size
  }

  getNeighbors(lat, lon) {
    return DIRECTIONS.map((dir) => {
      const b = neighborBbox(lat, lon, this.sizeDeg, dir)
      return { dir, bbox: b, key: chunkKey(b.center.lat, b.center.lon, this.sizeDeg) }
    })
  }

  add(lat, lon, bbox, group) {
    const key = chunkKey(lat, lon, this.sizeDeg)
    this.chunks.set(key, { lat, lon, bbox, group, loadedAt: Date.now() })
    this.pending.delete(key)
  }

  markPending(lat, lon) {
    this.pending.add(chunkKey(lat, lon, this.sizeDeg))
  }

  unmarkPending(lat, lon) {
    this.pending.delete(chunkKey(lat, lon, this.sizeDeg))
  }

  isPending(lat, lon) {
    return this.pending.has(chunkKey(lat, lon, this.sizeDeg))
  }

  // evict LRU farthest from playerPos (meters)
  evictIfNeeded(playerMeters, dispose) {
    if (this.chunks.size <= this.maxChunks) return []
    const entries = [...this.chunks.entries()]
    // sort by distance to player
    entries.sort((a, b) => {
      const da = dist2(a[1].group.userData.centreMeters, playerMeters)
      const db = dist2(b[1].group.userData.centreMeters, playerMeters)
      return db - da // farthest first
    })
    const evicted = []
    while (this.chunks.size > this.maxChunks) {
      const [key, rec] = entries.shift()
      // never evict the chunk player is currently inside if possible
      // keep at least 1 chunk
      if (this.chunks.size <= 1) break
      this.chunks.delete(key)
      if (dispose && rec.group) dispose(rec.group)
      evicted.push(key)
    }
    return evicted
  }

  getAllGroups() {
    return [...this.chunks.values()].map((r) => r.group)
  }

  clear(dispose) {
    for (const rec of this.chunks.values()) if (dispose && rec.group) dispose(rec.group)
    this.chunks.clear()
    this.pending.clear()
  }
}

function dist2(a, b) {
  if (!a || !b) return Infinity
  const dx = a.x - b.x
  const dz = a.z - b.z
  return dx * dx + dz * dz
}
