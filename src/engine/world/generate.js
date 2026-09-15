/**
 * Procedural generation from OSM data — runs in browser.
 * Pipeline: roads first → buildings next, all at 1:10 scale.
 * Optimizations: merged road geometry, instanced buildings, no textures, DPR capped.
 */

import * as THREE from 'three'
import { latLonToMeters, seededHeight, heightColor, roadWidth, roadColor, SCALE } from './scale.js'

// Tunables for mobile budget
export const MAX_BUILDINGS_PER_CHUNK = 320
export const MAX_ROADS_PER_CHUNK = 180
export const ROAD_SEGMENT_SIMPLIFY = 1 // keep every N points (1 = all)

/**
 * Build a chunk Group containing ground + roads + buildings
 * @param {object} opts
 * @param {object} opts.bbox - {south,west,north,east,center}
 * @param {Array} opts.elements - projected Overpass elements
 * @param {object} opts.origin - {lat, lon} global origin for metre conversion
 * @param {THREE.Vector2} opts.chunkOffset - world offset (metres scaled) for this chunk centre relative to origin
 * @param {boolean} opts.lowEnd - true reduces detail
 */
export function generateChunk({ bbox, elements, origin, lowEnd = false }) {
  const group = new THREE.Group()
  const centerLat = bbox.center.lat
  const centerLon = bbox.center.lon

  // Derived scaled size
  const widthDeg = bbox.east - bbox.west
  const heightDeg = bbox.north - bbox.south
  const widthM = (widthDeg * Math.PI / 180) * 6378137 * Math.cos((origin.lat * Math.PI) / 180) * SCALE
  const heightM = (heightDeg * Math.PI / 180) * 6378137 * SCALE

  // Classify
  const roads = []
  const buildings = []
  for (const el of elements) {
    if (el.tags?.building) buildings.push(el)
    else if (el.tags?.highway) roads.push(el)
  }

  // —— 1. Ground (single plane) — roads first, ground provides base
  const groundGeo = new THREE.PlaneGeometry(Math.abs(widthM), Math.abs(heightM))
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x151a24 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = false
  ground.userData.kind = 'ground'
  // Position ground at chunk centre
  const centreMeters = latLonToMeters(centerLat, centerLon, origin.lat, origin.lon)
  ground.position.set(centreMeters.x, 0, centreMeters.z)
  group.add(ground)

  // subtle grid overlay via second plane with transparent?
  // keep 1 draw call; we skip for perf

  // —— 2. ROADS FIRST (merged into one BufferGeometry)
  const roadLines = buildRoadLines({ roads, origin, lowEnd })
  if (roadLines) {
    // Position relative to group? We already offset per point, but we placed ground with absolute pos
    // roadLines is world-absolute; attach directly
    group.add(roadLines.group)
  }

  // —— 3. BUILDINGS (instanced)
  const buildingMeshes = buildBuildings({ buildings, origin, lowEnd, maxCount: lowEnd ? 150 : MAX_BUILDINGS_PER_CHUNK })
  for (const m of buildingMeshes) group.add(m.mesh)

  // metadata for chunk manager / HUD
  group.userData = {
    kind: 'chunk',
    bbox,
    buildingsCount: buildingMeshes.reduce((a, b) => a + b.count, 0),
    roadsCount: Math.min(roads.length, lowEnd ? 80 : MAX_ROADS_PER_CHUNK),
    truncated: elements.length >= 4000 || buildings.length > MAX_BUILDINGS_PER_CHUNK || roads.length > MAX_ROADS_PER_CHUNK,
    centreMeters,
    size: { width: Math.abs(widthM), height: Math.abs(heightM) },
  }

  // compute bounding box for frustum / edge detection (world space)
  group.userData.aabb = new THREE.Box3().setFromObject(group, true)

  return group
}

function buildRoadLines({ roads, origin, lowEnd }) {
  const cap = lowEnd ? 80 : MAX_ROADS_PER_CHUNK
  const slice = roads.slice(0, cap)
  if (!slice.length) return null

  const positions = []
  const colors = []

  for (const way of slice) {
    const geom = way.geometry
    if (!geom || geom.length < 2) continue
    const hw = way.tags.highway
    const col = roadColor(hw)
    // For each segment in way, push line strip
    for (let i = 0; i < geom.length - 1; i++) {
      if (ROAD_SEGMENT_SIMPLIFY > 1 && i % ROAD_SEGMENT_SIMPLIFY !== 0) continue
      const a = latLonToMeters(geom[i].lat, geom[i].lon, origin.lat, origin.lon)
      const b = latLonToMeters(geom[i + 1].lat, geom[i + 1].lon, origin.lat, origin.lon)
      positions.push(a.x, 0.02, a.z, b.x, 0.02, b.z)
      colors.push(col[0], col[1], col[2], col[0], col[1], col[2])
    }
  }
  if (!positions.length) return null

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  // use vertex colors to keep single material
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 1 /* ignored in most GL */ })
  const lines = new THREE.LineSegments(geo, mat)
  lines.frustumCulled = true
  // wider feel via later upgrade to MeshLine without new draw calls would be second pass
  const grp = new THREE.Group()
  grp.add(lines)

  // Optional: road “caps” as thin boxes for major highways (still merged if needed)
  // For now keep to LineSegments for lowest cost (1 draw)
  return { group: grp, count: slice.length }
}

