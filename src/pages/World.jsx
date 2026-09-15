import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import PageTransition from '../components/PageTransition'
import { PixelPatternBg } from '../components/BrandDecorations'

const PRESETS = [
  { label: 'Tokyo · Shibuya', lat: 35.659, lon: 139.7005, emoji: '🗼' },
  { label: 'New York · Manhattan', lat: 40.758, lon: -73.9855, emoji: '🗽' },
  { label: 'London · Westminster', lat: 51.4995, lon: -0.1248, emoji: '🇬🇧' },
  { label: 'Paris · Louvre', lat: 48.8606, lon: 2.3376, emoji: '🇫🇷' },
  { label: 'Berlin · Mitte', lat: 52.52, lon: 13.405, emoji: '🇩🇪' },
  { label: 'San Francisco', lat: 37.7749, lon: -122.4194, emoji: '🌉' },
]

function isLowEndDevice() {
  if (typeof navigator === 'undefined') return false
  const mem = navigator.deviceMemory || 4
  const cores = navigator.hardwareConcurrency || 4
  const saveData = navigator.connection?.saveData
  const slow = navigator.connection?.effectiveType === '2g' || navigator.connection?.effectiveType === 'slow-2g'
  return mem <= 3 || cores <= 4 || !!saveData || slow
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const check = () => {
      const touch = 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0
      const coarse = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false
      const narrow = window.innerWidth < 1024
      setIsMobile(touch || coarse || narrow)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  return isMobile
}

export default function World() {
  const [coords, setCoords] = useState({ lat: '35.659', lon: '139.7005' })
  const [sizeDeg, setSizeDeg] = useState(0.01)
  const [active, setActive] = useState(null) // {lat, lon, size}
  const [status, setStatus] = useState('idle') // idle | loading | ready | error
  const [stats, setStats] = useState({ chunks: 0, buildings: 0, roads: 0, fps: 0, pending: 0 })
  const [hudNote, setHudNote] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isFpv, setIsFpv] = useState(false)
  const isFpvRef = useRef(false)
  const isMobile = useIsMobile()
  const canvasRef = useRef(null)
  const engineRef = useRef(null)
  const lowEnd = useRef(typeof navigator === 'undefined' ? false : isLowEndDevice())

  // joystick state (flexible touch joystick)
  const joyMoveRef = useRef({ x: 0, y: 0 })
  const joyBaseRef = useRef(null)
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 })
  const joyActiveRef = useRef(false)
  const actionRef = useRef({ up: false, down: false, sprint: false })

  // keep ref in sync
  useEffect(() => { isFpvRef.current = isFpv }, [isFpv])

  const startAt = useCallback((lat, lon, size = sizeDeg) => {
    const nlat = Number(lat), nlon = Number(lon)
    if (!Number.isFinite(nlat) || !Number.isFinite(nlon)) {
      setErrorMsg('Enter valid latitude and longitude')
      return
    }
    if (nlat < -85 || nlat > 85 || nlon < -180 || nlon > 180) {
      setErrorMsg('Coordinates out of range')
      return
    }
    setErrorMsg('')
    setActive({ lat: nlat, lon: nlon, size })
    setStatus('loading')
    setHudNote('Downloading map slice → generating roads…')
  }, [sizeDeg])

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setErrorMsg('Geolocation not available'); return }
    setHudNote('Locating you…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords
        setCoords({ lat: String(latitude.toFixed(5)), lon: String(longitude.toFixed(5)) })
        startAt(latitude, longitude)
      },
      (err) => setErrorMsg(err.message || 'Could not get location'),
      { enableHighAccuracy: false, timeout: 8000 }
    )
  }

  // joystick handlers (flexible, appears on left side)
  const handleJoyStart = useCallback((e) => {
    if (!joyBaseRef.current) return
    joyActiveRef.current = true
    if (e.cancelable) e.preventDefault()
    const rect = joyBaseRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const p = e.touches ? e.touches[0] : e
    let dx = p.clientX - cx
    let dy = p.clientY - cy
    const max = rect.width / 2 - 16
    const dist = Math.hypot(dx, dy)
    if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max }
    setJoyPos({ x: dx, y: dy })
    joyMoveRef.current = { x: dx / max, y: -dy / max }
  }, [])

  const handleJoyMove = useCallback((e) => {
    if (!joyActiveRef.current || !joyBaseRef.current) return
    if (e.cancelable) e.preventDefault()
    const rect = joyBaseRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const p = e.touches ? e.touches[0] : e
    let dx = p.clientX - cx
    let dy = p.clientY - cy
    const max = rect.width / 2 - 16
    const dist = Math.hypot(dx, dy)
    if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max }
    setJoyPos({ x: dx, y: dy })
    joyMoveRef.current = { x: dx / max, y: -dy / max }
  }, [])

  const handleJoyEnd = useCallback(() => {
    joyActiveRef.current = false
    setJoyPos({ x: 0, y: 0 })
    joyMoveRef.current = { x: 0, y: 0 }
  }, [])

  // —— Three engine lifecycle ——
  useEffect(() => {
    if (!active || !canvasRef.current) return
    let cancelled = false
    let raf = 0
    let renderer, scene, camera, controls, chunkManager, origin, worldGroup
    let lastFrame = performance.now()
    let frameCount = 0
    let fpsAccum = 0
    let keys = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false }

    const onKey = (e, down) => {
      const k = e.key.toLowerCase()
      if (k in keys) keys[k] = down
      if (k === 'shift') keys.shift = down
      if (down && ['w', 'a', 's', 'd'].includes(k)) e.preventDefault()
    }
    const keyDown = (e) => onKey(e, true)
    const keyUp = (e) => onKey(e, false)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)

    const onResize = () => {
      if (!renderer || !camera || !canvasRef.current) return
      const w = canvasRef.current.clientWidth
      const h = canvasRef.current.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }

    async function init() {
      // dynamic imports — keeps Home bundle free of three
      const THREE = await import('three')
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js')
      const { bboxFromCenter } = await import('../engine/world/bbox.js')
      const { fetchOSMChunk } = await import('../engine/world/osm.js')
      const { generateChunk, disposeChunk } = await import('../engine/world/generate.js')
      const { ChunkManager } = await import('../engine/world/chunkManager.js')
      const { latLonToMeters } = await import('../engine/world/scale.js')

      if (cancelled || !canvasRef.current) return

      const canvas = canvasRef.current
      const dpr = Math.min(window.devicePixelRatio || 1, lowEnd.current ? 1 : 1.5)
      const antialias = !lowEnd.current

      renderer = new THREE.WebGLRenderer({ canvas, antialias, powerPreference: lowEnd.current ? 'low-power' : 'high-performance', alpha: false })
      renderer.setPixelRatio(dpr)
      renderer.setClearColor(0x0b0f17, 1)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      if (!lowEnd.current) {
        renderer.shadowMap.enabled = false
      }

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      renderer.setSize(width, height, false)

      scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0b0f17)
      scene.fog = new THREE.Fog(0x0b0f17, 90, 320)

      camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 800)
      camera.position.set(14, 18, 14)

      controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true
      controls.dampingFactor = 0.06
      controls.minDistance = 4
      controls.maxDistance = 180
      controls.maxPolarAngle = Math.PI / 2 - 0.06
      controls.target.set(0, 0, 0)
      controls.update()

      // Lights
      scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x1a2332, 1.0))
      const dir = new THREE.DirectionalLight(0xffffff, 0.9)
      dir.position.set(40, 60, 30)
      scene.add(dir)
      scene.add(new THREE.AmbientLight(0xffffff, 0.35))

      // Origin is first chunk centre
      origin = { lat: active.lat, lon: active.lon }
      chunkManager = new ChunkManager({ sizeDeg: active.size, maxChunks: 9 })
      worldGroup = new THREE.Group()
      scene.add(worldGroup)

      // helper grid (subtle)
      const grid = new THREE.GridHelper(400, 40, 0x1e2638, 0x1e2638)
      grid.position.y = 0.01
      grid.material.opacity = 0.35
      grid.material.transparent = true
      worldGroup.add(grid)

      let playerMeters = { x: 0, z: 0 }

      async function loadChunk(lat, lon) {
        const key = chunkManager.getKey(lat, lon)
        if (chunkManager.chunks.has(key) || chunkManager.isPending(lat, lon)) return
        chunkManager.markPending(lat, lon)
        try {
          const bbox = bboxFromCenter(lat, lon, active.size)
          const data = await fetchOSMChunk({ lat, lon, size: active.size })
          if (cancelled) return
          const chunkGroup = generateChunk({ bbox: data.bbox || bbox, elements: data.elements || [], origin, lowEnd: lowEnd.current })
          worldGroup.add(chunkGroup)
          chunkManager.add(lat, lon, bbox, chunkGroup)
          if (chunkManager.size() === 1) {
            const c = chunkGroup.userData.centreMeters
            // respect current FPV mode on first place
            if (isFpvRef.current) {
              camera.position.set(c.x, 2.2, c.z + 0.5)
              controls.target.set(c.x, 1.6, c.z + 8)
              controls.minDistance = 0.5
              controls.maxDistance = 12
              controls.maxPolarAngle = Math.PI / 1.9
            } else {
              controls.target.set(c.x, 0, c.z)
              camera.position.set(c.x + 16, 18, c.z + 16)
            }
            controls.update()
            setHudNote(data.source === 'sample-fallback' ? 'Offline demo — showing sample neighbourhood (Overpass unreachable)' : `Loaded ${data.elements.length} elements • ${chunkGroup.userData.buildingsCount} buildings • ${chunkGroup.userData.roadsCount} roads`)
            setTimeout(() => setHudNote(''), data.source === 'sample-fallback' ? 5000 : 2800)
          }
          setStats((s) => ({
            ...s,
            chunks: chunkManager.size(),
            buildings: [...chunkManager.chunks.values()].reduce((a, r) => a + (r.group.userData.buildingsCount || 0), 0),
            roads: [...chunkManager.chunks.values()].reduce((a, r) => a + (r.group.userData.roadsCount || 0), 0),
            pending: chunkManager.pending.size,
          }))
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('chunk load failed', e)
          setHudNote(`Chunk ${lat.toFixed(4)},${lon.toFixed(4)} failed — retrying`)
        } finally {
          chunkManager.unmarkPending(lat, lon)
        }
      }

      await loadChunk(active.lat, active.lon)
      if (cancelled) return
      setStatus('ready')

      function maybePrefetch() {
        if (!chunkManager || chunkManager.size() === 0) return
        let nearest = null, nearestDist = Infinity
        for (const rec of chunkManager.chunks.values()) {
          const c = rec.group.userData.centreMeters
          const d = (c.x - playerMeters.x) ** 2 + (c.z - playerMeters.z) ** 2
          if (d < nearestDist) { nearestDist = d; nearest = rec }
        }
        if (!nearest) return
        const halfW = nearest.group.userData.size.width / 2
        const halfH = nearest.group.userData.size.height / 2
        const localX = playerMeters.x - nearest.group.userData.centreMeters.x
        const localZ = playerMeters.z - nearest.group.userData.centreMeters.z
        const edgeDistX = halfW - Math.abs(localX)
        const edgeDistZ = halfH - Math.abs(localZ)
        const edgeDist = Math.min(edgeDistX, edgeDistZ)
        const threshold = Math.min(halfW, halfH) * 0.32
        if (edgeDist < threshold) {
          const neighbours = chunkManager.getNeighbors(nearest.bbox.center.lat, nearest.bbox.center.lon)
          for (const n of neighbours) {
            const isRelevant =
              (localX >  halfW * 0.4 && n.dir.includes('e')) ||
              (localX < -halfW * 0.4 && n.dir.includes('w')) ||
              (localZ >  halfH * 0.4 && n.dir.includes('n')) ||
              (localZ < -halfH * 0.4 && n.dir.includes('s')) ||
              edgeDist < halfW * 0.18
            const should = edgeDist < halfW * 0.18 ? true : isRelevant
            if (!should) continue
            if (!chunkManager.has(n.bbox.center.lat, n.bbox.center.lon)) {
              if ('requestIdleCallback' in window) {
                requestIdleCallback(() => loadChunk(n.bbox.center.lat, n.bbox.center.lon))
              } else {
                setTimeout(() => loadChunk(n.bbox.center.lat, n.bbox.center.lon), 120)
              }
            }
          }
        }
        const evicted = chunkManager.evictIfNeeded(playerMeters, (g) => {
          worldGroup.remove(g)
          disposeChunk(g)
        })
        if (evicted.length) {
          setStats((s) => ({ ...s, chunks: chunkManager.size(), buildings: [...chunkManager.chunks.values()].reduce((a, r) => a + (r.group.userData.buildingsCount || 0), 0), roads: [...chunkManager.chunks.values()].reduce((a, r) => a + (r.group.userData.roadsCount || 0), 0) }))
        }
      }

      const moveSpeedBase = lowEnd.current ? 10 : 16
      let lastPrefetch = 0

      // FPV apply helper
      const applyFpvMode = (fpv) => {
        if (!camera || !controls) return
        const target = controls.target
        const pos = camera.position
        if (fpv) {
          // lower to eye height, bring target close for FPS feel
          const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; if (forward.lengthSq() < 0.01) forward.set(0, 0, 1)
          forward.normalize()
          const newPosY = 2.2
          // keep XZ, lower Y
          camera.position.set(pos.x, newPosY, pos.z)
          controls.target.set(pos.x + forward.x * 8, 1.6, pos.z + forward.z * 8)
          controls.minDistance = 0.6
          controls.maxDistance = 14
          controls.maxPolarAngle = Math.PI / 1.85
          controls.minPolarAngle = 0.12
          camera.fov = 78
        } else {
          // orbit: elevate
          const center = { x: controls.target.x, z: controls.target.z }
          // if we have a chunk, elevate relative to it; else keep target XZ
          camera.position.set(center.x + 16, 18, center.z + 16)
          controls.target.set(center.x, 0, center.z)
          controls.minDistance = 4
          controls.maxDistance = 180
          controls.maxPolarAngle = Math.PI / 2 - 0.06
          controls.minPolarAngle = 0
          camera.fov = 68
        }
        camera.updateProjectionMatrix()
        controls.update()
      }

      function animate(now) {
        raf = requestAnimationFrame(animate)
        const dt = Math.min(0.033, (now - lastFrame) / 1000)
        lastFrame = now
        frameCount++
        fpsAccum += 1 / Math.max(dt, 0.001)
        if (frameCount % 30 === 0) {
          const fps = Math.round(fpsAccum / 30)
          fpsAccum = 0
          setStats((s) => ({ ...s, fps }))
          if (lowEnd.current && fps < 28 && chunkManager.size() > 3) {
            const ev = chunkManager.evictIfNeeded(playerMeters, (g) => { worldGroup.remove(g); disposeChunk(g) })
            if (ev.length) setHudNote('Optimizing for device — trimming distant chunks')
          }
        }

        const forward = new THREE.Vector3()
        camera.getWorldDirection(forward)
        forward.y = 0; forward.normalize()
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate()
        const sprint = keys.shift || actionRef.current.sprint ? 1.8 : 1
        const speed = moveSpeedBase * sprint * dt
        const move = new THREE.Vector3()
        // keyboard
        if (keys.w) move.addScaledVector(forward, speed)
        if (keys.s) move.addScaledVector(forward, -speed)
        if (keys.a) move.addScaledVector(right, -speed)
        if (keys.d) move.addScaledVector(right, speed)
        // joystick (flexible left stick) — mapped to WASD
        const jx = joyMoveRef.current.x
        const jy = joyMoveRef.current.y
        if (Math.abs(jx) > 0.08 || Math.abs(jy) > 0.08) {
          // jx → strafe, jy → forward
          move.addScaledVector(right, jx * speed * 1.2)
          move.addScaledVector(forward, jy * speed * 1.2)
        }
        if (keys.q || actionRef.current.down) move.y -= speed * 0.9
        if (keys.e || actionRef.current.up) move.y += speed * 0.9
        // FPV clamps vertical to ground-ish
        if (isFpvRef.current) {
          // keep near ground unless up/down held
          if (!keys.q && !keys.e && !actionRef.current.up && !actionRef.current.down) {
            // gently clamp y to eye height 2.2
            const desiredY = 2.2
            const diff = desiredY - camera.position.y
            if (Math.abs(diff) > 0.02) move.y += diff * dt * 3
          }
        }
        if (move.lengthSq() > 0) {
          camera.position.add(move)
          controls.target.add(move)
        }
        controls.update()
        playerMeters = { x: camera.position.x, z: camera.position.z }
        if (now - lastPrefetch > 400) {
          maybePrefetch()
          lastPrefetch = now
        }
        renderer.render(scene, camera)
      }
      animate(performance.now())
      window.addEventListener('resize', onResize)

      engineRef.current = {
        move: (dir) => {
          const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0; f.normalize()
          const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).negate()
          const s = moveSpeedBase * 0.12
          const mv = new THREE.Vector3()
          if (dir === 'f') mv.addScaledVector(f, s)
          if (dir === 'b') mv.addScaledVector(f, -s)
          if (dir === 'l') mv.addScaledVector(r, -s)
          if (dir === 'r') mv.addScaledVector(r, s)
          camera.position.add(mv); controls.target.add(mv); controls.update()
        },
        setAction: (name, v) => { if (name in actionRef.current) actionRef.current[name] = v },
        toggleFpv: () => {
          const next = !isFpvRef.current
          isFpvRef.current = next
          setIsFpv(next)
          applyFpvMode(next)
          setHudNote(next ? 'FPV — eye level · drag to look · WASD/joystick · Q/E ↑↓' : 'Orbit — elevated · drag to orbit · scroll zoom')
          setTimeout(() => setHudNote(''), 2200)
        },
        setFpv: (v) => {
          isFpvRef.current = !!v
          setIsFpv(!!v)
          applyFpvMode(!!v)
        },
        zoomIn: () => { camera.position.lerp(controls.target, 0.08); controls.update() },
        zoomOut: () => { const v = new THREE.Vector3().subVectors(camera.position, controls.target); v.multiplyScalar(1.08); camera.position.copy(controls.target).add(v); controls.update() },
        recenter: () => {
          if (chunkManager.size() === 0) return
          const first = [...chunkManager.chunks.values()][0]
          const c = first.group.userData.centreMeters
          if (isFpvRef.current) {
            camera.position.set(c.x, 2.2, c.z + 1)
            controls.target.set(c.x, 1.6, c.z + 8)
          } else {
            controls.target.set(c.x, 0, c.z)
            camera.position.set(c.x + 16, 18, c.z + 16)
          }
          controls.update()
        },
      }
      // sync initial FPV button state if already toggled before init (unlikely)
      if (isFpvRef.current) applyFpvMode(true)
      setStats((s) => ({ ...s, pending: chunkManager.pending.size }))
    }

    init().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e)
      setStatus('error'); setErrorMsg(String(e.message || e))
    })

    return () => {
      cancelled = true
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('resize', onResize)
      if (raf) cancelAnimationFrame(raf)
      if (engineRef.current) engineRef.current = null
      try {
        if (renderer) {
          renderer.dispose()
        }
      } catch (_) {}
    }
  }, [active])

  // sync FPV toggle from React state to engine (when user clicks HUD button before engine ready)
  useEffect(() => {
    if (engineRef.current?.setFpv) engineRef.current.setFpv(isFpv)
  }, [isFpv])

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-6 sm:p-8">
        <PixelPatternBg />
        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-accent/20 bg-brand-accent/10 px-3 py-1 text-[11px] font-mono font-semibold tracking-wider text-brand-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-accent animate-pulse" /> 1:10 SCALE • PROCEDURAL • BROWSER-SIDE
            </div>
            <h1 className="mt-3 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-brand-text">Enter Coordinates</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-brand-muted">
              Drop any real-world lat/lon and we fetch a lightweight Overpass slice (~1×1 unit) and generate roads first, then buildings — all in your browser. Walk toward an edge and the next chunk streams in lazily. XY is faithful, height is stylized. Works offline via sample fallback.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Link to="/" className="rounded-xl border border-[#1E2638] bg-[#0B0F17] px-4 py-2 text-sm font-medium text-brand-muted hover:text-brand-text hover:border-brand-primary/30">← Home</Link>
            <Link to="/gateway" className="rounded-xl border border-[#1E2638] bg-[#0B0F17] px-4 py-2 text-sm font-medium text-brand-muted hover:text-brand-text hover:border-brand-primary/30">Gateway</Link>
          </div>
        </div>
      </div>

      {/* Controls card — always visible */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8 rounded-2xl border border-[#1E2638] bg-[#151A24] p-5 sm:p-6">
          <h2 className="font-display text-sm font-bold tracking-wider text-brand-text">CHOOSE A PLACE</h2>
          <p className="mt-1 text-xs font-mono text-brand-muted">Free, no-key Overpass API • ~30–180 KB per chunk • 1:10 world feels 10× smaller than reality</p>

          {errorMsg && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-mono text-red-300">{errorMsg}</div>
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <label className="space-y-1">
              <span className="text-[11px] font-mono font-semibold tracking-wider text-brand-muted">LATITUDE</span>
              <input value={coords.lat} onChange={(e) => setCoords((c) => ({ ...c, lat: e.target.value }))} placeholder="35.659" className="w-full rounded-xl border border-[#1E2638] bg-[#0B0F17] px-3 py-2.5 text-sm font-mono text-brand-text placeholder:text-brand-muted/50 focus:outline-none focus:border-brand-primary/50" />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-mono font-semibold tracking-wider text-brand-muted">LONGITUDE</span>
              <input value={coords.lon} onChange={(e) => setCoords((c) => ({ ...c, lon: e.target.value }))} placeholder="139.7005" className="w-full rounded-xl border border-[#1E2638] bg-[#0B0F17] px-3 py-2.5 text-sm font-mono text-brand-text placeholder:text-brand-muted/50 focus:outline-none focus:border-brand-primary/50" />
            </label>
            <div className="flex items-end gap-2">
              <button onClick={() => startAt(coords.lat, coords.lon)} className="w-full sm:w-auto rounded-xl bg-brand-primary px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(37,99,235,0.35)] hover:bg-brand-primary/90 active:scale-[0.98]">Generate World →</button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-full border border-[#1E2638] bg-[#0B0F17] px-3 py-1.5 text-xs font-mono text-brand-muted">
              <span>Chunk</span>
              <select value={sizeDeg} onChange={(e) => setSizeDeg(Number(e.target.value))} className="bg-transparent text-brand-text focus:outline-none">
                <option value={0.005}>0.5 km (tiny — mobile)</option>
                <option value={0.01}>1 km (default — balanced)</option>
                <option value={0.015}>1.5 km (dense — desktop)</option>
              </select>
            </label>
            <button onClick={useMyLocation} className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-3 py-1.5 text-xs font-mono text-brand-accent hover:border-brand-accent/40">◎ Use my location</button>
            <button
              onClick={() => {
                if (engineRef.current?.toggleFpv) engineRef.current.toggleFpv()
                else setIsFpv((v) => !v)
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-mono font-semibold ${isFpv ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-[#0B0F17] text-brand-muted border-[#1E2638] hover:border-brand-primary/30'}`}
            >
              {isFpv ? '● FPV' : '○ Orbit'} — FPV Camera
            </button>
            <span className="text-[11px] font-mono text-brand-muted">{lowEnd.current ? 'Low-end • capped DPR/shadows' : 'Full quality • DPR ≤1.5'} {isMobile ? '• touch' : '• desktop'}</span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => { setCoords({ lat: String(p.lat), lon: String(p.lon) }); startAt(p.lat, p.lon) }} className="group inline-flex items-center gap-1.5 rounded-full border border-[#1E2638] bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-brand-muted hover:border-brand-primary/30 hover:text-brand-text">
                <span>{p.emoji}</span> {p.label}
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-[#1E2638] bg-[#0B0F17]/70 p-3">
            <div className="flex items-center gap-2 text-[11px] font-mono font-semibold tracking-wider text-brand-accent">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> HOW IT GENERATES
            </div>
            <ol className="mt-2 grid gap-1 text-xs leading-relaxed text-brand-muted sm:grid-cols-3">
              <li><span className="font-mono font-semibold text-brand-text">1. Roads first</span> → ground mesh & circulation skeleton (one merged BufferGeometry)</li>
              <li><span className="font-mono font-semibold text-brand-text">2. Buildings</span> → footprints extruded via InstancedMesh (≤3 draws per chunk)</li>
              <li><span className="font-mono font-semibold text-brand-text">3. Lazy edge</span> → when you near a border, neighbours prefetch in idle time</li>
            </ol>
          </div>
        </div>

        {/* Right meta */}
        <div className="lg:col-span-4 space-y-3">
          <div className="rounded-2xl border border-[#1E2638] bg-[#151A24] p-5">
            <h3 className="text-xs font-mono font-semibold tracking-wider text-brand-muted">WHY THIS IS LIGHT</h3>
            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-brand-muted">
              <li>• <span className="text-brand-text">No textures</span> — vertex colors only; cuts VRAM 50% [research §4.4]</li>
              <li>• <span className="text-brand-text">Instancing</span> — 300 buildings = 3 draw calls, not 300</li>
              <li>• <span className="text-brand-text">DPR ≤1.5</span> + no shadows on low-end (like PixelCat)</li>
              <li>• Chunk cap 9, LRU dispose — session never leaks</li>
              <li>• Overpass <span className="font-mono">out geom</span> — no extra node stitching</li>
            </ul>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-[#0B0F17] px-2 py-1 text-[10px] font-mono text-brand-muted border border-[#1E2638]">free • no key</span>
              <span className="rounded-full bg-[#0B0F17] px-2 py-1 text-[10px] font-mono text-brand-muted border border-[#1E2638]">overpass-api.de</span>
              <span className="rounded-full bg-[#0B0F17] px-2 py-1 text-[10px] font-mono text-brand-muted border border-[#1E2638]">kumi mirror</span>
              <span className="rounded-full bg-[#0B0F17] px-2 py-1 text-[10px] font-mono text-brand-muted border border-[#1E2638]">/api/osm/chunk</span>
            </div>
            <a href="/docs/WORLD-ENGINE-RESEARCH.md" target="_blank" rel="noreferrer" className="mt-3 inline-flex text-[11px] font-mono text-brand-accent hover:text-brand-accent2">Read research report →</a>
          </div>

          {active && (
            <div className="rounded-2xl border border-brand-primary/20 bg-[#0B0F17] p-4">
              <div className="text-[11px] font-mono font-semibold tracking-wider text-brand-accent">ACTIVE CHUNK</div>
              <div className="mt-2 font-mono text-xs text-brand-text">{active.lat.toFixed(5)}, {active.lon.toFixed(5)} <span className="text-brand-muted">• size {active.size}</span></div>
              <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-mono">
                <span className={`rounded-full px-2 py-1 border ${status === 'ready' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'}`}>{status}</span>
                <span className={`rounded-full px-2 py-1 border ${isFpv ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-[#151A24] border-[#1E2638] text-brand-muted'}`}>{isFpv ? 'FPV' : 'Orbit'}</span>
                <span className="rounded-full bg-[#151A24] border border-[#1E2638] px-2 py-1 text-brand-muted">1:10 • {(active.size * 111).toFixed(2)} km real</span>
                <span className="rounded-full bg-[#151A24] border border-[#1E2638] px-2 py-1 text-brand-muted">{(active.size * 111 * 0.1).toFixed(2)} km ingame</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[#151A24] border border-[#1E2638] p-2"><div className="font-display text-lg font-bold text-brand-text">{stats.chunks}</div><div className="text-[10px] font-mono text-brand-muted">CHUNKS</div></div>
                <div className="rounded-xl bg-[#151A24] border border-[#1E2638] p-2"><div className="font-display text-lg font-bold text-brand-text">{stats.buildings}</div><div className="text-[10px] font-mono text-brand-muted">BLDGS</div></div>
                <div className="rounded-xl bg-[#151A24] border border-[#1E2638] p-2"><div className="font-display text-lg font-bold text-brand-text">{stats.roads}</div><div className="text-[10px] font-mono text-brand-muted">ROADS</div></div>
              </div>
              <div className="mt-2 font-mono text-[11px] text-brand-muted">{stats.fps ? `${stats.fps} fps` : '— fps'} • pending {stats.pending} {isMobile ? '• touch' : ''}</div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    if (engineRef.current?.toggleFpv) engineRef.current.toggleFpv()
                    else setIsFpv((v) => !v)
                  }}
                  className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold ${isFpv ? 'bg-emerald-500 text-[#0B0F17] border-emerald-500' : 'bg-[#151A24] border-[#1E2638] text-brand-text hover:border-brand-primary/30'}`}
                >
                  {isFpv ? 'Orbit view' : 'FPV view'}
                </button>
                <button onClick={() => engineRef.current?.recenter()} className="flex-1 rounded-xl border border-[#1E2638] bg-[#151A24] px-3 py-2 text-xs font-medium text-brand-text hover:border-brand-primary/30">Recenter</button>
                <button onClick={() => setActive(null) || setStatus('idle')} className="flex-1 rounded-xl bg-[#1E2638] px-3 py-2 text-xs font-medium text-brand-muted hover:text-brand-text">Close</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Canvas area */}
      {!active ? (
        <div className="rounded-2xl border border-dashed border-[#2A3448] bg-[#0B0F17]/60 p-10 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#1E2638] bg-[#151A24] text-xl">🗺️</div>
            <h3 className="font-display text-lg font-bold text-brand-text">No world yet — pick coordinates above</h3>
            <p className="text-sm text-brand-muted">Try a preset, or paste any lat/lon. We download one tiny Overpass bbox and generate everything client-side. Nothing is rendered on the server.</p>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#0B0F17] shadow-2xl">
          {/* HUD */}
          <div className="pointer-events-none absolute left-2 right-2 top-2 z-10 flex flex-wrap items-center justify-between gap-2">
            <div className="pointer-events-auto flex flex-wrap items-center gap-2">
              <span className="hidden sm:inline-flex rounded-full bg-[#151A24]/90 backdrop-blur px-2.5 py-1 text-[11px] font-mono text-brand-muted border border-[#1E2638]">
                {isFpv ? 'FPV · drag look · joystick move · Q/E ↑↓ · Shift sprint' : 'Orbit · drag orbit · scroll zoom · WASD/joystick · Q/E ↑↓'}
              </span>
              <span className="sm:hidden rounded-full bg-[#151A24]/90 backdrop-blur px-2 py-1 text-[10px] font-mono text-brand-muted border border-[#1E2638]">{isFpv ? 'FPV' : 'Orbit'} · use joystick</span>
              {hudNote && <span className="rounded-full bg-brand-primary px-2.5 py-1 text-[11px] font-mono font-semibold text-white shadow">{hudNote}</span>}
            </div>
            <div className="pointer-events-auto flex items-center gap-1">
              <button
                onClick={() => {
                  if (engineRef.current?.toggleFpv) engineRef.current.toggleFpv()
                  else setIsFpv((v) => !v)
                }}
                className={`rounded-full backdrop-blur px-3 py-1 text-[11px] font-mono font-semibold border ${isFpv ? 'bg-emerald-500 text-[#0B0F17] border-emerald-500' : 'bg-[#151A24]/90 text-brand-text border-[#1E2638] hover:border-brand-primary/30'}`}
              >
                {isFpv ? '● FPV' : '○ Orbit'}
              </button>
              <span className="hidden sm:inline-flex rounded-full bg-[#151A24]/90 backdrop-blur px-2.5 py-1 text-[11px] font-mono text-brand-text border border-[#1E2638]">{stats.fps ? `${stats.fps} fps` : '-- fps'} • {stats.chunks} chunks</span>
              <button onClick={() => setActive(null)} className="hidden sm:inline-flex rounded-full bg-[#151A24]/90 backdrop-blur px-3 py-1 text-[11px] font-mono text-brand-muted border border-[#1E2638] hover:text-brand-text">✕ Close</button>
              <button onClick={() => setActive(null)} className="sm:hidden rounded-full bg-[#151A24]/90 backdrop-blur px-2.5 py-1 text-[11px] font-mono text-brand-muted border border-[#1E2638]">✕</button>
            </div>
          </div>

          {/* 3D canvas */}
          <div className="relative h-[56vh] min-h-[380px] w-full sm:h-[62vh] lg:h-[68vh]">
            {status === 'loading' && (
              <div className="absolute inset-0 z-[5] grid place-items-center bg-[#0B0F17]/70 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#1E2638] bg-[#151A24] px-6 py-5 text-center shadow-xl">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E2638] border-t-brand-primary" />
                  <div className="font-mono text-xs font-semibold tracking-wider text-brand-text">GENERATING WORLD…</div>
                  <div className="max-w-xs text-xs leading-relaxed text-brand-muted">Fetching Overpass slice → roads first → buildings next. First chunk is ~80–110 m ingame at 1:10 scale.</div>
                  <div className="font-mono text-[11px] text-brand-muted">{active.lat.toFixed(4)}, {active.lon.toFixed(4)} • {active.size}</div>
                </div>
              </div>
            )}
            <canvas ref={canvasRef} className="h-full w-full block" style={{ width: '100%', height: '100%' }} />

            {/* ── Mobile touch controls (only on touch/coarse devices) ── */}
            {isMobile && (
              <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3 sm:p-4 pointer-events-none">
                {/* Left: flexible joystick */}
                <div className="pointer-events-auto flex flex-col items-center gap-1.5">
                  <div
                    ref={joyBaseRef}
                    onTouchStart={handleJoyStart}
                    onTouchMove={handleJoyMove}
                    onTouchEnd={handleJoyEnd}
                    onTouchCancel={handleJoyEnd}
                    onMouseDown={handleJoyStart}
                    onMouseMove={handleJoyMove}
                    onMouseUp={handleJoyEnd}
                    onMouseLeave={handleJoyEnd}
                    className="relative flex h-[128px] w-[128px] items-center justify-center rounded-full border border-white/20 bg-white/[0.08] backdrop-blur-md shadow-[0_4px_24px_rgba(0,0,0,0.35)]"
                    style={{ backgroundColor: 'rgba(255,255,255,0.08)', opacity: 0.92 }}
                  >
                    {/* base ring */}
                    <div className="absolute inset-2 rounded-full border border-white/10 bg-white/[0.04]" />
                    {/* stick */}
                    <div
                      className="absolute h-14 w-14 rounded-full border border-white/20 bg-white/80 shadow-lg flex items-center justify-center"
                      style={{
                        transform: `translate(${joyPos.x}px, ${joyPos.y}px)`,
                        backgroundColor: 'rgba(255,255,255,0.92)',
                        opacity: 0.9,
                        transition: joyActiveRef.current ? 'none' : 'transform 140ms ease-out',
                      }}
                    >
                      <span className="text-[10px] font-mono font-bold text-[#0B0F17]">◉</span>
                    </div>
                    {/* cross hint */}
                    <div className="pointer-events-none absolute h-[1px] w-8 bg-white/20" />
                    <div className="pointer-events-none absolute h-8 w-[1px] bg-white/20" />
                  </div>
                  <span className="rounded-full bg-[#0B0F17]/20 backdrop-blur px-2 py-0.5 text-[10px] font-mono font-semibold tracking-wider text-white/80 border border-white/10">MOVE</span>
                </div>

                {/* Right: translucent action buttons (20% opacity) */}
                <div className="pointer-events-auto flex flex-col items-end gap-2">
                  {/* top row: FPV + recenter */}
                  <div className="flex gap-2">
                    <button
                      onTouchStart={(e) => { e.preventDefault(); if (engineRef.current?.toggleFpv) engineRef.current.toggleFpv() }}
                      onClick={() => engineRef.current?.toggleFpv?.()}
                      className="h-10 rounded-xl border border-white/20 bg-white/[0.12] backdrop-blur px-3 text-xs font-mono font-bold text-white shadow active:bg-white/30"
                      style={{ opacity: 0.88 }}
                    >
                      {isFpv ? 'Orbit' : 'FPV'}
                    </button>
                    <button
                      onTouchStart={(e) => { e.preventDefault(); engineRef.current?.recenter() }}
                      onClick={() => engineRef.current?.recenter()}
                      className="h-10 w-10 rounded-xl border border-white/20 bg-white/[0.12] backdrop-blur text-white shadow active:bg-white/30 flex items-center justify-center"
                      style={{ opacity: 0.88 }}
                      aria-label="Recenter"
                    >
                      ⌖
                    </button>
                  </div>
                  {/* D-pad style but mapped translucent, plus up/down/sprint */}
                  <div className="flex items-end gap-2">
                    {/* vertical up/down + sprint cluster */}
                    <div className="flex flex-col gap-2">
                      <button
                        onTouchStart={(e) => { e.preventDefault(); actionRef.current.up = true; engineRef.current?.setAction?.('up', true) }}
                        onTouchEnd={(e) => { e.preventDefault(); actionRef.current.up = false; engineRef.current?.setAction?.('up', false) }}
                        onTouchCancel={() => { actionRef.current.up = false; engineRef.current?.setAction?.('up', false) }}
                        onMouseDown={() => { actionRef.current.up = true; engineRef.current?.setAction?.('up', true) }}
                        onMouseUp={() => { actionRef.current.up = false; engineRef.current?.setAction?.('up', false) }}
                        onMouseLeave={() => { actionRef.current.up = false; engineRef.current?.setAction?.('up', false) }}
                        className="h-[44px] w-[44px] rounded-xl border border-white/20 bg-white/[0.14] backdrop-blur text-white font-bold shadow active:bg-emerald-500/40 active:border-emerald-400/40"
                        style={{ opacity: 0.88 }}
                        aria-label="Up"
                      >
                        ▲
                      </button>
                      <button
                        onTouchStart={(e) => { e.preventDefault(); actionRef.current.down = true; engineRef.current?.setAction?.('down', true) }}
                        onTouchEnd={(e) => { e.preventDefault(); actionRef.current.down = false; engineRef.current?.setAction?.('down', false) }}
                        onTouchCancel={() => { actionRef.current.down = false; engineRef.current?.setAction?.('down', false) }}
                        onMouseDown={() => { actionRef.current.down = true; engineRef.current?.setAction?.('down', true) }}
                        onMouseUp={() => { actionRef.current.down = false; engineRef.current?.setAction?.('down', false) }}
                        onMouseLeave={() => { actionRef.current.down = false; engineRef.current?.setAction?.('down', false) }}
                        className="h-[44px] w-[44px] rounded-xl border border-white/20 bg-white/[0.14] backdrop-blur text-white font-bold shadow active:bg-emerald-500/40"
                        style={{ opacity: 0.88 }}
                        aria-label="Down"
                      >
                        ▼
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onTouchStart={(e) => { e.preventDefault(); actionRef.current.sprint = true; engineRef.current?.setAction?.('sprint', true) }}
                        onTouchEnd={(e) => { e.preventDefault(); actionRef.current.sprint = false; engineRef.current?.setAction?.('sprint', false) }}
                        onTouchCancel={() => { actionRef.current.sprint = false; engineRef.current?.setAction?.('sprint', false) }}
                        onMouseDown={() => { actionRef.current.sprint = true; engineRef.current?.setAction?.('sprint', true) }}
                        onMouseUp={() => { actionRef.current.sprint = false; engineRef.current?.setAction?.('sprint', false) }}
                        onMouseLeave={() => { actionRef.current.sprint = false; engineRef.current?.setAction?.('sprint', false) }}
                        className="h-[44px] w-[88px] rounded-xl border border-white/20 bg-white/[0.14] backdrop-blur text-xs font-mono font-bold text-white shadow active:bg-amber-500/40"
                        style={{ opacity: 0.88 }}
                      >
                        ⚡ SPRINT
                      </button>
                      <div className="flex gap-2">
                        <button
                          onTouchStart={(e) => { e.preventDefault(); engineRef.current?.zoomIn?.() }}
                          onClick={() => engineRef.current?.zoomIn?.()}
                          className="h-9 w-[42px] rounded-xl border border-white/20 bg-white/[0.12] backdrop-blur text-white shadow active:bg-white/30"
                          style={{ opacity: 0.88 }}
                        >
                          ＋
                        </button>
                        <button
                          onTouchStart={(e) => { e.preventDefault(); engineRef.current?.zoomOut?.() }}
                          onClick={() => engineRef.current?.zoomOut?.()}
                          className="h-9 w-[42px] rounded-xl border border-white/20 bg-white/[0.12] backdrop-blur text-white shadow active:bg-white/30"
                          style={{ opacity: 0.88 }}
                        >
                          －
                        </button>
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full bg-[#0B0F17]/20 backdrop-blur px-2 py-0.5 text-[10px] font-mono font-semibold tracking-wider text-white/70 border border-white/10">ACTIONS</span>
                </div>
              </div>
            )}

            {/* Desktop fallback controls (shown only when NOT mobile) */}
            {!isMobile && (
              <div className="absolute bottom-3 left-3 right-3 z-10 hidden sm:flex items-end justify-between gap-3 pointer-events-none">
                <div className="pointer-events-auto flex gap-1.5 rounded-2xl border border-[#1E2638] bg-[#0B0F17]/70 p-2 backdrop-blur text-[11px] font-mono text-brand-muted">
                  <span className="px-2 py-1">WASD move</span>
                  <span className="px-2 py-1 border-l border-[#1E2638]">Shift sprint</span>
                  <span className="px-2 py-1 border-l border-[#1E2638]">Q/E ↑↓</span>
                </div>
                <div className="pointer-events-auto flex gap-1.5">
                  <button onClick={() => engineRef.current?.zoomIn()} className="h-9 w-9 rounded-xl border border-[#1E2638] bg-[#0B0F17]/80 backdrop-blur text-brand-text">＋</button>
                  <button onClick={() => engineRef.current?.zoomOut()} className="h-9 w-9 rounded-xl border border-[#1E2638] bg-[#0B0F17]/80 backdrop-blur text-brand-text">－</button>
                  <button onClick={() => engineRef.current?.recenter()} className="hidden sm:inline-flex h-9 rounded-xl border border-[#1E2638] bg-[#0B0F17]/80 backdrop-blur px-3 text-xs font-mono text-brand-muted sm:items-center">Recenter</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#1E2638] bg-[#151A24] px-3 py-2 text-[11px] font-mono text-brand-muted">
            <span>Scale 1:10 • XY faithful • Z stylized (levels → height) • chunk {active.size}° ≈ {(active.size * 111).toFixed(2)} km real → {(active.size * 111 * 0.1).toFixed(2)} km ingame {isFpv ? '• FPV eye 2.2m' : ''}</span>
            <span className="hidden sm:inline">Tip: approach any edge — next chunk streams lazily in the background without hitch. {isMobile ? 'Joystick left, actions right (20% translucent).' : ''}</span>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[#1E2638] bg-[#0B0F17] p-4 text-xs leading-relaxed text-brand-muted">
        <span className="font-mono font-semibold tracking-wider text-brand-text">FREE APIs ONLY</span> — This page uses <code className="rounded bg-[#151A24] px-1 py-0.5 font-mono text-brand-accent">overpass-api.de</code> + <code className="rounded bg-[#151A24] px-1 py-0.5 font-mono text-brand-accent">overpass.kumi.systems</code> (both CORS-open, keyless OSM) with a same-origin fallback at <code className="rounded bg-[#151A24] px-1 py-0.5 font-mono text-brand-accent">/api/osm/chunk</code> (also keyless, cached 10 min). No Mapbox, no Google, no billable provider. The sample neighbourhood renders even offline.
      </div>
    </PageTransition>
  )
}
