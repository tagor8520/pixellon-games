import { useState, useEffect } from 'react'
import { Tag, Loader2, ExternalLink } from 'lucide-react'
import PageTransition from '../components/PageTransition'
import SmartImage from '../components/SmartImage'
import LoadMore from '../components/LoadMore'
import useIncrementalList from '../hooks/useIncrementalList'
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations'
import { getDeals } from '../utils/api'

export default function Deals() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function fetchDeals() {
      try {
        // CheapShark via our cached route: one upstream call per 10 minutes for
        // the whole site instead of one per visitor.
        const data = await getDeals()
        if (!cancelled) setDeals(data)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDeals()
    return () => {
      cancelled = true
    }
  }, [])

  // 60 deals is 60 images and 60 cards; mount them in windows instead.
  const { visible, remaining, loadMore, sentinelRef } = useIncrementalList(deals, { pageSize: 24 })

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-8">
      {/* Header */}
      <section id="deals-header" className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-10">
        <PixelPatternBg />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-brand-accent">
              <Tag className="h-4 w-4" />
              <span className="text-xs font-mono font-semibold uppercase tracking-widest">
                Price Drops • Steam & Digital
              </span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-text">
              Real-Time Game Deals
            </h1>
            <p className="mt-1 text-sm text-brand-muted">
              Live PC game sales and maximum savings tracker powered by CheapShark.
            </p>
          </div>
          <div className="hidden sm:block">
            <PixelCross size={24} />
          </div>
        </div>
      </section>

      {loading && (
        <div className="flex justify-center items-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1E2638] border-t-brand-primary"></div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-6 py-4 text-center text-xs font-mono text-red-300">
          Error loading deals: {error}
        </div>
      )}

      {!loading && !error && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((deal) => (
            <a
              key={deal.dealID}
              href={`https://www.cheapshark.com/redirect?dealID=${deal.dealID}`}
              target="_blank"
              rel="noopener noreferrer"
              className="list-window group flex flex-col overflow-hidden rounded-xl border border-[#1E2638] bg-[#151A24] transition-all hover:border-brand-primary hover:shadow-[0_0_20px_rgba(37,99,235,0.25)] hover:-translate-y-1 cursor-pointer"
            >
              <div className="relative aspect-[16/9] overflow-hidden bg-[#0B0F17] p-2">
                <SmartImage
                  src={deal.thumb}
                  alt={deal.title}
                  className="h-full w-full transition-transform duration-500 group-hover:scale-105"
                  objectFit="contain"
                  ratio="16/9"
                  widths={[240, 360]}
                  sizes="(max-width: 640px) 45vw, 240px"
                />
                <div className="absolute right-2.5 top-2.5 rounded bg-brand-primary px-2 py-0.5 text-xs font-mono font-bold text-white shadow-md">
                  -{Math.round(deal.savings)}%
                </div>
              </div>
              
              <div className="flex flex-1 flex-col justify-between p-4">
                <h3 className="mb-3 font-display text-sm font-bold text-brand-text group-hover:text-brand-accent line-clamp-2">
                  {deal.title}
                </h3>
                
                <div className="flex items-end justify-between mt-auto pt-2 border-t border-[#1E2638]">
                  <div className="flex flex-col font-mono">
                    <span className="text-[11px] text-brand-muted line-through">${deal.normalPrice}</span>
                    <span className="text-base font-bold text-brand-accent">${deal.salePrice}</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-brand-accent group-hover:text-brand-accent2 transition-colors">
                    Claim Deal →
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {!loading && !error && (
        <LoadMore sentinelRef={sentinelRef} remaining={remaining} onLoadMore={loadMore} label="More deals" />
      )}
    </PageTransition>
  )
}
