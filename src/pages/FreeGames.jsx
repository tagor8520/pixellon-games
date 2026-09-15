import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Gift, Filter, Loader2, Monitor, LayoutGrid } from 'lucide-react'
import PageTransition from '../components/PageTransition'
import SmartImage from '../components/SmartImage'
import LoadMore from '../components/LoadMore'
import useIncrementalList from '../hooks/useIncrementalList'
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations'
import { getFreeGames } from '../utils/api'

export default function FreeGames() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [platform, setPlatform] = useState('all')

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      const data = await getFreeGames(platform)
      // Guarded: switching platform quickly (or navigating away) must not write
      // state into an unmounted tree.
      if (cancelled) return
      setGames(data)
      setLoading(false)
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [platform])

  // The free-to-play catalogue can return dozens of cards per platform; mount
  // them in windows so switching platform filters stays instant.
  const { visible, remaining, loadMore, sentinelRef } = useIncrementalList(games, { pageSize: 16 })

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-12 text-center">
          <PixelPatternBg />
          <div className="relative z-10 max-w-3xl mx-auto space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-4 py-1.5 text-xs font-mono font-medium text-brand-accent">
              <Gift className="h-4 w-4 text-brand-accent" />
              <span>100% Free to Play • Zero Cost</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-brand-text">
              Free Games{' '}
              <span className="text-brand-primary">
                Vault
              </span>
            </h1>
            <p className="mx-auto max-w-xl text-base sm:text-lg text-brand-muted leading-relaxed">
              Discover top-rated free-to-play gems available right now. Keep your wallet closed and your library stacked.
            </p>
          </div>
        </header>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-[#1E2638] bg-[#151A24] p-4">
          <div className="flex items-center gap-2 text-xs font-mono font-medium text-brand-muted">
            <Filter className="h-4 w-4 text-brand-accent" />
            <span>PLATFORM FILTER</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'All Platforms', icon: LayoutGrid },
              { id: 'pc', label: 'PC (Windows)', icon: Monitor },
              { id: 'browser', label: 'Web Browser', icon: LayoutGrid },
            ].map((p) => {
              const Icon = p.icon
              const isActive = platform === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-mono font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'bg-brand-primary text-white shadow-[0_0_12px_rgba(37,99,235,0.4)]'
                      : 'bg-[#0B0F17] text-brand-muted hover:bg-[#1A2232] hover:text-brand-text border border-[#1E2638]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Game Grid */}
        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-brand-primary" />
            <p className="text-sm font-mono text-brand-muted">Hunting for free games...</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((game, i) => (
              <motion.article
                key={game.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="list-window group flex h-full flex-col overflow-hidden rounded-xl border border-[#1E2638] bg-[#151A24] transition-all duration-300 hover:-translate-y-1 hover:border-brand-primary hover:shadow-[0_0_20px_rgba(37,99,235,0.25)]"
              >
                <div className="relative aspect-[16/9] overflow-hidden">
                  <SmartImage
                    src={game.thumbnail}
                    alt={game.title}
                    className="h-full w-full transition-transform duration-700 group-hover:scale-105"
                    ratio="16/9"
                    widths={[320, 480, 640]}
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 320px"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/40 to-transparent" />
                  <div className="absolute right-3 top-3 rounded bg-brand-primary px-2.5 py-0.5 text-[10px] font-mono font-bold text-white shadow-md">
                    FREE
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-accent">
                      {game.genre}
                    </span>
                    <span className="rounded border border-[#1E2638] bg-[#0B0F17] px-2 py-0.5 text-[10px] font-mono font-semibold text-brand-muted">
                      {game.platform === 'PC (Windows)' ? 'PC' : 'Web'}
                    </span>
                  </div>
                  <h3 className="mb-2 font-display text-lg font-bold text-brand-text transition-colors group-hover:text-brand-accent line-clamp-1">
                    {game.title}
                  </h3>
                  <p className="mb-5 text-sm leading-relaxed text-brand-muted line-clamp-2">
                    {game.short_description}
                  </p>
                  <div className="mt-auto">
                    <a
                      href={game.game_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full rounded-lg bg-brand-primary/15 border border-brand-primary/30 px-4 py-2.5 text-center text-xs font-mono font-semibold text-brand-accent transition-all duration-200 hover:bg-brand-primary hover:text-white hover:shadow-[0_0_12px_rgba(37,99,235,0.35)] cursor-pointer"
                    >
                      Get Game →
                    </a>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}

        {!loading && (
          <LoadMore sentinelRef={sentinelRef} remaining={remaining} onLoadMore={loadMore} label="More free games" />
        )}
      </div>
    </PageTransition>
  )
}
