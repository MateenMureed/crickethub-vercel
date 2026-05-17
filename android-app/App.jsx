import { lazy, Suspense, useContext, useEffect, useRef, useCallback, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from './context/AuthContext'
import { useDataStore } from './context/DataStore'

import BottomTabBar from './components/BottomTabBar'
import Navbar from './components/Navbar'

// Lazy-loaded detail/admin pages (not persistent tabs)
const AdminLogin = lazy(() => import('./pages/AdminLogin'))
const LeagueHub = lazy(() => import('./pages/LeagueHub'))
const LiveMatch = lazy(() => import('./pages/LiveMatch'))
const MatchScorecard = lazy(() => import('./pages/MatchScorecard'))
const AdminPanel = lazy(() => import('./pages/AdminPanel'))
const LiveScoring = lazy(() => import('./pages/LiveScoring'))

// Persistent tab pages — loaded eagerly after first render for instant switching
const HomePage = lazy(() => import('./pages/HomePage'))
const LeaguesPage = lazy(() => import('./pages/LeaguesPage'))
const LiveMatchesPage = lazy(() => import('./pages/LiveMatchesPage'))
const ResultsPage = lazy(() => import('./pages/ResultsPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const FixturesPage = lazy(() => import('./pages/FixturesPage'))

import {
  notificationsEnabled,
  startMatchNotificationWatcher,
  hasPromptedNotifications,
  requestMatchNotificationPermission,
  setupNotificationDeepLinkHandler,
} from './utils/notifications'

const RouteSkeleton = () => (
  <div style={{ padding: 14, display: 'grid', gap: 10 }}>
    <div className="skeleton" style={{ height: 140 }} />
    <div className="skeleton" style={{ height: 96 }} />
    <div className="skeleton" style={{ height: 96 }} />
  </div>
)

// ─── Persistent tab definitions ────────────────────────────────────────────────
const TAB_PATHS = ['/', '/leagues', '/live', '/results', '/stats', '/fixtures']

const isTabPath = (pathname) => TAB_PATHS.includes(pathname)

const matchesTab = (tabPath, pathname) => {
  if (tabPath === '/') return pathname === '/'
  return pathname === tabPath
}

// ─── Tab mount tracker: only mount a tab after the user first visits it ────────
function useMountedTabs(pathname) {
  const [mounted, setMounted] = useState(new Set([pathname]))

  useEffect(() => {
    if (isTabPath(pathname) && !mounted.has(pathname)) {
      setMounted((prev) => new Set(prev).add(pathname))
    }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  return mounted
}

export default function App() {
  const { user } = useContext(AuthContext)
  const navigate = useNavigate()
  const location = useLocation()
  const { isOnline } = useDataStore()
  const pathname = location.pathname

  // Is the current path a persistent tab or a detail page?
  const isOnTab = isTabPath(pathname)

  // Track which tabs have been mounted (lazy mount on first visit)
  const mountedTabs = useMountedTabs(pathname)

  // ── First-launch notification permission prompt ──────────────────────────
  const [showNotifPrompt, setShowNotifPrompt] = useState(false)

  useEffect(() => {
    // Show prompt on first launch after 1.5s delay
    if (!hasPromptedNotifications()) {
      const timer = setTimeout(() => setShowNotifPrompt(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleNotifAllow = async () => {
    await requestMatchNotificationPermission()
    setShowNotifPrompt(false)
  }

  const handleNotifDismiss = () => {
    setShowNotifPrompt(false)
    // Mark as prompted so we don't ask again
    import('./utils/notifications').then(m => m.markNotificationPrompted())
  }

  // ── Notification watcher ─────────────────────────────────────────────────
  useEffect(() => {
    if (!notificationsEnabled()) return
    const stop = startMatchNotificationWatcher({ intervalMs: 25000 })
    return () => stop?.()
  }, [])

  // ── Deep link handler for notification taps ──────────────────────────────
  useEffect(() => {
    return setupNotificationDeepLinkHandler((url) => {
      navigate(url)
    })
  }, [navigate])

  // ── Scroll position preservation ─────────────────────────────────────────
  const scrollPositions = useRef({})
  const mainRef = useRef(null)
  const previousPath = useRef(pathname)

  useEffect(() => {
    const main = mainRef.current
    if (!main) return

    // Save scroll position of the path we're leaving
    if (previousPath.current !== pathname) {
      scrollPositions.current[previousPath.current] = main.scrollTop
      previousPath.current = pathname
    }

    // Restore scroll position for the path we're entering
    if (isOnTab) {
      requestAnimationFrame(() => {
        main.scrollTop = scrollPositions.current[pathname] || 0
      })
    } else {
      // Detail pages always start at top
      main.scrollTop = 0
    }
  }, [pathname, isOnTab])

  return (
    <div className="app-wrapper ios-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--t1)' }}>
      <Navbar />
      {!isOnline && (
        <div style={{
          margin: '8px 12px 0',
          padding: '7px 10px',
          borderRadius: 10,
          border: '1px solid rgba(245,158,11,.34)',
          background: 'rgba(245,158,11,.12)',
          color: 'var(--gold)',
          fontSize: '0.72rem',
          fontWeight: 700,
          letterSpacing: '.4px',
          textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          Offline Mode · showing cached data
        </div>
      )}
      <main ref={mainRef} className="ios-main-scroll" style={{ flex: 1, paddingBottom: '84px', overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'auto', touchAction: 'pan-y', transform: 'translateZ(0)' }}>

        {/* ═══ Persistent Tab Pages ═══════════════════════════════════════════
             These components stay mounted once visited. Visibility is toggled
             via display:none/block so state, scroll, and DOM are preserved. */}

        {mountedTabs.has('/') && (
          <div style={{ display: matchesTab('/', pathname) ? 'block' : 'none' }}>
            <Suspense fallback={<RouteSkeleton />}>
              <HomePage />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('/leagues') && (
          <div style={{ display: matchesTab('/leagues', pathname) ? 'block' : 'none' }}>
            <Suspense fallback={<RouteSkeleton />}>
              <LeaguesPage />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('/live') && (
          <div style={{ display: matchesTab('/live', pathname) ? 'block' : 'none' }}>
            <Suspense fallback={<RouteSkeleton />}>
              <LiveMatchesPage />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('/results') && (
          <div style={{ display: matchesTab('/results', pathname) ? 'block' : 'none' }}>
            <Suspense fallback={<RouteSkeleton />}>
              <ResultsPage />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('/stats') && (
          <div style={{ display: matchesTab('/stats', pathname) ? 'block' : 'none' }}>
            <Suspense fallback={<RouteSkeleton />}>
              <StatsPage />
            </Suspense>
          </div>
        )}

        {mountedTabs.has('/fixtures') && (
          <div style={{ display: matchesTab('/fixtures', pathname) ? 'block' : 'none' }}>
            <Suspense fallback={<RouteSkeleton />}>
              <FixturesPage />
            </Suspense>
          </div>
        )}

        {/* ═══ Detail Routes (non-persistent) ════════════════════════════════
             These use normal React Router — mount/unmount on navigation. */}
        {!isOnTab && (
          <div className="route-scene ios-route-enter">
            <Suspense fallback={<RouteSkeleton />}>
              <Routes>
                <Route path="/login" element={<AdminLogin />} />
                <Route path="/leagues/:leagueId" element={<LeagueHub />} />
                <Route path="/live/:matchId" element={<LiveMatch />} />
                <Route path="/match/:id/live" element={<LiveMatch />} />
                <Route path="/match/:matchId" element={<MatchScorecard />} />
                <Route path="/match/:id/scorecard" element={<MatchScorecard />} />
                <Route path="/admin/login" element={<AdminLogin />} />

                {/* Protected admin routes */}
                <Route path="/admin" element={user ? <AdminPanel /> : <Navigate to="/login" />} />
                <Route path="/admin/scoring/:matchId" element={user ? <LiveScoring /> : <Navigate to="/login" />} />

                {/* Catch all - redirect to home */}
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </Suspense>
          </div>
        )}

      </main>

      <BottomTabBar />

      {/* ── First-launch notification permission prompt ── */}
      {showNotifPrompt && (
        <div className="modal-overlay" style={{ alignItems: 'flex-end', padding: 0, zIndex: 9999 }}>
          <div className="modal" style={{ 
            width: '100%', 
            margin: 0, 
            borderBottomLeftRadius: 0, 
            borderBottomRightRadius: 0,
            animation: 'slideUp 0.3s ease-out' 
          }}>
            <style>{`
              @keyframes slideUp {
                from { transform: translateY(100%); }
                to { transform: translateY(0); }
              }
            `}</style>
            <div style={{ padding: '24px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔔</div>
              <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Never Miss a Wicket!</h3>
              <p style={{ color: 'var(--t2)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.5 }}>
                Get instant live score updates, match reminders, and breaking cricket news right on your screen.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button 
                  className="btn btn-primary" 
                  style={{ width: '100%', padding: '14px', fontSize: '1rem', fontWeight: 600 }}
                  onClick={handleNotifAllow}
                >
                  Turn On Notifications
                </button>
                <button 
                  className="btn btn-ghost" 
                  style={{ width: '100%', padding: '12px' }}
                  onClick={handleNotifDismiss}
                >
                  Maybe Later
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
