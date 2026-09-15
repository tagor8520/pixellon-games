import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, BookOpen, Loader2 } from 'lucide-react';
import PageTransition from '../components/PageTransition';
import SmartImage from '../components/SmartImage';
import { PixelPatternBg, PixelCross } from '../components/BrandDecorations';
import { getGamesByGenre, searchGames } from '../utils/api';
import { searchContentIndex } from '../data/contentIndex';

const CATEGORIES = [
  { id: 'role-playing-games-rpg', title: 'Role-Playing Games' },
  { id: 'action', title: 'Action & Adventure' },
  { id: 'shooter', title: 'Shooters' },
  { id: 'strategy', title: 'Strategy & Tactics' },
];

export default function CodexHub() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [categoryData, setCategoryData] = useState({});
  const [loadingCategories, setLoadingCategories] = useState(true);

  useEffect(() => {
    async function loadCategories() {
      const data = {};
      try {
        await Promise.all(
          CATEGORIES.map(async (cat) => {
            const games = await getGamesByGenre(cat.id);
            data[cat.id] = games;
          })
        );
        setCategoryData(data);
      } catch (err) {
        console.error('Failed to load codex categories', err);
      } finally {
        setLoadingCategories(false);
      }
    }
    loadCategories();
  }, []);

  useEffect(() => {
    const term = searchQuery.trim();
    if (term.length < 3) {
      setSearchResults([]);
      return undefined;
    }

    // Local content index first: authored Codex pages are searched in the
    // browser from a small shard, so typing costs zero upstream quota. Only if
    // that comes back empty do we spend a cached API search.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const local = await searchContentIndex(term, { limit: 6 });
        if (local.length) {
          setSearchResults(
            local.map((entry) => ({
              id: entry.id,
              title: entry.title,
              genre: entry.genre || 'Codex',
              developer: entry.platforms?.join(' • '),
              image: entry.banner || null,
            })),
          );
          return;
        }
        setSearchResults(await searchGames(term, { signal: controller.signal }));
      } catch (error) {
        if (error?.name !== 'AbortError' && import.meta.env.DEV) console.warn(error);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  const GameGrid = ({ games }) => (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {games.map(game => (
        <Link
          key={game.id}
          to={`/codex/${game.id}`}
          className="list-window group block rounded-xl bg-[#151A24] border border-[#1E2638] hover:border-brand-primary transition-all overflow-hidden shadow-sm hover:shadow-[0_0_20px_rgba(37,99,235,0.25)] hover:-translate-y-1"
        >
          <div className="relative h-56 w-full overflow-hidden border-b border-[#1E2638] group-hover:border-brand-primary/50 transition-colors">
            <SmartImage
              src={game.image}
              alt={game.title}
              className="w-full h-full transition-transform duration-700 group-hover:scale-105"
              widths={[320, 480, 640]}
              sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 380px"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0B0F17] via-[#0B0F17]/40 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
              <h2 className="font-display text-xl sm:text-2xl font-bold text-brand-text drop-shadow group-hover:text-brand-accent transition-colors">
                {game.title}
              </h2>
            </div>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-2">
              <span className="text-xs font-mono font-medium bg-[#0B0F17] text-brand-accent px-2.5 py-1 rounded border border-[#1E2638]">
                {game.genre}
              </span>
              {game.developer && (
                <span className="text-xs font-mono font-medium bg-[#0B0F17] text-brand-muted px-2.5 py-1 rounded border border-[#1E2638]">
                  {game.developer}
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );

  return (
    <PageTransition className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12 min-h-screen space-y-12">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-[#1E2638] bg-[#151A24] p-8 sm:p-10">
        <PixelPatternBg />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-primary/20 border border-brand-primary/40 text-brand-accent">
                <BookOpen size={26} />
              </div>
              <div>
                <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-brand-text">
                  The Codex
                </h1>
                <p className="text-xs font-mono text-brand-accent2 uppercase tracking-widest mt-0.5">
                  Universal Gaming Encyclopedia
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm sm:text-base text-brand-muted max-w-xl">
              Comprehensive game lore, wiki mechanics, live Steam stats, and Twitch streams.
            </p>
          </div>

          <div className="w-full md:w-80">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted" size={18} />
              <input 
                type="text" 
                placeholder="Search games, lore, titles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl bg-[#0B0F17] border border-[#1E2638] pl-10 pr-10 py-3 text-sm text-brand-text placeholder:text-brand-muted focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary transition-all font-sans"
              />
              {isSearching && (
                <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-accent animate-spin" size={18} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {searchQuery.length > 2 ? (
        <section className="animate-fade-up">
          <div className="flex items-center gap-2 mb-6">
            <PixelCross size={14} />
            <h2 className="font-display text-xl font-bold text-brand-text">
              Search Results for "{searchQuery}"
            </h2>
          </div>
          {searchResults.length > 0 ? (
            <GameGrid games={searchResults} />
          ) : !isSearching ? (
            <div className="py-20 flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-[#1E2638] bg-[#151A24] p-8">
              <Search className="text-brand-muted mb-4" size={48} />
              <h3 className="font-display text-xl font-bold text-brand-text mb-2">No games found</h3>
              <p className="text-sm text-brand-muted">Try adjusting your search terms.</p>
            </div>
          ) : null}
        </section>
      ) : loadingCategories ? (
        <div className="flex justify-center items-center py-32">
          <Loader2 className="animate-spin text-brand-primary" size={48} />
        </div>
      ) : (
        <div className="space-y-14">
          {CATEGORIES.map(cat => (
            <section key={cat.id} className="animate-fade-up">
              <div className="flex items-center gap-3 mb-6 pb-2 border-b border-[#1E2638]">
                <span className="h-4 w-1.5 bg-brand-primary" />
                <h2 className="text-2xl font-display font-bold text-brand-text">
                  {cat.title}
                </h2>
              </div>
              <GameGrid games={categoryData[cat.id] || []} />
            </section>
          ))}
        </div>
      )}
    </PageTransition>
  );
}
