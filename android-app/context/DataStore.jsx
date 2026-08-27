import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

// ─── API base ──────────────────────────────────────────────────────────────────
const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

// ─── Staleness thresholds (ms) ─────────────────────────────────────────────────
const STALE_TIMES = {
  dashboardStats: 5 * 60 * 1000,
  leagues:        5 * 60 * 1000,
  liveMatches:    6 * 1000,
  upcoming:       2 * 60 * 1000,
  results:        5 * 60 * 1000,
  battingGlobal:  5 * 60 * 1000,
  bowlingGlobal:  5 * 60 * 1000,
}

// ─── localStorage persistence helpers ──────────────────────────────────────────
const STORE_KEY = 'ch_datastore_v1'

const loadPersistedData = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const persistData = (data) => {
  try {
    const toSave = {
      dashboardStats: data.dashboardStats,
      leagues: data.leagues,
      upcoming: data.upcoming,
      results: data.results,
      battingGlobal: data.battingGlobal,
      bowlingGlobal: data.bowlingGlobal,
      // Don't persist liveMatches — always stale
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(toSave))
  } catch {
    // localStorage full or unavailable — ignore
  }
}

// ─── Context ───────────────────────────────────────────────────────────────────
const DataStoreContext = createContext(null)

export function useDataStore() {
  const ctx = useContext(DataStoreContext)
  if (!ctx) throw new Error('useDataStore must be used within DataStoreProvider')
  return ctx
}

