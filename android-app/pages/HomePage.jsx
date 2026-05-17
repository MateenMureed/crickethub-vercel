import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useDataStore } from '../context/DataStore'
import LazyImage from '../components/LazyImage'
import { downloadFromUrl, handleBannerTap } from '../utils/media'
import {
  generateLeagueBannerForLeague,
  generateVsBannerForMatch,
  generateResultBannerForMatch,
  generateMatchWinnerBannerForMatch,
  generateSummaryBannerForMatch,
  generateLeagueWinnerBannerForLeague,
} from '../components/GraphicsGeneratorPanel'

const fmtOvers = b => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`
const hasActivity = (p) => (
  Number(p?.total_runs || 0) > 0
  || Number(p?.total_balls || 0) > 0
  || Number(p?.total_wickets || 0) > 0
  || Number(p?.total_runs_conceded || 0) > 0
)
const mValue = (p) => {
  const matches = Number(p?.matches_played ?? p?.total_matches ?? p?.matches ?? 0)
  const innings = Number(p?.innings ?? 0)
  return matches > 0 ? matches : (innings > 0 ? innings : (hasActivity(p) ? 1 : 0))
}

function parseMatchDateTime(match) {
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
  const hour = parseInt(timeParts[1], 10)
  const minute = parseInt(timeParts[2], 10)
  return new Date(y, m - 1, d, hour, minute, 0, 0)
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Starting now'
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}

export default function HomePage() {
  const navigate = useNavigate()
  const {
    dashboardStats: stats, leagues, liveMatches, upcoming, results,
    battingGlobal: batting, bowlingGlobal: bowling,
    isRefreshing, lastUpdated, isOnline, refreshAll, api: API,
  } = useDataStore()
  const [missingBanners, setMissingBanners] = useState({})
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [selectedPlayerStats, setSelectedPlayerStats] = useState(null)
  const [playerPopupLoading, setPlayerPopupLoading] = useState(false)
  const [cardGenerating, setCardGenerating] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const showInitialSkeleton = isRefreshing && !lastUpdated && leagues.length === 0 && liveMatches.length === 0

  // Data fetching is handled by DataStore — no local fetches needed

  // Online/offline + polling handled by DataStore

  useEffect(() => {
    if (!upcoming.length) return
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [upcoming.length])

  const topBat = useMemo(() => batting.slice(0, 5), [batting])
  const topBowl = useMemo(() => bowling.slice(0, 5), [bowling])
  const getUpcomingCountdown = (match) => {
    const scheduled = parseMatchDateTime(match)
    if (!scheduled || Number.isNaN(scheduled.getTime())) return ''
    return formatCountdown(scheduled.getTime() - nowTick)
  }
  const markMissing = (key) => setMissingBanners((prev) => ({ ...prev, [key]: true }))
  const getVsBannerSrc = (matchId) => {
    if (!missingBanners[`upcoming_vs_icc_${matchId}`]) return `/media/banners/matches/vs_banner_icc_${matchId}.png`
    if (!missingBanners[`upcoming_vs_${matchId}`]) return `/media/banners/matches/vs_banner_${matchId}.png`
    return null
  }

  const openPlayerPopup = async (player, type) => {
    const playerId = player?.player_id || player?.id
    const base = { ...player, type }
    setSelectedPlayer(base)
    setSelectedPlayerStats(null)
    if (!playerId) return

    setPlayerPopupLoading(true)
    try {
      const stats = await fetch(`${API}/players/${playerId}/stats`).then((r) => r.json()).catch(() => null)
      if (stats && !stats.error) setSelectedPlayerStats(stats)
    } finally {
      setPlayerPopupLoading(false)
    }
  }

  const closePlayerPopup = () => {
    setSelectedPlayer(null)
    setSelectedPlayerStats(null)
    setPlayerPopupLoading(false)
    setCardGenerating(false)
  }

  const getPlayerPhoto = () => (
    selectedPlayerStats?.player?.photo
    || selectedPlayer?.photo
    || selectedPlayer?.player_photo
    || ''
  )

  const getMatchesPlayed = () => {
    const byMatchStats = Array.isArray(selectedPlayerStats?.match_stats)
      ? new Set(selectedPlayerStats.match_stats.map((ms) => ms.match_id || `${ms.match_number || ''}_${ms.date || ''}_${ms.opponent_name || ''}`)).size
      : 0
    const byTotals = Number(selectedPlayerStats?.totals?.matches ?? selectedPlayer?.matches_played ?? selectedPlayer?.total_matches ?? selectedPlayer?.matches ?? 0)
    const byActivity = (
      Number(selectedPlayerStats?.totals?.batting?.runs || 0) > 0
      || Number(selectedPlayerStats?.totals?.bowling?.wickets || 0) > 0
      || hasActivity(selectedPlayer)
    ) ? 1 : 0
    return byMatchStats > 0 ? byMatchStats : (byTotals > 0 ? byTotals : byActivity)
  }

  const getInningsPlayed = (type) => {
    if (type === 'batting') return Number(selectedPlayerStats?.totals?.batting?.innings ?? selectedPlayer?.innings ?? 0)
    return Number(selectedPlayerStats?.totals?.bowling?.innings ?? selectedPlayer?.innings ?? 0)
  }

  const getStatEntries = () => {
    if (!selectedPlayer) return []
    if (selectedPlayer.type === 'batting') {
      return [
        ['MATCHES', getMatchesPlayed()],
        ['INNINGS', getInningsPlayed('batting')],
        ['RUNS', selectedPlayerStats?.totals?.batting?.runs || selectedPlayer.total_runs || 0],
        ['AVERAGE', selectedPlayerStats?.totals?.batting?.average || selectedPlayer.average || 0],
        ['STRIKE RATE', selectedPlayerStats?.totals?.batting?.strike_rate || (selectedPlayer.total_balls ? ((Number(selectedPlayer.total_runs || 0) / Number(selectedPlayer.total_balls || 1)) * 100).toFixed(2) : '0.00')],
        ['50s/100s', `${selectedPlayerStats?.totals?.batting?.fifties || 0}/${selectedPlayerStats?.totals?.batting?.hundreds || 0}`],
        ['BEST', selectedPlayerStats?.totals?.batting?.highest || selectedPlayer.highest || selectedPlayer.total_runs || 0],
      ]
    }
    return [
      ['MATCHES', getMatchesPlayed()],
      ['INNINGS', getInningsPlayed('bowling')],
      ['WICKETS', selectedPlayerStats?.totals?.bowling?.wickets || selectedPlayer.total_wickets || 0],
      ['RUNS', selectedPlayerStats?.totals?.bowling?.runs || selectedPlayer.total_runs_conceded || 0],
      ['OVERS', fmtOvers(selectedPlayerStats?.totals?.bowling?.balls || selectedPlayer.total_balls || 0)],
      ['ECONOMY', selectedPlayerStats?.totals?.bowling?.economy || (selectedPlayer.total_balls ? (Number(selectedPlayer.total_runs_conceded || 0) / (Number(selectedPlayer.total_balls || 0) / 6)).toFixed(2) : '0.00')],
      ['BEST', selectedPlayerStats?.totals?.bowling?.best || selectedPlayer.best || `${selectedPlayer.total_wickets || 0}/${selectedPlayer.total_runs_conceded || 0}`],
    ]
  }

  const getLeagueLabel = () => (
    selectedPlayerStats?.match_stats?.[0]?.league_name
    || selectedPlayer?.league_name
    || leagues?.[0]?.name
    || 'LEAGUE'
  )

  const loadImage = (src) => new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

  const downloadPlayerStatCard = async () => {
    if (!selectedPlayer) return
    setCardGenerating(true)
    try {
      const W = 1280
      const H = 720
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')

      const bg = ctx.createLinearGradient(0, 0, W, H)
      bg.addColorStop(0, '#1b0140')
      bg.addColorStop(1, '#3c026f')
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)

      ctx.fillStyle = 'rgba(255, 56, 164, 0.82)'
      for (let i = 0; i < 6; i++) {
        const y = 140 + i * 88
        ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(105, y + 30); ctx.lineTo(45, y + 60); ctx.closePath(); ctx.fill()
        ctx.beginPath(); ctx.moveTo(W - 45, y); ctx.lineTo(W - 105, y + 30); ctx.lineTo(W - 45, y + 60); ctx.closePath(); ctx.fill()
      }

      ctx.fillStyle = '#ffffff'
      ctx.font = '800 48px "Barlow Condensed", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('CRICKET PLAYER STATS', W / 2, 72)
      ctx.font = '700 30px "Barlow Condensed", sans-serif'
      ctx.fillText(`TEAM: ${(selectedPlayer.team_name || 'N/A').toUpperCase()}    FORMAT: ${selectedPlayer.type === 'batting' ? 'BATTING' : 'BOWLING'}`, W / 2, 112)
      ctx.font = '700 24px "Barlow Condensed", sans-serif'
      ctx.fillStyle = '#ffd97a'
      ctx.fillText(`LEAGUE: ${String(getLeagueLabel()).toUpperCase()}`, W / 2, 142)

      const photo = await loadImage(getPlayerPhoto())
      const avatarX = 110
      const avatarY = 160
      const avatarW = 360
      const avatarH = 410
      const avatarRadius = 28
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(avatarX + avatarRadius, avatarY)
      ctx.lineTo(avatarX + avatarW - avatarRadius, avatarY)
      ctx.quadraticCurveTo(avatarX + avatarW, avatarY, avatarX + avatarW, avatarY + avatarRadius)
      ctx.lineTo(avatarX + avatarW, avatarY + avatarH - avatarRadius)
      ctx.quadraticCurveTo(avatarX + avatarW, avatarY + avatarH, avatarX + avatarW - avatarRadius, avatarY + avatarH)
      ctx.lineTo(avatarX + avatarRadius, avatarY + avatarH)
      ctx.quadraticCurveTo(avatarX, avatarY + avatarH, avatarX, avatarY + avatarH - avatarRadius)
      ctx.lineTo(avatarX, avatarY + avatarRadius)
      ctx.quadraticCurveTo(avatarX, avatarY, avatarX + avatarRadius, avatarY)
      ctx.closePath()
      ctx.fillStyle = '#f8d57e'
      ctx.fill()
      if (photo) {
        ctx.clip()
        const sc = Math.max(avatarW / photo.width, avatarH / photo.height)
        const dw = photo.width * sc
        const dh = photo.height * sc
        ctx.drawImage(photo, avatarX + (avatarW - dw) / 2, avatarY + (avatarH - dh) / 2 - 12, dw, dh)
      } else {
        ctx.fillStyle = '#1a0a31'
        ctx.font = '900 140px "Barlow Condensed", sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText((selectedPlayer.player_name || selectedPlayer.name || '?')[0], avatarX + avatarW / 2, avatarY + avatarH * 0.60)
      }
      ctx.restore()
      ctx.strokeStyle = '#ffc83d'
      ctx.lineWidth = 7
      ctx.strokeRect(avatarX + 2, avatarY + 2, avatarW - 4, avatarH - 4)

      const statsX = 560
      const statsY = 160
      const statsW = 620
      const entries = getStatEntries().slice(0, 7)
      const rowH = 64
      ctx.fillStyle = 'rgba(230,230,240,.9)'
      ctx.fillRect(statsX, statsY + 56, statsW, rowH * entries.length)
      ctx.fillStyle = '#8a42e8'
      ctx.fillRect(statsX, statsY, statsW, 56)
      ctx.fillStyle = '#fff'
      ctx.font = '800 46px "Barlow Condensed", sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(selectedPlayer.type === 'batting' ? 'BATTING CAREER' : 'BOWLING CAREER', statsX + 20, statsY + 42)

      entries.forEach(([label, value], idx) => {
        const y = statsY + 56 + idx * rowH
        ctx.strokeStyle = '#2c2540'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(statsX, y); ctx.lineTo(statsX + statsW, y); ctx.stroke()
        ctx.fillStyle = '#d0208f'
        ctx.font = '800 40px "Barlow Condensed", sans-serif'
        ctx.fillText(String(label), statsX + 18, y + 46)
        ctx.fillStyle = '#2b2538'
        ctx.textAlign = 'right'
        ctx.fillText(String(value), statsX + statsW - 18, y + 46)
        ctx.textAlign = 'left'
      })

      ctx.fillStyle = '#242734'
      ctx.strokeStyle = '#f7c948'
      ctx.lineWidth = 4
      ctx.fillRect(130, H - 132, W - 260, 92)
      ctx.strokeRect(130, H - 132, W - 260, 92)
      ctx.fillStyle = '#ffffff'
      ctx.font = '900 70px "Barlow Condensed", sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText((selectedPlayer.player_name || selectedPlayer.name || 'PLAYER').toUpperCase(), 162, H - 66)

      const url = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = url
      link.download = `${(selectedPlayer.player_name || selectedPlayer.name || 'player').toLowerCase().replace(/\s+/g, '_')}_stats_card.png`
      link.click()
    } finally {
      setCardGenerating(false)
    }
  }

  const statRow = (label, value) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
      <div style={{ color: '#f6d3ff', fontWeight: 700, letterSpacing: '.25px', textTransform: 'uppercase', fontSize: '.66rem' }}>{label}</div>
      <div style={{ color: '#ffffff', fontWeight: 800, fontFamily: 'var(--mono)' }}>{value}</div>
    </div>
  )
  useEffect(() => {
    if (!leagues.length && !upcoming.length && !results.length) return

    const key = 'mobile_home_banner_autogen_v2'
    const now = Date.now()
    const last = Number(localStorage.getItem(key) || 0)
    if (now - last < 30 * 60 * 1000) return
    localStorage.setItem(key, String(now))

    const leagueById = new Map(leagues.map((l) => [String(l.id), l]))

    const run = async () => {
      try {
        for (const l of leagues.slice(0, 3)) {
          await generateLeagueBannerForLeague(l.id, { download: false })
          const lm = await fetch(`${API}/leagues/${l.id}/matches`).then((r) => r.json()).catch(() => [])
          const fullyCompleted = Array.isArray(lm) && lm.length > 0 && lm.every((m) => m.status === 'completed' || !!m.result_summary)
          if (fullyCompleted) {
            await generateLeagueWinnerBannerForLeague(l.id, { download: false })
          }
        }

        for (const m of upcoming) {
          await generateVsBannerForMatch(m, leagueById.get(String(m.league_id)) || null, { download: false })
          await generateVsBannerForMatch(m, leagueById.get(String(m.league_id)) || null, { theme: 'icc', download: false })
        }

        for (const m of results.slice(0, 3)) {
          const [matchRes, scoreRes] = await Promise.all([
            fetch(`${API}/matches/${m.id}`),
            fetch(`${API}/matches/${m.id}/scorecard`),
          ])
          const fullMatch = matchRes.ok ? await matchRes.json() : m
          const scorecard = scoreRes.ok ? await scoreRes.json() : []
          const leagueObj = leagueById.get(String(fullMatch.league_id)) || null
          await generateSummaryBannerForMatch(fullMatch, scorecard, leagueObj, { download: false })
          await generateMatchWinnerBannerForMatch(fullMatch, scorecard, leagueObj, { download: false })
          await generateResultBannerForMatch(fullMatch, scorecard, { download: false })
        }
      } catch (error) {
        console.warn('Home banner auto-generation skipped:', error?.message || error)
      }
    }

    // Defer banner generation to idle time — prevents blocking scrolling/tab switches
    const idleCallback = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => run(), { timeout: 15000 })
      : setTimeout(() => run(), 3000)

    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof idleCallback === 'number') cancelIdleCallback(idleCallback)
      else clearTimeout(idleCallback)
    }
  }, [leagues, upcoming, results])

  return (
    <div className="page" style={{ paddingBottom: 80 }}>

      {/* Modern Dashboard Header */}
      <div style={{ padding: '24px 20px', background: 'linear-gradient(145deg, #0f172a, #020617)', borderBottomLeftRadius: 32, borderBottomRightRadius: 32, marginBottom: 24, boxShadow: '0 10px 40px rgba(0,0,0,0.5)', position: 'relative', overflow: 'hidden' }}>
        {/* Glow effects */}
        <div style={{ position: 'absolute', top: -100, right: -100, width: 250, height: 250, background: 'radial-gradient(circle, rgba(0,232,150,0.12) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -50, left: -50, width: 200, height: 200, background: 'radial-gradient(circle, rgba(64,196,255,0.1) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(40px)', pointerEvents: 'none' }} />
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 2 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: 900, fontFamily: 'var(--font-display)', letterSpacing: '-0.5px' }}>
              Cricket<span style={{ color: '#00e896' }}>Hub</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <span style={{ 
                display: 'inline-block', 
                width: 8, height: 8, borderRadius: '50%', 
                background: isOnline ? '#00e896' : '#f59e0b',
                boxShadow: `0 0 8px ${isOnline ? '#00e896' : '#f59e0b'}`,
                animation: isOnline ? 'pulse 2s infinite' : 'none'
              }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--t2)', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                {isOnline ? 'Live Engine Active' : 'Offline Mode'}
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Spotlight Feature */}
        <div style={{ marginTop: 28, position: 'relative', zIndex: 2 }}>
          {liveMatches.length > 0 ? (
            <Link to={`/match/${liveMatches[0].id}`} style={{ display: 'block', textDecoration: 'none' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 16, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: '#ef4444', boxShadow: '0 0 12px #ef4444' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.5s infinite' }} />
                    Live Spotlight
                  </span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--t3)', fontWeight: 600 }}>{liveMatches[0].league_name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--t1)' }}>{liveMatches[0].team_a_name?.[0]}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--t2)', marginTop: 4, fontWeight: 600 }}>{liveMatches[0].team_a_name}</div>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'rgba(255,255,255,0.2)', margin: '0 16px' }}>VS</div>
                  <div style={{ textAlign: 'center', flex: 1 }}>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--t1)' }}>{liveMatches[0].team_b_name?.[0]}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--t2)', marginTop: 4, fontWeight: 600 }}>{liveMatches[0].team_b_name}</div>
                  </div>
                </div>
                {liveMatches.length > 1 && (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)', textAlign: 'center', fontSize: '0.75rem', color: '#40c4ff', fontWeight: 600 }}>
                    + {liveMatches.length - 1} more live matches →
                  </div>
                )}
              </div>
            </Link>
          ) : upcoming.length > 0 ? (
            <Link to="/fixtures" style={{ display: 'block', textDecoration: 'none' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, padding: 16, position: 'relative', overflow: 'hidden' }}>
                 <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: '#3b82f6', boxShadow: '0 0 12px #3b82f6' }} />
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Next Up
                  </span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--t3)', fontWeight: 600 }}>{upcoming[0].league_name}</span>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--t1)' }}>
                  {upcoming[0].team_a_name} <span style={{ color: 'var(--t3)', fontWeight: 500, fontSize: '0.9rem', margin: '0 4px' }}>vs</span> {upcoming[0].team_b_name}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: 8, fontWeight: 700 }}>
                  Starts in {getUpcomingCountdown(upcoming[0])}
                </div>
              </div>
            </Link>
          ) : (
             <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 20, padding: 20, textAlign: 'center' }}>
                <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: 8 }}>🏆</span>
                <div style={{ fontSize: '1rem', color: 'var(--t1)', fontWeight: 700 }}>Season Complete</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--t2)', marginTop: 4 }}>Check out the latest stats and results.</div>
             </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="stats-row">
        {[
          { num: stats.leagues,  lbl: 'Leagues' },
          { num: stats.teams,    lbl: 'Teams'   },
          { num: stats.matches,  lbl: 'Matches' },
          { num: stats.players,  lbl: 'Players' },
        ].map(s => (
          <div key={s.lbl} className="stat-box">
            <div className="stat-num">{s.num || 0}</div>
            <div className="stat-lbl">{s.lbl}</div>
          </div>
        ))}
      </div>

      {showInitialSkeleton && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          <div className="skeleton" style={{ height: 128 }} />
          <div className="skeleton" style={{ height: 108 }} />
          <div className="skeleton" style={{ height: 108 }} />
          <div className="skeleton" style={{ height: 84 }} />
        </div>
      )}

      {/* Live Matches */}
      {liveMatches.length > 0 && (
        <div className="data-fade-in" style={{ marginBottom: 24 }}>
          <div className="sect-head">
            <h3>Live Now</h3>
            <Link to="/live">See all</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {liveMatches.slice(0, 3).map(m => (
              <Link
                to={`/match/${m.id}`}
                key={m.id}
                className="card match-card card-hover"
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  background: 'linear-gradient(145deg, rgba(20,26,52,.62), rgba(14,20,38,.45))',
                  border: '1px solid rgba(255,255,255,.18)',
                  boxShadow: '0 10px 28px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.16)',
                  backdropFilter: 'blur(14px) saturate(145%)',
                  WebkitBackdropFilter: 'blur(14px) saturate(145%)',
                }}
              >
                {!missingBanners[`live_vs_${m.id}`] && (
                  <img
                    src={`/media/banners/matches/vs_banner_${m.id}.png`}
                    alt={`${m.team_a_name} vs ${m.team_b_name} banner`}
                    style={{ width: '100%', height: 108, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onError={() => markMissing(`live_vs_${m.id}`)}
                    onClick={(e) => {
                      e.preventDefault()
                      handleBannerTap(`/media/banners/matches/vs_banner_${m.id}.png`, `vs_banner_${m.id}.png`)
                    }}
                  />
                )}
                <div className="match-card-header">
                  <span className="badge badge-live">Live</span>
                  <span style={{ fontSize: '.7rem', color: 'var(--t3)' }}>{m.league_name}</span>
                </div>
                <div className="match-body">
                  <div className="match-teams">
                    <div className="match-team">
                      <div className="team-logo">{m.team_a_name?.[0]}</div>
                      <div className="team-name">{m.team_a_name}</div>
                    </div>
                    <div className="match-vs live">VS</div>
                    <div className="match-team">
                      <div className="team-logo">{m.team_b_name?.[0]}</div>
                      <div className="team-name">{m.team_b_name}</div>
                    </div>
                  </div>
                  {m.innings?.length > 0 && (
                    <div className="live-mini-score" style={{ textAlign: 'center', marginTop: 8 }}>
                      {m.innings.map(inn => {
                        const innScore = (m.scorecard || []).find((s) => s.id === inn.id) || inn
                        const striker = (innScore?.batting || []).find((b) => String(b.player_id) === String(inn.striker_id))
                        const battingSide = inn.batting_team_id === m.team_a_id ? m.team_a_name : m.team_b_name
                        return (
                        <span key={inn.id} style={{ marginRight: 12 }}>
                          {battingSide}: {inn.total_runs}/{inn.total_wickets} ({fmtOvers(inn.total_balls)})
                          {striker?.name && (
                            <span style={{ marginLeft: 8, color: '#22c55e', fontWeight: 700 }}>● {striker.name}*</span>
                          )}
                        </span>
                        )
                      })}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Active Leagues */}
      <div className="data-fade-in" style={{ marginBottom: 24 }}>
        <div className="sect-head">
          <h3>Leagues</h3>
          <Link to="/leagues">All leagues</Link>
        </div>
        {leagues.length === 0
          ? <div className="empty"><span className="ico">L</span><h4>No leagues yet</h4></div>
          : (
            <div className="active-league-grid">
              {leagues.slice(0, 6).map(l => (
                <Link to={`/leagues/${l.id}`} key={l.id} className="card active-league-card card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
                  {!missingBanners[`league_${l.id}`] && (
                    <img
                      src={`/media/banners/leagues/league_banner_${l.id}.png`}
                      alt={`${l.name} league banner`}
                      style={{ width: '100%', height: 108, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onError={() => markMissing(`league_${l.id}`)}
                      onClick={(e) => {
                        e.preventDefault()
                        handleBannerTap(`/media/banners/leagues/league_banner_${l.id}.png`, `league_banner_${l.id}.png`)
                      }}
                    />
                  )}
                  <div className="active-card-top">
                    {(l.logo_url || l.logo)
                      ? <img src={l.logo_url || l.logo} alt={l.name} className="active-league-logo" />
                      : <div className="active-league-logo fallback">{l.name?.[0]}</div>}
                  </div>
                  <div className="active-card-center">
                    <h3>{l.name}</h3>
                    <p>{l.city || 'City TBD'}</p>
                    <span>{l.team_count || 0} teams</span>
                  </div>
                  <div className="active-card-bottom">
                    <span className="badge badge-upcoming">{l.format || 'T20'}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="data-fade-in" style={{ marginBottom: 24 }}>
          <div className="sect-head">
            <h3>Upcoming</h3>
            <Link to="/fixtures">All fixtures</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcoming.slice(0, 4).map(m => (
              <div key={m.id} className="card">
                {getVsBannerSrc(m.id) && (
                  <img
                    src={getVsBannerSrc(m.id)}
                    alt={`${m.team_a_name} vs ${m.team_b_name} banner`}
                    style={{ width: '100%', height: 108, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onError={() => {
                      if (!missingBanners[`upcoming_vs_icc_${m.id}`]) markMissing(`upcoming_vs_icc_${m.id}`)
                      else markMissing(`upcoming_vs_${m.id}`)
                    }}
                    onClick={() => {
                      const src = getVsBannerSrc(m.id)
                      if (src) handleBannerTap(src, src.split('/').pop())
                    }}
                  />
                )}
                <div className="fixture-card">
                  <div className="fixture-teams">
                    <div className="fixture-team">{m.team_a_name}</div>
                    <div className="fixture-vs">VS</div>
                    <div className="fixture-team">{m.team_b_name}</div>
                  </div>
                  <div className="fixture-meta">{m.venue || 'Venue TBD'} · {m.date || m.match_date || 'Date TBD'} · {m.time || m.match_time || 'Time TBD'}</div>
                  {getUpcomingCountdown(m) && (
                    <div style={{ marginTop: 6, fontSize: '.74rem', color: 'var(--accent)', fontWeight: 700 }}>
                      Starts in: {getUpcomingCountdown(m)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => {
                      const src = getVsBannerSrc(m.id)
                      if (src) handleBannerTap(src, src.split('/').pop())
                    }}>
                      View Banner
                    </button>
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => {
                      const src = getVsBannerSrc(m.id)
                      if (src) downloadFromUrl(src, src.split('/').pop())
                    }}>
                      Download VS Banner
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Results */}
      {results.length > 0 && (
        <div className="data-fade-in" style={{ marginBottom: 24 }}>
          <div className="sect-head">
            <h3>Results</h3>
            <Link to="/results">All results</Link>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.slice(0, 4).map(m => (
              <Link to={`/match/${m.id}`} key={m.id} className="card card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
                {(() => {
                  const summaryMissing = !!missingBanners[`summary_${m.id}`]
                  const winnerMissing = !!missingBanners[`winner_${m.id}`]
                  const resultMissing = !!missingBanners[`result_${m.id}`]
                  const src = !summaryMissing
                    ? `/media/banners/results/summary_banner_${m.id}.png`
                    : (!winnerMissing ? `/media/banners/results/winner_banner_${m.id}.png` : (!resultMissing ? `/media/banners/results/result_banner_${m.id}.png` : null))
                  if (!src) return null
                  return (
                    <img
                      src={src}
                      alt={`${m.team_a_name} vs ${m.team_b_name} summary`}
                      style={{ width: '100%', height: 118, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onError={() => {
                        if (!summaryMissing) markMissing(`summary_${m.id}`)
                        else if (!winnerMissing) markMissing(`winner_${m.id}`)
                        else markMissing(`result_${m.id}`)
                      }}
                      onClick={(e) => {
                        e.preventDefault()
                        handleBannerTap(src, src.split('/').pop())
                      }}
                    />
                  )
                })()}
                <div className="fixture-card">
                  <div className="fixture-teams">
                    <div className="fixture-team">{m.team_a_name}</div>
                    <div className="fixture-vs" style={{ color: 'var(--accent)' }}>vs</div>
                    <div className="fixture-team">{m.team_b_name}</div>
                  </div>
                  <div className="result-summary">{m.result_summary || 'Result recorded'}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Top Batting */}
      {topBat.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="sect-head">
            <h3>Top Batters</h3>
            <Link to="/stats">Full stats</Link>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="mobile-table">
              <thead><tr><th>Player</th><th>Team</th><th>M</th><th>Runs</th><th>Balls</th><th>4s</th><th>6s</th></tr></thead>
              <tbody>
                {topBat.map((p, i) => (
                  <tr
                    key={p.player_id || p.id || i}
                    onClick={() => openPlayerPopup(p, 'batting')}
                    style={{ cursor: 'pointer' }}
                    title="Tap for detailed player stats"
                  >
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`player-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`} style={{ width: 22, height: 22, minWidth: 22, fontSize: '.62rem' }}>{i + 1}</span>
                        {p.photo
                          ? <img src={p.photo} alt={p.player_name || p.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--border)' }} />
                          : <span className="player-avatar" style={{ width: 28, height: 28, minWidth: 28, fontSize: '.68rem' }}>{(p.player_name || p.name || '?')[0]}</span>}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.player_name || p.name}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--t2)' }}>{p.team_name || '-'}</td>
                    <td>{mValue(p)}</td>
                    <td className="cell-hl">{p.total_runs || 0}</td>
                    <td>{p.total_balls || 0}</td>
                    <td>{p.total_fours || 0}</td>
                    <td>{p.total_sixes || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Bowling */}
      {topBowl.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="sect-head">
            <h3>Top Bowlers</h3>
            <Link to="/stats">Full stats</Link>
          </div>
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="mobile-table">
              <thead><tr><th>Player</th><th>Team</th><th>M</th><th>Wkts</th><th>Overs</th><th>Runs</th></tr></thead>
              <tbody>
                {topBowl.map((p, i) => (
                  <tr
                    key={p.player_id || p.id || i}
                    onClick={() => openPlayerPopup(p, 'bowling')}
                    style={{ cursor: 'pointer' }}
                    title="Tap for detailed player stats"
                  >
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className={`player-rank ${i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : ''}`} style={{ width: 22, height: 22, minWidth: 22, fontSize: '.62rem' }}>{i + 1}</span>
                        {p.photo
                          ? <img src={p.photo} alt={p.player_name || p.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--border)' }} />
                          : <span className="player-avatar" style={{ width: 28, height: 28, minWidth: 28, fontSize: '.68rem' }}>{(p.player_name || p.name || '?')[0]}</span>}
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.player_name || p.name}</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--t2)' }}>{p.team_name || '-'}</td>
                    <td>{mValue(p)}</td>
                    <td className="cell-hl" style={{ color: 'var(--red)' }}>{p.total_wickets || 0}</td>
                    <td>{fmtOvers(p.total_balls || 0)}</td>
                    <td>{p.total_runs_conceded || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedPlayer && (
        <div className="modal-overlay" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={closePlayerPopup}>
          <div className="modal" style={{ maxWidth: 640, width: '100%', borderRadius: 16, maxHeight: '86vh', borderTop: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedPlayer.player_name || selectedPlayer.name}</h3>
              <button className="modal-close" onClick={closePlayerPopup}>×</button>
            </div>
            <div className="modal-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div style={{ borderRadius: 14, padding: 12, background: 'linear-gradient(140deg,#2f0754 0%, #3a0a68 55%, #250547 100%)', border: '1px solid rgba(255,255,255,.18)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '132px 1fr', gap: 12, alignItems: 'stretch' }}>
                  <div style={{ borderRadius: 12, border: '2px solid #f7c948', background: 'radial-gradient(circle at 50% 20%, #f8df9f, #b3882e)', minHeight: 150, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2f0754', fontSize: '2.3rem', fontWeight: 900 }}>
                    {getPlayerPhoto()
                      ? <img src={getPlayerPhoto()} alt={selectedPlayer.player_name || selectedPlayer.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                      : <span>{(selectedPlayer.player_name || selectedPlayer.name || '?')[0]}</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: '.76rem', color: 'rgba(255,255,255,.82)', marginBottom: 6, fontWeight: 700 }}>
                      Team: {selectedPlayer.team_name || 'N/A'}
                    </div>

                    {playerPopupLoading && <div style={{ color: '#fff' }}>Loading player details...</div>}

                    {!playerPopupLoading && selectedPlayer.type === 'batting' && (
                      <div>
                        {statRow('Matches Played', getMatchesPlayed())}
                        {statRow('Innings', getInningsPlayed('batting'))}
                        {statRow('Runs', selectedPlayerStats?.totals?.batting?.runs || selectedPlayer.total_runs || 0)}
                        {statRow('Average', selectedPlayerStats?.totals?.batting?.average || selectedPlayer.average || 0)}
                        {statRow('Strike Rate', selectedPlayerStats?.totals?.batting?.strike_rate || (selectedPlayer.total_balls ? ((Number(selectedPlayer.total_runs || 0) / Number(selectedPlayer.total_balls || 1)) * 100).toFixed(2) : '0.00'))}
                        {statRow('50s / 100s', `${selectedPlayerStats?.totals?.batting?.fifties || 0}/${selectedPlayerStats?.totals?.batting?.hundreds || 0}`)}
                        {statRow('Best', selectedPlayerStats?.totals?.batting?.highest || selectedPlayer.highest || selectedPlayer.total_runs || 0)}
                      </div>
                    )}

                    {!playerPopupLoading && selectedPlayer.type === 'bowling' && (
                      <div>
                        {statRow('Matches Played', getMatchesPlayed())}
                        {statRow('Innings', getInningsPlayed('bowling'))}
                        {statRow('Wickets', selectedPlayerStats?.totals?.bowling?.wickets || selectedPlayer.total_wickets || 0)}
                        {statRow('Runs Conceded', selectedPlayerStats?.totals?.bowling?.runs || selectedPlayer.total_runs_conceded || 0)}
                        {statRow('Overs', fmtOvers(selectedPlayerStats?.totals?.bowling?.balls || selectedPlayer.total_balls || 0))}
                        {statRow('Economy', selectedPlayerStats?.totals?.bowling?.economy || (selectedPlayer.total_balls ? (Number(selectedPlayer.total_runs_conceded || 0) / (Number(selectedPlayer.total_balls || 0) / 6)).toFixed(2) : '0.00'))}
                        {statRow('Best', selectedPlayerStats?.totals?.bowling?.best || selectedPlayer.best || `${selectedPlayer.total_wickets || 0}/${selectedPlayer.total_runs_conceded || 0}`)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" className="btn btn-secondary" onClick={downloadPlayerStatCard} disabled={cardGenerating || playerPopupLoading}>
                {cardGenerating ? 'Generating Card...' : 'Download Stat Card Image'}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/stats')}>Open Full Player Table</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
