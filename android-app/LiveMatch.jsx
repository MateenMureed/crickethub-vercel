import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || 'https://cricket-android.azurewebsites.net/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

const ballCls = ball => {
  if (ball.is_wicket) return 'ball ball-W'
  if (ball.extras_type === 'wide') return 'ball ball-Wd'
  if (ball.extras_type === 'noball') return 'ball ball-Nb'
  if (ball.runs_scored === 6) return 'ball ball-6'
  if (ball.runs_scored === 4) return 'ball ball-4'
  if (ball.runs_scored >= 2) return 'ball ball-2'
  if (ball.runs_scored === 1) return 'ball ball-1'
  return 'ball ball-dot'
}
const ballLbl = ball => {
  if (ball.is_wicket) return 'W'
  if (ball.extras_type === 'wide') return 'Wd'
  if (ball.extras_type === 'noball') return 'Nb'
  return ball.runs_scored.toString()
}

export default function LiveMatch() {
  const { id } = useParams()
  const [match, setMatch] = useState(null)
  const [scorecard, setScorecard] = useState([])
  const [balls, setBalls] = useState([])

  useEffect(() => { loadData() }, [id])
  useEffect(() => {
    const interval = setInterval(loadData, 1000)
    return () => clearInterval(interval)
  }, [id])

  const loadData = async () => {
    const m = await fetch(`${API}/matches/${id}`).then(r => r.json()).catch(() => null)
    if (!m) return
    setMatch(m)
    const sc = await fetch(`${API}/matches/${id}/scorecard`).then(r => r.json()).catch(() => [])
    setScorecard(sc)
    const activeInn = m.innings?.find(i => !i.is_completed) || m.innings?.[m.innings.length - 1]
    if (activeInn) {
      const b = await fetch(`${API}/innings/${activeInn.id}/balls`).then(r => r.json()).catch(() => [])
      setBalls(b)
    }
  }

  const fmtOvers = b => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`

  if (!match) return <div className="loading-center"><div className="spinner" /></div>

  if (match.status === 'completed') return (
    <div className="page flex-center" style={{ flexDirection: 'column', gap: 16, textAlign: 'center', padding: '0 20px' }}>
      <div style={{ fontSize: '3rem' }}>🏆</div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', color: 'var(--gold)' }}>Match Complete</h2>
      <p style={{ color: 'var(--accent)', fontWeight: 600 }}>{match.result_summary}</p>
      <Link to={`/match/${id}/scorecard`} className="btn btn-primary">View Scorecard →</Link>
    </div>
  )

  const activeInnings = scorecard.find(s => !s.is_completed) || scorecard[scorecard.length - 1]
  const currentRR = activeInnings?.total_balls > 0 ? ((activeInnings.total_runs / activeInnings.total_balls) * 6).toFixed(2) : '0.00'
  const currentOverBalls = balls.length ? balls.filter(b => b.over_number === balls[balls.length - 1].over_number).slice(-6) : []
  const overNum = Math.floor((activeInnings?.total_balls || 0) / 6)
  const firstInnings = match.innings?.find(i => i.innings_number === 1)
  const isSecondInnings = activeInnings?.innings_number === 2
  const target = isSecondInnings && firstInnings ? firstInnings.total_runs + 1 : null
  const runsNeeded = target ? target - (activeInnings?.total_runs || 0) : null
  const ballsLeft = isSecondInnings ? (match.overs_per_innings || 20) * 6 - (activeInnings?.total_balls || 0) : null
  const rrr = runsNeeded && ballsLeft > 0 ? ((runsNeeded / ballsLeft) * 6).toFixed(2) : null
  const chasePercent = target ? Math.min(100, Math.round(((activeInnings?.total_runs || 0) / (target - 1)) * 100)) : 0
  const strikerId = activeInnings?.striker_id ? Number(activeInnings.striker_id) : null
  const overSlots = Array.from({ length: 6 }, (_, i) => currentOverBalls[i] || null)

  return (
    <div className="page">
      {/* Live indicator bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, var(--red), var(--orange), var(--red))', backgroundSize: '200%', animation: 'shimmer 2s linear infinite' }} />

      {/* Match Hero */}
      <div className="match-hero">
        <div className="match-hero-league">
          {match.league_name} · Match #{match.match_number}
          <span className="badge badge-live" style={{ marginLeft: 8, display: 'inline-flex' }}>● LIVE</span>
        </div>

        <div className="match-hero-teams">
          <div className="match-hero-team">
            {match.team_a_logo
              ? <img src={match.team_a_logo} alt="" className="match-hero-logo" />
              : <div className="match-hero-logo-fb">{match.team_a_name?.charAt(0)}</div>}
            <div className="match-hero-team-name">{match.team_a_name}</div>
            {scorecard.find(s => s.batting_team_id === match.team_a_id) && (() => {
              const s = scorecard.find(s => s.batting_team_id === match.team_a_id)
              return <>
                <div className="match-hero-score">{s.total_runs}/{s.total_wickets}</div>
                <div className="match-hero-overs">({fmtOvers(s.total_balls)} ov)</div>
              </>
            })()}
          </div>
          <div className="match-hero-vs">VS</div>
          <div className="match-hero-team">
            {match.team_b_logo
              ? <img src={match.team_b_logo} alt="" className="match-hero-logo" />
              : <div className="match-hero-logo-fb" style={{ color: 'var(--gold)' }}>{match.team_b_name?.charAt(0)}</div>}
            <div className="match-hero-team-name">{match.team_b_name}</div>
            {scorecard.find(s => s.batting_team_id === match.team_b_id) && (() => {
              const s = scorecard.find(s => s.batting_team_id === match.team_b_id)
              return <>
                <div className="match-hero-score">{s.total_runs}/{s.total_wickets}</div>
                <div className="match-hero-overs">({fmtOvers(s.total_balls)} ov)</div>
              </>
            })()}
          </div>
        </div>

        {/* Chase bar */}
        {target && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--sky)', marginBottom: 4, textAlign: 'center' }}>
              Target: {target} · Need {runsNeeded} in {ballsLeft} balls
            </div>
            <div className="chase-bar">
              <div className="chase-fill" style={{ width: `${chasePercent}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* RR stats */}
      {activeInnings && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 10px' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--sky-dim)', borderRadius: 'var(--r-lg)', padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 3 }}>CRR</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--sky)' }}>{currentRR}</div>
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 3 }}>{rrr ? 'RRR' : 'Balls Left'}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.5rem', fontWeight: 700, color: rrr ? 'var(--orange)' : 'var(--t2)' }}>{rrr || (ballsLeft ?? '—')}</div>
          </div>
        </div>
      )}

      {/* Current over */}
      <div style={{ margin: '0 16px 10px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--accent)' }}>Current Over {overNum}</span>
        </div>
        <div className="over-row">
          {overSlots.map((b, i) => (
            <div key={b?.id || `e-${i}`} className={b ? ballCls(b) : 'ball ball-dot'} style={{ opacity: b ? 1 : 0.3 }}>
              {b ? ballLbl(b) : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Batting & bowling panels */}
      {activeInnings && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 16px 10px' }}>
          {/* Batting */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '7px 10px', background: 'var(--gold-dim)', borderBottom: '1px solid var(--border2)', fontSize: '0.58rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--gold)' }}>🏏 Batting</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border2)' }}>
                  {['Batsman', 'R', 'B'].map(h => <th key={h} style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--t3)', padding: '4px 6px', textAlign: h === 'Batsman' ? 'left' : 'center' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {activeInnings.batting?.filter(b => !b.is_out).slice(-2).map(b => (
                  <tr key={b.player_id}>
                    <td style={{ padding: '6px 6px 6px 8px', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 60 }}>
                      {Number(b.player_id) === strikerId && <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', marginRight: 4 }} />}
                      {b.name}
                    </td>
                    <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--gold)', fontSize: '0.88rem' }}>{b.runs}</td>
                    <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--t2)' }}>{b.balls_faced}</td>
                  </tr>
                ))}
                {!activeInnings.batting?.filter(b => !b.is_out).length && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--t3)', padding: 10, fontSize: '0.7rem' }}>—</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Bowling */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '7px 10px', background: 'var(--red-dim)', borderBottom: '1px solid var(--border2)', fontSize: '0.58rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--red)' }}>🎳 Bowling</div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border2)' }}>
                  {['Bowler', 'O', 'W'].map(h => <th key={h} style={{ fontSize: '0.55rem', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--t3)', padding: '4px 6px', textAlign: h === 'Bowler' ? 'left' : 'center' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {activeInnings.bowling?.slice(-2).map(b => (
                  <tr key={b.player_id}>
                    <td style={{ padding: '6px 6px 6px 8px', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 60 }}>{b.name}</td>
                    <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--t1)' }}>{fmtOvers(b.balls_bowled)}</td>
                    <td style={{ padding: '6px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--red)', fontSize: '0.88rem' }}>{b.wickets}</td>
                  </tr>
                ))}
                {!activeInnings.bowling?.length && (
                  <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--t3)', padding: 10, fontSize: '0.7rem' }}>—</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ball history */}
      {balls.length > 0 && (
        <div style={{ margin: '0 16px 10px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border2)', fontSize: '0.58rem', fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--accent)' }}>Last 12 Balls</div>
          <div style={{ padding: '10px 14px', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {balls.slice(-12).map((b, i) => {
              const arr = balls.slice(-12)
              const showSep = i > 0 && b.over_number !== arr[i - 1].over_number
              return (
                <span key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {showSep && <div style={{ width: 1, height: 20, background: 'var(--border2)' }} />}
                  <div className={ballCls(b)}>{ballLbl(b)}</div>
                </span>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ padding: '4px 16px 8px', textAlign: 'center' }}>
        <Link to={`/match/${id}/scorecard`} style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--t2)', textDecoration: 'none', letterSpacing: '0.5px' }}>
          View Full Scorecard →
        </Link>
      </div>

      <div style={{ height: 16 }} />
    </div>
  )
}
