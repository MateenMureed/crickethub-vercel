import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { handleBannerTap } from '../utils/media'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || 'https://cricket-android.azurewebsites.net/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

export default function MatchScorecard() {
  const { matchId, id: routeId } = useParams()
  const id = matchId || routeId
  const [match, setMatch] = useState(null)
  const [scorecard, setScorecard] = useState([])
  const [ballsByInnings, setBallsByInnings] = useState({})
  const [missingSummary, setMissingSummary] = useState(false)
  const [missingResult, setMissingResult] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

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

  const loadData = async () => {
    const [m, sc] = await Promise.all([
      fetchJsonFresh(`${API}/matches/${id}`, null),
      fetchJsonFresh(`${API}/matches/${id}/scorecard`, []),
    ])
    if (m) setMatch(m)
    const inningsList = Array.isArray(sc) ? sc : []
    setScorecard(inningsList)

    const ballsEntries = await Promise.all(
      inningsList.map(async (inn) => {
        const balls = await fetchJsonFresh(`${API}/innings/${inn.id}/balls`, [])
        return [inn.id, Array.isArray(balls) ? balls : []]
      })
    )
    setBallsByInnings(Object.fromEntries(ballsEntries))
    setLastSyncedAt(Date.now())
  }

  useEffect(() => {
    loadData().catch(() => {})
  }, [id])

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => {
      loadData().catch(() => {})
    }, 3000)
    return () => clearInterval(interval)
  }, [id])

  const getInningsTotals = (inn) => {
    const extras = (inn.extras_wides || 0) + (inn.extras_noballs || 0) + (inn.extras_byes || 0) + (inn.extras_legbyes || 0)
    const battingRuns = (inn.batting || []).reduce((sum, b) => sum + Number(b.runs || 0), 0)
    const bowlingBalls = (inn.bowling || []).reduce((sum, b) => sum + Number(b.balls_bowled || 0), 0)
    const wickets = (inn.batting || []).reduce((sum, b) => sum + (b.is_out ? 1 : 0), 0)
    const totalRuns = Number(inn.total_runs || 0) > 0 ? Number(inn.total_runs || 0) : battingRuns + extras
    const totalWickets = Number(inn.total_wickets || 0) > 0 ? Number(inn.total_wickets || 0) : wickets
    const totalBalls = Number(inn.total_balls || 0) > 0 ? Number(inn.total_balls || 0) : bowlingBalls
    return { totalRuns, totalWickets, totalBalls }
  }

  const formatOvers = (balls) => !balls ? '0.0' : `${Math.floor(balls / 6)}.${balls % 6}`

  const buildOverSummary = (balls = []) => {
    const byOver = new Map()
    balls.forEach((ball) => {
      const over = Number(ball?.over_number || 0)
      if (!byOver.has(over)) {
        byOver.set(over, { over, runs: 0, wickets: 0, legal: 0 })
      }
      const bucket = byOver.get(over)
      const runs = Number(ball?.runs_scored || 0) + Number(ball?.extras_runs || 0)
      bucket.runs += runs
      if (ball?.is_wicket) bucket.wickets += 1
      if (!ball?.extras_type || (ball.extras_type !== 'wide' && ball.extras_type !== 'noball')) {
        bucket.legal += 1
      }
    })
    return [...byOver.values()].sort((a, b) => a.over - b.over)
  }

  const getDismissedOverLabel = (inn, batter) => {
    if (!batter?.is_out) return ''
    const direct = batter?.out_over ?? batter?.dismissed_over
    if (direct != null && direct !== '') {
      const overNum = Number(direct)
      if (!Number.isNaN(overNum)) return ` • out ${overNum}.${batter?.out_ball ?? 0}`
      return ` • out ${direct}`
    }
    const inningsBalls = ballsByInnings[inn.id] || []
    const dismissalBall = inningsBalls.find((ball) => ball?.is_wicket && Number(ball?.dismissed_player_id) === Number(batter.player_id))
    if (!dismissalBall) return ''
    return ` • out ${dismissalBall.over_number}.${dismissalBall.ball_in_over || 0}`
  }

  const maxOverRuns = (overs) => Math.max(1, ...overs.map((o) => Number(o.runs || 0)))

  const formatRelativeTime = (ts) => {
    if (!ts) return 'just now'
    const diffMin = Math.max(0, Math.floor((Date.now() - Number(ts)) / 60000))
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin} min ago`
    const hrs = Math.floor(diffMin / 60)
    const mins = diffMin % 60
    return mins ? `${hrs}h ${mins}m ago` : `${hrs}h ago`
  }

  const toBallOutcome = (ball) => {
    const runs = Number(ball?.runs_scored || 0)
    const extras = Number(ball?.extras_runs || 0)
    const total = runs + extras
    const ext = String(ball?.extras_type || '').toLowerCase()
    const wicket = Boolean(ball?.is_wicket)

    let token = '0'
    if (ext === 'wide') token = `Wd${total > 1 ? total : ''}`
    else if (ext === 'noball') token = `Nb${total > 1 ? total : ''}`
    else if (ext === 'legbye') token = `Lb${total || ''}`
    else if (ext === 'bye') token = `B${total || ''}`
    else token = String(total)

    if (wicket) token = token === '0' ? 'W' : `${token}W`
    return token
  }

  const buildOverDetails = (balls = []) => {
    const byOver = new Map()
    balls.forEach((ball) => {
      const over = Number(ball?.over_number || 0)
      if (!byOver.has(over)) {
        byOver.set(over, { over, runs: 0, wickets: 0, legal: 0, balls: [] })
      }
      const row = byOver.get(over)
      const runs = Number(ball?.runs_scored || 0) + Number(ball?.extras_runs || 0)
      row.runs += runs
      if (ball?.is_wicket) row.wickets += 1
      if (!ball?.extras_type || (ball.extras_type !== 'wide' && ball.extras_type !== 'noball')) {
        row.legal += 1
      }
      row.balls.push(toBallOutcome(ball))
    })

    let cumulative = 0
    return [...byOver.values()].sort((a, b) => a.over - b.over).map((row) => {
      cumulative += row.runs
      return { ...row, cumulative }
    })
  }

  const inningsVisualStats = (inn) => {
    const totals = getInningsTotals(inn)
    const balls = ballsByInnings[inn.id] || []
    const overRows = buildOverDetails(balls)
    const boundaries = (inn.batting || []).reduce((sum, b) => sum + Number(b.fours || 0) + Number(b.sixes || 0), 0)
    const sixes = (inn.batting || []).reduce((sum, b) => sum + Number(b.sixes || 0), 0)
    const extras = Number(inn.extras_wides || 0) + Number(inn.extras_noballs || 0) + Number(inn.extras_byes || 0) + Number(inn.extras_legbyes || 0)
    const runRate = totals.totalBalls ? ((totals.totalRuns * 6) / totals.totalBalls) : 0
    return { totals, overRows, boundaries, sixes, extras, runRate }
  }

  const resolveInningsStrikerId = (inn) => {
    const direct = inn?.striker_id ?? inn?.current_striker_id
    if (direct != null && direct !== '') return String(direct)

    const linkedMatchInnings = (match?.innings || []).find((mi) => (
      String(mi?.id) === String(inn?.id)
      || Number(mi?.innings_number) === Number(inn?.innings_number)
    ))
    const fallback = linkedMatchInnings?.striker_id ?? linkedMatchInnings?.current_striker_id
    if (fallback != null && fallback !== '') return String(fallback)
    return null
  }

  if (!match) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="card" style={{ marginBottom: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: '0.76rem', color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 700 }}>
          Match Stats Dashboard
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: isOnline ? 'var(--accent)' : 'var(--gold)', fontWeight: 700 }}>
            {isOnline ? 'Online' : 'Offline Mode'}
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--t2)' }}>Last updated {formatRelativeTime(lastSyncedAt)}</span>
        </div>
      </div>

      {(!missingSummary || !missingResult) && (
        <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
          <img
            src={!missingSummary ? `/media/banners/results/summary_banner_${id}.png` : `/media/banners/results/result_banner_${id}.png`}
            alt={`${match.team_a_name} vs ${match.team_b_name} generated summary`}
            style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
            onError={() => {
              if (!missingSummary) setMissingSummary(true)
              else setMissingResult(true)
            }}
            onClick={() => {
              const src = !missingSummary ? `/media/banners/results/summary_banner_${id}.png` : `/media/banners/results/result_banner_${id}.png`
              handleBannerTap(src, src.split('/').pop())
            }}
          />
        </div>
      )}

      {/* ── Match Result Banner ── */}
      <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ textAlign: 'center', marginBottom: 20, position: 'relative', zIndex: 2 }}>
          <span style={{
            background: 'var(--accent-dim)', border: '1px solid rgba(0,232,150,0.22)',
            color: 'var(--t2)', padding: '4px 14px', borderRadius: 99,
            fontSize: '0.72rem', fontFamily: 'var(--font-display)', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            {match.league_name} · Match #{match.match_number}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 14px', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {match.team_a_logo
              ? <img src={match.team_a_logo} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
              : <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--acc-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 900, color: 'var(--accent)' }}>{match.team_a_name?.charAt(0)}</div>}
            <div style={{ fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>{match.team_a_name}</div>
            {scorecard.map(s => s.batting_team_id === match.team_a_id && (
              <div key={s.id} style={{ fontFamily: 'var(--font-mono)', fontSize: '1.8rem', fontWeight: 700, color: match.winner_id === match.team_a_id ? 'var(--accent)' : 'var(--t1)', textAlign: 'center' }}>
                {s.total_runs}/{s.total_wickets}
                <div style={{ fontSize: '0.74rem', color: 'var(--t2)', fontFamily: 'var(--font-body)' }}>({formatOvers(s.total_balls)} ov)</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 900, color: 'var(--gold)' }}>VS</div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            {match.team_b_logo
              ? <img src={match.team_b_logo} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
              : <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--acc-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 900, color: 'var(--gold)' }}>{match.team_b_name?.charAt(0)}</div>}
            <div style={{ fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>{match.team_b_name}</div>
            {scorecard.map(s => s.batting_team_id === match.team_b_id && (
              <div key={s.id} style={{ fontFamily: 'var(--font-mono)', fontSize: '1.8rem', fontWeight: 700, color: match.winner_id === match.team_b_id ? 'var(--accent)' : 'var(--t1)', textAlign: 'center' }}>
                {s.total_runs}/{s.total_wickets}
                <div style={{ fontSize: '0.74rem', color: 'var(--t2)', fontFamily: 'var(--font-body)' }}>({formatOvers(s.total_balls)} ov)</div>
              </div>
            ))}
          </div>
        </div>

        {match.result_summary && (
          <div style={{ textAlign: 'center', marginTop: 18, position: 'relative', zIndex: 2 }}>
            <div style={{ color: 'var(--accent)', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-display)' }}>{match.result_summary}</div>
          </div>
        )}
        {match.mom_name && (
          <div style={{ textAlign: 'center', marginTop: 10, position: 'relative', zIndex: 2 }}>
            <span style={{ color: 'var(--gold)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>⭐ Man of the Match</span>
            <div style={{ fontWeight: 700, marginTop: 4, fontFamily: 'var(--font-display)', fontSize: '1rem' }}>{match.mom_name}</div>
          </div>
        )}
      </div>

      {/* ── Innings Scorecards ── */}
      {scorecard.map(inn => {
        const visual = inningsVisualStats(inn)
        const totals = visual.totals
        const overSummary = buildOverSummary(ballsByInnings[inn.id] || [])
        const overDetails = visual.overRows
        const peakOverRuns = maxOverRuns(overSummary)
        const firstInnings = scorecard.find((s) => Number(s.innings_number) === 1)
        const firstTotals = firstInnings ? getInningsTotals(firstInnings) : null
        const isSecondInnings = Number(inn.innings_number) === 2
        const target = isSecondInnings && firstTotals ? firstTotals.totalRuns + 1 : null
        const chaseStatus = target
          ? (totals.totalRuns >= target ? 'CHASE COMPLETE' : `NEED ${Math.max(0, target - totals.totalRuns)} RUNS`)
          : '1ST INNINGS'
        return (
        <div key={inn.id} className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'linear-gradient(135deg, var(--accent-dim), var(--gold-dim))',
            borderBottom: '1px solid var(--glass-bd)',
            flexWrap: 'wrap', gap: 8,
          }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>
              {inn.team_name} — {inn.innings_number === 1 ? '1st' : '2nd'} Innings
            </h3>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.4rem', color: 'var(--accent)', fontWeight: 700 }}>
              {totals.totalRuns}/{totals.totalWickets}
              <span style={{ fontSize: '0.82rem', color: 'var(--t2)', marginLeft: 6 }}>({formatOvers(totals.totalBalls)} ov)</span>
            </div>
          </div>

          <div style={{ padding: '0 20px', overflowX: 'auto' }}>
            <div style={{ paddingTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Run Rate</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.96rem', fontWeight: 700 }}>{visual.runRate.toFixed(2)}</div>
              </div>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Boundaries</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.96rem', fontWeight: 700 }}>{visual.boundaries}</div>
              </div>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Sixes</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.96rem', fontWeight: 700 }}>{visual.sixes}</div>
              </div>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Extras</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.96rem', fontWeight: 700 }}>{visual.extras}</div>
              </div>
            </div>

            <h4 style={{ padding: '13px 0 8px', color: 'var(--t2)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>Batting</h4>
            <table className="scorecard-table">
              <thead><tr><th>Batsman</th><th>Dismissal</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
              <tbody>
                {inn.batting?.map(b => {
                  const strikerId = resolveInningsStrikerId(inn)
                  const isOnStrike = strikerId && String(b.player_id) === strikerId
                  return (
                  <tr key={b.player_id} style={{ background: isOnStrike ? 'rgba(34,197,94,.08)' : 'transparent' }}>
                    <td className="player-name" style={{ whiteSpace: 'nowrap' }}>
                      {isOnStrike && <span style={{ color: '#22c55e', marginRight: 6 }}>●</span>}
                      {b.name}
                    </td>
                    <td style={{ color: 'var(--t2)', fontSize: '0.8rem' }}>
                      {b.is_out
                        ? `${b.dismissal_type}${b.bowler_name ? ` b ${b.bowler_name}` : ''}${b.fielder_name ? ` c ${b.fielder_name}` : ''}${getDismissedOverLabel(inn, b)}`
                        : <span style={{ color: 'var(--accent)', fontWeight: 700 }}>not out</span>}
                    </td>
                    <td className="highlight">{b.runs}</td>
                    <td>{b.balls_faced}</td>
                    <td>{b.fours}</td>
                    <td>{b.sixes}</td>
                  </tr>
                )})}
              </tbody>
            </table>
            <div style={{ padding: '9px 0', color: 'var(--t2)', fontSize: '0.8rem', borderTop: '1px solid var(--glass-bd)' }}>
              Extras: {(inn.extras_wides || 0) + (inn.extras_noballs || 0) + (inn.extras_byes || 0) + (inn.extras_legbyes || 0)}
            </div>

            {overSummary.length > 0 && (
              <div style={{ padding: '8px 0 10px', borderTop: '1px solid var(--glass-bd)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                  <h4 style={{ color: 'var(--t2)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                    Over Progression
                  </h4>
                  <div style={{ fontSize: '0.66rem', fontWeight: 800, color: isSecondInnings ? 'var(--gold)' : 'var(--sky)' }}>
                    {isSecondInnings ? `2nd Innings Chase • ${chaseStatus}` : '1st Innings Build'}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {overSummary.map((ov) => {
                    const pct = Math.max(8, (Number(ov.runs || 0) / peakOverRuns) * 100)
                    return (
                      <div key={`ov-${inn.id}-${ov.over}`} style={{ display: 'grid', gridTemplateColumns: '38px 1fr 56px', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: '0.66rem', color: 'var(--t2)', fontFamily: 'var(--font-mono)' }}>Ov {ov.over + 1}</div>
                        <div style={{ height: 12, borderRadius: 999, background: 'var(--glass-bg)', border: '1px solid var(--glass-bd)', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: ov.wickets > 0 ? 'linear-gradient(90deg, #ff4d6d, #ff8c42)' : 'linear-gradient(90deg, #00e896, #40c4ff)',
                            }}
                          />
                        </div>
                        <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: 'var(--t1)', textAlign: 'right' }}>
                          {ov.runs}/{ov.wickets}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {overDetails.length > 0 && (
              <div style={{ padding: '8px 0 14px', borderTop: '1px solid var(--glass-bd)' }}>
                <h4 style={{ color: 'var(--t2)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', fontWeight: 700, marginBottom: 8 }}>
                  Each Over Details
                </h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {overDetails.map((ov) => (
                    <div key={`detail-${inn.id}-${ov.over}`} style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, background: 'var(--glass-bg)', padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700 }}>Over {ov.over + 1}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--t2)' }}>Runs {ov.runs} • Wkts {ov.wickets} • Cum {ov.cumulative}</div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {ov.balls.map((token, tokenIdx) => (
                          <span
                            key={`ball-${inn.id}-${ov.over}-${tokenIdx}`}
                            style={{
                              minWidth: 28,
                              padding: '4px 6px',
                              borderRadius: 999,
                              textAlign: 'center',
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              border: '1px solid var(--glass-bd)',
                              color: String(token).includes('W') ? '#ff8a9f' : 'var(--t1)',
                              background: String(token).includes('W') ? 'rgba(255,77,109,0.16)' : 'rgba(255,255,255,0.03)',
                            }}
                          >
                            {token}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '0 20px 20px', overflowX: 'auto' }}>
            <h4 style={{ padding: '13px 0 8px', color: 'var(--t2)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-display)', fontWeight: 700, borderTop: '1px solid var(--glass-bd)' }}>Bowling</h4>
            <table className="scorecard-table">
              <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th></tr></thead>
              <tbody>
                {inn.bowling?.map(b => (
                  <tr key={b.player_id}>
                    <td className="player-name">{b.name}</td>
                    <td>{formatOvers(b.balls_bowled)}</td>
                    <td>{b.maidens}</td>
                    <td>{b.runs_conceded}</td>
                    <td className="highlight" style={{ color: 'var(--red)' }}>{b.wickets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )})}

      {scorecard.length > 0 && (() => {
        const inningsOne = scorecard.find((s) => Number(s.innings_number) === 1)
        const inningsTwo = scorecard.find((s) => Number(s.innings_number) === 2)
        const visualOne = inningsOne ? inningsVisualStats(inningsOne) : null
        const visualTwo = inningsTwo ? inningsVisualStats(inningsTwo) : null
        const maxCum = Math.max(
          1,
          ...(visualOne?.overRows || []).map((o) => o.cumulative),
          ...(visualTwo?.overRows || []).map((o) => o.cumulative),
        )

        const overIndex = new Set([
          ...(visualOne?.overRows || []).map((o) => o.over),
          ...(visualTwo?.overRows || []).map((o) => o.over),
        ])
        const overs = [...overIndex].sort((a, b) => a - b)

        const chaseTarget = visualOne ? visualOne.totals.totalRuns + 1 : null
        const chaseDone = chaseTarget && visualTwo ? visualTwo.totals.totalRuns >= chaseTarget : false
        const chasePct = chaseTarget && visualTwo ? Math.min(100, (visualTwo.totals.totalRuns / chaseTarget) * 100) : 0

        const totalMatchRuns = (visualOne?.totals.totalRuns || 0) + (visualTwo?.totals.totalRuns || 0)
        const totalMatchWkts = (visualOne?.totals.totalWickets || 0) + (visualTwo?.totals.totalWickets || 0)
        const totalMatchBalls = (visualOne?.totals.totalBalls || 0) + (visualTwo?.totals.totalBalls || 0)
        const matchRunRate = totalMatchBalls ? ((totalMatchRuns * 6) / totalMatchBalls) : 0

        return (
          <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--glass-bd)', background: 'linear-gradient(140deg, rgba(64,196,255,0.16), rgba(0,232,150,0.1))' }}>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 800 }}>Overall Match Summary & Visuals</h3>
              <div style={{ fontSize: '0.72rem', color: 'var(--t2)', marginTop: 4 }}>Full match details with first innings, second innings, chase, and combined visual trend</div>
            </div>

            <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, padding: '8px 10px', background: 'var(--glass-bg)' }}><div style={{ fontSize: '0.6rem', color: 'var(--t2)' }}>TOTAL RUNS</div><div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{totalMatchRuns}</div></div>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, padding: '8px 10px', background: 'var(--glass-bg)' }}><div style={{ fontSize: '0.6rem', color: 'var(--t2)' }}>TOTAL WKTS</div><div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{totalMatchWkts}</div></div>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, padding: '8px 10px', background: 'var(--glass-bg)' }}><div style={{ fontSize: '0.6rem', color: 'var(--t2)' }}>TOTAL OVERS</div><div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{formatOvers(totalMatchBalls)}</div></div>
              <div style={{ border: '1px solid var(--glass-bd)', borderRadius: 10, padding: '8px 10px', background: 'var(--glass-bg)' }}><div style={{ fontSize: '0.6rem', color: 'var(--t2)' }}>MATCH RR</div><div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>{matchRunRate.toFixed(2)}</div></div>
            </div>

            {visualOne && (
              <div style={{ padding: '0 16px 10px' }}>
                <h4 style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--sky)', marginBottom: 7 }}>First Innings Visual</h4>
                <div style={{ height: 10, borderRadius: 999, border: '1px solid var(--glass-bd)', background: 'var(--glass-bg)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (visualOne.totals.totalRuns / Math.max(1, totalMatchRuns)) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #40c4ff, #22d3ee)' }} />
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--t2)', marginTop: 5 }}>{visualOne.totals.totalRuns}/{visualOne.totals.totalWickets} ({formatOvers(visualOne.totals.totalBalls)} ov)</div>
              </div>
            )}

            {visualTwo && (
              <div style={{ padding: '0 16px 10px' }}>
                <h4 style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--gold)', marginBottom: 7 }}>Second Innings Visual</h4>
                <div style={{ height: 10, borderRadius: 999, border: '1px solid var(--glass-bd)', background: 'var(--glass-bg)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (visualTwo.totals.totalRuns / Math.max(1, totalMatchRuns)) * 100)}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #f97316)' }} />
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--t2)', marginTop: 5 }}>{visualTwo.totals.totalRuns}/{visualTwo.totals.totalWickets} ({formatOvers(visualTwo.totals.totalBalls)} ov)</div>
              </div>
            )}

            {chaseTarget && visualTwo && (
              <div style={{ padding: '0 16px 12px' }}>
                <h4 style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--accent)', marginBottom: 7 }}>Chase Visual</h4>
                <div style={{ height: 12, borderRadius: 999, border: '1px solid var(--glass-bd)', background: 'var(--glass-bg)', overflow: 'hidden' }}>
                  <div style={{ width: `${chasePct}%`, height: '100%', background: chaseDone ? 'linear-gradient(90deg, #00e896, #00b876)' : 'linear-gradient(90deg, #40c4ff, #00e896)' }} />
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--t2)', marginTop: 5 }}>
                  Target {chaseTarget} • Scored {visualTwo.totals.totalRuns} • {chaseDone ? 'Chase Complete' : `Need ${Math.max(0, chaseTarget - visualTwo.totals.totalRuns)}`}
                </div>
              </div>
            )}

            {overs.length > 0 && (
              <div style={{ padding: '0 16px 14px' }}>
                <h4 style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--t2)', marginBottom: 8 }}>Overall Match Visual (Cumulative by Over)</h4>
                <div style={{ display: 'grid', gap: 6 }}>
                  {overs.map((ov) => {
                    const c1 = (visualOne?.overRows || []).find((r) => r.over === ov)?.cumulative || 0
                    const c2 = (visualTwo?.overRows || []).find((r) => r.over === ov)?.cumulative || 0
                    return (
                      <div key={`overall-${ov}`} style={{ display: 'grid', gridTemplateColumns: '44px 1fr', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: '0.65rem', color: 'var(--t2)', fontFamily: 'var(--font-mono)' }}>Ov {ov + 1}</div>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div style={{ height: 8, borderRadius: 999, background: 'rgba(64,196,255,0.15)', border: '1px solid rgba(64,196,255,0.35)', overflow: 'hidden' }}>
                            <div style={{ width: `${(c1 / maxCum) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #40c4ff, #22d3ee)' }} />
                          </div>
                          <div style={{ height: 8, borderRadius: 999, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', overflow: 'hidden' }}>
                            <div style={{ width: `${(c2 / maxCum) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #f97316)' }} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      <div style={{ textAlign: 'center', marginTop: 8 }}>
        <Link to={`/leagues/${match.league_id}`} className="btn-accent" style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 'var(--r2)', textDecoration: 'none', textAlign: 'center' }}>← Back to League</Link>
      </div>
    </div>
  )
}
