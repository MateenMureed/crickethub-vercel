import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || 'https://cricket-android.azurewebsites.net/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

export default function HomePage() {
  const [stats, setStats]             = useState({ leagues: 0, teams: 0, matches: 0, players: 0 })
  const [leagues, setLeagues]         = useState([])
  const [liveMatches, setLiveMatches] = useState([])
  const [upcoming, setUpcoming]       = useState([])
  const [results, setResults]         = useState([])
  const [batting, setBatting]         = useState([])
  const [bowling, setBowling]         = useState([])

  useEffect(() => {
    fetch(`${API}/stats/dashboard`).then(r => r.json()).then(setStats).catch(() => {})
    fetch(`${API}/leagues`).then(r => r.json()).then(setLeagues).catch(() => {})
    fetch(`${API}/matches/upcoming/all`).then(r => r.json()).then(setUpcoming).catch(() => {})
    fetch(`${API}/matches/completed/all`).then(r => r.json()).then(setResults).catch(() => {})
    fetch(`${API}/stats/global/batting`).then(r => r.json()).then(setBatting).catch(() => {})
    fetch(`${API}/stats/global/bowling`).then(r => r.json()).then(setBowling).catch(() => {})
  }, [])

  // Live polling every second
  useEffect(() => {
    const load = () => fetch(`${API}/matches/live/all`).then(r => r.json()).then(setLiveMatches).catch(() => {})
    load()
    const id = setInterval(load, 1000)
    return () => clearInterval(id)
  }, [])

  const fmtOvers = b => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`
  const featuredLeague = useMemo(() => leagues.find(l => l.status === 'active') || leagues[0], [leagues])

  const topPlayers = useMemo(() => {
    const bat = batting.slice(0, 3).map(p => ({ ...p, metric: `${p.total_runs || 0} Runs`, type: 'bat' }))
    const bowl = bowling.slice(0, 3).map(p => ({ ...p, metric: `${p.total_wickets || 0} Wkts`, type: 'bowl' }))
    return [...bat, ...bowl].slice(0, 6)
  }, [batting, bowling])

  return (
    <div className="page">
      {/* ── Hero Banner ── */}
      <div className="hero-banner">
        <div className="hero-banner-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            {featuredLeague?.logo
              ? <img src={featuredLeague.logo} alt="" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', border: '2px solid rgba(0,232,150,0.3)', flexShrink: 0 }} />
              : <div style={{ width: 52, height: 52, borderRadius: 12, background: 'var(--accent-dim)', border: '1px solid rgba(0,232,150,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: '1.6rem', color: 'var(--accent)' }}>
                  {featuredLeague?.name?.charAt(0) || 'C'}
                </div>}
            <div>
              <div className="hero-title">Cricket<span>Hub</span></div>
              <div style={{ fontSize: '0.72rem', color: 'var(--t3)', marginTop: 2 }}>
                {featuredLeague?.name || 'League Management Platform'}
              </div>
            </div>
          </div>
          <div className="hero-stats-row">
            {[
              { num: stats.leagues, lbl: 'Leagues' },
              { num: stats.teams, lbl: 'Teams' },
              { num: stats.matches, lbl: 'Matches' },
              { num: stats.players, lbl: 'Players' },
            ].map(s => (
              <div className="hero-stat" key={s.lbl}>
                <div className="hero-stat-num">{s.num}</div>
                <div className="hero-stat-lbl">{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div style={{ padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          { icon: '🏆', label: 'Leagues', to: '/leagues' },
          { icon: '📅', label: 'Fixtures', to: '/fixtures' },
          { icon: '📡', label: 'Live', to: '/live' },
          { icon: '📊', label: 'Stats', to: '/stats' },
        ].map(a => (
          <Link key={a.to} to={a.to} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
            padding: '10px 4px', background: 'var(--surface)', border: '1px solid var(--border2)',
            borderRadius: 'var(--r-md)', textDecoration: 'none', color: 'var(--t2)',
            fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
          }}>
            <span style={{ fontSize: '1.3rem' }}>{a.icon}</span>
            {a.label}
          </Link>
        ))}
      </div>

      {/* ── Live Matches ── */}
      {liveMatches.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>Live Matches</h2>
              <div className="section-head-line" style={{ background: 'var(--red)' }} />
            </div>
            <Link to="/live" className="see-all" style={{ color: 'var(--red)' }}>See all</Link>
          </div>
          {liveMatches.slice(0, 3).map(m => (
            <Link to={`/match/${m.id}/live`} key={m.id} className="live-card">
              <div className="live-card-top">
                <div className="flex-center gap-8">
                  <span className="badge badge-live">
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                    LIVE
                  </span>
                  <span style={{ fontSize: '0.65rem', color: 'var(--t3)' }}>Match #{m.match_number}</span>
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--t3)', fontStyle: 'italic' }}>{m.league_name}</span>
              </div>
              <div className="live-teams-row">
                <div className="team-score-block">
                  <div className="team-name-sm">{m.team_a_name}</div>
                  {m.innings?.find(i => i.batting_team_id === m.team_a_id) && (() => {
                    const inn = m.innings.find(i => i.batting_team_id === m.team_a_id)
                    return (
                      <>
                        <div className="team-runs">{inn.total_runs}<sub>/{inn.total_wickets}</sub></div>
                        <div className="team-overs">({fmtOvers(inn.total_balls)})</div>
                      </>
                    )
                  })()}
                </div>
                <div className="live-vs">VS</div>
                <div className="team-score-block" style={{ textAlign: 'right' }}>
                  <div className="team-name-sm" style={{ textAlign: 'right' }}>{m.team_b_name}</div>
                  {m.innings?.find(i => i.batting_team_id === m.team_b_id) && (() => {
                    const inn = m.innings.find(i => i.batting_team_id === m.team_b_id)
                    return (
                      <>
                        <div className="team-runs" style={{ textAlign: 'right' }}>{inn.total_runs}<sub>/{inn.total_wickets}</sub></div>
                        <div className="team-overs" style={{ textAlign: 'right' }}>({fmtOvers(inn.total_balls)})</div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </Link>
          ))}
        </>
      )}

      {/* ── Leagues ── */}
      <div className="section-head">
        <div>
          <h2>Leagues</h2>
          <div className="section-head-line" />
        </div>
        <Link to="/leagues" className="see-all">See all</Link>
      </div>
      <div className="hscroll">
        {leagues.slice(0, 8).map(league => (
          <Link key={league.id} to={`/league/${league.id}`} style={{ textDecoration: 'none', display: 'block', minWidth: 130, maxWidth: 130 }}>
            <div className="league-card">
              <div className="league-card-banner">
                {league.logo
                  ? <img src={league.logo} alt="" className="league-logo" />
                  : <div className="league-logo-fallback">{league.name?.charAt(0)}</div>}
              </div>
              <div className="league-card-info">
                <div className="league-card-name">{league.name}</div>
                <div className="league-card-meta">{league.city || 'City TBD'} · {league.team_count || 0} teams</div>
              </div>
            </div>
          </Link>
        ))}
        {leagues.length === 0 && (
          <div className="empty-state" style={{ minWidth: '100%' }}>
            <div className="empty-icon">🏆</div>
            <div className="empty-title">No leagues yet</div>
          </div>
        )}
      </div>

      {/* ── Upcoming Fixtures ── */}
      <div className="section-head">
        <div>
          <h2>Upcoming</h2>
          <div className="section-head-line" style={{ background: 'var(--sky)' }} />
        </div>
        <Link to="/fixtures" className="see-all" style={{ color: 'var(--sky)' }}>See all</Link>
      </div>
      {upcoming.slice(0, 5).map(m => (
        <div className="fixture-card" key={m.id}>
          <div className="fixture-team">{m.team_a_name}</div>
          <div className="fixture-center">
            <span className="fixture-vs-badge">VS</span>
            <div className="fixture-meta">{m.date || 'TBA'}</div>
          </div>
          <div className="fixture-team right">{m.team_b_name}</div>
        </div>
      ))}
      {upcoming.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📅</div>
          <div className="empty-title">No fixtures scheduled</div>
        </div>
      )}

      {/* ── Latest Results ── */}
      <div className="section-head">
        <div>
          <h2>Results</h2>
          <div className="section-head-line" style={{ background: 'var(--gold)' }} />
        </div>
        <Link to="/results" className="see-all" style={{ color: 'var(--gold)' }}>See all</Link>
      </div>
      {results.slice(0, 5).map(m => (
        <Link to={`/match/${m.id}/scorecard`} key={m.id} className="result-card">
          <div className="result-card-top">{m.league_name}</div>
          <div className="result-card-body">
            <div className="result-teams-row">
              <div className="result-team-name">{m.team_a_name}</div>
              <div className="result-vs">vs</div>
              <div className="result-team-name right">{m.team_b_name}</div>
            </div>
            {m.result_summary && <div className="result-summary">{m.result_summary}</div>}
            {m.mom_name && <div className="result-mom">⭐ {m.mom_name}</div>}
          </div>
        </Link>
      ))}
      {results.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🏅</div>
          <div className="empty-title">No results yet</div>
        </div>
      )}

      {/* ── Top Players ── */}
      {topPlayers.length > 0 && (
        <>
          <div className="section-head">
            <div>
              <h2>Leaderboard</h2>
              <div className="section-head-line" style={{ background: 'var(--gold)' }} />
            </div>
            <Link to="/stats" className="see-all" style={{ color: 'var(--gold)' }}>Full stats</Link>
          </div>
          <div style={{ margin: '0 16px', background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            {topPlayers.map((p, i) => (
              <div key={`${p.id}-${i}`} className="player-row">
                <div style={{ width: 22, fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--t3)', flexShrink: 0 }}>#{i + 1}</div>
                {p.photo
                  ? <img src={p.photo} alt={p.name} className="player-avatar" />
                  : <div className="player-avatar-fallback">{p.name?.charAt(0)}</div>}
                <div>
                  <div className="player-name">{p.name}</div>
                  <div className="player-role">{p.team_name}</div>
                </div>
                <div className="player-stat">{p.metric}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ height: 16 }} />
    </div>
  )
}
