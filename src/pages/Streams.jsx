import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Tv, Users, Loader2, Play } from 'lucide-react'
import PageTransition from '../components/PageTransition'
import SmartImage from '../components/SmartImage'
import LoadMore from '../components/LoadMore'
import useIncrementalList from '../hooks/useIncrementalList'
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations'
import { getTopStreams } from '../utils/api'

export default function Streams() {
  const [streams, setStreams] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      const data = await getTopStreams()
      if (cancelled) return
      setStreams(data)
      setLoading(false)
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [])

  // Twitch thumbnails are templated ({width}x{height}) — SmartImage asks for the
  // size the card actually renders instead of the provider default.
  const { visible, remaining, loadMore, sentinelRef } = useIncrementalList(streams, { pageSize: 12 })

  return (
    <PageTransition>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-10">
          <PixelPatternBg />
          <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-brand-accent">
                <Tv className="h-4 w-4" />
                <span className="text-xs font-mono font-semibold uppercase tracking-widest">
                  Live Broadcasts • Twitch Feed
                </span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-text">
                Live Streams
              </h1>
              <p className="mt-1 text-sm text-brand-muted">
                Tune in to real-time broadcasts, pro gameplay, and community channels.
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
            <p className="text-sm font-mono text-brand-muted">Tuning in to live streams...</p>
          </div>
        ) : streams.length === 0 ? (
          <div className="flex min-h-[35vh] flex-col items-center justify-center rounded-2xl border border-dashed border-[#1E2638] bg-[#151A24] p-8 text-center">
            <Tv className="mb-4 h-12 w-12 text-brand-muted" />
            <h2 className="mb-2 font-display text-xl font-bold text-brand-text">No Streams Live Currently</h2>
            <p className="max-w-md text-sm text-brand-muted">
              Live Twitch channels will appear here once broadcasts go live.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((stream, i) => (
              <motion.article
                key={stream.id}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="list-window group relative flex flex-col overflow-hidden rounded-xl border border-[#1E2638] bg-[#151A24] transition-all hover:border-brand-primary hover:shadow-[0_0_20px_rgba(37,99,235,0.25)] hover:-translate-y-1"
              >
                <div className="relative aspect-video overflow-hidden">
                  <SmartImage
                    src={stream.thumbnail_url}
                    alt={stream.title}
                    className="h-full w-full transition-transform duration-500 group-hover:scale-105"
                    ratio="16/9"
                    widths={[320, 480, 640]}
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 320px"
                  />
                  <div className="absolute inset-0 bg-[#0B0F17]/30 group-hover:bg-transparent transition-colors" />
                  
                  <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded bg-red-600 px-2 py-0.5 text-[10px] font-mono font-bold text-white shadow-sm">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    LIVE
                  </div>
                  
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded bg-[#0B0F17]/90 px-2 py-0.5 text-[10px] font-mono font-semibold text-brand-text">
                    <Users className="h-3 w-3 text-brand-accent" />
                    {new Intl.NumberFormat('en-US').format(stream.viewer_count)}
                  </div>
                  
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary/90 text-white shadow-lg transition-transform group-hover:scale-110">
                      <Play className="h-5 w-5 ml-0.5" />
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-mono font-bold text-brand-accent">
                      {stream.user_name}
                    </span>
                    <span className="truncate rounded bg-[#0B0F17] px-2 py-0.5 text-[10px] font-mono text-brand-muted border border-[#1E2638]">
                      {stream.game_name}
                    </span>
                  </div>
                  <h3 className="line-clamp-2 text-sm font-display font-medium text-brand-text group-hover:text-brand-accent transition-colors" title={stream.title}>
                    <a href={`https://twitch.tv/${stream.user_login}`} target="_blank" rel="noopener noreferrer" className="after:absolute after:inset-0">
                      {stream.title}
                    </a>
                  </h3>
                </div>
              </motion.article>
            ))}
          </div>
        )}

        <LoadMore sentinelRef={sentinelRef} remaining={remaining} onLoadMore={loadMore} label="More streams" />
      </div>
    </PageTransition>
  )
}
