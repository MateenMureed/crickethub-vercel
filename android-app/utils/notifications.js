import { Capacitor, registerPlugin } from '@capacitor/core'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || 'https://cricket-android.azurewebsites.net/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

const ENABLED_KEY = 'ch_notifications_enabled_v1'
const PERMISSION_PROMPTED_KEY = 'ch_notif_first_prompt_v1'
const LocalNotifications = registerPlugin('LocalNotifications')
const WATCHER_STATE = { stop: null, count: 0 }

// ─── Live Score Snapshot ───────────────────────────────────────────────────────

const getLiveSnapshot = (match, scorecard = []) => {
  const innings = Array.isArray(scorecard) && scorecard.length
    ? scorecard
    : (Array.isArray(match?.innings) ? match.innings : [])
  const active = innings.find((i) => !i.is_completed) || innings[innings.length - 1] || null
  const battingTeamId = active?.batting_team_id
  const battingTeamName = battingTeamId === match?.team_a_id
    ? (match?.team_a_name || 'Team A')
    : (battingTeamId === match?.team_b_id ? (match?.team_b_name || 'Team B') : 'Batting')

  return {
    runs: Number(active?.total_runs || 0),
    wickets: Number(active?.total_wickets || 0),
    balls: Number(active?.total_balls || 0),
    over: `${Math.floor(Number(active?.total_balls || 0) / 6)}.${Number(active?.total_balls || 0) % 6}`,
    battingTeamName,
    inningsNumber: innings.indexOf(active) + 1,
    totalInnings: innings.length,
  }
}

// ─── Batter/Bowler Snapshot ────────────────────────────────────────────────────

const getBatterSnapshot = (match, scorecard = []) => {
  const innings = Array.isArray(scorecard) && scorecard.length
    ? scorecard
    : (Array.isArray(match?.innings) ? match.innings : [])
  const active = innings.find((i) => !i.is_completed) || innings[innings.length - 1] || null
  const batting = Array.isArray(active?.batting) ? active.batting : []
  const bowling = Array.isArray(active?.bowling) ? active.bowling : []

  const striker = batting.find((b) => String(b.player_id) === String(active?.striker_id)) || batting.find((b) => !b?.is_out) || null
  const nonStriker = batting.find((b) => String(b.player_id) === String(active?.non_striker_id)) || batting.find((b) => !b?.is_out && String(b.player_id) !== String(striker?.player_id)) || null
  const bowler = bowling.find((b) => String(b.player_id) === String(active?.current_bowler_id)) || bowling[0] || null

  const fmtBatter = (p, isStriker = false) => {
    if (!p) return null
    const runs = Number(p.runs || 0)
    const balls = Number(p.balls_faced || 0)
    const fours = Number(p.fours || 0)
    const sixes = Number(p.sixes || 0)
    const sr = balls > 0 ? ((runs / balls) * 100).toFixed(1) : '0.0'
    return {
      name: p.name || 'Batter',
      runs,
      balls,
      fours,
      sixes,
      sr,
      isStriker,
      line: `${isStriker ? '🏏 ' : '   '}${p.name || 'Batter'}${isStriker ? '*' : ''} ${runs}(${balls})`,
      detail: `${p.name || 'Batter'}${isStriker ? '*' : ''}: ${runs}(${balls}) • SR ${sr} • ${fours}×4 ${sixes}×6`,
    }
  }

  const fmtBowler = (b) => {
    if (!b) return null
    const wickets = Number(b.wickets || 0)
    const runsConceded = Number(b.runs_conceded || 0)
    const ballsBowled = Number(b.balls_bowled || 0)
    const overs = `${Math.floor(ballsBowled / 6)}.${ballsBowled % 6}`
    const econ = ballsBowled > 0 ? ((runsConceded / (ballsBowled / 6))).toFixed(1) : '0.0'
    return {
      name: b.name || 'Bowler',
      wickets,
      runs: runsConceded,
      overs,
      econ,
      line: `⚾ ${b.name || 'Bowler'} ${wickets}/${runsConceded} (${overs})`,
      detail: `${b.name || 'Bowler'}: ${wickets}/${runsConceded} (${overs} ov) • Econ ${econ}`,
    }
  }

  return {
    striker: fmtBatter(striker, true),
    nonStriker: fmtBatter(nonStriker, false),
    bowler: fmtBowler(bowler),
    // Legacy compat
    strikerLine: fmtBatter(striker, true)?.line || '🏏 TBD',
    nonStrikerLine: fmtBatter(nonStriker, false)?.line || '   TBD',
    bowlerLine: fmtBowler(bowler)?.line || '⚾ Bowler TBD',
  }
}

