import { Component } from 'react'

/**
 * ErrorBoundary — one broken panel must not blank the whole site.
 *
 * Recovery is by remount: `App` gives the boundary `key={location.pathname}`, so
 * navigating away from a broken screen resets it without any setState-in-update
 * gymnastics (which oxlint rightly flags).
 *
 * Every page here renders data from a third-party API, so partial failure is
 * normal (a dead feed, an expired key, a 502 upstream). Before, a single thrown
 * render error unmounted the entire React tree — the user got a white screen
 * and the only clue was a console log. This keeps the shell (nav, footer, cat)
 * alive and offers a retry.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Keep the console signal for local development…
    if (import.meta.env.DEV) console.error('[ErrorBoundary]', error, info?.componentStack)
    // …and forward to a collector when one exists, without ever throwing.
    try {
      window.__pixellonErrors?.push?.({ message: String(error?.message || error), at: Date.now() })
    } catch {
      /* ignore */
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center gap-4 px-6 py-20 text-center">
        <div className="rounded-xl border border-[#1E2638] bg-[#151A24] p-8">
          <h1 className="font-display text-2xl font-bold text-brand-text">This section hit an error</h1>
          <p className="mt-2 text-sm text-brand-muted">
            The rest of Pixellon is still working. You can retry this view, or head back home.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg border border-[#1E2638] bg-[#0B0F17] p-3 text-left font-mono text-[11px] text-brand-muted">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ error: null, info: null })}
              className="rounded-lg bg-brand-primary px-4 py-2 text-xs font-mono font-bold text-white transition-colors hover:bg-brand-primary/85"
            >
              Retry
            </button>
            <a
              href="/"
              className="rounded-lg border border-[#1E2638] px-4 py-2 text-xs font-mono font-bold text-brand-text transition-colors hover:border-brand-accent/50"
            >
              Go home
            </a>
          </div>
        </div>
      </div>
    )
  }
}