function buildBuildings({ buildings, origin, lowEnd, maxCount }) {
  // sort by footprint area descending so large buildings survive culling when capped
  const scored = buildings.map((b) => {
    const geom = b.geometry
    if (!geom || geom.length < 3) return { el: b, area: 0, w: 0, d: 0, cx: 0, cz: 0 }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    let sumX = 0, sumZ = 0
    for (const pt of geom) {
      const m = latLonToMeters(pt.lat, pt.lon, origin.lat, origin.lon)
      minX = Math.min(minX, m.x); maxX = Math.max(maxX, m.x)
      minZ = Math.min(minZ, m.z); maxZ = Math.max(maxZ, m.z)
      sumX += m.x; sumZ += m.z
    }
    const w = Math.max(1.5 * SCALE, maxX - minX)
    const d = Math.max(1.5 * SCALE, maxZ - minZ)
    const area = w * d
    return { el: b, area, w, d, cx: sumX / geom.length, cz: sumZ / geom.length }
  })
  scored.sort((a, b) => b.area - a.area)
  const kept = scored.slice(0, maxCount).filter(s => s.area > 0.2) // filter tiny slivers

  if (!kept.length) {
    // rural fallback: sprinkle a few procedural “trees” as cones so chunk not empty
    return buildFoliageFallback({ origin, count: lowEnd ? 12 : 24 })
  }

  // bucket by height to allow 3 instanced meshes (reduces shader switches)
  const buckets = { low: [], mid: [], high: [] }
  for (const s of kept) {
    const h = seededHeight(s.el.id, s.el.tags?.['building:levels'])
    if (h < 1.0) buckets.low.push({ ...s, h })
    else if (h < 1.9) buckets.mid.push({ ...s, h })
    else buckets.high.push({ ...s, h })
  }

  const out = []
  for (const [key, arr] of Object.entries(buckets)) {
    if (!arr.length) continue
    const mesh = makeInstancedBuildingBatch(arr)
    mesh.userData.kind = `buildings-${key}`
    out.push({ mesh, count: arr.length })
  }
  return out
}

function makeInstancedBuildingBatch(items) {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  // translate so base sits on ground: Box is centered, we want y = h/2
  // we handle via matrix translation y = h/2
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false })
  // We'll use per-instance color via instanceColor attribute
  const count = items.length
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = true

  const dummy = new THREE.Object3D()
  const color = new THREE.Color()

  for (let i = 0; i < count; i++) {
    const it = items[i]
    const h = it.h
    const w = it.w
    const d = it.d
    // box is unit; scale to footprint, height h
    dummy.position.set(it.cx, h / 2 + 0.01, it.cz)
    dummy.scale.set(w, h, d)
    // keep rotation 0 for faithful X/Y per spec; tiny jitter for visual variance except strict
    dummy.rotation.y = 0
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    const c = heightColor(h)
    color.setRGB(c[0], c[1], c[2])
    mesh.setColorAt(i, color)
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.instanceMatrix.needsUpdate = true
  // fix material to respect instanceColor
  mesh.material.vertexColors = false
  // Three will use instanceColor automatically when setColorAt called

  // lightweight outline: not added to keep draw calls low

  return mesh
}

function buildFoliageFallback({ origin, count }) {
  // simple cone instancing for rural emptiness
  const geo = new THREE.ConeGeometry(0.6 * SCALE * 10, 2, 6) // scaled up visibly
  // Actually 0.6*scale*10 = ~0.6 ingame? keep moderate
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a7d44 })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  const dummy = new THREE.Object3D()
  const spread = 40 * SCALE * 10 // ~40m ingame
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5
    const r = 5 + Math.random() * spread
    dummy.position.set(Math.cos(ang) * r, 0.5, Math.sin(ang) * r)
    dummy.scale.set(1, 0.8 + Math.random() * 0.7, 1)
    dummy.rotation.y = Math.random() * Math.PI
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.userData.kind = 'foliage'
  return [{ mesh, count }]
}

export function disposeChunk(group) {
  group.traverse((obj) => {
    if (obj.isMesh || obj.isLine || obj.isLineSegments) {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
        else obj.material.dispose()
      }
    }
    if (obj.isInstancedMesh) {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    }
  })
}