// ─── Match stamp for change detection ──────────────────────────────────────────

const toMatchStamp = (match, scorecard = []) => {
  const snap = getLiveSnapshot(match, scorecard)
  return `${match?.status || 'unknown'}:${snap.runs}/${snap.wickets}:${snap.balls}`
}

// ─── Notification ID management ────────────────────────────────────────────────
// Use stable IDs per match so notifications UPDATE instead of creating new ones

const LIVE_NOTIF_BASE_ID = 10000
const UPCOMING_NOTIF_BASE_ID = 20000
const NEW_MATCH_NOTIF_BASE_ID = 30000
let notifCounter = 40000

const getNotifId = (matchId, type = 'live') => {
  const numId = typeof matchId === 'number' ? matchId : parseInt(String(matchId), 10) || 0
  switch (type) {
    case 'live': return LIVE_NOTIF_BASE_ID + (numId % 5000)
    case 'upcoming': return UPCOMING_NOTIF_BASE_ID + (numId % 5000)
    case 'new': return NEW_MATCH_NOTIF_BASE_ID + (numId % 5000)
    default: return notifCounter++
  }
}

// ─── Rich notification sender ──────────────────────────────────────────────────

const safeNotify = async (title, body, { matchId = null, actionUrl = null, isUpdate = false } = {}) => {
  // Build the deep link URL for clicking the notification
  const deepLinkUrl = actionUrl || (matchId ? `/match/${matchId}/live` : null)

  if (Capacitor.isNativePlatform()) {
    try {
      const notificationConfig = {
        id: matchId ? getNotifId(matchId, isUpdate ? 'live' : 'new') : notifCounter++,
        title,
        body,
        schedule: { at: new Date(Date.now() + 200) },
        smallIcon: 'ic_stat_icon_config_sample',
        // Group notifications by match for better organization
        group: matchId ? `match_${matchId}` : 'crickethub',
        groupSummary: false,
        ongoing: isUpdate, // Persistent for live score updates
        autoCancel: !isUpdate,
        // Extra data for deep linking
        extra: deepLinkUrl ? { url: deepLinkUrl, matchId: String(matchId || '') } : {},
      }

      await LocalNotifications.schedule({ notifications: [notificationConfig] })
      return
    } catch {
      // Fall back to web notification below.
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const notif = new Notification(title, {
      body,
      tag: matchId ? `ch_live_${matchId}` : `ch_${Date.now()}`,
      renotify: isUpdate,
      silent: isUpdate, // Don't make sound on score updates
      icon: '/crickethub-logo.svg',
    })
    // Deep link on click
    if (deepLinkUrl) {
      notif.onclick = () => {
        window.focus()
        if (window.location) window.location.hash = ''
        window.dispatchEvent(new CustomEvent('crickethub:navigate', { detail: { url: deepLinkUrl } }))
      }
    }
  } catch {
    // Ignore unsupported contexts.
  }
}

// ─── Cricbuzz-style notification builder ───────────────────────────────────────

const buildLiveScoreNotification = (match, scorecard = []) => {
  const snap = getLiveSnapshot(match, scorecard)
  const batters = getBatterSnapshot(match, scorecard)
  const teamA = match.team_a_name || 'Team A'
  const teamB = match.team_b_name || 'Team B'

  // ── Title: compact score line (shown in collapsed notification)
  const title = `🏏 ${snap.battingTeamName} ${snap.runs}/${snap.wickets} (${snap.over} ov)`

  // ── Body: expandable rich content
  const bodyParts = [
    `${teamA} vs ${teamB}`,
  ]

  // Batsmen lines
  if (batters.striker) {
    bodyParts.push(batters.striker.detail)
  }
  if (batters.nonStriker) {
    bodyParts.push(batters.nonStriker.detail)
  }

  // Bowler line
  if (batters.bowler) {
    bodyParts.push(`🎯 ${batters.bowler.detail}`)
  }

  // Match context
  if (match.league_name) {
    bodyParts.push(`📍 ${match.league_name}`)
  }

  const body = bodyParts.join('\n')

  return { title, body }
}

const buildMatchStartNotification = (match) => {
  const teamA = match.team_a_name || 'Team A'
  const teamB = match.team_b_name || 'Team B'
  const title = `🔴 LIVE NOW: ${teamA} vs ${teamB}`
  const bodyParts = [
    `${match.league_name || 'Cricket League'}`,
    match.venue ? `📍 ${match.venue}` : null,
    'Tap to follow live scores →',
  ].filter(Boolean)

  return { title, body: bodyParts.join('\n') }
}

const buildUpcomingNotification = (match, label) => {
  const teamA = match.team_a_name || 'Team A'
  const teamB = match.team_b_name || 'Team B'
  const title = `⏰ ${teamA} vs ${teamB}`
  const bodyParts = [
    `Starts ${label}`,
    match.league_name ? `🏆 ${match.league_name}` : null,
    match.venue ? `📍 ${match.venue}` : null,
    'Tap to set reminder →',
  ].filter(Boolean)

  return { title, body: bodyParts.join('\n') }
}

// ─── Permission helpers ────────────────────────────────────────────────────────

const hasWebNotifyPermission = () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  return Notification.permission === 'granted'
}

