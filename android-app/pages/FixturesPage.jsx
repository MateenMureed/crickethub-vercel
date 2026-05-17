import { useMemo, useState } from 'react'
import { useDataStore } from '../context/DataStore'
import LazyImage from '../components/LazyImage'
import { downloadFromUrl, handleBannerTap } from '../utils/media'
import { notificationsEnabled, requestMatchNotificationPermission } from '../utils/notifications'

export default function FixturesPage() {
  const { leagues, upcoming, isRefreshing } = useDataStore()
  const loading = isRefreshing && upcoming.length === 0
  const [selectedLeague, setSelectedLeague] = useState('all')
  const [missingBanners, setMissingBanners] = useState({})
  const [alertsEnabled, setAlertsEnabled] = useState(() => notificationsEnabled())

  const shownFixtures = selectedLeague === 'all'
    ? upcoming
    : upcoming.filter((m) => String(m.league_id) === String(selectedLeague))

  const fixturesByLeague = useMemo(() => {
    return shownFixtures.reduce((acc, fixture) => {
      const key = String(fixture.league_id || 'unknown')
      if (!acc[key]) acc[key] = []
      acc[key].push(fixture)
      return acc
    }, {})
  }, [shownFixtures])

  const leagueById = useMemo(() => {
    const map = new Map()
    leagues.forEach((league) => map.set(String(league.id), league))
    return map
  }, [leagues])

  const markMissing = (key) => setMissingBanners((prev) => ({ ...prev, [key]: true }))
  const getVsBannerSrc = (matchId) => {
    const iccKey = `vs_icc_${matchId}`
    const normalKey = `vs_${matchId}`
    if (!missingBanners[iccKey]) return `/media/banners/matches/vs_banner_icc_${matchId}.png`
    if (!missingBanners[normalKey]) return `/media/banners/matches/vs_banner_${matchId}.png`
    return null
  }
  const enableAlerts = async () => {
    const granted = await requestMatchNotificationPermission().catch(() => false)
    setAlertsEnabled(granted)
  }

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="sect-head"><h3>📅 Upcoming Fixtures</h3></div>

      <div className="card" style={{ marginBottom: 12, padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: '.68rem', color: 'var(--t2)' }}>
          Upcoming fixture alerts + live score update notifications
        </div>
        <button type="button" className="btn btn-secondary btn-xs" onClick={enableAlerts} disabled={alertsEnabled}>
          {alertsEnabled ? 'Alerts ON' : 'Enable Alerts'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 12, padding: 10 }}>
        <div style={{ fontSize: '.68rem', color: 'var(--t2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px', fontWeight: 700 }}>
          All League Banners
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
          {leagues.slice(0, 20).map((league) => (
            <button
              key={league.id}
              type="button"
              style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-2)', overflow: 'hidden', minWidth: 140, padding: 0 }}
              onClick={() => handleBannerTap(`/media/banners/leagues/league_banner_${league.id}.png`, `league_banner_${league.id}.png`)}
            >
              <img
                src={`/media/banners/leagues/league_banner_${league.id}.png`}
                alt={`${league.name} banner`}
                style={{ width: '100%', height: 72, objectFit: 'cover' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <div style={{ fontSize: '.68rem', padding: '6px 8px', color: 'var(--t1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{league.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <select className="form-select" value={selectedLeague} onChange={(e) => setSelectedLeague(e.target.value)}>
          <option value="all">All Leagues</option>
          {leagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="spinner" />
      ) : shownFixtures.length === 0 ? (
        <div className="empty"><span>📅</span><p>No upcoming fixtures</p></div>
      ) : Object.entries(fixturesByLeague).slice(0, 20).map(([leagueId, leagueFixtures]) => {
        const league = leagueById.get(String(leagueId))
        return (
          <div key={leagueId} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '2px 2px 8px' }}>
              <h4 style={{ fontSize: '.82rem' }}>{league?.name || leagueFixtures[0]?.league_name || 'League Fixtures'}</h4>
              <span style={{ fontSize: '.66rem', color: 'var(--t2)' }}>{leagueFixtures.length} upcoming</span>
            </div>

            {!missingBanners[`fixtures_${leagueId}`] && (
              <div className="card" style={{ marginBottom: 8, overflow: 'hidden' }}>
                <LazyImage
                  src={`/media/banners/leagues/fixtures_banner_${leagueId}.png`}
                  alt={`${league?.name || 'League'} fixtures banner`}
                  style={{ width: '100%', height: 116, objectFit: 'cover', display: 'block', cursor: 'pointer' }}
                  onError={() => markMissing(`fixtures_${leagueId}`)}
                  onClick={() => handleBannerTap(`/media/banners/leagues/fixtures_banner_${leagueId}.png`, `fixtures_banner_${leagueId}.png`)}
                />
              </div>
            )}

            {leagueFixtures.slice(0, 12).map((m) => (
              <div key={m.id} className="card" style={{ marginBottom: 8 }}>
                {getVsBannerSrc(m.id) && (
                  <LazyImage
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
                  <div className="fixture-meta">
                    {m.league_name} · {m.venue || 'Venue TBD'} · {m.date || m.match_date || 'Date TBC'} · {m.time || m.match_time || 'Time TBC'}
                  </div>
                  <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 10, background: 'var(--acc-dim)', border: '1px solid var(--border)', textAlign: 'center', fontSize: '.68rem', color: 'var(--t2)' }}>
                    Venue: <strong style={{ color: 'var(--t1)' }}>{m.venue || 'TBD'}</strong> · Date: <strong style={{ color: 'var(--t1)' }}>{m.date || m.match_date || 'TBD'}</strong> · Time: <strong style={{ color: 'var(--t1)' }}>{m.time || m.match_time || 'TBD'}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        const src = getVsBannerSrc(m.id)
                        if (src) handleBannerTap(src, src.split('/').pop())
                      }}
                    >
                      View Banner
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => {
                        const src = getVsBannerSrc(m.id)
                        if (src) downloadFromUrl(src, src.split('/').pop())
                      }}
                    >
                      Download VS Banner
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