// ─── Provider ──────────────────────────────────────────────────────────────────
export function DataStoreProvider({ children }) {
  // Persisted cache provides instant first render
  const persisted = useRef(loadPersistedData())
  const p = persisted.current || {}

  // ── Data state ───────────────────────────────────────────────────────────
  const [dashboardStats, setDashboardStats] = useState(p.dashboardStats || { leagues: 0, teams: 0, matches: 0, players: 0 })
  const [leagues, setLeagues]               = useState(p.leagues || [])
  const [liveMatches, setLiveMatches]       = useState([])
  const [upcoming, setUpcoming]             = useState(p.upcoming || [])
  const [results, setResults]               = useState(p.results || [])
  const [battingGlobal, setBattingGlobal]   = useState(p.battingGlobal || [])
  const [bowlingGlobal, setBowlingGlobal]   = useState(p.bowlingGlobal || [])

  // ── Meta state ───────────────────────────────────────────────────────────
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [isOnline, setIsOnline]         = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true)

  // ── Freshness timestamps ─────────────────────────────────────────────────
  const fetchedAt = useRef({
    dashboardStats: 0, leagues: 0, liveMatches: 0,
    upcoming: 0, results: 0, battingGlobal: 0, bowlingGlobal: 0,
  })

  // ── In-flight request deduplication ──────────────────────────────────────
  const inflight = useRef(new Map())

  const deduplicatedFetch = useCallback((url) => {
    if (inflight.current.has(url)) return inflight.current.get(url)
    const promise = fetch(url)
      .then(r => r.json())
      .finally(() => inflight.current.delete(url))
    inflight.current.set(url, promise)
    return promise
  }, [])

  // ── Staleness check ──────────────────────────────────────────────────────
  const isStale = useCallback((key) => {
    const elapsed = Date.now() - (fetchedAt.current[key] || 0)
    return elapsed > (STALE_TIMES[key] || 60000)
  }, [])

  // ── Individual endpoint refreshers ───────────────────────────────────────

  const refreshDashboardStats = useCallback(async (force = false) => {
    if (!force && !isStale('dashboardStats')) return
    try {
      const data = await deduplicatedFetch(`${API}/stats/dashboard`)
      setDashboardStats(data || { leagues: 0, teams: 0, matches: 0, players: 0 })
      fetchedAt.current.dashboardStats = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  const refreshLeagues = useCallback(async (force = false) => {
    if (!force && !isStale('leagues')) return
    try {
      const data = await deduplicatedFetch(`${API}/leagues`)
      const arr = Array.isArray(data) ? data : []
      setLeagues(arr)
      fetchedAt.current.leagues = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  const refreshUpcoming = useCallback(async (force = false) => {
    if (!force && !isStale('upcoming')) return
    try {
      const data = await deduplicatedFetch(`${API}/matches/upcoming/all`)
      setUpcoming(Array.isArray(data) ? data : [])
      fetchedAt.current.upcoming = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  const refreshResults = useCallback(async (force = false) => {
    if (!force && !isStale('results')) return
    try {
      const data = await deduplicatedFetch(`${API}/matches/completed/all`)
      setResults(Array.isArray(data) ? data : [])
      fetchedAt.current.results = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  const refreshBattingGlobal = useCallback(async (force = false) => {
    if (!force && !isStale('battingGlobal')) return
    try {
      const data = await deduplicatedFetch(`${API}/stats/global/batting`)
      setBattingGlobal(Array.isArray(data) ? data : [])
      fetchedAt.current.battingGlobal = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  const refreshBowlingGlobal = useCallback(async (force = false) => {
    if (!force && !isStale('bowlingGlobal')) return
    try {
      const data = await deduplicatedFetch(`${API}/stats/global/bowling`)
      setBowlingGlobal(Array.isArray(data) ? data : [])
      fetchedAt.current.bowlingGlobal = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  // ── Live matches deep fetch (batched, replaces N+1) ──────────────────────
  const refreshLiveDeep = useCallback(async (force = false) => {
    if (!force && !isStale('liveMatches')) return
    try {
      const liveRaw = await deduplicatedFetch(`${API}/matches/live/all`)
      const list = Array.isArray(liveRaw) ? liveRaw : []

      if (list.length === 0) {
        setLiveMatches([])
        fetchedAt.current.liveMatches = Date.now()
        return
      }

      // Batch: fan-out match details + scorecards in parallel (max 3 concurrent)
      const batchSize = 3
      const enriched = [...list]
      for (let i = 0; i < list.length; i += batchSize) {
        const batch = list.slice(i, i + batchSize)
        const batchResults = await Promise.all(batch.map(async (m) => {
          const [fullMatch, scorecard] = await Promise.all([
            deduplicatedFetch(`${API}/matches/${m.id}`).catch(() => m),
            deduplicatedFetch(`${API}/matches/${m.id}/scorecard`).catch(() => []),
          ])
          return {
            ...m,
            innings: Array.isArray(fullMatch?.innings) ? fullMatch.innings : (Array.isArray(m?.innings) ? m.innings : []),
            scorecard: Array.isArray(scorecard) ? scorecard : [],
          }
        }))
        batchResults.forEach((result, idx) => { enriched[i + idx] = result })
      }

      setLiveMatches(enriched)
      fetchedAt.current.liveMatches = Date.now()
    } catch { /* use cached */ }
  }, [deduplicatedFetch, isStale])

  // ── Refresh all endpoints ────────────────────────────────────────────────
  const refreshAll = useCallback(async (force = false) => {
    setIsRefreshing(true)
    try {
      await Promise.all([
        refreshDashboardStats(force),
        refreshLeagues(force),
        refreshLiveDeep(force),
        refreshUpcoming(force),
        refreshResults(force),
        refreshBattingGlobal(force),
        refreshBowlingGlobal(force),
      ])
      setLastUpdated(new Date())
    } finally {
      setIsRefreshing(false)
    }
  }, [refreshDashboardStats, refreshLeagues, refreshLiveDeep, refreshUpcoming, refreshResults, refreshBattingGlobal, refreshBowlingGlobal])

  // ── Persist to localStorage on data change ───────────────────────────────
  useEffect(() => {
    persistData({ dashboardStats, leagues, upcoming, results, battingGlobal, bowlingGlobal })
  }, [dashboardStats, leagues, upcoming, results, battingGlobal, bowlingGlobal])

  // ── Online/offline tracking ──────────────────────────────────────────────
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true)
      // Silent refresh when coming back online
      refreshAll(false).catch(() => {})
    }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refreshAll])

  // ── Initial data load ────────────────────────────────────────────────────
  useEffect(() => {
    refreshAll(true).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Smart polling: adaptive interval ─────────────────────────────────────
  useEffect(() => {
    const pollInterval = liveMatches.length > 0 ? 6000 : 30000

    const poll = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (!navigator.onLine) return

      // Always refresh live data
      refreshLiveDeep(true).catch(() => {})

      // Refresh other data only if stale
      refreshDashboardStats(false).catch(() => {})
      refreshLeagues(false).catch(() => {})
      refreshUpcoming(false).catch(() => {})
      refreshResults(false).catch(() => {})
    }

    const id = setInterval(poll, pollInterval)
    return () => clearInterval(id)
  }, [liveMatches.length, refreshLiveDeep, refreshDashboardStats, refreshLeagues, refreshUpcoming, refreshResults])

  // ── Global refresh event listener ────────────────────────────────────────
  useEffect(() => {
    const onGlobalRefresh = () => refreshAll(true).catch(() => {})
    window.addEventListener('crickethub:refresh-all', onGlobalRefresh)
    return () => window.removeEventListener('crickethub:refresh-all', onGlobalRefresh)
  }, [refreshAll])

  // ── League-specific stats helper (with local SWR) ────────────────────────
  const leagueStatsCache = useRef(new Map())

  const fetchLeagueStats = useCallback(async (leagueId) => {
    const cacheKey = `league_stats_${leagueId}`
    const cached = leagueStatsCache.current.get(cacheKey)
    const now = Date.now()

    // Return cached if fresh
    if (cached && (now - cached.fetchedAt) < STALE_TIMES.leagues) {
      return cached.data
    }

    try {
      const [bat, bowl] = await Promise.all([
        deduplicatedFetch(`${API}/leagues/${leagueId}/stats/batting`).catch(() => []),
        deduplicatedFetch(`${API}/leagues/${leagueId}/stats/bowling`).catch(() => []),
      ])
      const data = {
        batting: Array.isArray(bat) ? bat : [],
        bowling: Array.isArray(bowl) ? bowl : [],
      }
      leagueStatsCache.current.set(cacheKey, { data, fetchedAt: now })
      return data
    } catch {
      return cached?.data || { batting: [], bowling: [] }
    }
  }, [deduplicatedFetch])

  // ── Context value ────────────────────────────────────────────────────────
  const value = {
    // Data
    dashboardStats,
    leagues,
    liveMatches,
    upcoming,
    results,
    battingGlobal,
    bowlingGlobal,

    // Meta
    isRefreshing,
    lastUpdated,
    isOnline,

    // Actions
    refreshAll,
    refreshLiveDeep,
    refreshLeagues,
    refreshUpcoming,
    refreshResults,
    fetchLeagueStats,

    // Helpers
    api: API,
    deduplicatedFetch,
  }

  return (
    <DataStoreContext.Provider value={value}>
      {children}
    </DataStoreContext.Provider>
  )
}
