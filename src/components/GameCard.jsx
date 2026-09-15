import SmartImage from './SmartImage'

const TAG_COLORS = {
  blue: 'bg-brand-primary/15 text-brand-accent border-brand-primary/30',
  accent: 'bg-brand-accent/15 text-brand-accent2 border-brand-accent/30',
  violet: 'bg-brand-primary/15 text-brand-accent border-brand-primary/30',
  cyan: 'bg-brand-accent/15 text-brand-accent2 border-brand-accent/30',
  amber: 'bg-brand-primary/15 text-brand-accent3 border-brand-primary/30',
  emerald: 'bg-brand-accent/15 text-brand-text border-brand-accent/30',
}

/**
 * Reusable game card component used across all pages.
 */
export default function GameCard({
  title,
  genre,
  platform = [],
  rating,
  image,
  excerpt,
  tag,
  tagColor = 'blue',
  verdict,
  developer,
  variant = 'default',
  onClick,
}) {
  if (variant === 'featured') {
    return (
      <article
        onClick={onClick}
        className="list-window group relative overflow-hidden rounded-xl border border-[#1E2638] bg-[#151A24] transition-all duration-300 hover:border-brand-primary hover:shadow-[0_0_20px_rgba(37,99,235,0.25)] hover:-translate-y-1 cursor-pointer"
      >
        <div className="relative aspect-[16/9] overflow-hidden">
          <SmartImage
            src={image}
            alt={title}
            className="h-full w-full transition-transform duration-700 group-hover:scale-105"
            widths={[640, 960, 1280]}
            sizes="(max-width: 1024px) 92vw, 720px"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/50 to-transparent" />

          {/* Tag */}
          {tag && (
            <div className="absolute left-4 top-4">
              <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-mono font-semibold border ${TAG_COLORS[tagColor] || TAG_COLORS.blue}`}>
                {tag}
              </span>
            </div>
          )}

          {/* Rating */}
          {rating && (
            <div className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg border border-[#1E2638] bg-[#0B0F17]/90 shadow-md">
              <span className="text-sm font-bold font-mono text-brand-accent">{rating}</span>
            </div>
          )}

          {/* Content over image */}
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-brand-accent">
                {genre}
              </span>
              <span className="text-brand-muted">•</span>
              <span className="text-xs font-medium text-brand-text/80">{platform.join(' / ')}</span>
            </div>
            <h3 className="font-display text-2xl font-bold text-brand-text transition-colors group-hover:text-brand-accent">
              {title}
            </h3>
            {excerpt && (
              <p className="mt-2 text-sm leading-relaxed text-brand-muted line-clamp-2">{excerpt}</p>
            )}
          </div>
        </div>
      </article>
    )
  }

  if (variant === 'compact') {
    return (
      <article
        onClick={onClick}
        className="group flex gap-4 rounded-xl border border-[#1E2638] bg-[#151A24] p-3 transition-all duration-200 hover:border-brand-primary/50 hover:shadow-md cursor-pointer"
      >
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
          <SmartImage
            src={image}
            alt={title}
            className="h-full w-full transition-transform duration-500 group-hover:scale-105"
            widths={[80, 160]}
            sizes="80px"
          />
          {rating && (
            <div className="absolute bottom-1 right-1 flex h-5 w-7 items-center justify-center rounded bg-[#0B0F17] border border-[#1E2638]">
              <span className="text-[10px] font-mono font-bold text-brand-accent">{rating}</span>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col justify-center">
          <h4 className="text-sm font-display font-bold text-brand-text transition-colors group-hover:text-brand-accent truncate">
            {title}
          </h4>
          <p className="mt-1 text-xs text-brand-muted font-medium truncate">
            {genre} • {platform.join(', ')}
          </p>
          {verdict && (
            <span className={`mt-2 inline-flex w-fit items-center rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider border ${TAG_COLORS[tagColor] || TAG_COLORS.blue}`}>
              {verdict}
            </span>
          )}
        </div>
      </article>
    )
  }

  // Default variant
  return (
    <article
      onClick={onClick}
      className="list-window group flex flex-col h-full overflow-hidden rounded-xl border border-[#1E2638] bg-[#151A24] transition-all duration-200 hover:border-brand-primary hover:shadow-[0_0_16px_rgba(37,99,235,0.2)] hover:-translate-y-1 cursor-pointer"
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <SmartImage
          src={image}
          alt={title}
          className="h-full w-full transition-transform duration-700 group-hover:scale-105"
          widths={[320, 480, 640]}
          sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 380px"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#151A24] via-[#151A24]/30 to-transparent opacity-80 group-hover:opacity-60 transition-opacity" />

        {tag && (
          <div className="absolute left-3 top-3">
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider border ${TAG_COLORS[tagColor] || TAG_COLORS.blue}`}>
              {tag}
            </span>
          </div>
        )}

        {rating && (
          <div className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg border border-[#1E2638] bg-[#0B0F17]/90 shadow-sm">
            <span className="text-xs font-mono font-bold text-brand-accent">{rating}</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-brand-accent">
            {genre}
          </span>
          {developer && (
            <>
              <span className="text-brand-muted">•</span>
              <span className="text-[11px] font-medium text-brand-muted truncate">{developer}</span>
            </>
          )}
        </div>
        <h3 className="font-display text-lg font-bold text-brand-text transition-colors group-hover:text-brand-accent line-clamp-1">
          {title}
        </h3>
        {excerpt && (
          <p className="mt-2 text-sm leading-relaxed text-brand-muted line-clamp-2">{excerpt}</p>
        )}
        <div className="mt-auto pt-4 flex flex-wrap gap-1.5">
          {platform.map((p) => (
            <span
              key={p}
              className="rounded border border-[#1E2638] bg-[#0B0F17] px-2 py-0.5 text-[10px] font-mono font-medium text-brand-muted"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </article>
  )
}
