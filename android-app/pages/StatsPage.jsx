import { useEffect, useState } from 'react'
import { useDataStore } from '../context/DataStore'

export default function StatsPage() {
  const { leagues, fetchLeagueStats, api: API } = useDataStore()
  const [selectedLeague, setSelectedLeague] = useState('')
  const [batting, setBatting] = useState([])
  const [bowling, setBowling] = useState([])
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [selectedPlayerStats, setSelectedPlayerStats] = useState(null)
  const [playerPopupLoading, setPlayerPopupLoading] = useState(false)
  const [cardGenerating, setCardGenerating] = useState(false)
  const [statsLoading, setStatsLoading] = useState(true)
  const selectedLeagueObj = leagues.find((l) => String(l.id) === String(selectedLeague))

  const fmtOvers = (b) => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`
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

  const getMatchesPlayed = (player, stats) => {
    const byMatchStats = Array.isArray(stats?.match_stats)
      ? new Set(stats.match_stats.map((ms) => ms.match_id || `${ms.match_number || ''}_${ms.date || ''}_${ms.opponent_name || ''}`)).size
      : 0
    const byTotals = Number(stats?.totals?.matches ?? player?.matches_played ?? player?.total_matches ?? player?.matches ?? 0)
    const byActivity = (
      Number(stats?.totals?.batting?.runs || 0) > 0
      || Number(stats?.totals?.bowling?.wickets || 0) > 0
      || hasActivity(player)
    ) ? 1 : 0
    return byMatchStats > 0 ? byMatchStats : (byTotals > 0 ? byTotals : byActivity)
  }

  const getInningsPlayed = (player, stats, type) => {
    if (type === 'batting') {
      return Number(stats?.totals?.batting?.innings ?? player?.innings ?? 0)
    }
    return Number(stats?.totals?.bowling?.innings ?? player?.innings ?? 0)
  }

  const statRow = (label, value) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
      <div style={{ color: '#f6d3ff', fontWeight: 700, letterSpacing: '.25px', textTransform: 'uppercase', fontSize: '.66rem' }}>{label}</div>
      <div style={{ color: '#ffffff', fontWeight: 800, fontFamily: 'var(--mono)' }}>{value}</div>
    </div>
  )

  const openPlayerPopup = async (player, type) => {
    const playerId = player?.player_id || player?.id
    const base = { ...player, type }
    setSelectedPlayer(base)
    setSelectedPlayerStats(null)
    if (!playerId) return

    setPlayerPopupLoading(true)
    try {
      const stats = await fetch(`${API}/players/${playerId}/stats?league_id=${selectedLeague}`).then((r) => r.json()).catch(() => null)
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

  const getStatEntries = () => {
    if (!selectedPlayer) return []
    if (selectedPlayer.type === 'batting') {
      return [
        ['MATCHES', getMatchesPlayed(selectedPlayer, selectedPlayerStats)],
        ['INNINGS', getInningsPlayed(selectedPlayer, selectedPlayerStats, 'batting')],
        ['RUNS', selectedPlayerStats?.totals?.batting?.runs || selectedPlayer.total_runs || 0],
        ['AVERAGE', selectedPlayerStats?.totals?.batting?.average || selectedPlayer.average || 0],
        ['STRIKE RATE', selectedPlayerStats?.totals?.batting?.strike_rate || (selectedPlayer.total_balls ? ((Number(selectedPlayer.total_runs || 0) / Number(selectedPlayer.total_balls || 1)) * 100).toFixed(2) : '0.00')],
        ['50s/100s', `${selectedPlayerStats?.totals?.batting?.fifties || 0}/${selectedPlayerStats?.totals?.batting?.hundreds || 0}`],
        ['BEST', selectedPlayerStats?.totals?.batting?.highest || selectedPlayer.highest || selectedPlayer.total_runs || 0],
      ]
    }
    return [
      ['MATCHES', getMatchesPlayed(selectedPlayer, selectedPlayerStats)],
      ['INNINGS', getInningsPlayed(selectedPlayer, selectedPlayerStats, 'bowling')],
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
    || selectedLeagueObj?.name
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

      // Decorative side shapes inspired by reference style.
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

  // Auto-select first league when leagues load from DataStore
  useEffect(() => {
    if (leagues?.length && !selectedLeague) {
      setSelectedLeague(String(leagues[0].id))
    }
  }, [leagues, selectedLeague])

  // Fetch league-specific stats via DataStore's SWR-cached helper
  useEffect(() => {
    if (!selectedLeague) return
    setStatsLoading(true)
    fetchLeagueStats(selectedLeague).then((data) => {
      setBatting(data.batting)
      setBowling(data.bowling)
      setStatsLoading(false)
    }).catch(() => {
      setBatting([])
      setBowling([])
      setStatsLoading(false)
    })
  }, [selectedLeague, fetchLeagueStats])

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="sect-head"><h3>📊 League Stats</h3></div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <select className="form-select" value={selectedLeague} onChange={(e) => setSelectedLeague(e.target.value)}>
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <div className="card" style={{ marginBottom: 12, overflowX: 'auto' }}>
        <div className="match-card-header"><span>🏏 Top Batting</span></div>
        {statsLoading ? (
          <div style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
          </div>
        ) : batting.length === 0 ? (
          <div className="empty" style={{ padding: '20px 0' }}><p>No batting stats yet</p></div>
        ) : (
          <table className="mobile-table">
            <thead><tr><th>Player</th><th>Team</th><th>M</th><th>Runs</th><th>Balls</th><th>4s</th><th>6s</th></tr></thead>
            <tbody>
              {batting.slice(0, 15).map((p) => (
                <tr
                  key={`bat-${p.id}`}
                  onClick={() => openPlayerPopup(p, 'batting')}
                  style={{ cursor: 'pointer' }}
                  title="Tap for detailed player stats"
                >
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
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
        )}
      </div>

      <div className="card" style={{ overflowX: 'auto' }}>
        <div className="match-card-header"><span>🎳 Top Bowling</span></div>
        {statsLoading ? (
          <div style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
          </div>
        ) : bowling.length === 0 ? (
          <div className="empty" style={{ padding: '20px 0' }}><p>No bowling stats yet</p></div>
        ) : (
          <table className="mobile-table">
            <thead><tr><th>Player</th><th>Team</th><th>M</th><th>Wkts</th><th>Overs</th><th>Runs</th></tr></thead>
            <tbody>
              {bowling.slice(0, 15).map((p) => (
                <tr
                  key={`bowl-${p.id}`}
                  onClick={() => openPlayerPopup(p, 'bowling')}
                  style={{ cursor: 'pointer' }}
                  title="Tap for detailed player stats"
                >
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td style={{ color: 'var(--t2)' }}>{p.team_name || '-'}</td>
                  <td>{mValue(p)}</td>
                  <td className="cell-hl" style={{ color: 'var(--red)' }}>{p.total_wickets || 0}</td>
                  <td>{fmtOvers(p.total_balls || 0)}</td>
                  <td>{p.total_runs_conceded || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedPlayer && (
        <div className="modal-overlay" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={closePlayerPopup}>
          <div className="modal" style={{ maxWidth: 640, width: '100%', borderRadius: 16, maxHeight: '86vh', borderTop: '1px solid var(--border)' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedPlayer.player_name || selectedPlayer.name}</h3>
              <button className="modal-close" onClick={closePlayerPopup}>×</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                        {statRow('Matches Played', getMatchesPlayed(selectedPlayer, selectedPlayerStats))}
                        {statRow('Innings', getInningsPlayed(selectedPlayer, selectedPlayerStats, 'batting'))}
                        {statRow('Runs', selectedPlayerStats?.totals?.batting?.runs || selectedPlayer.total_runs || 0)}
                        {statRow('Average', selectedPlayerStats?.totals?.batting?.average || selectedPlayer.average || 0)}
                        {statRow('Strike Rate', selectedPlayerStats?.totals?.batting?.strike_rate || (selectedPlayer.total_balls ? ((Number(selectedPlayer.total_runs || 0) / Number(selectedPlayer.total_balls || 1)) * 100).toFixed(2) : '0.00'))}
                        {statRow('50s / 100s', `${selectedPlayerStats?.totals?.batting?.fifties || 0}/${selectedPlayerStats?.totals?.batting?.hundreds || 0}`)}
                        {statRow('Best', selectedPlayerStats?.totals?.batting?.highest || selectedPlayer.highest || selectedPlayer.total_runs || 0)}
                      </div>
                    )}

                    {!playerPopupLoading && selectedPlayer.type === 'bowling' && (
                      <div>
                        {statRow('Matches Played', getMatchesPlayed(selectedPlayer, selectedPlayerStats))}
                        {statRow('Innings', getInningsPlayed(selectedPlayer, selectedPlayerStats, 'bowling'))}
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
