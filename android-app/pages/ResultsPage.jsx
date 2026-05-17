import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../context/DataStore'
import LazyImage from '../components/LazyImage'
import { handleBannerTap } from '../utils/media'

export default function ResultsPage() {
  const { leagues, results, isRefreshing } = useDataStore()
  const loading = isRefreshing && results.length === 0
  const [selectedLeague, setSelectedLeague] = useState('all')
  const [missingBanners, setMissingBanners] = useState({})

  const shownResults = selectedLeague === 'all'
    ? results
    : results.filter(m => String(m.league_id) === String(selectedLeague))

  const markMissing = (key) => setMissingBanners((prev) => ({ ...prev, [key]: true }))
  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="sect-head"><h3>🏅 Results</h3></div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <select className="form-select" value={selectedLeague} onChange={(e) => setSelectedLeague(e.target.value)}>
          <option value="all">All Leagues</option>
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      {loading ? (
        <div className="spinner" />
      ) : shownResults.length === 0 ? (
        <div className="empty"><span>🏅</span><p>No results published yet</p></div>
      ) : shownResults.slice(0, 50).map((m) => (
        <Link to={`/match/${m.id}`} key={m.id} className="card card-hover" style={{ marginBottom: 8, textDecoration: 'none', color: 'inherit', display: 'block' }}>
          {(() => {
            const summaryMissing = !!missingBanners[`summary_${m.id}`]
            const resultMissing = !!missingBanners[`result_${m.id}`]
            const src = !summaryMissing
              ? `/media/banners/results/summary_banner_${m.id}.png`
              : (!resultMissing ? `/media/banners/results/result_banner_${m.id}.png` : null)
            if (!src) return null
            return (
              <LazyImage
                src={src}
                alt={`${m.team_a_name} vs ${m.team_b_name} summary`}
                style={{ width: '100%', height: 118, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onError={() => {
                  if (!summaryMissing) markMissing(`summary_${m.id}`)
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
            <span style={{ fontSize: '0.72rem', color: 'var(--t2)' }}>{m.league_name}</span>
            <span className="badge-completed">FT</span>
          </div>
          <div className="fixture-card">
            <div className="fixture-teams">
              <div className="fixture-team">{m.team_a_name}</div>
              <div className="fixture-vs">vs</div>
              <div className="fixture-team">{m.team_b_name}</div>
            </div>
            {m.result_summary && <div className="result-summary" style={{ textAlign: 'center' }}>{m.result_summary}</div>}
            {Array.isArray(m.innings) && m.innings.length > 0 && (
              <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                {(() => {
                  const innings = m.innings.slice(0, 2)
                  const topRuns = Math.max(1, ...innings.map((inn) => Number(inn.total_runs || 0)))
                  const firstRuns = Number(innings[0]?.total_runs || 0)
                  return innings.map((inn, idx) => {
                    const runs = Number(inn.total_runs || 0)
                    const wickets = Number(inn.total_wickets || 0)
                    const balls = Number(inn.total_balls || 0)
                    const label = idx === 0 ? '1st Innings' : '2nd Innings Chase'
                    const chaseNeed = idx === 1 ? Math.max(0, firstRuns + 1 - runs) : null
                    return (
                      <div key={`${m.id}_${inn.id || idx}`} style={{ display: 'grid', gridTemplateColumns: '88px 1fr 70px', gap: 6, alignItems: 'center' }}>
                        <div style={{ fontSize: '.62rem', color: 'var(--t2)', fontWeight: 700 }}>{label}</div>
                        <div style={{ height: 10, borderRadius: 999, background: 'var(--glass-bg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.max(8, (runs / topRuns) * 100)}%`, background: idx === 0 ? 'linear-gradient(90deg,#40c4ff,#00e896)' : 'linear-gradient(90deg,#f7c948,#ff8c42)' }} />
                        </div>
                        <div style={{ fontSize: '.66rem', color: 'var(--t1)', fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{runs}/{wickets}</div>
                        {idx === 1 && chaseNeed !== null && (
                          <div style={{ gridColumn: '1 / -1', fontSize: '.62rem', color: chaseNeed === 0 ? 'var(--accent)' : 'var(--gold)', textAlign: 'right' }}>
                            {chaseNeed === 0 ? 'Chase completed' : `Need ${chaseNeed} to win`} • Overs {Math.floor(balls / 6)}.{balls % 6}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
            {m.mom_name && <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--gold)', paddingTop: 4 }}>⭐ MOM: {m.mom_name}</div>}
          </div>
        </Link>
      ))}
    </div>
  )
}
