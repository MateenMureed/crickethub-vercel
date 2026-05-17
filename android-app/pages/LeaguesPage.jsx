import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useDataStore } from '../context/DataStore'
import LazyImage from '../components/LazyImage'
import { handleBannerTap } from '../utils/media'

export default function LeaguesPage() {
  const { leagues, isRefreshing } = useDataStore()
  const loading = isRefreshing && leagues.length === 0
  const [missingBanners, setMissingBanners] = useState({})

  const markMissing = (key) => setMissingBanners((prev) => ({ ...prev, [key]: true }))
  const sponsorLine = (league) => {
    const sponsors = Array.isArray(league?.sponsors) ? league.sponsors : []
    const names = sponsors
      .map((s) => (typeof s === 'string' ? s : s?.name))
      .filter(Boolean)
      .slice(0, 3)
    return names.length ? names.join(' · ') : 'No sponsors added'
  }

  return (
    <div className="page" style={{ paddingBottom: 80 }}>
      <div className="sect-head">
        <h3>All Leagues</h3>
      </div>
      {loading
        ? <div className="spinner" />
        : leagues.length === 0
          ? <div className="empty"><span className="ico">L</span><h4>No leagues found</h4><p>Create a league from the admin panel</p></div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {leagues.map(l => (
                <Link to={`/leagues/${l.id}`} key={l.id} className="card card-hover" style={{ textDecoration: 'none', color: 'inherit' }}>
                  {!missingBanners[`league_${l.id}`] && (
                    <LazyImage
                      src={`/media/banners/leagues/league_banner_${l.id}.png`}
                      alt={`${l.name} league banner`}
                      style={{ width: '100%', height: 110, objectFit: 'cover', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onError={() => markMissing(`league_${l.id}`)}
                      onClick={(e) => {
                        e.preventDefault()
                        handleBannerTap(`/media/banners/leagues/league_banner_${l.id}.png`, `league_banner_${l.id}.png`)
                      }}
                    />
                  )}
                  <div className="league-card">
                    <div className="league-logo">
                      {(l.logo_url || l.logo) ? <img src={l.logo_url || l.logo} alt={l.name} /> : l.name?.[0]}
                    </div>
                    <div className="league-info">
                      <h4>{l.name}</h4>
                      <p>{l.city || 'City TBD'} - {l.format || 'T20'} - Season {l.season || '-'}</p>
                      <p style={{ marginTop: 3 }}>{l.team_count || 0} teams - {l.venue || ''}</p>
                      <p style={{ marginTop: 3 }}>Organizer: {l.organizer || 'N/A'}</p>
                      <p style={{ marginTop: 3 }}>Sponsors: {sponsorLine(l)}</p>
                    </div>
                    <span className={`badge badge-${l.status === 'active' ? 'live' : l.status === 'completed' ? 'completed' : 'upcoming'}`}>
                      {l.status || 'upcoming'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
    </div>
  )
}