const hasNativeNotifyPermission = async () => {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const status = await LocalNotifications.checkPermissions()
    return status?.display === 'granted'
  } catch {
    return false
  }
}

const fetchLiveScorecard = async (matchId) => {
  return fetch(`${API}/matches/${matchId}/scorecard`).then((r) => r.json()).catch(() => [])
}

const parseDateTime = (match) => {
  const rawDate = String(match?.date || match?.match_date || '').trim()
  if (!rawDate) return null
  const [y, m, d] = rawDate.split('-').map((v) => parseInt(v, 10))
  if (!y || !m || !d) return null

  const rawTime = String(match?.time || match?.match_time || '').trim()
  if (!rawTime) return new Date(y, m - 1, d, 0, 0, 0, 0)

  const twelveHour = rawTime.match(/^(\d{1,2}):(\d{2})(?:\s*)(AM|PM)$/i)
  if (twelveHour) {
    let hour = parseInt(twelveHour[1], 10)
    const minute = parseInt(twelveHour[2], 10)
    const meridian = String(twelveHour[3] || '').toUpperCase()
    if (meridian === 'PM' && hour < 12) hour += 12
    if (meridian === 'AM' && hour === 12) hour = 0
    return new Date(y, m - 1, d, hour, minute, 0, 0)
  }

  const timeParts = rawTime.match(/^(\d{1,2}):(\d{2})/)
  if (!timeParts) return new Date(y, m - 1, d, 0, 0, 0, 0)
  return new Date(y, m - 1, d, parseInt(timeParts[1], 10), parseInt(timeParts[2], 10), 0, 0)
}

// ─── Public API ────────────────────────────────────────────────────────────────

export const notificationsEnabled = () => {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export const setNotificationsEnabled = (enabled) => {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Check if first-launch notification prompt has been shown.
 */
export const hasPromptedNotifications = () => {
  try {
    return localStorage.getItem(PERMISSION_PROMPTED_KEY) === '1'
  } catch {
    return false
  }
}

export const markNotificationPrompted = () => {
  try {
    localStorage.setItem(PERMISSION_PROMPTED_KEY, '1')
  } catch {}
}

/**
 * Request notification permission — prompts the user on both native & web.
 * Returns true if granted.
 */
export const requestMatchNotificationPermission = async () => {
  let nativeGranted = false

  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.checkPermissions()
      const display = status?.display || 'prompt'
      if (display === 'granted') {
        nativeGranted = true
      } else {
        const req = await LocalNotifications.requestPermissions()
        nativeGranted = req?.display === 'granted'
      }
    } catch {
      nativeGranted = false
    }
  }

  let webGranted = false
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      webGranted = true
    } else {
      const permission = await Notification.requestPermission().catch(() => 'denied')
      webGranted = permission === 'granted'
    }
  }

  const granted = nativeGranted || webGranted
  setNotificationsEnabled(granted)
  markNotificationPrompted()
  return granted
}

// ─── Deep link handler (listens for notification taps) ─────────────────────────

export const setupNotificationDeepLinkHandler = (navigateFn) => {
  // Handle web notification clicks
  const handleNavigate = (e) => {
    const url = e?.detail?.url
    if (url && navigateFn) navigateFn(url)
  }
  window.addEventListener('crickethub:navigate', handleNavigate)

  // Handle native Capacitor notification action clicks
  if (Capacitor.isNativePlatform()) {
    try {
      LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const url = action?.notification?.extra?.url
        if (url && navigateFn) {
          navigateFn(url)
        }
      })
    } catch {}
  }

  return () => {
    window.removeEventListener('crickethub:navigate', handleNavigate)
  }
}

// ─── Notification Watcher (main polling engine) ────────────────────────────────

