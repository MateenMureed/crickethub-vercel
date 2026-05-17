import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../context/DataStore'

const fmtOvers = b => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`

export default function LiveMatchesPage() {
  const { liveMatches, isRefreshing, refreshLiveDeep } = useDataStore()
  const loading = isRefreshing && liveMatches.length === 0
  const [autoRefresh, setAutoRefresh] = useState(true)

  // Polling is handled by DataStore. The autoRefresh toggle is kept for UI consistency.

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="sect-head">
        <h3>🔴 Live Matches</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {liveMatches.length > 0 && <span style={{ fontSize: '.72rem', color: 'var(--red)', fontWeight: 700 }}>● {liveMatches.length} live</span>}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.66rem', color: 'var(--t2)', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            Auto sync
          </label>
        </div>
      </div>

      {loading
        ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton" style={{ height: 148 }} />
            <div className="skeleton" style={{ height: 148 }} />
            <div className="skeleton" style={{ height: 148 }} />
          </div>
        )
        : liveMatches.length === 0
        ? <div className="empty"><span className="ico">📡</span><h4>No live matches right now</h4><p>Check back soon</p></div>
        : (
          <div className="data-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {liveMatches.map(m => (
              <Link to={`/match/${m.id}`} key={m.id} className="card match-card card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="match-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-live">● Live</span>
                    <span style={{ fontSize: '.68rem', color: 'var(--t3)' }}>{m.league_name}</span>
                  </div>
                  <span style={{ fontSize: '.68rem', color: 'var(--t3)' }}>Match #{m.match_number}</span>
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
                    <div className="live-mini-score" style={{ textAlign: 'center', marginTop: 10 }}>
                      {m.innings.map(inn => {
                        const innScore = (m.scorecard || []).find((s) => s.id === inn.id) || inn
                        const striker = (innScore?.batting || []).find((b) => String(b.player_id) === String(inn.striker_id))
                        const battingSide = inn.batting_team_id === m.team_a_id ? m.team_a_name : m.team_b_name
                        return (
                        <div key={inn.id}>
                          {battingSide}: {inn.total_runs}/{inn.total_wickets} ({fmtOvers(inn.total_balls)} ov)
                          {striker?.name && <span style={{ marginLeft: 8, color: '#22c55e', fontWeight: 700 }}>● {striker.name}*</span>}
                        </div>
                        )
                      })}
                    </div>
                  )}
                </div>
                <div className="match-card-footer">ICC Live Center • auto sync</div>
              </Link>
            ))}
          </div>
        )}
    </div>
  )
}
