import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { handleBannerTap } from '../utils/media'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || 'https://cricket-android.azurewebsites.net/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

export default function LiveMatch() {
  const { matchId, id: routeId } = useParams()
  const id = matchId || routeId
  const [match, setMatch] = useState(null)
  const [scorecard, setScorecard] = useState([])
  const [balls, setBalls] = useState([])
  const [missingBanners, setMissingBanners] = useState({})
  const [lastSync, setLastSync] = useState(null)
  const [autoSync, setAutoSync] = useState(true)
  const [syncEveryMs, setSyncEveryMs] = useState(4000)
  const [syncing, setSyncing] = useState(false)
  const [displayRuns, setDisplayRuns] = useState(0)
  const [displayWickets, setDisplayWickets] = useState(0)
  const [scoreFlash, setScoreFlash] = useState(false)
  const [isIslandOpen, setIsIslandOpen] = useState(false)

  const fetchJsonFresh = async (url, fallback) => {
    try {
      const sep = url.includes('?') ? '&' : '?'
      const freshUrl = `${url}${sep}_ts=${Date.now()}`
      const res = await fetch(freshUrl, { cache: 'no-store' })
      if (!res.ok) return fallback
      return await res.json()
    } catch {
      return fallback
    }
  }

  useEffect(() => { loadData() }, [id])
  useEffect(() => {
    if (!autoSync) return
    const interval = setInterval(loadData, syncEveryMs)
    return () => clearInterval(interval)
  }, [id, autoSync, syncEveryMs])

  useEffect(() => {
    const animateTo = (setter, from, to) => {
      const start = performance.now()
      const duration = 420
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration)
        const eased = 1 - Math.pow(1 - t, 3)
        const next = Math.round(from + (to - from) * eased)
        setter(next)
        if (t < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }

    const active = scorecard.find((s) => !s.is_completed) || scorecard[scorecard.length - 1]
    const nextRuns = Number(active?.total_runs || 0)
    const nextWkts = Number(active?.total_wickets || 0)
    animateTo(setDisplayRuns, Number(displayRuns || 0), nextRuns)
    animateTo(setDisplayWickets, Number(displayWickets || 0), nextWkts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scorecard])

  useEffect(() => {
    if (!balls.length) return
    const last = balls[balls.length - 1]
    const runs = Number(last?.runs_scored || 0)
    if (runs === 4 || runs === 6) {
      setScoreFlash(true)
      const timer = setTimeout(() => setScoreFlash(false), 760)
      return () => clearTimeout(timer)
    }
  }, [balls])

  useEffect(() => {
    const onGlobalRefresh = () => loadData().catch(() => {})
    window.addEventListener('crickethub:refresh-all', onGlobalRefresh)
    return () => window.removeEventListener('crickethub:refresh-all', onGlobalRefresh)
  }, [id])

  const loadData = async () => {
    setSyncing(true)
    const m = await fetchJsonFresh(`${API}/matches/${id}`, null)
    if (!m) {
      setSyncing(false)
      return
    }
    setMatch(m)
    const sc = await fetchJsonFresh(`${API}/matches/${id}/scorecard`, [])
    setScorecard(sc)
    const activeScoreInnings = (Array.isArray(sc) ? sc : []).find((i) => !i.is_completed) || (Array.isArray(sc) ? sc[sc.length - 1] : null)
    const activeMatchInnings = m.innings?.find(i => !i.is_completed) || m.innings?.[m.innings.length - 1]
    const inningsIdForBalls = activeScoreInnings?.id
      || m.innings?.find((i) => Number(i.innings_number) === Number(activeScoreInnings?.innings_number))?.id
      || activeMatchInnings?.id
    if (inningsIdForBalls) {
      const b = await fetchJsonFresh(`${API}/innings/${inningsIdForBalls}/balls`, [])
      setBalls(b)
    } else {
      setBalls([])
    }
    setLastSync(new Date())
    setSyncing(false)
  }

  const fmtOvers = b => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`
  const getInningsTotals = (inn) => {
    if (!inn) return { runs: 0, wickets: 0, balls: 0 }
    const extras = Number(inn.extras_wides || 0) + Number(inn.extras_noballs || 0) + Number(inn.extras_byes || 0) + Number(inn.extras_legbyes || 0)
    const battingRuns = (inn.batting || []).reduce((sum, b) => sum + Number(b.runs || 0), 0)
    const wickets = (inn.batting || []).reduce((sum, b) => sum + (b.is_out ? 1 : 0), 0)
    const bowlingBalls = (inn.bowling || []).reduce((sum, b) => sum + Number(b.balls_bowled || 0), 0)
    return {
      runs: Number(inn.total_runs || 0) > 0 ? Number(inn.total_runs || 0) : battingRuns + extras,
      wickets: Number(inn.total_wickets || 0) > 0 ? Number(inn.total_wickets || 0) : wickets,
      balls: Number(inn.total_balls || 0) > 0 ? Number(inn.total_balls || 0) : bowlingBalls,
    }
  }

  if (!match) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  if (match.status === 'completed') return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: '3rem' }}>🏆</div>
        <h2 style={{ background: 'var(--g-gold)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>Match Complete</h2>
        <p style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '1rem', maxWidth: 300 }}>{match.result_summary}</p>
        <Link to={`/match/${id}`} className="btn-accent" style={{ display: 'inline-block', padding: '10px 24px', borderRadius: 'var(--r2)', textDecoration: 'none' }}>View Full Scorecard →</Link>
      </div>
    </div>
  )

  const activeInnings = scorecard.find(s => !s.is_completed) || scorecard[scorecard.length - 1]
  const activeTotals = getInningsTotals(activeInnings)
  const currentRR = activeTotals.balls > 0 ? ((activeTotals.runs / activeTotals.balls) * 6).toFixed(2) : '0.00'
  const striker = (activeInnings?.batting || []).find((b) => String(b.player_id) === String(activeInnings?.striker_id))
  const nonStriker = (activeInnings?.batting || []).find((b) => String(b.player_id) === String(activeInnings?.non_striker_id))
  const currentBowler = (activeInnings?.bowling || []).find((b) => String(b.player_id) === String(activeInnings?.current_bowler_id))
  const inningsType = activeInnings?.innings_number === 2 ? 'second' : 'first'
  const inningsBannerKey = `innings_${id}_${inningsType}`
  const tickerItems = [
    `${match.team_a_name || 'Team A'} vs ${match.team_b_name || 'Team B'}`,
    `Score ${displayRuns}/${displayWickets} (${fmtOvers(activeTotals.balls)} ov)`,
    `CRR ${currentRR}`,
    striker?.name ? `Striker ${striker.name} ${striker.runs || 0}(${striker.balls_faced || 0})` : 'Striker TBD',
    currentBowler?.name ? `Bowler ${currentBowler.name} ${currentBowler.wickets || 0}/${currentBowler.runs_conceded || 0}` : 'Bowler TBD',
  ].join('  •  ')

  return (
    <div style={{ paddingBottom: 40 }}>
      <div
        onClick={() => setIsIslandOpen((v) => !v)}
        style={{
          position: 'sticky',
          top: 6,
          zIndex: 140,
          margin: '8px auto 0',
          width: isIslandOpen ? 'min(92vw, 430px)' : 'min(70vw, 300px)',
          borderRadius: 999,
          background: 'rgba(8,14,24,.9)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 12px 26px rgba(0,0,0,.35)',
          padding: isIslandOpen ? '8px 12px' : '7px 11px',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          cursor: 'pointer',
          transition: 'all .26s cubic-bezier(.22,.82,.32,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff4d6d', boxShadow: '0 0 10px rgba(255,77,109,.52)', animation: 'blink 1.3s ease-in-out infinite' }} />
          <span style={{ fontSize: '.67rem', color: 'var(--t2)', fontWeight: 700, letterSpacing: '.35px' }}>
            LIVE {displayRuns}/{displayWickets} ({fmtOvers(activeTotals.balls)} ov)
          </span>
        </div>
        {isIslandOpen && (
          <div className="live-ticker" style={{ marginTop: 7 }}>
            <div className="live-ticker-track">{tickerItems}</div>
          </div>
        )}
      </div>

      {/* Topbar */}
      <div style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(24px)',
        borderBottom: '2px solid var(--accent)',
        height: 48, display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 10,
        position: 'sticky', top: 62, zIndex: 50,
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: '0.88rem', letterSpacing: 2, textTransform: 'uppercase', background: 'var(--g-accent)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
          CricketHub
        </span>
        <span style={{ color: 'var(--t3)', fontSize: '0.7rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-display)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {match.league_name}
        </span>
        <span style={{ background: 'var(--red-dim)', color: 'var(--red)', border: '1px solid rgba(255,77,109,0.3)', fontFamily: 'var(--font-display)', fontSize: '0.6rem', fontWeight: 700, letterSpacing: 2, padding: '3px 9px', borderRadius: 4, animation: 'livePulse 1.6s ease-in-out infinite', flexShrink: 0 }}>
          ● LIVE
        </span>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="card" style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: '.68rem', color: 'var(--t2)' }}>Live auto-sync controls</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.68rem', color: 'var(--t2)', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              Auto sync
            </label>
            <select
              value={syncEveryMs}
              onChange={(e) => setSyncEveryMs(Number(e.target.value) || 4000)}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-2)',
                color: 'var(--t1)',
                padding: '4px 6px',
                fontSize: '.66rem',
              }}
              disabled={!autoSync}
            >
              <option value={4000}>4s</option>
              <option value={6000}>6s</option>
              <option value={8000}>8s</option>
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => loadData()}
              disabled={syncing}
            >
              {syncing ? 'Syncing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {!missingBanners[inningsBannerKey] && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <img
              src={`/media/banners/matches/innings_banner_${inningsType}_${id}.png`}
              alt={`${match.team_a_name} vs ${match.team_b_name} innings banner`}
              style={{ width: '100%', maxHeight: 170, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
              onError={() => setMissingBanners((prev) => ({ ...prev, [inningsBannerKey]: true }))}
              onClick={() => handleBannerTap(`/media/banners/matches/innings_banner_${inningsType}_${id}.png`, `innings_banner_${inningsType}_${id}.png`)}
            />
          </div>
        )}

        {/* ── HERO SCOREBOARD ── */}
        <div className={`card ${scoreFlash ? 'score-flash' : ''}`} style={{ overflow: 'hidden' }}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between',padding: '10px 16px',borderBottom: '1px solid var(--glass-bd)',background: 'var(--accent-dim)',}}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent)' }}>
              {match.team_a_name} vs {match.team_b_name}
            </span>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)', animation: 'livePulse 1.2s ease-in-out infinite' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--glass-bd)' }}>
            <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '.62rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.3 }}>Current RR</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: '1rem', fontWeight: 700 }}>{currentRR}</div>
            </div>
            <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '.62rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.3 }}>Last Sync</div>
              <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--gold)', fontSize: '.84rem', fontWeight: 700 }}>{lastSync ? lastSync.toLocaleTimeString() : '--:--:--'}</div>
            </div>
            <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: '.62rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.3 }}>Status</div>
              <div style={{ color: '#22c55e', fontSize: '.82rem', fontWeight: 800, letterSpacing: .5 }}>LIVE</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {match.innings?.map(inn => {
              const sc = scorecard.find(
                (s) => String(s.id) === String(inn.id)
                  || Number(s.innings_number) === Number(inn.innings_number)
              )
              const runs = sc?.total_runs ?? inn.total_runs ?? 0
              const wkts = sc?.total_wickets ?? inn.total_wickets ?? 0
              const bls = sc?.total_balls ?? inn.total_balls ?? 0
              const teamName = inn.batting_team_id === match.team_a_id ? match.team_a_name : match.team_b_name
              return (
                <div key={inn.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 14px', borderRadius: 'var(--r-md)',
                  background: 'var(--glass-bg)',
                  border: '1px solid var(--glass-bd)',
                }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--t1)', marginBottom: 2 }}>{teamName}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.6rem', letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--t3)' }}>{inn.innings_number === 1 ? '1st Innings' : '2nd Innings'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 700, lineHeight: 1, color: 'var(--gold)' }}>
                      {Number(inn.innings_number) === Number(activeInnings?.innings_number)
                        ? displayRuns
                        : runs}
                      <span style={{ fontSize: '1.1rem', opacity: 0.6 }}>/
                        {Number(inn.innings_number) === Number(activeInnings?.innings_number)
                          ? displayWickets
                          : wkts}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.67rem', color: 'var(--t3)', letterSpacing: 1, marginTop: 2 }}>({fmtOvers(bls)} overs)</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Current Over */}
        {balls.length > 0 && (
          <div className="card">
            <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--glass-bd)', background: 'var(--gold-dim)' }}>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--gold)' }}>Current Over</span>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {balls.slice(-6).map((b, i) => (
                <div key={i} style={{
                  width: 34, height: 34, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.78rem',
                  background: b.is_wicket ? 'var(--red-dim)' : 'var(--glass-bg)',
                  border: `2px solid ${b.is_wicket ? 'var(--red)' : 'var(--glass-bd)'}`,
                  color: b.is_wicket ? 'var(--red)' : 'var(--t3)',
                }}>
                  {b.is_wicket ? 'W' : b.runs_scored}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--glass-bd)', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--accent)' }}>Live Batters</span>
            <span style={{ fontSize: '0.62rem', color: 'var(--t3)' }}>{lastSync ? `Synced ${lastSync.toLocaleTimeString()}` : 'Syncing...'}</span>
          </div>
          <div style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--glass-bg)' }}>
              <div style={{ fontSize: '.62rem', color: 'var(--t3)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Striker</div>
              <div style={{ fontSize: '.84rem', fontWeight: 700, color: 'var(--t1)' }}>
                <span style={{ color: '#22c55e', marginRight: 6 }}>●</span>
                {striker?.name || 'TBD'}
              </div>
              <div style={{ fontSize: '.72rem', color: 'var(--t2)', marginTop: 2 }}>{striker ? `${striker.runs} (${striker.balls_faced})` : ''}</div>
            </div>
            <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--glass-bg)' }}>
              <div style={{ fontSize: '.62rem', color: 'var(--t3)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Non-Striker</div>
              <div style={{ fontSize: '.84rem', fontWeight: 700, color: 'var(--t1)' }}>{nonStriker?.name || 'TBD'}</div>
              <div style={{ fontSize: '.72rem', color: 'var(--t2)', marginTop: 2 }}>{nonStriker ? `${nonStriker.runs} (${nonStriker.balls_faced})` : ''}</div>
            </div>
            <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 'var(--r-md)', padding: '10px 12px', background: 'var(--glass-bg)' }}>
              <div style={{ fontSize: '.62rem', color: 'var(--t3)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>Bowler</div>
              <div style={{ fontSize: '.84rem', fontWeight: 700, color: 'var(--t1)' }}>
                <span style={{ color: '#22c55e', marginRight: 6 }}>●</span>
                {currentBowler?.name || 'TBD'}
              </div>
              <div style={{ fontSize: '.72rem', color: 'var(--t2)', marginTop: 2 }}>
                {currentBowler ? `${fmtOvers(currentBowler.balls_bowled || 0)} • ${currentBowler.runs_conceded || 0}/${currentBowler.wickets || 0}` : ''}
              </div>
            </div>
          </div>
        </div>

        {activeInnings && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '9px 14px', borderBottom: '1px solid var(--glass-bd)', background: 'var(--gold-dim)' }}>
              <span style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--gold)' }}>
                International Live Scoreboard
              </span>
            </div>

            <div style={{ padding: '0 12px 12px', overflowX: 'auto' }}>
              <h4 style={{ padding: '12px 0 8px', color: 'var(--t2)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.8px' }}>Batting</h4>
              <table className="scorecard-table">
                <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
                <tbody>
                  {(activeInnings.batting || []).map((b) => {
                    const isOnStrike = String(b.player_id) === String(activeInnings.striker_id)
                    const strikeRate = Number(b.balls_faced || 0) > 0
                      ? ((Number(b.runs || 0) / Number(b.balls_faced || 1)) * 100).toFixed(2)
                      : '0.00'
                    return (
                      <tr key={b.player_id} style={{ background: isOnStrike ? 'rgba(34,197,94,.08)' : 'transparent' }}>
                        <td className="player-name" style={{ whiteSpace: 'nowrap' }}>
                          {isOnStrike && <span style={{ color: '#22c55e', marginRight: 6 }}>●</span>}
                          {b.name}
                          {!b.is_out && <span style={{ color: 'var(--accent)', marginLeft: 4 }}>*</span>}
                        </td>
                        <td className="highlight">{b.runs || 0}</td>
                        <td>{b.balls_faced || 0}</td>
                        <td>{b.fours || 0}</td>
                        <td>{b.sixes || 0}</td>
                        <td>{strikeRate}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              <h4 style={{ padding: '12px 0 8px', color: 'var(--t2)', fontSize: '.72rem', textTransform: 'uppercase', letterSpacing: '.8px' }}>Bowling</h4>
              <table className="scorecard-table">
                <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                <tbody>
                  {(activeInnings.bowling || []).map((b) => {
                    const economy = Number(b.balls_bowled || 0) > 0
                      ? ((Number(b.runs_conceded || 0) / (Number(b.balls_bowled || 0) / 6))).toFixed(2)
                      : '0.00'
                    return (
                      <tr key={b.player_id}>
                        <td className="player-name">{b.name}</td>
                        <td>{fmtOvers(b.balls_bowled || 0)}</td>
                        <td>{b.maidens || 0}</td>
                        <td>{b.runs_conceded || 0}</td>
                        <td className="highlight" style={{ color: 'var(--red)' }}>{b.wickets || 0}</td>
                        <td>{economy}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Link to={`/match/${id}`} className="btn-accent" style={{ display: 'block', width: '100%', textAlign: 'center', padding: '12px', borderRadius: 'var(--r2)', textDecoration: 'none' }}>View Full Scorecard →</Link>
      </div>
    </div>
  )
}
