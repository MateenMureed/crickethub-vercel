import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()
const WICKET_TYPES = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired out']

export default function LiveScoring() {
  const { matchId } = useParams()
  const navigate = useNavigate()

  const [match, setMatch]                   = useState(null)
  const [scorecard, setScorecard]           = useState([])
  const [currentInnings, setCurrentInnings] = useState(null)
  const [balls, setBalls]                   = useState([])
  const [battingPlayers, setBattingPlayers] = useState([])
  const [bowlingPlayers, setBowlingPlayers] = useState([])
  const [teamSquadsById, setTeamSquadsById] = useState({})
  const [startConfig, setStartConfig]       = useState({ batting_team_id: '', bowling_team_id: '' })

  const [showWicketModal, setShowWicketModal]         = useState(false)
  const [pendingWicketType, setPendingWicketType]     = useState('bowled')
  const [pendingDismissedEnd, setPendingDismissedEnd] = useState('striker')
  const [pendingIncoming, setPendingIncoming]         = useState('')
  const [showBowlerModal, setShowBowlerModal]         = useState(false)
  const [selectedBowler, setSelectedBowler]           = useState('')
  const [showInningsInit, setShowInningsInit]         = useState(false)
  const [inningsInitCfg, setInningsInitCfg]           = useState({ striker_id: '', non_striker_id: '', bowler_id: '' })

  const token = localStorage.getItem('crickethub_token')
  const authJson = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const fetchPlayers = async (teamId) => {
    if (!teamId || Number.isNaN(+teamId)) return []
    return fetch(`${API}/teams/${teamId}/players`).then(r => r.json()).catch(() => [])
  }

  const loadMatch = async () => {
    const m = await fetch(`${API}/matches/${matchId}`).then(r => r.json()).catch(() => null)
    if (!m) return
    setMatch(m)
    const [sA, sB] = await Promise.all([fetchPlayers(m.team_a_id), fetchPlayers(m.team_b_id)])
    setTeamSquadsById(p => ({ ...p, [m.team_a_id]: sA, [m.team_b_id]: sB }))
    const sc = await fetch(`${API}/matches/${matchId}/scorecard`).then(r => r.json()).catch(() => [])
    setScorecard(sc)
    const active = m.innings?.find(i => !i.is_completed) || null
    setCurrentInnings(active)
    if (!active) { setBalls([]); return }
    const [bat, bowl, be] = await Promise.all([
      fetchPlayers(active.batting_team_id),
      fetchPlayers(active.bowling_team_id),
      fetch(`${API}/innings/${active.id}/balls`).then(r => r.json()).catch(() => [])
    ])
    setBattingPlayers(bat); setBowlingPlayers(bowl); setBalls(be)
    if (!active.striker_id || !active.non_striker_id) {
      const defaultStriker = bat?.[0] || null
      const defaultNonStriker = bat?.[1] || null
      const defaultBowler = (bowl || []).find((p) => ['bowler', 'all-rounder'].includes((p.role || '').toLowerCase())) || bowl?.[0] || null

      if (defaultStriker && defaultNonStriker && defaultBowler) {
        const autoInitRes = await fetch(`${API}/innings/${active.id}/initialize`, {
          method: 'POST', headers: authJson,
          body: JSON.stringify({ striker_id: defaultStriker.id, non_striker_id: defaultNonStriker.id, bowler_id: defaultBowler.id })
        }).catch(() => null)
        if (autoInitRes?.ok) {
          setShowInningsInit(false)
          await loadMatch()
          return
        }
      }

      setInningsInitCfg({
        striker_id: defaultStriker?.id ? String(defaultStriker.id) : '',
        non_striker_id: defaultNonStriker?.id ? String(defaultNonStriker.id) : '',
        bowler_id: defaultBowler?.id ? String(defaultBowler.id) : '',
      })
      setShowInningsInit(true)
      return
    }
    if (!active.current_bowler_id) setShowBowlerModal(true)
  }

  useEffect(() => { loadMatch() }, [matchId])
  useEffect(() => { const id = setInterval(loadMatch, 1500); return () => clearInterval(id) }, [matchId])

  const startInnings = async (e) => {
    e.preventDefault()
    const { batting_team_id, bowling_team_id } = startConfig
    if (!batting_team_id || !bowling_team_id) { alert('Select both teams'); return }
    const bP = teamSquadsById[+batting_team_id] || await fetchPlayers(+batting_team_id)
    const wP = teamSquadsById[+bowling_team_id] || await fetchPlayers(+bowling_team_id)
    const s = bP[0], ns = bP[1]
    const bwl = wP.find(p => ['bowler','all-rounder'].includes((p.role||'').toLowerCase())) || wP[0]
    if (!s || !ns || !bwl) { alert('Not enough players'); return }
    const res = await fetch(`${API}/matches/${matchId}/start`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ batting_team_id: +batting_team_id, bowling_team_id: +bowling_team_id, striker_id: s.id, non_striker_id: ns.id, bowler_id: bwl.id })
    })
    if (!res.ok) { const d = await res.json(); alert(d.error||'Failed'); return }
    await loadMatch()
  }

  const initInnings = async () => {
    const { striker_id, non_striker_id, bowler_id } = inningsInitCfg
    if (!striker_id || !non_striker_id || !bowler_id) { alert('Select all players'); return }
    if (+striker_id === +non_striker_id) { alert('Striker and non-striker must be different players'); return }
    const res = await fetch(`${API}/innings/${currentInnings.id}/initialize`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ striker_id: +striker_id, non_striker_id: +non_striker_id, bowler_id: +bowler_id })
    })
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error||'Failed'); return }
    setShowInningsInit(false); await loadMatch()
  }

  const setBowlerForOver = async () => {
    if (!selectedBowler) { alert('Select a bowler'); return }
    const res = await fetch(`${API}/innings/${currentInnings.id}/select-bowler`, {
      method: 'POST', headers: authJson, body: JSON.stringify({ bowler_id: +selectedBowler })
    })
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error||'Failed'); return }
    setShowBowlerModal(false); setSelectedBowler(''); await loadMatch()
  }

  const submitBall = async (ballData) => {
    if (!currentInnings) return
    const res = await fetch(`${API}/innings/${currentInnings.id}/ball`, {
      method: 'POST', headers: authJson, body: JSON.stringify(ballData)
    })
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error||'Failed to record ball'); return }
    await loadMatch()
  }

  const handleWicketFlow = async () => {
    const dismissedId = pendingDismissedEnd === 'striker' ? striker?.id : nonStriker?.id
    await submitBall({
      runs_scored: 0, is_wicket: true, wicket_type: pendingWicketType,
      dismissed_player_id: dismissedId, dismissed_end: pendingDismissedEnd,
      incoming_batsman_id: pendingIncoming ? +pendingIncoming : undefined
    })
    setShowWicketModal(false); setPendingIncoming(''); await loadMatch()
  }

  const undoLastBall = async () => {
    if (!currentInnings || balls.length === 0) return
    if (!confirm('Undo the last recorded ball?')) return
    const res = await fetch(`${API}/innings/${currentInnings.id}/ball/last`, { method: 'DELETE', headers: authJson })
    if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error||'Failed'); return }
    await loadMatch()
  }

  const endMatch = async () => {
    if (!confirm('End match and finalize result?')) return
    const winner = prompt('Winner team name (blank for tie):')
    const summary = prompt('Result summary:')
    await fetch(`${API}/matches/${matchId}/end`, {
      method: 'POST', headers: authJson,
      body: JSON.stringify({ winner_name: winner||'', result_summary: summary||'' })
    })
    navigate(`/match/${matchId}/scorecard`)
  }

  const fmtOvers = b => !b ? '0.0' : `${Math.floor(b/6)}.${b%6}`

  const activeInnings = useMemo(() => scorecard.find(s => s.id === currentInnings?.id), [scorecard, currentInnings])
  const striker       = useMemo(() => battingPlayers.find(p => p.id === currentInnings?.striker_id), [battingPlayers, currentInnings])
  const nonStriker    = useMemo(() => battingPlayers.find(p => p.id === currentInnings?.non_striker_id), [battingPlayers, currentInnings])
  const strikerStats  = useMemo(() => activeInnings?.batting?.find(b => b.player_id === striker?.id), [activeInnings, striker])
  const nonStrkStats  = useMemo(() => activeInnings?.batting?.find(b => b.player_id === nonStriker?.id), [activeInnings, nonStriker])
  const bowlerStats   = useMemo(() => {
    const id = currentInnings?.current_bowler_id
    return id ? activeInnings?.bowling?.find(b => b.player_id === id) : null
  }, [activeInnings, currentInnings])

  const currentOverBalls = useMemo(() =>
    balls.length ? balls.filter(b => b.over_number === balls[balls.length-1].over_number).slice(-6) : [], [balls])
  const overSlots = useMemo(() => Array.from({length:6}, (_,i) => currentOverBalls[i]||null), [currentOverBalls])
  const overNum = Math.floor((activeInnings?.total_balls||0)/6)

  const firstInn = match?.innings?.find(i => i.innings_number===1)
  const isSecond = activeInnings?.innings_number === 2
  const target = isSecond && firstInn ? firstInn.total_runs+1 : null
  const ballsLeft = isSecond ? (match?.overs_per_innings||20)*6-(activeInnings?.total_balls||0) : null
  const runsNeeded = target ? target-(activeInnings?.total_runs||0) : null
  const currentRR = activeInnings?.total_balls > 0 ? ((activeInnings.total_runs/activeInnings.total_balls)*6).toFixed(2) : '0.00'
  const rrr = runsNeeded && ballsLeft > 0 ? ((runsNeeded/ballsLeft)*6).toFixed(2) : null

  const availableBatsmen = useMemo(() => {
    const outIds = activeInnings?.batting?.filter(b => b.is_out).map(b => b.player_id)||[]
    const activeIds = [striker?.id, nonStriker?.id].filter(Boolean)
    return battingPlayers.filter(p => !outIds.includes(p.id) && !activeIds.includes(p.id))
  }, [battingPlayers, activeInnings, striker, nonStriker])

  const availableBowlers = useMemo(() => {
    const lastId = balls.length > 0 ? balls[balls.length-1]?.bowler_id : null
    return bowlingPlayers.filter(p => ['bowler','all-rounder'].includes((p.role||'').toLowerCase()) && p.id !== lastId)
  }, [bowlingPlayers, balls])

  const ballClass = b => {
    if (!b) return 'ball ball-dot'
    if (b.is_wicket) return 'ball ball-W'
    if (b.extras_type==='wide') return 'ball ball-Wd'
    if (b.extras_type==='noball') return 'ball ball-Nb'
    if (b.runs_scored===6) return 'ball ball-6'
    if (b.runs_scored===4) return 'ball ball-4'
    if (b.runs_scored>=2) return 'ball ball-2'
    if (b.runs_scored===1) return 'ball ball-1'
    return 'ball ball-dot'
  }
  const ballLabel = b => {
    if (!b) return ''
    if (b.is_wicket) return 'W'
    if (b.extras_type==='wide') return 'Wd'
    if (b.extras_type==='noball') return 'Nb'
    return String(b.runs_scored)
  }

  if (!match) return <div className="loading-center"><div className="spinner"/></div>

  /* ── Match not started ── */
  if (!match.innings || match.innings.length === 0) return (
    <div className="page">
      <div style={{padding:'14px 16px 8px'}}>
        <div style={{fontFamily:'var(--font-display)',fontSize:'1.3rem',letterSpacing:'0.5px',marginBottom:4}}>Start Match</div>
        <div style={{fontSize:'0.75rem',color:'var(--t3)'}}>{match.team_a_name} vs {match.team_b_name}</div>
      </div>
      <div style={{margin:'8px 16px',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:'var(--r-lg)',overflow:'hidden'}}>
        <div style={{padding:'12px 14px',background:'var(--accent-dim)',borderBottom:'1px solid var(--border2)',fontSize:'0.65rem',fontWeight:800,letterSpacing:'0.5px',textTransform:'uppercase',color:'var(--accent)'}}>Toss &amp; Setup</div>
        <form onSubmit={startInnings} style={{padding:'14px'}}>
          <div className="form-group">
            <label className="label">Batting First</label>
            <select className="select" value={startConfig.batting_team_id} onChange={e=>setStartConfig(p=>({...p,batting_team_id:e.target.value}))}>
              <option value="">Select team</option>
              <option value={match.team_a_id}>{match.team_a_name}</option>
              <option value={match.team_b_id}>{match.team_b_name}</option>
            </select>
          </div>
          <div className="form-group" style={{marginBottom:18}}>
            <label className="label">Bowling First</label>
            <select className="select" value={startConfig.bowling_team_id} onChange={e=>setStartConfig(p=>({...p,bowling_team_id:e.target.value}))}>
              <option value="">Select team</option>
              <option value={match.team_a_id}>{match.team_a_name}</option>
              <option value={match.team_b_id}>{match.team_b_name}</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary btn-full">Start 1st Innings →</button>
        </form>
      </div>
    </div>
  )

  /* ── Main scoring UI ── */
  return (
    <div className="page">
      <div style={{height:3,background:'linear-gradient(90deg,var(--accent),var(--sky),var(--accent))',backgroundSize:'200%',animation:'shimmer 2s linear infinite'}}/>

      {/* Scoreboard */}
      {activeInnings && (
        <div style={{margin:'10px 16px',padding:'14px 16px',background:'linear-gradient(135deg,#0a1830 0%,#060e1e 100%)',border:'1px solid rgba(0,232,150,0.18)',borderRadius:'var(--r-lg)'}}>
          <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between',marginBottom:2}}>
            <div style={{fontSize:'0.62rem',color:'var(--t3)',textTransform:'uppercase',letterSpacing:'1px',fontWeight:800}}>{activeInnings.team_name} · {activeInnings.innings_number===1?'1st':'2nd'} Inn</div>
            <span className="badge badge-live" style={{fontSize:'0.55rem'}}>● LIVE</span>
          </div>
          <div style={{display:'flex',alignItems:'baseline',gap:8}}>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'2.4rem',fontWeight:700,color:'var(--gold)',lineHeight:1}}>{activeInnings.total_runs}</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'1.8rem',color:'var(--t4)'}}>/</span>
            <span style={{fontFamily:'var(--font-mono)',fontSize:'2.4rem',fontWeight:700,color:'var(--gold)',lineHeight:1}}>{activeInnings.total_wickets}</span>
            <span style={{fontFamily:'var(--font-display)',fontSize:'0.9rem',color:'var(--t3)',letterSpacing:'1px',marginLeft:4}}>({fmtOvers(activeInnings.total_balls)} ov)</span>
            <span style={{marginLeft:'auto',fontFamily:'var(--font-mono)',fontSize:'0.75rem',color:'var(--sky)',background:'var(--sky-dim)',padding:'2px 8px',borderRadius:'var(--r-pill)',border:'1px solid rgba(64,196,255,0.2)'}}>CRR {currentRR}</span>
          </div>
          {target && <div style={{marginTop:6,fontSize:'0.72rem',color:'var(--sky)',fontWeight:700}}>Target {target} · Need {runsNeeded} off {ballsLeft} balls{rrr?` · RRR ${rrr}`:''}</div>}
        </div>
      )}

      {/* Players strip */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,margin:'0 16px 10px'}}>
        {[
          {label:'● Striker',  name:striker?.name,  info: strikerStats  ? `${strikerStats.runs}(${strikerStats.balls_faced})`  : '—', color:'var(--accent)', bg:'rgba(0,232,150,0.06)',  bd:'rgba(0,232,150,0.18)'},
          {label:'Non-Striker',name:nonStriker?.name,info: nonStrkStats  ? `${nonStrkStats.runs}(${nonStrkStats.balls_faced})`   : '—', color:'var(--t3)',    bg:'var(--surface)',         bd:'var(--border2)'},
          {label:'🎳 Bowler',  name:bowlerStats?.name,info:bowlerStats   ? `${fmtOvers(bowlerStats.balls_bowled)}-${bowlerStats.wickets}-${bowlerStats.runs_conceded}` : '—', color:'var(--red)', bg:'var(--red-dim)', bd:'rgba(255,77,109,0.18)'},
        ].map(r => (
          <div key={r.label} style={{background:r.bg,border:`1px solid ${r.bd}`,borderRadius:'var(--r-md)',padding:'8px 10px'}}>
            <div style={{fontSize:'0.52rem',color:r.color,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:3}}>{r.label}</div>
            <div style={{fontSize:'0.78rem',fontWeight:700,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>{r.name||'—'}</div>
            <div style={{fontFamily:'var(--font-mono)',fontSize:'0.68rem',color:'var(--t2)'}}>{r.info}</div>
          </div>
        ))}
      </div>

      {/* Current Over */}
      <div style={{margin:'0 16px 10px',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:'var(--r-lg)',padding:'10px 14px'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
          <span style={{fontSize:'0.6rem',fontWeight:800,letterSpacing:'1.5px',textTransform:'uppercase',color:'var(--accent)'}}>Over {overNum}</span>
          <button onClick={()=>setShowBowlerModal(true)} style={{fontSize:'0.62rem',color:'var(--t3)',background:'none',border:'1px solid var(--border2)',borderRadius:4,padding:'2px 8px',cursor:'pointer'}}>Change Bowler</button>
        </div>
        <div className="over-row">
          {overSlots.map((b,i)=>(
            <div key={b?.id||`e-${i}`} className={b?ballClass(b):'ball ball-dot'} style={{opacity:b?1:0.25,width:32,height:32,fontSize:'0.72rem'}}>{b?ballLabel(b):''}</div>
          ))}
        </div>
      </div>

      {/* Runs */}
      <div style={{padding:'0 16px 6px',fontSize:'0.6rem',fontWeight:800,letterSpacing:'1.5px',textTransform:'uppercase',color:'var(--t3)'}}>Runs</div>
      <div className="scoring-action-grid">
        {[0,1,2,3].map(r=><button key={r} className={`run-btn r${r}`} onClick={()=>submitBall({runs_scored:r})}>{r}</button>)}
        <button className="run-btn r4" onClick={()=>submitBall({runs_scored:4})}>4</button>
        <button className="run-btn r6" onClick={()=>submitBall({runs_scored:6})}>6</button>
        <button className="run-btn rWd" onClick={()=>submitBall({runs_scored:0,extras_type:'wide',extras_runs:1})}>Wide</button>
        <button className="run-btn rNb" onClick={()=>submitBall({runs_scored:0,extras_type:'noball',extras_runs:1})}>NB</button>
      </div>

      {/* Extras + Wicket + Undo */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:'8px 16px 0'}}>
        <button style={{padding:'10px',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:'var(--r-md)',color:'var(--t2)',fontSize:'0.82rem',fontWeight:700,cursor:'pointer'}}
          onClick={()=>submitBall({runs_scored:0,extras_type:'bye',extras_runs:1})}>Bye</button>
        <button style={{padding:'10px',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:'var(--r-md)',color:'var(--t2)',fontSize:'0.82rem',fontWeight:700,cursor:'pointer'}}
          onClick={()=>submitBall({runs_scored:0,extras_type:'legbye',extras_runs:1})}>Leg Bye</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:'8px 16px 0'}}>
        <button className="run-btn rW" style={{height:54,borderRadius:'var(--r-md)',fontSize:'1rem',fontWeight:800,letterSpacing:'1px'}} onClick={()=>setShowWicketModal(true)}>⚡ WICKET</button>
        <button className="run-btn rUndo" style={{height:54,borderRadius:'var(--r-md)',fontSize:'0.9rem'}} onClick={undoLastBall}>↩ Undo</button>
      </div>

      {/* Last balls */}
      {balls.length>0 && (
        <div style={{margin:'10px 16px 0',background:'var(--surface)',border:'1px solid var(--border2)',borderRadius:'var(--r-lg)',padding:'10px 12px'}}>
          <div style={{fontSize:'0.58rem',fontWeight:800,letterSpacing:'1.5px',textTransform:'uppercase',color:'var(--t3)',marginBottom:7}}>Last 12 Balls</div>
          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
            {balls.slice(-12).map((b,i)=>{
              const arr=balls.slice(-12); const sep=i>0&&b.over_number!==arr[i-1].over_number
              return <span key={b.id} style={{display:'flex',alignItems:'center',gap:4}}>
                {sep&&<div style={{width:1,height:20,background:'var(--border2)'}}/>}
                <div className={ballClass(b)} style={{width:28,height:28,fontSize:'0.68rem'}}>{ballLabel(b)}</div>
              </span>
            })}
          </div>
        </div>
      )}

      <div style={{padding:'12px 16px 4px'}}>
        <button className="btn btn-danger btn-full" onClick={endMatch}>End Match</button>
      </div>

      {/* ══ WICKET SHEET ══ */}
      {showWicketModal&&(
        <div className="bottomsheet-overlay" onClick={()=>setShowWicketModal(false)}>
          <div className="bottomsheet" onClick={e=>e.stopPropagation()}>
            <div className="bottomsheet-handle"/>
            <div className="bottomsheet-title">⚡ Wicket Event</div>
            <div className="form-group">
              <label className="label">Wicket Type</label>
              <select className="select" value={pendingWicketType} onChange={e=>setPendingWicketType(e.target.value)}>
                {WICKET_TYPES.map(w=><option key={w} value={w}>{w.charAt(0).toUpperCase()+w.slice(1)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Dismissed End</label>
              <select className="select" value={pendingDismissedEnd} onChange={e=>setPendingDismissedEnd(e.target.value)}>
                <option value="striker">Striker — {striker?.name||'N/A'}</option>
                <option value="non-striker">Non-Striker — {nonStriker?.name||'N/A'}</option>
              </select>
            </div>
            <div className="form-group" style={{marginBottom:20}}>
              <label className="label">Incoming Batsman</label>
              <select className="select" value={pendingIncoming} onChange={e=>setPendingIncoming(e.target.value)}>
                <option value="">Select incoming batsman</option>
                {availableBatsmen.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <button className="btn btn-danger btn-full" onClick={handleWicketFlow}>Confirm Wicket</button>
          </div>
        </div>
      )}

      {/* ══ BOWLER SHEET ══ */}
      {showBowlerModal&&(
        <div className="bottomsheet-overlay" onClick={()=>setShowBowlerModal(false)}>
          <div className="bottomsheet" onClick={e=>e.stopPropagation()}>
            <div className="bottomsheet-handle"/>
            <div className="bottomsheet-title">Select Bowler</div>
            <div style={{fontSize:'0.78rem',color:'var(--t3)',marginBottom:14}}>Bowlers &amp; all-rounders shown. Previous over bowler excluded.</div>
            <div className="form-group" style={{marginBottom:20}}>
              <label className="label">Bowler for this Over</label>
              <select className="select" value={selectedBowler} onChange={e=>setSelectedBowler(e.target.value)}>
                <option value="">Select bowler</option>
                {availableBowlers.map(p=><option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-full" onClick={setBowlerForOver}>Confirm Bowler</button>
          </div>
        </div>
      )}

      {/* ══ INNINGS INIT SHEET ══ */}
      {showInningsInit&&currentInnings&&(
        <div className="bottomsheet-overlay">
          <div className="bottomsheet" onClick={e=>e.stopPropagation()}>
            <div className="bottomsheet-handle"/>
            <div className="bottomsheet-title">Set Opening Players</div>
            <div style={{fontSize:'0.78rem',color:'var(--t3)',marginBottom:14}}>Select striker, non-striker and opening bowler to begin this innings.</div>
            <div className="form-group">
              <label className="label">Striker</label>
              <select className="select" value={inningsInitCfg.striker_id} onChange={e=>setInningsInitCfg(p=>({...p,striker_id:e.target.value}))}>
                <option value="">Select striker</option>
                {battingPlayers.filter(p=>p.id!==+inningsInitCfg.non_striker_id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Non-Striker</label>
              <select className="select" value={inningsInitCfg.non_striker_id} onChange={e=>setInningsInitCfg(p=>({...p,non_striker_id:e.target.value}))}>
                <option value="">Select non-striker</option>
                {battingPlayers.filter(p=>p.id!==+inningsInitCfg.striker_id).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="form-group" style={{marginBottom:20}}>
              <label className="label">Opening Bowler</label>
              <select className="select" value={inningsInitCfg.bowler_id} onChange={e=>setInningsInitCfg(p=>({...p,bowler_id:e.target.value}))}>
                <option value="">Select bowler</option>
                {bowlingPlayers.map(p=><option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-full" onClick={initInnings}>Start Innings →</button>
          </div>
        </div>
      )}

      <div style={{height:16}}/>
    </div>
  )
}
