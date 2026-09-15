import { Link, NavLink } from 'react-router-dom'
import { useState } from 'react'
import { PixellonLogo } from './PixellonLogo'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/world', label: 'World', highlight: true },
  { to: '/news', label: 'News' },
  { to: '/free-games', label: 'Free Games' },
  { to: '/streams', label: 'Streams' },
  { to: '/esports', label: 'Esports' },
  { to: '/indie', label: 'Indie' },
  { to: '/deals', label: 'Deals' },
  { to: '/codex', label: 'Codex' },
  { to: '/profile', label: 'Profile' },
]

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <nav className="sticky top-0 z-50 border-b border-[#1E2638] bg-[#0B0F17]/95 backdrop-blur-md w-full">
      <div className="flex w-full items-center justify-between px-4 sm:px-8 lg:px-12 py-3.5">
        {/* Logo */}
        <Link to="/" className="flex items-center group transition-transform duration-200 hover:scale-[1.02]">
          <PixellonLogo size="md" />
        </Link>

        {/* Desktop Links */}
        <div className="hidden items-center gap-1 lg:gap-2 md:flex">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              className={({ isActive }) => {
                if (link.highlight) {
                  return `px-3 py-1.5 text-sm font-medium transition-all duration-150 rounded-lg border ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.35)]'
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/15 hover:text-emerald-200'
                  }`
                }
                return `px-3 py-1.5 text-sm font-medium transition-all duration-150 rounded-lg ${
                  isActive
                    ? 'bg-brand-primary/15 text-brand-accent border border-brand-primary/30 shadow-[0_0_12px_rgba(37,99,235,0.25)]'
                    : 'text-brand-muted hover:bg-[#151A24] hover:text-brand-text'
                }`
              }}
            >
              {link.label}
            </NavLink>
          ))}
        </div>



        {/* Mobile Toggle */}
        <button
          id="mobile-menu-toggle"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-[#151A24] hover:text-brand-text md:hidden"
          aria-label="Toggle menu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="border-t border-[#1E2638] bg-[#0B0F17] px-4 py-3 md:hidden space-y-1">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => {
                if (link.highlight) {
                  return `block px-3.5 py-2 text-sm font-medium rounded-lg transition-colors border ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                  }`
                }
                return `block px-3.5 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive
                    ? 'bg-brand-primary/15 text-brand-accent border border-brand-primary/30'
                    : 'text-brand-muted hover:bg-[#151A24] hover:text-brand-text'
                }`
              }}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  )
}
