import { lazy, Suspense } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import PixelCat from './components/PixelCat/PixelCat'
import ErrorBoundary from './components/ErrorBoundary'

/**
 * Route-level code splitting.
 *
 * Before: every page — including `react-markdown` + `remark-gfm` for the Codex
 * and `framer-motion` for six pages — was in one 648 KB bundle every visitor
 * downloaded before seeing anything.
 *
 * Now the shell (React + router + nav) loads first and each page arrives as its
 * own chunk on navigation. That also means the catalog can grow to thousands of
 * routes without the first paint getting heavier — the wiki is one lazy route,
 * not one module per game.
 */
const Home = lazy(() => import('./pages/Home'))
const Indie = lazy(() => import('./pages/Indie'))
const Reviews = lazy(() => import('./pages/Reviews'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Deals = lazy(() => import('./pages/Deals'))
const Gateway = lazy(() => import('./pages/Gateway'))
const GameWiki = lazy(() => import('./pages/GameWiki'))
const CodexHub = lazy(() => import('./pages/CodexHub'))
const FreeGames = lazy(() => import('./pages/FreeGames'))
const News = lazy(() => import('./pages/News'))
const Streams = lazy(() => import('./pages/Streams'))
const Esports = lazy(() => import('./pages/Esports'))
const Profile = lazy(() => import('./pages/Profile'))
const World = lazy(() => import('./pages/World'))

/** Shown while a route chunk downloads — matches the app's loading language. */
function RouteFallback() {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-7xl items-center justify-center px-6 py-20">
      <div
        className="h-10 w-10 animate-spin rounded-full border-4 border-[#1E2638] border-t-brand-primary"
        role="status"
        aria-label="Loading"
      />
    </div>
  )
}

export default function App() {
  const location = useLocation()

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<RouteFallback />}>
            {/* `key` on Routes is what remounts the page per pathname, which is
                also what re-triggers the CSS enter animation in PageTransition.
                No AnimatePresence needed — that import alone used to pull the
                whole motion library into the entry chunk. */}
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Home />} />
              <Route path="/indie" element={<Indie />} />
              <Route path="/reviews" element={<Reviews />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/deals" element={<Deals />} />
              <Route path="/gateway" element={<Gateway />} />
              <Route path="/codex" element={<CodexHub />} />
              <Route path="/codex/:gameId" element={<GameWiki />} />
              <Route path="/codex/:gameId/:pageId" element={<GameWiki />} />
              <Route path="/free-games" element={<FreeGames />} />
              <Route path="/news" element={<News />} />
              <Route path="/streams" element={<Streams />} />
              <Route path="/esports" element={<Esports />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/world" element={<World />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      <PixelCat />
    </div>
  )
}
