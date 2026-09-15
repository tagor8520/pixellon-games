import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Newspaper, Loader2, ExternalLink, Calendar } from 'lucide-react'
import PageTransition from '../components/PageTransition'
import SmartImage from '../components/SmartImage'
import LoadMore from '../components/LoadMore'
import useIncrementalList from '../hooks/useIncrementalList'
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations'
import { getGamingNews } from '../utils/api'

export default function News() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const data = await getGamingNews()
      setArticles(data)
      setLoading(false)
    }
    fetchData()
  }, [])

  const { visible, remaining, loadMore, sentinelRef } = useIncrementalList(articles, { pageSize: 12 })

  const formatDate = (dateString) => {
    const options = { year: 'numeric', month: 'short', day: 'numeric' }
    return new Date(dateString).toLocaleDateString(undefined, options)
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-10">
          <PixelPatternBg />
          <div className="relative z-10 flex items-center justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-brand-accent">
                <Newspaper className="h-5 w-5" />
                <span className="text-xs font-mono font-semibold uppercase tracking-widest">
                  The Daily Feed • Pixellon Dispatch
                </span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-brand-text">
                Gaming News
              </h1>
              <p className="mt-1 text-sm text-brand-muted">
                Real-time updates, industry insights, and breaking headlines.
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
            <p className="text-sm font-mono text-brand-muted">Loading latest news...</p>
          </div>
        ) : (
          <div className="grid gap-5">
            {visible.map((article, i) => (
              <motion.article
                key={article.guid || i}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="list-window-fast group relative flex flex-col gap-6 rounded-xl border border-[#1E2638] bg-[#151A24] p-5 transition-all hover:border-brand-primary hover:shadow-[0_0_20px_rgba(37,99,235,0.2)] sm:flex-row"
              >
                {/* Thumbnail */}
                {(article.enclosure?.link || article.thumbnail) && (
                  <div className="relative aspect-video w-full flex-shrink-0 overflow-hidden rounded-lg sm:w-64 sm:aspect-[4/3]">
                    <SmartImage
                      src={article.thumbnail || article.enclosure?.link}
                      alt={article.title}
                      className="h-full w-full transition-transform duration-500 group-hover:scale-105"
                      ratio="4/3"
                      widths={[160, 240, 320]}
                      sizes="(max-width: 640px) 92vw, 256px"
                    />
                  </div>
                )}
                
                {/* Content */}
                <div className="flex flex-1 flex-col justify-center">
                  <div className="mb-2.5 flex flex-wrap items-center gap-3 text-xs font-mono text-brand-muted">
                    <span className="flex items-center gap-1.5 rounded bg-[#0B0F17] px-2.5 py-1 border border-[#1E2638]">
                      <Calendar className="h-3.5 w-3.5 text-brand-accent" />
                      {formatDate(article.pubDate)}
                    </span>
                    {article.author && <span>By {article.author}</span>}
                  </div>
                  
                  <h2 className="mb-2 font-display text-xl font-bold text-brand-text transition-colors group-hover:text-brand-accent lg:text-2xl line-clamp-2">
                    <a href={article.link} target="_blank" rel="noopener noreferrer" className="after:absolute after:inset-0">
                      {article.title}
                    </a>
                  </h2>
                  
                  <div 
                    className="mb-4 line-clamp-2 text-sm leading-relaxed text-brand-muted"
                    dangerouslySetInnerHTML={{ __html: article.description }} 
                  />

                  <div className="mt-auto flex items-center text-xs font-mono font-semibold text-brand-accent transition-all group-hover:text-brand-accent2">
                    Read Full Article <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </div>
                </div>
              </motion.article>
            ))}

            <LoadMore sentinelRef={sentinelRef} remaining={remaining} onLoadMore={loadMore} label="Older headlines" />
          </div>
        )}
      </div>
    </PageTransition>
  )
}
