import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import html2canvas from 'html2canvas'
import { downloadDataUrl, downloadFromUrl, handleBannerTap } from '../utils/media'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()
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

export default function LeagueHub() {
  const { leagueId } = useParams()
  const [league,       setLeague]       = useState(null)
  const [teams,        setTeams]        = useState([])
  const [matches,      setMatches]      = useState([])
  const [points,       setPoints]       = useState([])
  const [battingStats, setBattingStats] = useState([])
  const [bowlingStats, setBowlingStats] = useState([])
  const [activeTab,    setActiveTab]    = useState('overview')
  const [expandedTeam, setExpandedTeam] = useState(null)
  const [teamPlayers,  setTeamPlayers]  = useState({})
  const [selectedPlayerKey, setSelectedPlayerKey] = useState(null)
  const [playerStatsById, setPlayerStatsById] = useState({})
  const [playerStatsLoading, setPlayerStatsLoading] = useState({})
  const [missingBanners, setMissingBanners] = useState({})
  const [selectedStatPlayer, setSelectedStatPlayer] = useState(null)
  const [selectedStatPlayerStats, setSelectedStatPlayerStats] = useState(null)
  const [statPlayerLoading, setStatPlayerLoading] = useState(false)
  const [statCardGenerating, setStatCardGenerating] = useState(false)
  const [matchScorecardsById, setMatchScorecardsById] = useState({})
  const pointsTableRef = useRef(null)

  useEffect(() => { loadData() }, [leagueId])

  useEffect(() => {
    const onGlobalRefresh = () => loadData()
    window.addEventListener('crickethub:refresh-all', onGlobalRefresh)
    return () => window.removeEventListener('crickethub:refresh-all', onGlobalRefresh)
  }, [leagueId])

  useEffect(() => {
    if (activeTab !== 'points') return
    fetchPoints()
    const iv = setInterval(fetchPoints, 5000)
    return () => clearInterval(iv)
  }, [activeTab, leagueId])

  useEffect(() => {
    const completedMatches = matches.filter((m) => m.status === 'completed')
    if (!completedMatches.length) {
      setMatchScorecardsById({})
      return
    }

    let cancelled = false
    const loadScorecards = async () => {
      const entries = await Promise.all(
        completedMatches.map(async (m) => {
          const sc = await fetch(`${API}/matches/${m.id}/scorecard`).then((r) => r.json()).catch(() => [])
          return [m.id, Array.isArray(sc) ? sc : []]
        })
      )
      if (!cancelled) setMatchScorecardsById(Object.fromEntries(entries))
    }

    loadScorecards().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [matches])

  const fetchPoints = () =>
    fetch(`${API}/leagues/${leagueId}/points`).then(r => r.json()).then(setPoints).catch(() => {})

  const loadData = () => {
    fetch(`${API}/leagues/${leagueId}`).then(r => r.json()).then(setLeague).catch(() => {})
    fetch(`${API}/leagues/${leagueId}/teams`).then(r => r.json()).then(d => setTeams(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`${API}/leagues/${leagueId}/matches`).then(r => r.json()).then(d => setMatches(Array.isArray(d) ? d : [])).catch(() => {})
    fetchPoints()
    fetch(`${API}/leagues/${leagueId}/stats/batting`).then(r => r.json()).then(d => setBattingStats(Array.isArray(d) ? d : [])).catch(() => {})
    fetch(`${API}/leagues/${leagueId}/stats/bowling`).then(r => r.json()).then(d => setBowlingStats(Array.isArray(d) ? d : [])).catch(() => {})
  }

  const quotaBalls = Number(league?.overs_per_innings || 20) * 6
  const normalizeNrrOvers = (balls, wickets) => {
    const b = Number(balls || 0)
    const w = Number(wickets || 0)
    if (!b) return 0
    if (w >= 10 && quotaBalls > 0 && b < quotaBalls) {
      return quotaBalls / 6
    }
    return b / 6
  }

  const computedNrrByTeam = useMemo(() => {
    const aggregate = new Map()
    const completedMatches = matches.filter((m) => m.status === 'completed')

    completedMatches.forEach((m) => {
      const innings = Array.isArray(matchScorecardsById[m.id]) ? matchScorecardsById[m.id] : []
      innings.forEach((inn) => {
        const battingTeamId = Number(inn?.batting_team_id || 0)
        if (!battingTeamId) return
        const runsFor = Number(inn?.total_runs || 0)
        const wicketsLost = Number(inn?.total_wickets || 0)
        const ballsFaced = Number(inn?.total_balls || 0)
        const oversFaced = normalizeNrrOvers(ballsFaced, wicketsLost)

        const opponentInnings = innings.find((x) => Number(x?.batting_team_id) !== battingTeamId)
        const runsAgainst = Number(opponentInnings?.total_runs || 0)
        const oppWickets = Number(opponentInnings?.total_wickets || 0)
        const oppBalls = Number(opponentInnings?.total_balls || 0)
        const oversBowled = normalizeNrrOvers(oppBalls, oppWickets)

        const row = aggregate.get(battingTeamId) || { runsFor: 0, oversFaced: 0, runsAgainst: 0, oversBowled: 0 }
        row.runsFor += runsFor
        row.oversFaced += oversFaced
        row.runsAgainst += runsAgainst
        row.oversBowled += oversBowled
        aggregate.set(battingTeamId, row)
      })
    })

    const nrrMap = new Map()
    aggregate.forEach((row, teamId) => {
      const forRR = row.oversFaced > 0 ? row.runsFor / row.oversFaced : 0
      const againstRR = row.oversBowled > 0 ? row.runsAgainst / row.oversBowled : 0
      nrrMap.set(teamId, Number((forRR - againstRR).toFixed(3)))
    })
    return nrrMap
  }, [matches, matchScorecardsById, quotaBalls])

  const pointsTableRows = useMemo(() => {
    const base = Array.isArray(points) ? points : []
    const merged = base.map((p) => {
      const teamId = Number(p.team_id || 0)
      const computed = computedNrrByTeam.get(teamId)
      return {
        ...p,
        nrr: Number.isFinite(computed) ? computed : Number(p.nrr || 0),
      }
    })

    return merged.sort((a, b) => {
      if (Number(b.points || 0) !== Number(a.points || 0)) return Number(b.points || 0) - Number(a.points || 0)
      if (Number(b.nrr || 0) !== Number(a.nrr || 0)) return Number(b.nrr || 0) - Number(a.nrr || 0)
      return Number(b.wins || 0) - Number(a.wins || 0)
    })
  }, [points, computedNrrByTeam])

  const toggleTeamPlayers = async (teamId) => {
    if (expandedTeam === teamId) {
      setExpandedTeam(null)
      setSelectedPlayerKey(null)
      return
    }
    if (!teamPlayers[teamId]) {
      const p = await fetch(`${API}/teams/${teamId}/players`).then(r => r.json()).catch(() => [])
      setTeamPlayers(prev => ({ ...prev, [teamId]: Array.isArray(p) ? p : [] }))
    }
    setExpandedTeam(teamId)
    setSelectedPlayerKey(null)
  }

  const openPlayerStats = async (teamId, player) => {
    const key = `${teamId}_${player.id}`
    if (selectedPlayerKey === key) {
      setSelectedPlayerKey(null)
      return
    }

    setSelectedPlayerKey(key)

    if (playerStatsById[player.id] || playerStatsLoading[player.id]) return

    setPlayerStatsLoading((prev) => ({ ...prev, [player.id]: true }))
    try {
      const data = await fetch(`${API}/players/${player.id}/stats?league_id=${leagueId}`).then((r) => r.json())
      if (data && !data.error) {
        setPlayerStatsById((prev) => ({ ...prev, [player.id]: data }))
      }
    } catch (_) {
      // Ignore stats errors and keep roster usable.
    } finally {
      setPlayerStatsLoading((prev) => ({ ...prev, [player.id]: false }))
    }
  }

  const markMissing = (key) => setMissingBanners((prev) => ({ ...prev, [key]: true }))
  const getVsBannerSrc = (matchId) => {
    if (!missingBanners[`vs_icc_${matchId}`]) return `/media/banners/matches/vs_banner_icc_${matchId}.png`
    if (!missingBanners[`vs_${matchId}`]) return `/media/banners/matches/vs_banner_${matchId}.png`
    return null
  }

  const getResultBannerSources = (matchId) => {
    const summarySrc = !missingBanners[`summary_${matchId}`] ? `/media/banners/results/summary_banner_${matchId}.png` : null
    const winnerSrc = !missingBanners[`winner_${matchId}`] ? `/media/banners/results/winner_banner_${matchId}.png` : null
    const resultSrc = !missingBanners[`result_${matchId}`] ? `/media/banners/results/result_banner_${matchId}.png` : null
    return {
      summarySrc,
      winnerSrc,
      resultSrc,
      primarySrc: summarySrc || winnerSrc || resultSrc || null,
    }
  }

  const openStatPlayerPopup = async (player, type) => {
    const playerId = player?.player_id || player?.id
    setSelectedStatPlayer({ ...player, type })
    setSelectedStatPlayerStats(null)
    if (!playerId) return
    setStatPlayerLoading(true)
    try {
      const stats = await fetch(`${API}/players/${playerId}/stats?league_id=${leagueId}`).then((r) => r.json()).catch(() => null)
      if (stats && !stats.error) setSelectedStatPlayerStats(stats)
    } finally {
      setStatPlayerLoading(false)
    }
  }

  const closeStatPlayerPopup = () => {
    setSelectedStatPlayer(null)
    setSelectedStatPlayerStats(null)
    setStatPlayerLoading(false)
    setStatCardGenerating(false)
  }

  const statRow = (label, value) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
      <div style={{ color: '#f6d3ff', fontWeight: 700, letterSpacing: '.25px', textTransform: 'uppercase', fontSize: '.66rem' }}>{label}</div>
      <div style={{ color: '#ffffff', fontWeight: 800, fontFamily: 'var(--mono)' }}>{value}</div>
    </div>
  )

  const getStatPlayerPhoto = () => (
    selectedStatPlayerStats?.player?.photo
    || selectedStatPlayer?.photo
    || selectedStatPlayer?.player_photo
    || ''
  )

  const getStatMatchesPlayed = () => {
    const byMatchStats = Array.isArray(selectedStatPlayerStats?.match_stats)
      ? new Set(selectedStatPlayerStats.match_stats.map((ms) => ms.match_id || `${ms.match_number || ''}_${ms.date || ''}_${ms.opponent_name || ''}`)).size
      : 0
    const byTotals = Number(selectedStatPlayerStats?.totals?.matches ?? selectedStatPlayer?.matches_played ?? selectedStatPlayer?.total_matches ?? selectedStatPlayer?.matches ?? 0)
    const byActivity = (
      Number(selectedStatPlayerStats?.totals?.batting?.runs || 0) > 0
      || Number(selectedStatPlayerStats?.totals?.bowling?.wickets || 0) > 0
      || hasActivity(selectedStatPlayer)
    ) ? 1 : 0
    return byMatchStats > 0 ? byMatchStats : (byTotals > 0 ? byTotals : byActivity)
  }

  const getStatInningsPlayed = (type) => {
    if (type === 'batting') return Number(selectedStatPlayerStats?.totals?.batting?.innings ?? selectedStatPlayer?.innings ?? 0)
    return Number(selectedStatPlayerStats?.totals?.bowling?.innings ?? selectedStatPlayer?.innings ?? 0)
  }

  const getStatEntries = () => {
    if (!selectedStatPlayer) return []
    if (selectedStatPlayer.type === 'batting') {
      return [
        ['MATCHES', getStatMatchesPlayed()],
        ['INNINGS', getStatInningsPlayed('batting')],
        ['RUNS', selectedStatPlayerStats?.totals?.batting?.runs || selectedStatPlayer.total_runs || 0],
        ['AVERAGE', selectedStatPlayerStats?.totals?.batting?.average || selectedStatPlayer.average || 0],
        ['STRIKE RATE', selectedStatPlayerStats?.totals?.batting?.strike_rate || (selectedStatPlayer.total_balls ? ((Number(selectedStatPlayer.total_runs || 0) / Number(selectedStatPlayer.total_balls || 1)) * 100).toFixed(2) : '0.00')],
        ['50s/100s', `${selectedStatPlayerStats?.totals?.batting?.fifties || 0}/${selectedStatPlayerStats?.totals?.batting?.hundreds || 0}`],
        ['BEST', selectedStatPlayerStats?.totals?.batting?.highest || selectedStatPlayer.highest || selectedStatPlayer.total_runs || 0],
      ]
    }
    return [
      ['MATCHES', getStatMatchesPlayed()],
      ['INNINGS', getStatInningsPlayed('bowling')],
      ['WICKETS', selectedStatPlayerStats?.totals?.bowling?.wickets || selectedStatPlayer.total_wickets || 0],
      ['RUNS', selectedStatPlayerStats?.totals?.bowling?.runs || selectedStatPlayer.total_runs_conceded || 0],
      ['OVERS', fmtOvers(selectedStatPlayerStats?.totals?.bowling?.balls || selectedStatPlayer.total_balls || 0)],
      ['ECONOMY', selectedStatPlayerStats?.totals?.bowling?.economy || (selectedStatPlayer.total_balls ? (Number(selectedStatPlayer.total_runs_conceded || 0) / (Number(selectedStatPlayer.total_balls || 0) / 6)).toFixed(2) : '0.00')],
      ['BEST', selectedStatPlayerStats?.totals?.bowling?.best || selectedStatPlayer.best || `${selectedStatPlayer.total_wickets || 0}/${selectedStatPlayer.total_runs_conceded || 0}`],
    ]
  }

  const getStatLeagueLabel = () => (
    selectedStatPlayerStats?.match_stats?.[0]?.league_name
    || selectedStatPlayer?.league_name
    || league?.name
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
    if (!selectedStatPlayer) return
    setStatCardGenerating(true)
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
      ctx.fillText(`TEAM: ${(selectedStatPlayer.team_name || 'N/A').toUpperCase()}    FORMAT: ${selectedStatPlayer.type === 'batting' ? 'BATTING' : 'BOWLING'}`, W / 2, 112)
      ctx.font = '700 24px "Barlow Condensed", sans-serif'
      ctx.fillStyle = '#ffd97a'
      ctx.fillText(`LEAGUE: ${String(getStatLeagueLabel()).toUpperCase()}`, W / 2, 142)

      const photo = await loadImage(getStatPlayerPhoto())
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
        ctx.fillText((selectedStatPlayer.player_name || selectedStatPlayer.name || '?')[0], avatarX + avatarW / 2, avatarY + avatarH * 0.60)
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
      ctx.fillText(selectedStatPlayer.type === 'batting' ? 'BATTING CAREER' : 'BOWLING CAREER', statsX + 20, statsY + 42)

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
      ctx.fillText((selectedStatPlayer.player_name || selectedStatPlayer.name || 'PLAYER').toUpperCase(), 162, H - 66)

      const url = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      link.href = url
      link.download = `${(selectedStatPlayer.player_name || selectedStatPlayer.name || 'player').toLowerCase().replace(/\s+/g, '_')}_stats_card.png`
      link.click()
    } finally {
      setStatCardGenerating(false)
    }
  }

  const downloadPointsTable = async () => {
    if (!pointsTableRef.current) return
    const canvas = await html2canvas(pointsTableRef.current, {
      backgroundColor: '#0b1220',
      scale: 2,
      useCORS: true,
    })
    downloadDataUrl(canvas.toDataURL('image/png'), `${league.name || 'league'}_points_table.png`)
  }

  if (!league) return <div className="page"><div className="spinner" /></div>

  const sponsorNames = (Array.isArray(league?.sponsors) ? league.sponsors : [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter(Boolean)
    .slice(0, 4)

  const TABS = [
    { id: 'overview',   label: 'Overview'  },
    { id: 'teams',      label: 'Teams'     },
    { id: 'fixtures',   label: 'Fixtures'  },
    { id: 'results',    label: 'Results'   },
    { id: 'points',     label: 'Standings' },
    { id: 'statistics', label: 'Stats'     },
  ]

  const live      = matches.filter(m => m.status === 'live')
  const upcoming  = matches.filter(m => m.status === 'upcoming')
  const completed = matches.filter(m => m.status === 'completed')
  const isLeagueFullyCompleted = matches.length > 0 && matches.every((m) => m.status === 'completed' || !!m.result_summary)

  return (
    <div style={{ paddingBottom: 80, maxWidth: 430, margin: '0 auto', width: '100%' }}>
      {/* League Header */}
      <div style={{ background: 'linear-gradient(160deg,var(--bg),var(--bg-2))', border: '1px solid var(--border)', borderRadius: 18, margin: '10px 10px 8px', padding: '14px 12px 12px' }}>
        {!missingBanners[`league_${league.id}`] && (
          <img
            src={`/media/banners/leagues/league_banner_${league.id}.png`}
            alt={`${league.name} league banner`}
            style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 12, marginBottom: 10, border: '1px solid var(--border)', cursor: 'pointer' }}
            onError={() => markMissing(`league_${league.id}`)}
            onClick={() => handleBannerTap(`/media/banners/leagues/league_banner_${league.id}.png`, `league_banner_${league.id}.png`)}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <div className="league-logo" style={{ width: 60, height: 60, borderRadius: 16, flexShrink: 0, fontSize: '1.5rem' }}>
            {(league.logo_url || league.logo) ? <img src={league.logo_url || league.logo} alt={league.name} /> : league.name?.[0]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 900, margin: '0 0 4px' }}>{league.name}</h2>
            <p style={{ fontSize: '.74rem', color: 'var(--t2)', margin: 0 }}>
              {[league.city, league.venue, league.format && `${league.format} - ${league.overs_per_innings || 20} ov`].filter(Boolean).join(' - ')}
            </p>
          </div>
          <span className={`badge badge-${league.status === 'active' ? 'live' : league.status === 'completed' ? 'completed' : 'upcoming'}`}>{league.status}</span>
        </div>
        <div className="stats-row" style={{ margin: 0, gap: 6 }}>
          {[{n:teams.length,l:'Teams'},{n:matches.length,l:'Matches'},{n:completed.length,l:'Done'},{n:live.length,l:'Live'}].map(s=>(
            <div key={s.l} className="stat-box"><div className="stat-num">{s.n}</div><div className="stat-lbl">{s.l}</div></div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: '.72rem', color: 'var(--t2)', lineHeight: 1.45 }}>
          <div>Organizer: <strong style={{ color: 'var(--t1)' }}>{league.organizer || 'N/A'}</strong></div>
          <div>Sponsors: <strong style={{ color: 'var(--t1)' }}>{sponsorNames.length ? sponsorNames.join(' · ') : 'No sponsors added'}</strong></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="league-tabs-wrap" style={{ top: 74 }}>
        <div className="league-tabs">
          {TABS.map(t => (
            <button key={t.id} className={`league-tab${activeTab === t.id ? ' active' : ''}`} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="page" style={{ paddingTop: 16 }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div>
            {isLeagueFullyCompleted && !missingBanners[`league_winner_${league.id}`] && (
              <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
                <img
                  src={`/media/banners/leagues/league_winner_banner_${league.id}.png`}
                  alt={`${league.name} winner banner`}
                  style={{ width: '100%', height: 138, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onError={() => markMissing(`league_winner_${league.id}`)}
                  onClick={() => handleBannerTap(`/media/banners/leagues/league_winner_banner_${league.id}.png`, `league_winner_banner_${league.id}.png`)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 10px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => downloadFromUrl(`/media/banners/leagues/league_winner_banner_${league.id}.png`, `league_winner_banner_${league.id}.png`)}
                  >
                    Download Winner Banner
                  </button>
                </div>
              </div>
            )}

            {live.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="sect-head"><h3>Live Now</h3></div>
                {live.map(m => (
                  <Link to={`/match/${m.id}`} key={m.id} className="card match-card card-hover" style={{ textDecoration: 'none', color: 'inherit', marginBottom: 8 }}>
                    <div className="match-card-header">
                      <span className="badge badge-live">Live</span>
                      <span style={{ fontSize: '.68rem', color: 'var(--t3)' }}>Match #{m.match_number}</span>
                    </div>
                    <div className="match-body">
                      <div className="match-teams">
                        <div className="match-team"><div className="team-logo">{m.team_a_name?.[0]}</div><div className="team-name">{m.team_a_name}</div></div>
                        <div className="match-vs live">VS</div>
                        <div className="match-team"><div className="team-logo">{m.team_b_name?.[0]}</div><div className="team-name">{m.team_b_name}</div></div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {pointsTableRows.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div className="sect-head"><h3>Top Teams</h3><button onClick={() => setActiveTab('points')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '.75rem', fontWeight: 700 }}>Full table</button></div>
                <div className="card">
                  {pointsTableRows.slice(0, 4).map((p, i) => (
                    <div key={p.team_id} className="player-row">
                      <div className={`player-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}`}>{i + 1}</div>
                      <div className="player-avatar">{p.name?.[0]}</div>
                      <div className="player-meta"><h5>{p.name}</h5><p>W:{p.wins} L:{p.losses} T:{p.ties}</p></div>
                      <div className="player-val">{p.points}pts</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {upcoming.slice(0, 3).map(m => (
              <div key={m.id} className="card" style={{ marginBottom: 8 }}>
                <div className="fixture-card">
                  <div className="fixture-teams">
                    <div className="fixture-team">{m.team_a_name}</div>
                    <div className="fixture-vs">VS</div>
                    <div className="fixture-team">{m.team_b_name}</div>
                  </div>
                  <div className="fixture-meta">{m.venue || 'Venue TBD'} - {(m.date || m.match_date || 'Date TBD')} - {(m.time || m.match_time || 'Time TBD')}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TEAMS */}
        {activeTab === 'teams' && (
          <div>
            {teams.length === 0
              ? <div className="empty"><span className="ico">T</span><h4>No teams yet</h4></div>
              : teams.map(t => (
                <div key={t.id} className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
                  <div className="league-card" style={{ cursor: 'pointer' }} onClick={() => toggleTeamPlayers(t.id)}>
                    <div className="league-logo">{(t.logo_url || t.logo) ? <img src={t.logo_url || t.logo} alt={t.name} /> : t.name?.[0]}</div>
                    <div className="league-info">
                      <h4>{t.name}</h4>
                      <p>{t.captain_name ? `Captain: ${t.captain_name}` : ''} - {t.player_count || 11} players</p>
                    </div>
                    <span style={{ color: 'var(--accent)', fontSize: '.8rem', transition: '.2s', transform: expandedTeam === t.id ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>v</span>
                  </div>
                  {expandedTeam === t.id && teamPlayers[t.id] && (
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                      <div style={{ padding: 10 }}>
                        <div style={{ fontSize: '.68rem', color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.45px', fontWeight: 700 }}>
                          Squad Photos - Tap to open player details
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => downloadFromUrl(`/media/banners/teams/team_banner_${t.id}.png`, `team_banner_${t.id}.png`)}
                          >
                            Download Squad Banner
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                          {teamPlayers[t.id].map((pl) => {
                            const playerKey = `${t.id}_${pl.id}`
                            const isSelected = selectedPlayerKey === playerKey
                            return (
                              <button
                                key={pl.id}
                                type="button"
                                onClick={() => openPlayerStats(t.id, pl)}
                                style={{
                                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                                  borderRadius: 10,
                                  background: 'var(--bg-2)',
                                  overflow: 'hidden',
                                  textAlign: 'left',
                                  padding: 0,
                                }}
                              >
                                <div style={{ position: 'relative', width: '100%', height: 124, background: 'var(--bg)' }}>
                                  {pl.photo
                                    ? <img src={pl.photo} alt={pl.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', color: 'var(--accent)', fontWeight: 800 }}>{pl.name?.[0] || '?'}</div>}
                                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 8px 7px', background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,.78) 45%, rgba(0,0,0,.92))' }}>
                                    <div style={{ fontSize: '.67rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {pl.name}{pl.is_captain ? ' (C)' : ''}
                                    </div>
                                    <div style={{ fontSize: '.61rem', color: '#c5d5ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pl.role || 'Player'}</div>
                                  </div>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {(() => {
                        const selected = teamPlayers[t.id].find((pl) => selectedPlayerKey === `${t.id}_${pl.id}`)
                        if (!selected) return null
                        const stats = playerStatsById[selected.id]
                        const isLoading = !!playerStatsLoading[selected.id]
                        return (
                          <div style={{ margin: '0 10px 10px', borderRadius: 12, border: '1px solid var(--border)', background: 'linear-gradient(155deg, var(--bg), var(--bg-2))', overflow: 'hidden' }}>
                            {isLoading && (
                              <div style={{ padding: '14px 12px', fontSize: '.78rem', color: 'var(--t2)' }}>Loading player performance...</div>
                            )}

                            {!isLoading && stats && (
                              <>
                                <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'stretch', borderBottom: '1px solid var(--border)' }}>
                                  <div style={{ width: 112, minWidth: 112, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                    {stats.player?.photo
                                      ? <img src={stats.player.photo} alt={stats.player.name} style={{ width: '100%', height: '100%', minHeight: 132, objectFit: 'cover', objectPosition: 'top' }} />
                                      : <div style={{ width: '100%', height: 132, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.1rem', fontWeight: 900, color: 'var(--accent)' }}>{stats.player?.name?.[0] || '?'}</div>}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <h4 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>{stats.player?.name}</h4>
                                    <p style={{ margin: '0 0 6px', color: 'var(--t2)', fontSize: '.72rem' }}>{stats.player?.role || 'Player'} {stats.player?.jersey_number ? `- #${stats.player.jersey_number}` : ''}</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, fontSize: '.68rem' }}>
                                      <div style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8 }}>Matches: <strong>{stats.totals?.matches || 0}</strong></div>
                                      <div style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8 }}>Runs: <strong>{stats.totals?.batting?.runs || 0}</strong></div>
                                      <div style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8 }}>Wkts: <strong>{stats.totals?.bowling?.wickets || 0}</strong></div>
                                      <div style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 8 }}>SR: <strong>{stats.totals?.batting?.strike_rate || 0}</strong></div>
                                    </div>
                                  </div>
                                </div>

                                <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                                  <h5 style={{ margin: '0 0 8px', fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--t2)' }}>Total Performance</h5>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, fontSize: '.68rem' }}>
                                    <div style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>Bat Avg: <strong>{stats.totals?.batting?.average || 0}</strong></div>
                                    <div style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>High: <strong>{stats.totals?.batting?.highest || 0}</strong></div>
                                    <div style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>Econ: <strong>{stats.totals?.bowling?.economy || 0}</strong></div>
                                    <div style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>Best: <strong>{stats.totals?.bowling?.best || '0/0'}</strong></div>
                                    <div style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>50s/100s: <strong>{stats.totals?.batting?.fifties || 0}/{stats.totals?.batting?.hundreds || 0}</strong></div>
                                    <div style={{ padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>Overs Bowled: <strong>{fmtOvers(stats.totals?.bowling?.balls || 0)}</strong></div>
                                  </div>
                                </div>

                                <div style={{ padding: '10px 12px' }}>
                                  <h5 style={{ margin: '0 0 8px', fontSize: '.74rem', textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--t2)' }}>Match by Match</h5>
                                  {(stats.match_stats || []).length === 0 && (
                                    <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--t2)' }}>No performance entries yet.</p>
                                  )}
                                  {(stats.match_stats || []).map((ms) => (
                                    <div key={ms.match_id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 9px', marginBottom: 8 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                        <strong style={{ fontSize: '.72rem' }}>Match #{ms.match_number} vs {ms.opponent_name || 'TBD'}</strong>
                                        <span style={{ fontSize: '.65rem', color: 'var(--t2)' }}>{ms.date || 'Date TBD'} {ms.time ? `- ${ms.time}` : ''}</span>
                                      </div>
                                      <div style={{ fontSize: '.68rem', color: 'var(--t2)' }}>
                                        Batting: {ms.batting?.runs || 0} ({ms.batting?.balls || 0}) - 4s {ms.batting?.fours || 0}, 6s {ms.batting?.sixes || 0}
                                      </div>
                                      <div style={{ fontSize: '.68rem', color: 'var(--t2)' }}>
                                        Bowling: {ms.bowling?.wickets || 0}/{ms.bowling?.runs || 0} in {fmtOvers(ms.bowling?.balls || 0)}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* FIXTURES */}
        {activeTab === 'fixtures' && (
          <div>
            {!missingBanners[`fixtures_overall_${league.id}`] && (
              <div className="card" style={{ marginBottom: 8, overflow: 'hidden' }}>
                <img
                  src={`/media/banners/leagues/fixtures_banner_${league.id}.png`}
                  alt={`${league.name} fixtures banner`}
                  style={{ width: '100%', height: 130, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onError={() => markMissing(`fixtures_overall_${league.id}`)}
                  onClick={() => handleBannerTap(`/media/banners/leagues/fixtures_banner_${league.id}.png`, `fixtures_banner_${league.id}.png`)}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '8px 10px' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => handleBannerTap(`/media/banners/leagues/fixtures_banner_${league.id}.png`, `fixtures_banner_${league.id}.png`)}
                  >
                    View Banner
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => downloadFromUrl(`/media/banners/leagues/fixtures_banner_${league.id}.png`, `fixtures_banner_${league.id}.png`)}
                  >
                    Download Fixtures Banner
                  </button>
                </div>
              </div>
            )}

            {upcoming.length === 0
              ? <div className="empty"><span className="ico">F</span><h4>No upcoming fixtures</h4></div>
              : upcoming.map(m => (
                <div key={m.id} className="card" style={{ marginBottom: 8 }}>
                  {getVsBannerSrc(m.id) && (
                    <img
                      src={getVsBannerSrc(m.id)}
                      alt={`${m.team_a_name} vs ${m.team_b_name} banner`}
                      style={{ width: '100%', height: 108, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onError={() => {
                        if (!missingBanners[`vs_icc_${m.id}`]) markMissing(`vs_icc_${m.id}`)
                        else markMissing(`vs_${m.id}`)
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
                    <div className="fixture-meta">{m.venue || 'Venue TBD'} - {(m.date || m.match_date || 'Date TBD')} - {(m.time || m.match_time || 'Time TBD')}</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
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
        )}

        {/* RESULTS */}
        {activeTab === 'results' && (
          <div>
            {completed.length === 0
              ? <div className="empty"><span className="ico">R</span><h4>No results yet</h4></div>
              : completed.map(m => (
                <Link to={`/match/${m.id}`} key={m.id} className="card card-hover" style={{ textDecoration: 'none', color: 'inherit', marginBottom: 8, display: 'block' }}>
                  {(() => {
                    const { summarySrc, winnerSrc, resultSrc, primarySrc: src } = getResultBannerSources(m.id)
                    if (!src) return null
                    return (
                      <img
                        src={src}
                        alt={`${m.team_a_name} vs ${m.team_b_name} summary`}
                        style={{ width: '100%', height: 118, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onError={() => {
                          if (src === summarySrc) markMissing(`summary_${m.id}`)
                          else if (src === winnerSrc) markMissing(`winner_${m.id}`)
                          else markMissing(`result_${m.id}`)
                        }}
                        onClick={(e) => {
                          e.preventDefault()
                          handleBannerTap(src, src.split('/').pop())
                        }}
                      />
                    )
                  })()}
                  <div className="match-card-header">
                    <span style={{ fontSize: '.68rem', color: 'var(--t3)' }}>Match #{m.match_number}</span>
                    <span className="badge badge-completed">Done</span>
                  </div>
                  <div className="fixture-card" style={{ paddingTop: 10 }}>
                    <div className="fixture-teams">
                      <div className="fixture-team">{m.team_a_name}</div>
                      <div className="fixture-vs" style={{ color: 'var(--accent)' }}>vs</div>
                      <div className="fixture-team">{m.team_b_name}</div>
                    </div>
                    <div className="result-summary">{m.result_summary || 'Result recorded'}</div>
                    {m.mom_name && <div style={{ fontSize: '.68rem', color: 'var(--gold)', marginTop: 4 }}>MOM: {m.mom_name}</div>}
                    {(() => {
                      const { summarySrc, winnerSrc, resultSrc } = getResultBannerSources(m.id)
                      if (!summarySrc && !winnerSrc && !resultSrc) return null

                      const ActionBtn = ({ label, src, download = false }) => (
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          style={{ width: '100%', justifyContent: 'flex-start' }}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (!src) return
                            if (download) downloadFromUrl(src, src.split('/').pop())
                            else handleBannerTap(src, src.split('/').pop())
                          }}
                        >
                          {label}
                        </button>
                      )

                      return (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                          <details
                            style={{ width: '100%', maxWidth: 250 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <summary
                              className="btn btn-secondary btn-xs"
                              style={{ listStyle: 'none', cursor: 'pointer', textAlign: 'center' }}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                const detailsEl = e.currentTarget.parentElement
                                if (detailsEl) detailsEl.open = !detailsEl.open
                              }}
                            >
                              Banners
                            </summary>
                            <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                              {winnerSrc && <ActionBtn label="View Winner Banner" src={winnerSrc} />}
                              {winnerSrc && <ActionBtn label="Download Winner Banner" src={winnerSrc} download />}
                              {summarySrc && <ActionBtn label="View Summary Banner" src={summarySrc} />}
                              {summarySrc && <ActionBtn label="Download Summary Banner" src={summarySrc} download />}
                              {resultSrc && <ActionBtn label="View Result Banner" src={resultSrc} />}
                              {resultSrc && <ActionBtn label="Download Result Banner" src={resultSrc} download />}
                            </div>
                          </details>
                        </div>
                      )
                    })()}
                  </div>
                </Link>
              ))}
          </div>
        )}

        {/* POINTS TABLE */}
        {activeTab === 'points' && (
          <div>
            {!missingBanners[`points_${league.id}`] && (
              <div className="card" style={{ marginBottom: 8, overflow: 'hidden' }}>
                <img
                  src={`/media/banners/leagues/points_table_icc_${league.id}.png`}
                  alt={`${league.name} ICC points table banner`}
                  style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                  onError={() => markMissing(`points_${league.id}`)}
                  onClick={() => handleBannerTap(`/media/banners/leagues/points_table_icc_${league.id}.png`, `points_table_icc_${league.id}.png`)}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <button type="button" className="btn btn-secondary btn-xs" onClick={downloadPointsTable}>
                Download Points Table Image
              </button>
            </div>
            <div
              ref={pointsTableRef}
              className="card"
              style={{
                overflow: 'hidden',
                background: 'radial-gradient(circle at 14% 10%, rgba(132,255,63,.28), transparent 32%), linear-gradient(140deg, #0a3f2e, #0b2e5f 58%, #0b1e3f)',
                border: '1px solid rgba(180,255,110,.35)',
              }}
            >
              <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.16)', background: 'linear-gradient(135deg, rgba(188,255,89,.24), rgba(0,0,0,.25))' }}>
                <div style={{ fontSize: '.85rem', fontWeight: 900, color: '#ebff9a', textTransform: 'uppercase', letterSpacing: '.55px' }}>{league.name} - Standings</div>
                <div style={{ fontSize: '.68rem', color: '#e7f3ff', marginTop: 2 }}>
                  {[league.city, league.format && `${league.format} ${league.overs_per_innings || 20} ov`, league.organizer && `Organizer: ${league.organizer}`].filter(Boolean).join(' · ')}
                </div>
              </div>
            {pointsTableRows.length === 0
              ? <div className="empty"><span className="ico">S</span><h4>No standings yet</h4></div>
              : (
                <table className="points-table" style={{ background: 'rgba(0,0,0,.18)' }}>
                  <thead>
                    <tr>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>#</th>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>Team</th>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>M</th>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>W</th>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>L</th>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>Pts</th>
                      <th style={{ background: 'rgba(5,10,35,.58)', color: '#c6dbff' }}>NRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pointsTableRows.map((p, i) => (
                      <tr
                        key={p.team_id}
                        style={{
                          background: i === 0
                            ? 'linear-gradient(90deg, rgba(196,255,87,.22), rgba(255,255,255,.02))'
                            : (i % 2 === 0 ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.01)'),
                        }}
                      >
                        <td>
                          <span
                            className="pts-val"
                            style={{
                              color: '#f3ff9e',
                              background: 'rgba(0,0,0,.34)',
                              padding: '2px 6px',
                              borderRadius: 8,
                            }}
                          >
                            {i + 1}
                          </span>
                        </td>
                        <td style={{ fontWeight: 800, color: '#f5ffde', textAlign: 'left', paddingLeft: 6 }}>{p.name}</td>
                        <td style={{ color: '#e6f5ff' }}>{p.matches_played}</td>
                        <td style={{ color: '#c8ff92', fontWeight: 800 }}>{p.wins}</td>
                        <td style={{ color: '#ffd6d6' }}>{p.losses}</td>
                        <td><span className="pts-val" style={{ color: '#b8ff52' }}>{p.points}</span></td>
                        <td style={{ color: p.nrr >= 0 ? '#8dff7d' : '#ff8ca4', fontFamily: 'var(--mono)', fontSize: '.72rem', fontWeight: 700 }}>
                          {p.nrr > 0 ? '+' : ''}{(p.nrr || 0).toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* STATISTICS */}
        {activeTab === 'statistics' && (
          <div>
            <div className="sect-head"><h3>Top Batters</h3></div>
            {battingStats.length === 0
              ? <div className="empty"><span className="ico">B</span><h4>No batting data yet</h4></div>
              : (
                <div className="card" style={{ marginBottom: 20, overflowX: 'auto' }}>
                  <table className="mobile-table">
                    <thead><tr><th>Player</th><th>Team</th><th>M</th><th>Runs</th><th>Balls</th><th>4s</th><th>6s</th></tr></thead>
                    <tbody>
                      {battingStats.slice(0, 15).map((p, i) => (
                        <tr
                          key={`bat-${p.id || p.player_id || i}`}
                          onClick={() => openStatPlayerPopup(p, 'batting')}
                          style={{ cursor: 'pointer' }}
                          title="Tap for detailed player stats"
                        >
                          <td style={{ fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className={`player-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}`} style={{ width: 22, height: 22, minWidth: 22, fontSize: '.62rem' }}>{i + 1}</span>
                              {p.photo
                                ? <img src={p.photo} alt={p.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--border)' }} />
                                : <span className="player-avatar" style={{ width: 28, height: 28, minWidth: 28, fontSize: '.68rem' }}>{p.name?.[0] || '?'}</span>}
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
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
              )}

            <div className="sect-head"><h3>Top Bowlers</h3></div>
            {bowlingStats.length === 0
              ? <div className="empty"><span className="ico">W</span><h4>No bowling data yet</h4></div>
              : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table className="mobile-table">
                    <thead><tr><th>Player</th><th>Team</th><th>M</th><th>Wkts</th><th>Overs</th><th>Runs</th></tr></thead>
                    <tbody>
                      {bowlingStats.slice(0, 15).map((p, i) => (
                        <tr
                          key={`bowl-${p.id || p.player_id || i}`}
                          onClick={() => openStatPlayerPopup(p, 'bowling')}
                          style={{ cursor: 'pointer' }}
                          title="Tap for detailed player stats"
                        >
                          <td style={{ fontWeight: 600 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className={`player-rank ${i===0?'gold':i===1?'silver':i===2?'bronze':''}`} style={{ width: 22, height: 22, minWidth: 22, fontSize: '.62rem' }}>{i + 1}</span>
                              {p.photo
                                ? <img src={p.photo} alt={p.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--border)' }} />
                                : <span className="player-avatar" style={{ width: 28, height: 28, minWidth: 28, fontSize: '.68rem' }}>{p.name?.[0] || '?'}</span>}
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
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
              )}
          </div>
        )}

        {selectedStatPlayer && (
          <div className="modal-overlay" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={closeStatPlayerPopup}>
            <div className="modal" style={{ maxWidth: 640, width: '100%', borderRadius: 16, maxHeight: '86vh', borderTop: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{selectedStatPlayer.player_name || selectedStatPlayer.name}</h3>
                <button className="modal-close" onClick={closeStatPlayerPopup}>×</button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ borderRadius: 14, padding: 12, background: 'linear-gradient(140deg,#2f0754 0%, #3a0a68 55%, #250547 100%)', border: '1px solid rgba(255,255,255,.18)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '132px 1fr', gap: 12, alignItems: 'stretch' }}>
                    <div style={{ borderRadius: 12, border: '2px solid #f7c948', background: 'radial-gradient(circle at 50% 20%, #f8df9f, #b3882e)', minHeight: 150, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2f0754', fontSize: '2.3rem', fontWeight: 900 }}>
                      {getStatPlayerPhoto()
                        ? <img src={getStatPlayerPhoto()} alt={selectedStatPlayer.player_name || selectedStatPlayer.name} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                        : <span>{(selectedStatPlayer.player_name || selectedStatPlayer.name || '?')[0]}</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: '.76rem', color: 'rgba(255,255,255,.82)', marginBottom: 6, fontWeight: 700 }}>
                        Team: {selectedStatPlayer.team_name || 'N/A'}
                      </div>

                      {statPlayerLoading && <div style={{ color: '#fff' }}>Loading player details...</div>}

                      {!statPlayerLoading && selectedStatPlayer.type === 'batting' && (
                        <div>
                          {statRow('Matches Played', getStatMatchesPlayed())}
                          {statRow('Innings', getStatInningsPlayed('batting'))}
                          {statRow('Runs', selectedStatPlayerStats?.totals?.batting?.runs || selectedStatPlayer.total_runs || 0)}
                          {statRow('Average', selectedStatPlayerStats?.totals?.batting?.average || selectedStatPlayer.average || 0)}
                          {statRow('Strike Rate', selectedStatPlayerStats?.totals?.batting?.strike_rate || (selectedStatPlayer.total_balls ? ((Number(selectedStatPlayer.total_runs || 0) / Number(selectedStatPlayer.total_balls || 1)) * 100).toFixed(2) : '0.00'))}
                          {statRow('50s / 100s', `${selectedStatPlayerStats?.totals?.batting?.fifties || 0}/${selectedStatPlayerStats?.totals?.batting?.hundreds || 0}`)}
                          {statRow('Best', selectedStatPlayerStats?.totals?.batting?.highest || selectedStatPlayer.highest || selectedStatPlayer.total_runs || 0)}
                        </div>
                      )}

                      {!statPlayerLoading && selectedStatPlayer.type === 'bowling' && (
                        <div>
                          {statRow('Matches Played', getStatMatchesPlayed())}
                          {statRow('Innings', getStatInningsPlayed('bowling'))}
                          {statRow('Wickets', selectedStatPlayerStats?.totals?.bowling?.wickets || selectedStatPlayer.total_wickets || 0)}
                          {statRow('Runs Conceded', selectedStatPlayerStats?.totals?.bowling?.runs || selectedStatPlayer.total_runs_conceded || 0)}
                          {statRow('Overs', fmtOvers(selectedStatPlayerStats?.totals?.bowling?.balls || selectedStatPlayer.total_balls || 0))}
                          {statRow('Economy', selectedStatPlayerStats?.totals?.bowling?.economy || (selectedStatPlayer.total_balls ? (Number(selectedStatPlayer.total_runs_conceded || 0) / (Number(selectedStatPlayer.total_balls || 0) / 6)).toFixed(2) : '0.00'))}
                          {statRow('Best', selectedStatPlayerStats?.totals?.bowling?.best || selectedStatPlayer.best || `${selectedStatPlayer.total_wickets || 0}/${selectedStatPlayer.total_runs_conceded || 0}`)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <button type="button" className="btn btn-secondary" onClick={downloadPlayerStatCard} disabled={statCardGenerating || statPlayerLoading}>
                  {statCardGenerating ? 'Generating Card...' : 'Download Stat Card Image'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
