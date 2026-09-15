import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import GameCard from '../components/GameCard'
import SectionHeader from '../components/SectionHeader'
import PageTransition from '../components/PageTransition'
import { PixellonIcon } from '../components/PixellonLogo'
import { BrandPillarsBar, PixelCross, PixelPatternBg } from '../components/BrandDecorations'
import { getHomeBundle } from '../utils/api'

export default function Home() {
  const [trendingGames, setTrendingGames] = useState([])
  const [recentReviews, setRecentReviews] = useState([])
  const [upcomingReleases, setUpcomingReleases] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadData() {
      try {
        // One request for the whole page: the server fans out to RAWG once and
        // caches the result, instead of the browser making three cold calls.
        const { trending, topRated, upcoming } = await getHomeBundle()
        if (cancelled) return
        setTrendingGames(trending || [])
        setRecentReviews(topRated || [])
        setUpcomingReleases(upcoming || [])
      } catch (err) {
        if (import.meta.env.DEV) console.warn('Home data unavailable', err?.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadData()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <PageTransition className="mx-auto max-w-7xl px-6 py-20 flex justify-center items-center min-h-[50vh]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1E2638] border-t-brand-primary"></div>
      </PageTransition>
    )
  }

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-16">
      {/* ── Brand Hero Section ─────────────────────────────────── */}
      <section id="hero" className="animate-fade-up relative">
        <div className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-12 lg:p-16">
          <PixelPatternBg />

          <div className="relative z-10 grid gap-10 lg:grid-cols-12 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-3.5 py-1.5 text-xs font-mono font-medium text-brand-accent">
                <span className="h-2 w-2 rounded-full bg-brand-accent animate-pulse" />
                <span>Small pixels. Big possibilities.</span>
              </div>

              <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-brand-text leading-[1.1]">
                Play. Share.{' '}
                <span className="text-brand-primary">
                  Belong.
                </span>
              </h1>

              <p className="text-base sm:text-lg leading-relaxed text-brand-muted max-w-xl font-sans">
                The hub built for every player. From daily breaking updates and indie spotlights to deep-dive codex guides and release drops — small pixels, big possibilities.
              </p>

              <div className="flex flex-wrap gap-3.5 pt-2">
                <Link
                  to="/codex"
                  id="hero-cta-codex"
                  className="rounded-xl bg-brand-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-brand-primary/90 shadow-[0_0_20px_rgba(37,99,235,0.4)] active:scale-95 cursor-pointer font-sans"
                >
                  Explore The Codex →
                </Link>
                <Link
                  to="/gateway"
                  id="hero-cta-gateway"
                  className="rounded-xl border border-[#1E2638] bg-[#0B0F17] px-6 py-3 text-sm font-semibold text-brand-text transition-all duration-200 hover:border-brand-accent/50 hover:bg-[#10151F] cursor-pointer font-sans"
                >
                  Starter Zone
                </Link>
                <Link
                  to="/world"
                  id="hero-cta-world"
                  className="rounded-xl border border-brand-accent/40 bg-brand-accent/10 px-6 py-3 text-sm font-semibold text-brand-accent transition-all duration-200 hover:border-brand-accent hover:bg-brand-accent/15 shadow-[0_0_16px_rgba(96,165,250,0.25)] active:scale-95 cursor-pointer font-sans"
                >
                  Enter Coordinates →
                </Link>
              </div>
            </div>

            {/* Right Brand 3D / Badge Card */}
            <div className="lg:col-span-5 flex justify-center">
              <div className="relative w-full max-w-sm rounded-2xl border border-[#1E2638] bg-[#0B0F17] p-8 shadow-2xl">
                <div className="flex items-center justify-between border-b border-[#1E2638] pb-4 mb-6">
                  <div className="flex items-center gap-2">
                    <PixelCross size={14} />
                    <span className="font-mono text-xs font-semibold text-brand-accent uppercase tracking-wider">
                      PIXELLON VIBE
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-brand-muted">v1.0</span>
                </div>

                <div className="flex flex-col items-center text-center py-4 space-y-4">
                  <div className="relative group">
                    <div className="absolute -inset-1 rounded-2xl bg-brand-primary/30 opacity-60 blur-sm group-hover:opacity-90 transition-opacity" />
                    <PixellonIcon size={72} className="relative shadow-xl" />
                  </div>
                  
                  <div>
                    <h3 className="font-display text-xl font-bold text-brand-text">
                      Built for Every Player
                    </h3>
                    <p className="mt-1 text-xs text-brand-muted">
                      Games • People • Culture • Community
                    </p>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-[#1E2638] grid grid-cols-3 gap-2 text-center text-xs font-mono">
                  <div className="rounded-lg bg-[#151A24] p-2">
                    <div className="text-brand-accent font-bold">100%</div>
                    <div className="text-[10px] text-brand-muted">Honest</div>
                  </div>
                  <div className="rounded-lg bg-[#151A24] p-2">
                    <div className="text-brand-accent2 font-bold">Live</div>
                    <div className="text-[10px] text-brand-muted">Streams</div>
                  </div>
                  <div className="rounded-lg bg-[#151A24] p-2">
                    <div className="text-brand-accent3 font-bold">Free</div>
                    <div className="text-[10px] text-brand-muted">Drops</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trending Games ────────────────────────────────────── */}
      <section id="trending-games">
        <SectionHeader
          title="What Everyone's Playing"
          subtitle="Trending titles currently dominating the leaderboards and community chats."
          accent="blue"
        />
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {trendingGames.map((game) => (
            <GameCard key={game.id} {...game} variant="featured" tag="TRENDING" tagColor="blue" />
          ))}
        </div>
      </section>

      {/* ── Recent Reviews (Top Picks) ────────────────────────── */}
      <section id="recent-reviews">
        <SectionHeader
          title="Top Rated Reviews"
          subtitle="Critically acclaimed titles tested and rated by the community."
          accent="accent"
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {recentReviews.map((game) => (
            <GameCard
              key={game.id}
              {...game}
              tag={game.rating >= 9 ? 'Masterpiece' : 'Great'}
              tagColor={game.rating >= 9 ? 'emerald' : 'blue'}
            />
          ))}
        </div>
      </section>

      {/* ── Upcoming Releases ─────────────────────────────────── */}
      <section id="upcoming-preview">
        <SectionHeader
          title="On Our Radar"
          subtitle="Confirmed upcoming releases saving up wishlist slots."
          accent="cyan"
        />
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {upcomingReleases.slice(0, 6).map((release) => (
            <div
              key={release.id}
              className="flex items-center justify-between rounded-xl border border-[#1E2638] bg-[#151A24] px-5 py-4 transition-all hover:border-brand-primary/60 hover:shadow-md"
            >
              <div className="min-w-0 pr-4">
                <h4 className="text-sm font-display font-bold text-brand-text truncate">{release.title}</h4>
                <p className="mt-0.5 text-xs text-brand-muted truncate">
                  {release.genre} · {release.platform?.join(', ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className="block text-sm font-mono font-medium text-brand-accent">{release.date}</span>
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-brand-accent2">
                  Confirmed
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center">
          <Link
            to="/calendar"
            id="view-full-calendar"
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-accent transition-colors hover:text-brand-accent2"
          >
            <span>View Full Calendar</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </section>

      {/* ── World Engine — Enter Coordinates ────────────────────── */}
      <section id="world-cta">
        <div className="relative overflow-hidden rounded-2xl border border-brand-accent/20 bg-gradient-to-br from-[#151A24] via-[#151A24] to-[#10182A] p-6 sm:p-8 lg:p-10">
          <PixelPatternBg />
          <div className="relative z-10 grid gap-6 lg:grid-cols-12 items-center">
            <div className="lg:col-span-7 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-mono font-semibold tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> NEW • 1:10 SCALE WORLD • BROWSER GENERATION
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-brand-text leading-tight">
                Explore the Real World — <span className="text-brand-accent">at 1:10 Scale</span>
              </h3>
              <p className="text-sm leading-relaxed text-brand-muted">
                Drop any coordinates and we fetch a tiny OpenStreetMap slice, then procedurally build roads first and buildings next — all on your device. Walk to an edge and the next chunk streams lazily. No key, no install, works offline with a sample.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-3 py-1 text-[11px] font-mono text-brand-muted">30–180 KB / chunk</span>
                <span className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-3 py-1 text-[11px] font-mono text-brand-muted">Instanced • ≤5 draws</span>
                <span className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-3 py-1 text-[11px] font-mono text-brand-muted">Overpass free API</span>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-[#1E2638] bg-[#0B0F17] p-5">
                <div className="flex items-center gap-2 text-[11px] font-mono font-semibold tracking-wider text-brand-accent"><span>🗺️</span> TRY A COORDINATE</div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    ['Tokyo', '35.659, 139.700'],
                    ['New York', '40.758, -73.98'],
                    ['London', '51.499, -0.124'],
                  ].map(([city, coords]) => (
                    <Link key={city} to="/world" className="rounded-xl border border-[#1E2638] bg-[#151A24] px-3 py-2 text-center hover:border-brand-primary/40">
                      <div className="text-xs font-semibold text-brand-text">{city}</div>
                      <div className="font-mono text-[10px] text-brand-muted">{coords}</div>
                    </Link>
                  ))}
                </div>
                <Link to="/world" id="world-cta-enter" className="mt-4 flex w-full items-center justify-center rounded-xl bg-brand-accent px-5 py-3 text-sm font-bold text-[#0B0F17] hover:bg-brand-accent2 shadow-[0_0_16px_rgba(96,165,250,0.35)]">
                  Enter Coordinates →
                </Link>
                <div className="mt-2 text-center font-mono text-[10px] text-brand-muted">No signup • runs at 60 fps on mobile • DPR-capped</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Gateway CTA Banner ────────────────────────────────── */}
      <section id="gateway-cta">
        <div className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-12 text-center">
          <PixelPatternBg />
          <div className="relative z-10 flex flex-col items-center justify-center max-w-xl mx-auto">
            <span className="mb-3 text-3xl">🎮</span>
            <h3 className="font-display text-2xl sm:text-3xl font-bold text-brand-text">
              New to the Gaming World?
            </h3>
            <p className="mt-3 text-sm sm:text-base text-brand-muted leading-relaxed">
              No stress, no gatekeeping. Jump into beginner-friendly titles and jargon-free guides designed for anyone starting out.
            </p>
            <Link
              to="/gateway"
              id="gateway-banner-cta"
              className="mt-6 rounded-xl bg-brand-accent px-6 py-3 text-sm font-bold text-[#0B0F17] transition-all hover:bg-brand-accent2 shadow-[0_0_16px_rgba(96,165,250,0.4)] active:scale-95 cursor-pointer font-sans"
            >
              Enter The Gateway →
            </Link>
          </div>
        </div>
      </section>
    </PageTransition>
  )
}
