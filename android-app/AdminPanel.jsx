import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

/* ── Toast ── */
function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="toast">
      <span style={{ color: 'var(--accent)' }}>✓</span>
      {message}
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', marginLeft: 8, fontSize: '1.1rem', lineHeight: 1 }}>×</button>
    </div>
  )
}

/* ── Bottom Sheet ── */
function BottomSheet({ title, onClose, children }) {
  return (
    <div className="bottomsheet-overlay" onClick={onClose}>
      <div className="bottomsheet" onClick={e => e.stopPropagation()}>
        <div className="bottomsheet-handle" />
        {title && <div className="bottomsheet-title">{title}</div>}
        {children}
      </div>
    </div>
  )
}

/* ── Collapsible Section ── */
function Section({ icon, title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="admin-section-card">
      <div className="admin-section-head" onClick={() => setOpen(o => !o)}>
        <span className="admin-section-icon">{icon}</span>
        <span className="admin-section-title">{title}</span>
        {count !== undefined && <span className="admin-section-count">{count}</span>}
        <span className={`admin-section-caret${open ? ' open' : ''}`}>▾</span>
      </div>
      {open && <div>{children}</div>}
    </div>
  )
}

export default function AdminPanel() {
  const navigate = useNavigate()
  const [leagues, setLeagues] = useState([])
  const [selectedLeague, setSelectedLeague] = useState(null)
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [teamPlayers, setTeamPlayers] = useState([])
  const [toast, setToast] = useState(null)
  const [sheet, setSheet] = useState(null) // 'addLeague'|'addTeam'|'addPlayer'|'generateFixtures'
  const [loading, setLoading] = useState(false)

  // Forms
  const [leagueForm, setLeagueForm] = useState({ name: '', city: '', season: '', status: 'upcoming' })
  const [teamForm, setTeamForm] = useState({ name: '', captain_name: '' })
  const [playerForm, setPlayerForm] = useState({ name: '', role: 'batsman', jersey_number: '' })
  const [fixtureForm, setFixtureForm] = useState({ format: 'round-robin', matches_per_pair: 1, overs_per_innings: 20, match_date: '', match_time: '', venue: '', match_gap_days: 1 })

  const showToast = msg => setToast(msg)
  const token = localStorage.getItem('crickethub_token')
  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }

  useEffect(() => {
    loadLeagues()
  }, [])

  useEffect(() => {
    if (selectedLeague) {
      loadTeams(selectedLeague.id)
      loadMatches(selectedLeague.id)
    }
  }, [selectedLeague])

  useEffect(() => {
    if (selectedTeam) loadPlayers(selectedTeam.id)
  }, [selectedTeam])

  const loadLeagues = () => fetch(`${API}/leagues`).then(r => r.json()).then(setLeagues).catch(() => {})
  const loadTeams = id => fetch(`${API}/leagues/${id}/teams`).then(r => r.json()).then(setTeams).catch(() => setTeams([]))
  const loadMatches = id => fetch(`${API}/leagues/${id}/matches`).then(r => r.json()).then(setMatches).catch(() => setMatches([]))
  const loadPlayers = id => fetch(`${API}/teams/${id}/players`).then(r => r.json()).then(setTeamPlayers).catch(() => setTeamPlayers([]))

  // Add League
  const addLeague = async e => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`${API}/leagues`, { method: 'POST', headers: authHeaders, body: JSON.stringify(leagueForm) })
      if (res.ok) { loadLeagues(); setSheet(null); showToast('League created!'); setLeagueForm({ name: '', city: '', season: '', status: 'upcoming' }) }
      else { const d = await res.json(); showToast('Error: ' + (d.error || 'Failed')) }
    } catch { showToast('Network error') } finally { setLoading(false) }
  }

  // Add Team
  const addTeam = async e => {
    e.preventDefault()
    if (!selectedLeague) return
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('name', teamForm.name)
      fd.append('captain_name', teamForm.captain_name)
      const res = await fetch(`${API}/leagues/${selectedLeague.id}/teams`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd })
      if (res.ok) { loadTeams(selectedLeague.id); setSheet(null); showToast('Team added!'); setTeamForm({ name: '', captain_name: '' }) }
    } catch { showToast('Network error') } finally { setLoading(false) }
  }

  // Add Player
  const addPlayer = async e => {
    e.preventDefault()
    if (!selectedTeam) return
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('name', playerForm.name)
      fd.append('role', playerForm.role)
      if (playerForm.jersey_number) fd.append('jersey_number', playerForm.jersey_number)
      const res = await fetch(`${API}/teams/${selectedTeam.id}/players`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd })
      if (res.ok) { loadPlayers(selectedTeam.id); setSheet(null); showToast('Player added!'); setPlayerForm({ name: '', role: 'batsman', jersey_number: '' }) }
    } catch { showToast('Network error') } finally { setLoading(false) }
  }

  // Generate Fixtures
  const generateFixtures = async e => {
    e.preventDefault()
    if (!selectedLeague) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/leagues/${selectedLeague.id}/generate-fixtures`, {
        method: 'POST', headers: authHeaders, body: JSON.stringify(fixtureForm)
      })
      if (res.ok) { loadMatches(selectedLeague.id); setSheet(null); showToast('Fixtures generated!') }
      else { const d = await res.json(); showToast('Error: ' + (d.error || 'Failed')) }
    } catch { showToast('Network error') } finally { setLoading(false) }
  }

  // Delete
  const deleteLeague = async id => {
    if (!confirm('Delete this league?')) return
    await fetch(`${API}/leagues/${id}`, { method: 'DELETE', headers: authHeaders })
    loadLeagues()
    if (selectedLeague?.id === id) setSelectedLeague(null)
    showToast('League deleted')
  }

  const deleteTeam = async id => {
    if (!confirm('Delete this team?')) return
    await fetch(`${API}/teams/${id}`, { method: 'DELETE', headers: authHeaders })
    loadTeams(selectedLeague.id)
    if (selectedTeam?.id === id) setSelectedTeam(null)
    showToast('Team deleted')
  }

  const deletePlayer = async id => {
    await fetch(`${API}/players/${id}`, { method: 'DELETE', headers: authHeaders })
    loadPlayers(selectedTeam.id)
    showToast('Player removed')
  }

  const startMatch = async id => {
    await fetch(`${API}/matches/${id}/start`, { method: 'POST', headers: authHeaders })
    loadMatches(selectedLeague.id)
    showToast('Match started')
  }

  return (
    <div className="page">
      <div style={{ padding: '14px 16px 8px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', letterSpacing: '0.5px', marginBottom: 4 }}>Organizer Panel</h1>
        <p style={{ fontSize: '0.75rem', color: 'var(--t3)' }}>Manage leagues, teams & matches</p>
      </div>

      {/* ── Leagues ── */}
      <Section icon="🏆" title="Leagues" count={leagues.length} defaultOpen={true}>
        <div style={{ padding: '8px 14px' }}>
          <button className="btn btn-primary btn-sm btn-full" onClick={() => setSheet('addLeague')}>+ New League</button>
        </div>
        {leagues.map(l => (
          <div key={l.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderTop: '1px solid rgba(255,255,255,0.04)',
          }}>
            {l.logo
              ? <img src={l.logo} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              : <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--accent)', flexShrink: 0 }}>{l.name?.charAt(0)}</div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--t3)' }}>{l.city} · {l.team_count || 0} teams</div>
            </div>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              <button className="btn btn-secondary btn-xs" onClick={() => setSelectedLeague(l)}>Manage</button>
              <button className="btn btn-danger btn-xs" onClick={() => deleteLeague(l.id)}>✕</button>
            </div>
          </div>
        ))}
        {leagues.length === 0 && <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--t3)', fontSize: '0.8rem' }}>No leagues yet</div>}
      </Section>

      {/* ── Teams (for selected league) ── */}
      {selectedLeague && (
        <Section icon="👥" title={`Teams · ${selectedLeague.name}`} count={teams.length} defaultOpen={true}>
          <div style={{ padding: '8px 14px' }}>
            <button className="btn btn-primary btn-sm btn-full" onClick={() => setSheet('addTeam')}>+ Add Team</button>
          </div>
          {teams.map(t => (
            <div key={t.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                {t.logo
                  ? <img src={t.logo} alt="" style={{ width: 32, height: 32, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(64,196,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1rem', color: 'var(--sky)', flexShrink: 0 }}>{t.name?.charAt(0)}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{t.name}</div>
                  {t.captain_name && <div style={{ fontSize: '0.65rem', color: 'var(--t3)' }}>Captain: {t.captain_name}</div>}
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-xs" onClick={() => setSelectedTeam(t)}>Players</button>
                  <button className="btn btn-danger btn-xs" onClick={() => deleteTeam(t.id)}>✕</button>
                </div>
              </div>
              {/* Players for selected team */}
              {selectedTeam?.id === t.id && (
                <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border2)' }}>
                  <div style={{ padding: '6px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Squad</span>
                    <button className="btn btn-primary btn-xs" onClick={() => setSheet('addPlayer')}>+ Player</button>
                  </div>
                  {teamPlayers.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px 7px 22px', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                      {p.photo
                        ? <img src={p.photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                        : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: 'var(--accent)', flexShrink: 0 }}>{p.name?.charAt(0)}</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--t3)', textTransform: 'capitalize' }}>{p.role}{p.jersey_number ? ` · #${p.jersey_number}` : ''}</div>
                      </div>
                      <button className="btn btn-danger btn-xs" onClick={() => deletePlayer(p.id)}>✕</button>
                    </div>
                  ))}
                  {teamPlayers.length === 0 && <div style={{ padding: '10px 22px', fontSize: '0.75rem', color: 'var(--t3)' }}>No players added yet</div>}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* ── Matches ── */}
      {selectedLeague && (
        <Section icon="🏏" title={`Matches · ${selectedLeague.name}`} count={matches.length} defaultOpen={false}>
          <div style={{ padding: '8px 14px' }}>
            <button className="btn btn-gold btn-sm btn-full" onClick={() => setSheet('generateFixtures')}>⚡ Generate Fixtures</button>
          </div>
          {matches.map(m => (
            <div key={m.id} style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>{m.team_a_name} vs {m.team_b_name}</div>
                <span className={`badge ${m.status === 'live' ? 'badge-live' : m.status === 'completed' ? 'badge-done' : 'badge-upcoming'}`}>{m.status}</span>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--t3)', marginBottom: 8 }}>{m.date || 'Date TBA'} · {m.venue || 'Venue TBA'}</div>
              {m.status === 'upcoming' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-xs" onClick={() => { startMatch(m.id) }}>Start Match</button>
                </div>
              )}
              {m.status === 'live' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-xs" onClick={() => navigate(`/admin/scoring/${m.id}`)}>Live Scoring</button>
                </div>
              )}
              {m.status === 'completed' && m.result_summary && (
                <div style={{ fontSize: '0.72rem', color: 'var(--accent)' }}>{m.result_summary}</div>
              )}
            </div>
          ))}
          {matches.length === 0 && <div style={{ padding: '16px 14px', textAlign: 'center', color: 'var(--t3)', fontSize: '0.8rem' }}>No matches yet · Generate fixtures above</div>}
        </Section>
      )}

      {/* ═══ Bottom Sheets ═══ */}

      {/* Add League */}
      {sheet === 'addLeague' && (
        <BottomSheet title="New League" onClose={() => setSheet(null)}>
          <form onSubmit={addLeague}>
            <div className="form-group"><label className="label">League Name *</label><input className="input" value={leagueForm.name} onChange={e => setLeagueForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. City Premier League" required /></div>
            <div className="form-group"><label className="label">City</label><input className="input" value={leagueForm.city} onChange={e => setLeagueForm(p => ({ ...p, city: e.target.value }))} placeholder="City" /></div>
            <div className="form-group"><label className="label">Season</label><input className="input" value={leagueForm.season} onChange={e => setLeagueForm(p => ({ ...p, season: e.target.value }))} placeholder="e.g. 2025" /></div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="label">Status</label>
              <select className="select" value={leagueForm.status} onChange={e => setLeagueForm(p => ({ ...p, status: e.target.value }))}>
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>{loading ? 'Creating…' : 'Create League'}</button>
          </form>
        </BottomSheet>
      )}

      {/* Add Team */}
      {sheet === 'addTeam' && (
        <BottomSheet title={`Add Team · ${selectedLeague?.name}`} onClose={() => setSheet(null)}>
          <form onSubmit={addTeam}>
            <div className="form-group"><label className="label">Team Name *</label><input className="input" value={teamForm.name} onChange={e => setTeamForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Rising Stars" required /></div>
            <div className="form-group" style={{ marginBottom: 20 }}><label className="label">Captain Name</label><input className="input" value={teamForm.captain_name} onChange={e => setTeamForm(p => ({ ...p, captain_name: e.target.value }))} placeholder="Captain's name" /></div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>{loading ? 'Adding…' : 'Add Team'}</button>
          </form>
        </BottomSheet>
      )}

      {/* Add Player */}
      {sheet === 'addPlayer' && (
        <BottomSheet title={`Add Player · ${selectedTeam?.name}`} onClose={() => setSheet(null)}>
          <form onSubmit={addPlayer}>
            <div className="form-group"><label className="label">Player Name *</label><input className="input" value={playerForm.name} onChange={e => setPlayerForm(p => ({ ...p, name: e.target.value }))} placeholder="Player name" required /></div>
            <div className="form-group">
              <label className="label">Role</label>
              <select className="select" value={playerForm.role} onChange={e => setPlayerForm(p => ({ ...p, role: e.target.value }))}>
                <option value="batsman">Batsman</option>
                <option value="bowler">Bowler</option>
                <option value="all-rounder">All-Rounder</option>
                <option value="wicket-keeper">Wicket Keeper</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}><label className="label">Jersey #</label><input className="input" type="number" value={playerForm.jersey_number} onChange={e => setPlayerForm(p => ({ ...p, jersey_number: e.target.value }))} placeholder="e.g. 18" /></div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>{loading ? 'Adding…' : 'Add Player'}</button>
          </form>
        </BottomSheet>
      )}

      {/* Generate Fixtures */}
      {sheet === 'generateFixtures' && (
        <BottomSheet title={`Generate Fixtures · ${selectedLeague?.name}`} onClose={() => setSheet(null)}>
          <form onSubmit={generateFixtures}>
            <div className="form-group">
              <label className="label">Format</label>
              <select className="select" value={fixtureForm.format} onChange={e => setFixtureForm(p => ({ ...p, format: e.target.value }))}>
                <option value="round-robin">Round Robin</option>
                <option value="knockout">Knockout</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group"><label className="label">Overs/Innings</label><input className="input" type="number" min="1" value={fixtureForm.overs_per_innings} onChange={e => setFixtureForm(p => ({ ...p, overs_per_innings: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Matches/Pair</label><input className="input" type="number" min="1" value={fixtureForm.matches_per_pair} onChange={e => setFixtureForm(p => ({ ...p, matches_per_pair: e.target.value }))} /></div>
            </div>
            <div className="form-group"><label className="label">Venue</label><input className="input" value={fixtureForm.venue} onChange={e => setFixtureForm(p => ({ ...p, venue: e.target.value }))} placeholder="Ground / stadium" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group"><label className="label">Start Date</label><input className="input" type="date" value={fixtureForm.match_date} onChange={e => setFixtureForm(p => ({ ...p, match_date: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Time</label><input className="input" type="time" value={fixtureForm.match_time} onChange={e => setFixtureForm(p => ({ ...p, match_time: e.target.value }))} /></div>
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}><label className="label">Gap (days)</label><input className="input" type="number" min="0" value={fixtureForm.match_gap_days} onChange={e => setFixtureForm(p => ({ ...p, match_gap_days: e.target.value }))} /></div>
            <button type="submit" className="btn btn-gold btn-full" disabled={loading}>{loading ? 'Generating…' : '⚡ Generate Fixtures'}</button>
          </form>
        </BottomSheet>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div style={{ height: 16 }} />
    </div>
  )
}
