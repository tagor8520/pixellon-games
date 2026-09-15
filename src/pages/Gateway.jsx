import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import GameCard from '../components/GameCard'
import SectionHeader from '../components/SectionHeader'
import PageTransition from '../components/PageTransition'
import { PixelPatternBg } from '../components/BrandDecorations'
import { gatewayCollections, beginnerGuides } from '../data/mockData'
import { getTrendingGames, getHighlyRatedGames } from '../utils/api'

const COLLECTION_COLORS = {
  emerald: { border: 'border-brand-accent/30', bg: 'bg-brand-accent/5', text: 'text-brand-accent' },
  violet: { border: 'border-brand-primary/30', bg: 'bg-brand-primary/5', text: 'text-brand-accent2' },
  cyan: { border: 'border-brand-accent/30', bg: 'bg-brand-accent/5', text: 'text-brand-accent' },
  amber: { border: 'border-brand-primary/30', bg: 'bg-brand-primary/5', text: 'text-brand-accent3' },
}

export default function Gateway() {
  const [apiGames, setApiGames] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    async function fetchApiData() {
      setLoading(true)
      try {
        const [trending, highlyRated] = await Promise.all([
          getTrendingGames(),
          getHighlyRatedGames()
        ])
        
        const combined = [...trending, ...highlyRated]
        const unique = Array.from(new Map(combined.map(item => [item.id, item])).values())
        const shuffled = unique.sort(() => 0.5 - Math.random())
        setApiGames(shuffled.slice(0, 3))
      } catch (err) {
        console.error("Failed to load gateway API games", err)
      } finally {
        setLoading(false)
      }
    }
    fetchApiData()
  }, [])

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-16">
      {/* ── Hero ──────────────────────────────────────────────── */}
      <section id="gateway-hero" className="animate-fade-up relative">
        <div className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-14 text-center">
          <PixelPatternBg />
          <div className="relative z-10 max-w-3xl mx-auto space-y-4">
            <span className="inline-flex items-center rounded-full border border-brand-accent/30 bg-brand-accent/10 px-4 py-1.5 text-xs font-mono font-semibold text-brand-accent">
              🌟 No experience needed • Built for Every Player
            </span>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-brand-text">
              Welcome to the{' '}
              <span className="text-brand-primary">
                Starter Zone
              </span>
            </h1>
            <p className="mx-auto max-w-xl text-base sm:text-lg leading-relaxed text-brand-muted">
              Gaming can be intimidating, we get it. Here are hand-picked games that are easy to pick up, plus straight-to-the-point guides with zero jargon.
            </p>
          </div>
        </div>
      </section>

      {/* ── Quick Stats ───────────────────────────────────────── */}
      <section id="gateway-stats">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: 'Starter Lists', value: '4', icon: '📚' },
            { label: 'Curated Picks', value: '12+', icon: '🎮' },
            { label: 'Quick Guides', value: '4', icon: '📖' },
            { label: 'Vibe Check', value: '100%', icon: '✨' },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-[#1E2638] bg-[#151A24] px-5 py-6 text-center transition-all hover:border-brand-primary/50"
            >
              <span className="text-2xl">{stat.icon}</span>
              <p className="mt-2 font-display text-2xl font-bold text-brand-text">{stat.value}</p>
              <p className="mt-1 text-xs font-mono text-brand-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Dynamic API Suggestions ───────────────────────────── */}
      <section id="api-suggestions">
        <SectionHeader
          title="Trending Right Now"
          subtitle="What the wider community is currently diving into."
          accent="blue"
        />
        
        {loading ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl border border-[#1E2638] bg-[#151A24]">
            <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
            <p className="text-sm font-mono text-brand-muted">Fetching top picks...</p>
          </div>
        ) : apiGames.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {apiGames.map((game) => (
              <GameCard
                key={game.id}
                {...game}
                tag="TRENDING"
                tagColor="blue"
                onClick={() => navigate(`/codex/${game.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-[#1E2638] bg-[#151A24] p-8 text-center text-brand-muted">
            Could not fetch live suggestions at this time.
          </div>
        )}
      </section>

      {/* ── Curated Collections ───────────────────────────────── */}
      {gatewayCollections.map((collection) => {
        const colors = COLLECTION_COLORS[collection.color] || COLLECTION_COLORS.violet
        return (
          <section key={collection.id} id={`collection-${collection.id}`}>
            <div className="rounded-2xl border border-[#1E2638] bg-[#151A24] p-6 sm:p-8 space-y-6">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{collection.emoji}</span>
                  <h2 className={`font-display text-2xl font-bold ${colors.text}`}>
                    {collection.title}
                  </h2>
                </div>
                <p className="ml-10 text-sm text-brand-muted">{collection.description}</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {collection.games.map((game) => (
                  <GameCard
                    key={game.id}
                    {...game}
                    tagColor={collection.color}
                  />
                ))}
              </div>
            </div>
          </section>
        )
      })}

      {/* ── Beginner Guides ───────────────────────────────────── */}
      <section id="beginner-guides">
        <SectionHeader
          title="The Basics"
          subtitle="No jargon, just straight answers."
          accent="cyan"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {beginnerGuides.map((guide) => (
            <article
              key={guide.id}
              id={`guide-${guide.id}`}
              className="group flex gap-4 rounded-xl border border-[#1E2638] bg-[#151A24] p-5 transition-all duration-200 hover:border-brand-accent hover:bg-[#1A2232] cursor-pointer"
            >
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-[#1E2638] bg-[#0B0F17] text-xl transition-transform group-hover:scale-110">
                {guide.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-display font-bold text-brand-text group-hover:text-brand-accent transition-colors">
                    {guide.title}
                  </h4>
                  <span className="flex-shrink-0 rounded bg-[#0B0F17] px-2 py-0.5 text-[10px] font-mono text-brand-muted">
                    {guide.readTime}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-brand-muted leading-relaxed">{guide.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Enter Coordinates — New 3rd Option ─────────────────── */}
      <section id="gateway-world">
        <div className="relative overflow-hidden rounded-2xl border border-brand-accent/20 bg-gradient-to-br from-[#151A24] to-[#0F172A] p-6 sm:p-8">
          <PixelPatternBg />
          <div className="relative z-10 grid gap-6 lg:grid-cols-12 items-center">
            <div className="lg:col-span-7 space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-mono font-semibold tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> NEW • REAL-WORLD AT 1:10 SCALE
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-bold text-brand-text leading-tight">Enter Coordinates — <span className="text-brand-accent">Generate Your World</span></h3>
              <p className="text-sm leading-relaxed text-brand-muted">
                The new third path: type any lat/lon (or use your location) and watch a tiny 1×1 Overpass slice turn into a walkable 3D neighbourhood — roads first, buildings next, all rendered in your browser at 1:10 scale. Move to an edge and the next chunk streams lazily behind a fog.
              </p>
              <div className="flex flex-wrap gap-2 pt-1 text-[11px] font-mono">
                <span className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-2.5 py-1 text-brand-muted">~1 km real → ~100 m ingame</span>
                <span className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-2.5 py-1 text-brand-muted">No key • works offline</span>
                <span className="rounded-full border border-[#1E2638] bg-[#0B0F17] px-2.5 py-1 text-brand-muted">Mobile-optimized</span>
              </div>
            </div>
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-[#1E2638] bg-[#0B0F17] p-5">
                <div className="text-[11px] font-mono font-semibold tracking-wider text-brand-accent">QUICK START</div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    ['Tokyo', '35.65, 139.70'],
                    ['NYC', '40.75, -73.98'],
                    ['Paris', '48.86, 2.33'],
                  ].map(([city, c]) => (
                    <Link key={city} to="/world" className="rounded-xl border border-[#1E2638] bg-[#151A24] px-3 py-2 text-center hover:border-brand-primary/40">
                      <div className="text-xs font-bold text-brand-text">{city}</div>
                      <div className="font-mono text-[10px] text-brand-muted">{c}</div>
                    </Link>
                  ))}
                </div>
                <Link to="/world" id="gateway-to-world" className="mt-4 flex w-full items-center justify-center rounded-xl bg-brand-accent px-5 py-3 text-sm font-bold text-[#0B0F17] hover:bg-brand-accent2 shadow-[0_0_16px_rgba(96,165,250,0.35)]">
                  Enter Coordinates →
                </Link>
                <div className="mt-2 text-center font-mono text-[10px] text-brand-muted">Drag = orbit • WASD = walk • Shift = sprint • free Overpass API</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Getting Started CTA ───────────────────────────────── */}
      <section id="gateway-getting-started">
        <div className="rounded-2xl border border-[#1E2638] bg-[#151A24] px-8 py-14 text-center">
          <h3 className="font-display text-2xl sm:text-3xl font-bold text-brand-text">
            Where to Next?
          </h3>
          <p className="mx-auto mt-3 max-w-md text-sm text-brand-muted">
            Grab whatever catches your eye and start playing. Small pixels, big possibilities.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to="/reviews"
              id="gateway-to-reviews"
              className="rounded-xl bg-brand-primary px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-brand-primary/85 shadow-[0_0_16px_rgba(37,99,235,0.3)] active:scale-95 cursor-pointer font-sans"
            >
              Browse All Reviews
            </Link>
            <Link
              to="/indie"
              id="gateway-to-indie"
              className="rounded-xl border border-[#1E2638] bg-[#0B0F17] px-6 py-3 text-sm font-semibold text-brand-text transition-all hover:border-brand-primary/50 cursor-pointer font-sans"
            >
              Discover Indie Gems
            </Link>
            <Link
              to="/world"
              id="gateway-to-world-alt"
              className="rounded-xl border border-brand-accent/30 bg-brand-accent/10 px-6 py-3 text-sm font-semibold text-brand-accent transition-all hover:border-brand-accent/50 cursor-pointer font-sans"
            >
              Enter Coordinates
            </Link>
          </div>
        </div>
      </section>
    </PageTransition>
  )
}
