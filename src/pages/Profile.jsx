import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Search, Loader2, Gamepad2, Clock, AlertCircle } from 'lucide-react'
import PageTransition from '../components/PageTransition'
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations'
import SmartImage from '../components/SmartImage'
import { getSteamPlayer } from '../utils/api'

export default function Profile() {
  const [steamId, setSteamId] = useState('')
  const [profile, setProfile] = useState(null)
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!steamId.trim()) return

    setLoading(true)
    setError('')
    setProfile(null)
    setGames([])
    setSearched(true)

    try {
      // One cached request for both profile and library (they used to be two
      // sequential round trips through two separate upstream calls).
      const data = await getSteamPlayer(steamId)
      if (!data?.profile) {
        setError('Profile not found. Ensure the Steam ID is correct and the profile is public.')
        return
      }
      setProfile(data.profile)
      setGames((data.games || []).slice(0, 12))
    } catch (err) {
      setError(
        err?.status === 404
          ? 'Profile not found. Ensure the Steam ID is correct and the profile is public.'
          : 'An error occurred while fetching profile data.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Header */}
        <header className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-10 text-center">
          <PixelPatternBg />
          <div className="relative z-10 max-w-2xl mx-auto space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-primary/30 bg-brand-primary/10 px-4 py-1.5 text-xs font-mono font-medium text-brand-accent">
              <User className="h-4 w-4 text-brand-accent" />
              <span>Player Identity • Steam Sync</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-brand-text">
              Player Profile
            </h1>
            <p className="text-sm sm:text-base text-brand-muted">
              Enter a public 64-bit Steam ID to view live status, total library playtime, and top games.
            </p>
          </div>
        </header>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="mx-auto flex max-w-lg items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-muted" />
            <input
              type="text"
              placeholder="Enter Steam 64-ID (e.g. 76561197960434622)"
              value={steamId}
              onChange={(e) => setSteamId(e.target.value)}
              className="w-full rounded-xl border border-[#1E2638] bg-[#151A24] py-3 pl-10 pr-4 text-sm font-mono text-brand-text placeholder:text-brand-muted focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-brand-primary px-6 py-3 font-mono text-xs font-semibold text-white transition-all hover:bg-brand-primary/85 shadow-[0_0_12px_rgba(37,99,235,0.3)] disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </button>
        </form>

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-xs font-mono text-red-300 flex items-center justify-center gap-2"
          >
            <AlertCircle className="h-4 w-4" />
            {error}
          </motion.div>
        )}

        {profile && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-[#1E2638] bg-[#151A24] p-6 shadow-2xl sm:p-8"
          >
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <img
                src={profile.avatarfull}
                alt={profile.personaname}
                className="h-28 w-28 rounded-2xl border border-brand-primary shadow-xl"
              />
              <div className="flex-1 text-center sm:text-left">
                <h2 className="mb-2 font-display text-2xl sm:text-3xl font-bold text-brand-text">
                  {profile.personaname}
                </h2>
                <div className="mb-4 flex flex-wrap items-center justify-center gap-3 sm:justify-start font-mono text-xs">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${profile.personastate === 1 ? 'bg-brand-accent/20 text-brand-accent border border-brand-accent/40' : 'bg-[#0B0F17] text-brand-muted border border-[#1E2638]'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${profile.personastate === 1 ? 'bg-brand-accent animate-pulse' : 'bg-brand-muted'}`} />
                    {profile.personastate === 1 ? 'Online' : 'Offline'}
                  </span>
                  <a
                    href={profile.profileurl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-accent hover:text-brand-accent2 underline"
                  >
                    View on Steam →
                  </a>
                </div>
              </div>
            </div>

            {/* Top Games */}
            <div className="mt-8 pt-6 border-t border-[#1E2638]">
              <h3 className="mb-5 flex items-center gap-2 font-display text-lg font-bold text-brand-text">
                <Gamepad2 className="h-5 w-5 text-brand-accent" />
                Most Played Games
              </h3>
              
              {games.length > 0 ? (
                <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                  {games.map((game) => (
                    <div key={game.appid} className="flex items-center gap-3.5 rounded-xl bg-[#0B0F17] border border-[#1E2638] p-3">
                      {/* https, not http: the old URL was mixed content on an
                          https page, so browsers blocked the icon entirely. */}
                      <SmartImage
                        src={
                          game.img_icon_url
                            ? `https://media.steampowered.com/steamcommunity/public/images/apps/${game.appid}/${game.img_icon_url}.jpg`
                            : null
                        }
                        alt={game.name}
                        className="h-10 w-10 flex-shrink-0 rounded shadow"
                        widths={[40, 64]}
                        sizes="40px"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-display font-bold text-brand-text" title={game.name}>
                          {game.name}
                        </p>
                        <p className="flex items-center gap-1 text-[11px] font-mono text-brand-muted mt-0.5">
                          <Clock className="h-3 w-3 text-brand-accent" />
                          {Math.round(game.playtime_forever / 60)} hours
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-mono text-brand-muted">No public gameplay data available.</p>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </PageTransition>
  )
}
