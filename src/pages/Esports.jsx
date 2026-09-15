import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Trophy, Calendar, Clock, Loader2, Gamepad2, Shield } from 'lucide-react'
import PageTransition from '../components/PageTransition'
import SmartImage from '../components/SmartImage'
import LoadMore from '../components/LoadMore'
import useIncrementalList from '../hooks/useIncrementalList'
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations'
import { getEsportsMatches } from '../utils/api'

export default function Esports() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      const data = await getEsportsMatches()
      if (cancelled) return
      setMatches(data)
      setLoading(false)
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [])

  const { visible, remaining, loadMore, sentinelRef } = useIncrementalList(matches, { pageSize: 12 })

  const formatMatchTime = (dateString) => {
    const date = new Date(dateString)
    const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    return date.toLocaleString(undefined, options)
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-10">
          <PixelPatternBg />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-brand-accent">
                <Trophy className="h-4 w-4" />
                <span className="text-xs font-mono font-semibold uppercase tracking-widest">
                  Competitive Arena • Pro Schedule
                </span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-text">
                Pro Esports Matches
              </h1>
              <p className="mt-1 text-sm text-brand-muted">
                Live match trackers and confirmed fixtures across global tournament circuits.
              </p>
            </div>
            <div className="hidden sm:block">
              <PixelCross size={24} />
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
            <Loader2 className="h-10 w-10 animate-spin text-brand-primary" />
            <p className="text-sm font-mono text-brand-muted">Loading match schedule...</p>
          </div>
        ) : matches.length === 0 ? (
          <div className="flex min-h-[35vh] flex-col items-center justify-center rounded-2xl border border-dashed border-[#1E2638] bg-[#151A24] p-8 text-center">
            <Shield className="mb-4 h-12 w-12 text-brand-muted" />
            <h2 className="mb-2 font-display text-xl font-bold text-brand-text">No Matches Found</h2>
            <p className="max-w-md text-sm text-brand-muted">
              Upcoming tournament matches will populate once circuit schedules publish.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((match, i) => (
              <motion.article
                key={match.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="list-window group flex flex-col overflow-hidden rounded-xl border border-[#1E2638] bg-[#151A24] transition-all hover:border-brand-primary hover:shadow-[0_0_20px_rgba(37,99,235,0.25)]"
              >
                {/* League Header */}
                <div className="flex items-center gap-3 border-b border-[#1E2638] bg-[#0B0F17] px-5 py-3">
                  {match.league.image_url ? (
                    <SmartImage
                      src={match.league.image_url}
                      alt={match.league.name}
                      className="h-7 w-7"
                      objectFit="contain"
                      widths={[48]}
                      sizes="28px"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-[#151A24] border border-[#1E2638]">
                      <Gamepad2 className="h-3.5 w-3.5 text-brand-muted" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-xs font-mono font-bold text-brand-text">{match.league.name}</p>
                    <p className="truncate text-[10px] font-mono text-brand-muted">{match.serie?.full_name}</p>
                  </div>
                  {match.videogame && (
                    <span className="rounded bg-brand-primary/15 border border-brand-primary/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-brand-accent">
                      {match.videogame.name}
                    </span>
                  )}
                </div>

                {/* Matchup */}
                <div className="flex flex-1 flex-col p-5">
                  <div className="mb-6 flex flex-1 items-center justify-between gap-4">
                    {/* Team 1 */}
                    <div className="flex flex-1 flex-col items-center gap-2 text-center">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-[#0B0F17] p-2 border border-[#1E2638]">
                        {match.opponents[0]?.opponent?.image_url ? (
                          <img src={match.opponents[0].opponent.image_url} alt={match.opponents[0].opponent.name} className="h-full w-full object-contain" />
                        ) : (
                          <Shield className="h-8 w-8 text-brand-muted" />
                        )}
                      </div>
                      <span className="text-xs font-display font-bold text-brand-text line-clamp-2">
                        {match.opponents[0]?.opponent?.name || 'TBD'}
                      </span>
                    </div>
                    
                    {/* VS */}
                    <div className="flex flex-col items-center justify-center">
                      <span className="font-mono text-xl font-black italic text-brand-accent transition-colors">
                        VS
                      </span>
                    </div>

                    {/* Team 2 */}
                    <div className="flex flex-1 flex-col items-center gap-2 text-center">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-[#0B0F17] p-2 border border-[#1E2638]">
                        {match.opponents[1]?.opponent?.image_url ? (
                          <img src={match.opponents[1].opponent.image_url} alt={match.opponents[1].opponent.name} className="h-full w-full object-contain" />
                        ) : (
                          <Shield className="h-8 w-8 text-brand-muted" />
                        )}
                      </div>
                      <span className="text-xs font-display font-bold text-brand-text line-clamp-2">
                        {match.opponents[1]?.opponent?.name || 'TBD'}
                      </span>
                    </div>
                  </div>

                  {/* Match Info */}
                  <div className="mt-auto flex flex-col gap-1.5 rounded-lg bg-[#0B0F17] p-3 text-xs font-mono border border-[#1E2638]">
                    <div className="flex items-center gap-2 text-brand-muted">
                      <Calendar className="h-3.5 w-3.5 text-brand-accent" />
                      <span className="font-medium text-brand-text">{formatMatchTime(match.begin_at)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-brand-muted">
                      <Clock className="h-3.5 w-3.5 text-brand-accent" />
                      <span>Best of {match.number_of_games || 3}</span>
                    </div>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}

        {!loading && (
          <LoadMore sentinelRef={sentinelRef} remaining={remaining} onLoadMore={loadMore} label="More matches" />
        )}
      </div>
    </PageTransition>
  )
}