export const startMatchNotificationWatcher = ({ intervalMs = 25000 } = {}) => {
  if (WATCHER_STATE.stop) {
    WATCHER_STATE.count += 1
    return () => {
      WATCHER_STATE.count -= 1
      if (WATCHER_STATE.count <= 0 && WATCHER_STATE.stop) {
        WATCHER_STATE.stop()
        WATCHER_STATE.stop = null
        WATCHER_STATE.count = 0
      }
    }
  }

  let previousLiveIds = new Set()
  let previousLiveStamp = new Map()
  let previousUpcomingAlerts = new Set()
  let previousLiveNotifyAt = new Map()
  let isCancelled = false
  let hasLiveMatches = false

  const poll = async () => {
    if (isCancelled) return
    if (!notificationsEnabled()) return
    // Battery optimization: skip if page is hidden
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return

    const [nativeOk, webOk] = await Promise.all([
      hasNativeNotifyPermission(),
      Promise.resolve(hasWebNotifyPermission()),
    ])
    if (!nativeOk && !webOk) return

    const [liveRaw, upcomingRaw] = await Promise.all([
      fetch(`${API}/matches/live/all`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/matches/upcoming/all`).then((r) => r.json()).catch(() => []),
    ])

    const live = Array.isArray(liveRaw) ? liveRaw : []
    const upcoming = Array.isArray(upcomingRaw) ? upcomingRaw : []
    hasLiveMatches = live.length > 0

    const currentLiveIds = new Set(live.map((m) => String(m.id)))

    for (const m of live) {
      const id = String(m.id)

      // ── New match started notification ──────────────────────────
      if (!previousLiveIds.has(id)) {
        const { title, body } = buildMatchStartNotification(m)
        safeNotify(title, body, { matchId: m.id, actionUrl: `/match/${m.id}/live` })
      }

      // ── Live score update notification (Cricbuzz-style) ─────────
      const liveScorecard = await fetchLiveScorecard(id)
      const stamp = toMatchStamp(m, liveScorecard)

      if (previousLiveStamp.has(id) && previousLiveStamp.get(id) !== stamp) {
        const lastNotifyAt = Number(previousLiveNotifyAt.get(id) || 0)
        const nowTs = Date.now()
        // Throttle: at least 30s between score notifications per match
        if (nowTs - lastNotifyAt >= 30000) {
          const { title, body } = buildLiveScoreNotification(m, liveScorecard)
          safeNotify(title, body, {
            matchId: m.id,
            actionUrl: `/match/${m.id}/live`,
            isUpdate: true,
          })
          previousLiveNotifyAt.set(id, nowTs)
        }
      }
      previousLiveStamp.set(id, stamp)
    }

    previousLiveIds = currentLiveIds

    // ── Upcoming match reminders ──────────────────────────────────
    const now = Date.now()
    for (const match of upcoming) {
      const scheduledAt = parseDateTime(match)
      if (!scheduledAt) continue
      const diff = scheduledAt.getTime() - now
      const id = String(match.id)

      const reminderLevels = [
        { minutes: 60, label: 'in about 1 hour' },
        { minutes: 30, label: 'in about 30 mins' },
        { minutes: 10, label: 'in about 10 mins' },
      ]
      for (const level of reminderLevels) {
        const key = `${id}_${level.minutes}`
        if (diff > 0 && diff <= level.minutes * 60 * 1000 && !previousUpcomingAlerts.has(key)) {
          const { title, body } = buildUpcomingNotification(match, level.label)
          safeNotify(title, body, {
            matchId: match.id,
            actionUrl: `/match/${match.id}/live`,
          })
          previousUpcomingAlerts.add(key)
        }
      }
    }
  }

  // Initial poll
  poll().catch(() => {})

  // Adaptive polling: faster when live matches exist (15s), slower otherwise (45s)
  let currentIntervalId = null
  const startPolling = () => {
    const pollInterval = hasLiveMatches ? 15000 : 45000
    currentIntervalId = setInterval(() => poll().catch(() => {}), pollInterval)
  }
  startPolling()

  // Re-adjust interval every 60s based on live match presence
  const adaptiveCheckId = setInterval(() => {
    if (isCancelled) return
    clearInterval(currentIntervalId)
    startPolling()
  }, 60000)

  const stop = () => {
    isCancelled = true
    clearInterval(currentIntervalId)
    clearInterval(adaptiveCheckId)
  }

  WATCHER_STATE.stop = stop
  WATCHER_STATE.count = 1

  return () => {
    WATCHER_STATE.count -= 1
    if (WATCHER_STATE.count <= 0 && WATCHER_STATE.stop) {
      WATCHER_STATE.stop()
      WATCHER_STATE.stop = null
      WATCHER_STATE.count = 0
    }
  }
}
