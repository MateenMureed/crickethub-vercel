import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  generateResultBannerForMatch,
  generateSummaryBannerForMatch,
} from '../components/GraphicsGeneratorPanel'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()
const API_FALLBACK = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_FALLBACK_URL || '').replace(/\/$/, '')
  if (!raw) return ''
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()
const WICKET_TYPES = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired out']

function buildApiUrls(path) {
  const cleanPath = String(path || '').startsWith('/') ? path : `/${path}`
  const primary = `${API}${cleanPath}`
  const urls = [primary]
  if (API_FALLBACK && API_FALLBACK !== API) {
    urls.push(`${API_FALLBACK}${cleanPath}`)
  }
  return [...new Set(urls)]
}

async function apiJson(path, options) {
  let lastErr = null
  const urls = buildApiUrls(path)

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], options)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      lastErr = err
    }
  }

  throw lastErr || new Error('Request failed')
}

async function apiCall(path, options) {
  let lastErr = null
  const urls = buildApiUrls(path)

  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetch(urls[i], options)
      if (res.ok) return res

      if (res.status >= 500 && i < urls.length - 1) {
        continue
      }

      return res
    } catch (err) {
      lastErr = err
    }
  }

  throw lastErr || new Error('Request failed')
}

const IcoBat = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="21" x2="15" y2="9" /><path d="M15 9l4-4 2 2-4 4" /></svg>
const IcoBall = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 016.36 15.36M5.64 5.64A9 9 0 0112 3" /></svg>
const IcoHist = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 15" /></svg>

const css = `
  .ls-root { min-height: 100vh; background: var(--bg); }
  .ls-shell {
    min-height: 100vh;
    max-width: 480px;
    margin: 0 auto;
    border-left: 1px solid var(--glass-bd);
    border-right: 1px solid var(--glass-bd);
    background:
      radial-gradient(140% 65% at 12% -12%, rgba(0, 232, 150, 0.12), transparent 55%),
      radial-gradient(120% 56% at 88% -12%, rgba(64, 196, 255, 0.10), transparent 54%),
      linear-gradient(180deg, var(--bg) 0%, var(--bg-1) 56%, var(--bg) 100%);
  }

  .ls-topbar {
    background: var(--nav-bg);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-bottom: 2px solid var(--accent);
    height: 48px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    gap: 8px;
    position: sticky;
    top: 0;
    z-index: 200;
  }
  .ls-back-btn {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid var(--glass-bd);
    background: var(--glass-bg);
    color: var(--t1);
    font-size: 1rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .ls-brand {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 0.82rem;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    background: var(--g-accent);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    flex-shrink: 0;
  }
  .ls-match-info {
    font-family: var(--font-display);
    font-size: 0.64rem;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--t3);
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .ls-live-pill {
    background: var(--red-dim);
    color: var(--red);
    border: 1px solid rgba(255, 77, 109, 0.28);
    font-family: var(--font-display);
    font-size: 0.56rem;
    font-weight: 700;
    letter-spacing: 1.5px;
    padding: 2px 8px;
    border-radius: 4px;
    animation: livePulse 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }

  .ls-page {
    display: grid;
    grid-template-columns: 1fr;
    height: auto;
    overflow: hidden;
    padding-bottom: 74px;
  }

  .ls-left {
    background: var(--bg-1);
    border-bottom: 1px solid var(--glass-bd);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .ls-left::-webkit-scrollbar { width: 3px; }
  .ls-left::-webkit-scrollbar-thumb { background: var(--glass-bd); border-radius: 2px; }

  .ls-sb {
    padding: 14px;
    border-bottom: 2px solid var(--accent);
    background: var(--glass-bg);
    flex-shrink: 0;
  }
  .ls-sb-tag { font-family: var(--font-display); font-size: 0.58rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--t3); margin-bottom: 2px; }
  .ls-sb-team { font-family: var(--font-display); font-size: 0.9rem; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; color: var(--t1); margin-bottom: 8px; }
  .ls-sb-score-row { display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
  .ls-sb-runs { font-family: var(--font-mono); font-size: 2.3rem; font-weight: 700; color: var(--gold); line-height: 1; text-shadow: 0 0 24px rgba(247, 201, 72, 0.25); }
  .ls-sb-sep { font-family: var(--font-mono); font-size: 1.7rem; color: var(--t4); }
  .ls-sb-wkts { font-family: var(--font-mono); font-size: 2.3rem; font-weight: 700; color: var(--gold); line-height: 1; }
  .ls-sb-overs { font-family: var(--font-display); font-size: 0.72rem; color: var(--t3); letter-spacing: 1px; margin-left: 4px; }
  .ls-sb-target { font-family: var(--font-display); font-size: 0.68rem; font-weight: 700; color: var(--sky); letter-spacing: 0.9px; text-transform: uppercase; margin-top: 6px; }

  .ls-over-strip {
    background: var(--glass-bg);
    border-bottom: 1px solid var(--glass-bd);
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .ls-over-lbl { font-family: var(--font-display); font-size: 0.56rem; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
  .ls-balls-row { display: flex; gap: 4px; flex-wrap: wrap; }

  .ls-ball {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 0.75rem;
    border: 2px solid transparent;
    transition: transform .12s;
    cursor: default;
    flex-shrink: 0;
  }
  .ls-b-dot { background: var(--glass-bg); border-color: var(--glass-bd); color: var(--t3); }
  .ls-b-1 { background: var(--sky-dim); border-color: var(--sky); color: var(--sky); }
  .ls-b-2 { background: rgba(64, 196, 255, 0.08); border-color: rgba(64, 196, 255, 0.5); color: var(--sky); }
  .ls-b-3 { background: rgba(64, 196, 255, 0.06); border-color: rgba(64, 196, 255, 0.35); color: var(--sky); }
  .ls-b-4 { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
  .ls-b-6 { background: var(--gold-dim); border-color: var(--gold); color: var(--gold); }
  .ls-b-W { background: var(--red-dim); border-color: var(--red); color: var(--red); }
  .ls-b-Wd { background: rgba(255, 140, 66, 0.1); border-color: var(--orange); color: var(--orange); }
  .ls-b-Nb { background: rgba(255, 140, 66, 0.08); border-color: rgba(255, 140, 66, 0.45); color: var(--orange); }

  .ls-scoring { padding: 12px; flex-shrink: 0; }
  .ls-sec-lbl { font-family: var(--font-display); font-size: 0.56rem; font-weight: 700; letter-spacing: 2.2px; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; gap: 5px; }

  .ls-run-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin-bottom: 10px; }
  .ls-run-btn {
    aspect-ratio: 1;
    border-radius: var(--r-md);
    border: 2px solid transparent;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 1.05rem;
    cursor: pointer;
    transition: all .13s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ls-run-btn:active { transform: scale(.88); }
  .ls-r0 { background: var(--glass-bg); border-color: var(--glass-bd); color: var(--t3); }
  .ls-r0:hover { background: var(--glass-bg-h); border-color: var(--t2); }
  .ls-r1 { background: var(--sky-dim); border-color: var(--sky); color: var(--sky); }
  .ls-r1:hover { background: rgba(64, 196, 255, 0.2); }
  .ls-r2 { background: rgba(64, 196, 255, 0.07); border-color: rgba(64, 196, 255, 0.45); color: var(--sky); }
  .ls-r2:hover { background: rgba(64, 196, 255, 0.18); }
  .ls-r3 { background: rgba(64, 196, 255, 0.05); border-color: rgba(64, 196, 255, 0.3); color: var(--sky); }
  .ls-r3:hover { background: rgba(64, 196, 255, 0.15); }
  .ls-r4 { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
  .ls-r4:hover { background: rgba(0, 232, 150, 0.2); box-shadow: 0 0 12px var(--accent-glow); }
  .ls-r6 { background: var(--gold-dim); border-color: var(--gold); color: var(--gold); }
  .ls-r6:hover { background: rgba(247, 201, 72, 0.25); box-shadow: 0 0 12px rgba(247, 201, 72, 0.3); }

  .ls-extras-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-bottom: 10px; }
  .ls-ext-btn {
    padding: 8px 4px;
    border-radius: var(--r-md);
    border: 1px solid rgba(255, 140, 66, 0.35);
    background: rgba(255, 140, 66, 0.07);
    font-family: var(--font-display);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 1.3px;
    text-transform: uppercase;
    color: var(--orange);
    cursor: pointer;
    transition: all .13s;
    text-align: center;
  }
  .ls-ext-btn:hover { background: rgba(255, 140, 66, 0.18); border-color: var(--orange); }
  .ls-ext-btn:active { transform: scale(.95); }

  .ls-wicket-btn {
    width: 100%;
    padding: 11px;
    border-radius: var(--r-md);
    border: 2px solid var(--red);
    background: var(--red-dim);
    font-family: var(--font-display);
    font-size: 0.8rem;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--red);
    cursor: pointer;
    transition: all .13s;
  }
  .ls-wicket-btn:hover { background: rgba(255, 77, 109, 0.2); box-shadow: 0 0 16px rgba(255, 77, 109, 0.25); }
  .ls-wicket-btn:active { transform: scale(.97); }

  .ls-divider { height: 1px; background: var(--glass-bd); margin: 10px 0; }

  .ls-right { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .ls-right::-webkit-scrollbar { width: 3px; }
  .ls-right::-webkit-scrollbar-thumb { background: var(--glass-bd); border-radius: 2px; }

  .ls-card { background: var(--card-bg); backdrop-filter: var(--glass-blur); border: 1px solid var(--glass-bd); border-radius: var(--r-lg); overflow: hidden; flex-shrink: 0; }
  .ls-card-head {
    background: var(--accent-dim);
    border-bottom: 1px solid var(--glass-bd);
    padding: 7px 12px;
    font-family: var(--font-display);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 2.2px;
    text-transform: uppercase;
    color: var(--accent);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ls-tbl { width: 100%; border-collapse: collapse; }
  .ls-tbl thead tr { background: var(--glass-bg); border-bottom: 1px solid var(--glass-bd); }
  .ls-tbl thead th { font-family: var(--font-display); font-size: 0.54rem; font-weight: 700; letter-spacing: 1.3px; text-transform: uppercase; color: var(--t3); padding: 6px 8px; text-align: center; }
  .ls-tbl thead th:first-child { text-align: left; padding-left: 12px; }
  .ls-tbl tbody tr { border-bottom: 1px solid var(--glass-bd); }
  .ls-tbl tbody tr:last-child { border-bottom: none; }
  .ls-tbl tbody td { font-family: var(--font-mono); font-size: 0.82rem; font-weight: 600; padding: 7px 8px; text-align: center; color: var(--t1); }
  .ls-tbl tbody td:first-child { text-align: left; padding-left: 12px; font-family: var(--font-body); font-weight: 500; font-size: 0.74rem; }
  .ls-td-runs { color: var(--gold) !important; font-size: .92rem !important; }
  .ls-td-wkts { color: var(--red) !important; }
  .ls-td-hl { color: var(--gold) !important; }
  .ls-td-empty { text-align: center !important; color: var(--t3) !important; padding: 12px !important; font-size: .72rem !important; }
  .ls-striker-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-right: 4px; vertical-align: middle; box-shadow: 0 0 6px var(--accent); animation: livePulse 1s ease-in-out infinite; }

  .ls-ball-row { display: flex; gap: 5px; flex-wrap: wrap; padding: 10px 12px 12px; }

  .ls-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--glass-bd);
    background: var(--glass-bg);
  }
  .ls-metric {
    border: 1px solid var(--glass-bd);
    border-radius: 10px;
    padding: 7px 6px;
    text-align: center;
    background: rgba(255, 255, 255, 0.02);
  }
  .ls-metric-k {
    font-family: var(--font-display);
    font-size: 0.52rem;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--t3);
    margin-bottom: 3px;
  }
  .ls-metric-v {
    font-family: var(--font-mono);
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--gold);
  }

  .ls-action-dock {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 10px;
    width: min(460px, calc(100vw - 16px));
    z-index: 260;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 8px;
    border-radius: 16px;
    background: rgba(6, 13, 25, 0.92);
    border: 1px solid var(--glass-bd);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }

  .ls-data-error {
    margin: 8px 10px;
    border: 1px solid rgba(255, 77, 109, 0.3);
    background: var(--red-dim);
    border-radius: 10px;
    padding: 9px 10px;
    color: var(--red);
    font-size: 0.74rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .ls-start-wrap { max-width: 640px; margin: 0 auto; padding: 18px 12px; }
  .ls-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  .ls-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    animation: fadeIn 0.18s var(--ease);
  }
  .ls-modal {
    background: var(--bg-1);
    border: 1px solid var(--glass-bd);
    border-top: 3px solid var(--accent);
    border-radius: var(--r-xl);
    width: 100%;
    max-width: 420px;
    box-shadow: var(--sh-lg);
    overflow: hidden;
    animation: slideUp 0.22s var(--ease);
  }
  .ls-modal-head { background: var(--accent-dim); border-bottom: 1px solid var(--glass-bd); padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; }
  .ls-modal-title { font-family: var(--font-display); font-size: 0.82rem; font-weight: 800; letter-spacing: 1.8px; text-transform: uppercase; color: var(--accent); }
  .ls-modal-x { background: none; border: none; cursor: pointer; color: var(--t3); font-size: 1.3rem; line-height: 1; transition: color .15s; }
  .ls-modal-x:hover { color: var(--red); }
  .ls-modal-body { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .ls-modal-foot { border-top: 1px solid var(--glass-bd); padding: 10px 16px; display: flex; justify-content: flex-end; gap: 8px; }
  .ls-modal-note { font-size: .72rem; color: var(--t2); line-height: 1.45; background: var(--glass-bg); padding: 8px 10px; border-radius: var(--r-md); border: 1px solid var(--glass-bd); }

  .ls-flabel { display: block; font-family: var(--font-display); font-size: .58rem; font-weight: 700; letter-spacing: 1.4px; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
  .ls-fselect {
    width: 100%;
    padding: 8px 30px 8px 10px;
    background: var(--inp-bg);
    border: 1px solid var(--inp-bd);
    border-radius: var(--r-md);
    color: var(--t1);
    font-family: var(--font-body);
    font-size: .8rem;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7' viewBox='0 0 11 7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' stroke='%2300e896' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 11px center;
    transition: border-color .15s;
  }
  .ls-fselect:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
  .ls-fselect option { background: var(--bg-2); }

  .ls-btn-primary {
    padding: 8px 16px;
    border-radius: var(--r-md);
    background: var(--g-accent);
    border: none;
    font-family: var(--font-display);
    font-size: .72rem;
    font-weight: 700;
    letter-spacing: 1.3px;
    text-transform: uppercase;
    color: #fff;
    cursor: pointer;
    transition: all .13s;
    box-shadow: var(--sh-acc);
  }
  .ls-btn-primary:hover { filter: brightness(1.1); transform: translateY(-1px); }

  .ls-btn-danger {
    padding: 8px 16px;
    border-radius: var(--r-md);
    background: var(--g-red);
    border: none;
    font-family: var(--font-display);
    font-size: .72rem;
    font-weight: 700;
    letter-spacing: 1.3px;
    text-transform: uppercase;
    color: #fff;
    cursor: pointer;
    transition: all .13s;
  }
  .ls-btn-danger:hover { filter: brightness(1.1); transform: translateY(-1px); }

  .ls-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    font-family: var(--font-display);
    font-size: .8rem;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--t3);
  }
  .ls-spinner {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 3px solid var(--glass-bd);
    border-top-color: var(--accent);
    animation: spin .8s linear infinite;
    margin-right: 10px;
  }

  @media (max-width: 860px) {
    .ls-page {
      overflow: visible;
      padding-bottom: 80px;
    }
    .ls-left { overflow: visible; }
    .ls-right { overflow: visible; }
    .ls-match-info { display: none; }
  }
  @media (max-width: 480px) {
    .ls-root { padding-bottom: 6px; }
    .ls-shell { border-left: none; border-right: none; }
    .ls-topbar { padding: 0 10px; gap: 6px; }
    .ls-sb { padding: 10px 12px; }
    .ls-sb-runs, .ls-sb-wkts { font-size: 2rem; }
    .ls-over-strip { padding: 8px 10px; }
    .ls-scoring { padding: 10px; }
    .ls-run-grid { gap: 5px; }
    .ls-run-btn { font-size: 0.92rem; }
    .ls-right { padding: 9px; gap: 9px; }
    .ls-metrics { grid-template-columns: 1fr 1fr 1fr; padding: 7px 8px; gap: 5px; }
    .ls-metric-v { font-size: 0.85rem; }
    .ls-ball { width: 26px; height: 26px; font-size: .68rem; }
    .ls-form-row { grid-template-columns: 1fr; }
    .ls-overlay { padding: 10px; align-items: center; justify-content: center; }
    .ls-modal { border-bottom-left-radius: var(--r-xl); border-bottom-right-radius: var(--r-xl); max-width: 420px; }
    .ls-action-dock { width: calc(100vw - 12px); bottom: 8px; padding: 7px; gap: 7px; border-radius: 14px; }
  }
`

export default function LiveScoring() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const touchStartYRef = useRef(null)
  const pullTriggeredRef = useRef(false)
  const bowlerPromptRef = useRef({ overKey: '', suppressedUntil: 0 })

  const [match, setMatch] = useState(null)
  const [currentInnings, setCurrentInnings] = useState(null)
  const [scorecard, setScorecard] = useState([])
  const [balls, setBalls] = useState([])
  const [battingPlayers, setBattingPlayers] = useState([])
  const [bowlingPlayers, setBowlingPlayers] = useState([])
  const [teamAPlayers, setTeamAPlayers] = useState([])
  const [teamBPlayers, setTeamBPlayers] = useState([])
  const [teamSquadsById, setTeamSquadsById] = useState({})

  const [startConfig, setStartConfig] = useState({ batting_team_id: '', bowling_team_id: '', striker_id: '', non_striker_id: '', bowler_id: '' })
  const [showWicketModal, setShowWicketModal] = useState(false)
  const [pendingWicketType, setPendingWicketType] = useState('bowled')
  const [pendingDismissedEnd, setPendingDismissedEnd] = useState('striker')
  const [pendingIncomingBatsman, setPendingIncomingBatsman] = useState('')
  const [showBowlerModal, setShowBowlerModal] = useState(false)
  const [selectedBowler, setSelectedBowler] = useState('')
  const [showInningsInitModal, setShowInningsInitModal] = useState(false)
  const [inningsInitConfig, setInningsInitConfig] = useState({ striker_id: '', non_striker_id: '', bowler_id: '' })
  const [dataError, setDataError] = useState('')
  const [isPullRefreshing, setIsPullRefreshing] = useState(false)

  const fetchTeamPlayers = async (teamId) => {
    if (!teamId || Number.isNaN(teamId)) return []
    const direct = await apiJson(`/teams/${teamId}/players`).catch(() => [])
    if (Array.isArray(direct)) return direct
    const tp = await apiJson(`/teams/${teamId}`).catch(() => null)
    return tp?.players || []
  }

  const loadMatch = async () => {
    const m = await apiJson(`/matches/${matchId}`).catch(() => null)
    if (!m) {
      setDataError('Could not load live match data. Check backend and retry.')
      return
    }
    setDataError('')
    setMatch(m)
    const [sA, sB] = await Promise.all([fetchTeamPlayers(m.team_a_id), fetchTeamPlayers(m.team_b_id)])
    setTeamAPlayers(sA)
    setTeamBPlayers(sB)
    setTeamSquadsById(p => ({ ...p, [m.team_a_id]: sA, [m.team_b_id]: sB }))
    const sc = await apiJson(`/matches/${matchId}/scorecard`).catch(() => [])
    setScorecard(sc)
    const active = m.innings?.find(i => !i.is_completed) || null
    setCurrentInnings(active)
    if (!active) {
      setBalls([])
      return
    }
    const [bat, bowl, be] = await Promise.all([
      fetchTeamPlayers(active.batting_team_id),
      fetchTeamPlayers(active.bowling_team_id),
      apiJson(`/innings/${active.id}/balls`).catch(() => [])
    ])
    setBattingPlayers(bat)
    setBowlingPlayers(bowl)
    setBalls(be)
    if (!active.striker_id || !active.non_striker_id) {
      setShowInningsInitModal(true)
      setShowBowlerModal(false)
      return
    }
    if (!active.current_bowler_id) {
      const overKey = `${active.id}_${Math.floor((active.total_balls || 0) / 6)}`
      const now = Date.now()
      const isSuppressed = now < Number(bowlerPromptRef.current.suppressedUntil || 0)
      const alreadyPromptedThisOver = bowlerPromptRef.current.overKey === overKey
      if (!showBowlerModal && !isSuppressed && !alreadyPromptedThisOver) {
        bowlerPromptRef.current.overKey = overKey
        setSelectedBowler('')
        setShowBowlerModal(true)
      }
    }
  }

  useEffect(() => { loadMatch() }, [matchId])
  useEffect(() => {
    const id = setInterval(loadMatch, 1000)
    return () => clearInterval(id)
  }, [matchId])

  const onTouchStartPull = (e) => {
    if (window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) {
      touchStartYRef.current = null
      return
    }
    touchStartYRef.current = e.touches?.[0]?.clientY ?? null
    pullTriggeredRef.current = false
  }

  const onTouchMovePull = async (e) => {
    if (isPullRefreshing || pullTriggeredRef.current || touchStartYRef.current == null) return
    const currentY = e.touches?.[0]?.clientY
    if (typeof currentY !== 'number') return
    const delta = currentY - touchStartYRef.current
    if (delta < 80) return

    pullTriggeredRef.current = true
    setIsPullRefreshing(true)
    try {
      await loadMatch()
    } finally {
      setIsPullRefreshing(false)
    }
  }

  const onTouchEndPull = () => {
    touchStartYRef.current = null
    pullTriggeredRef.current = false
  }

  const loadTeamPlayersForSelection = async (teamId) => {
    if (!teamId || Number.isNaN(teamId)) return []
    if (teamSquadsById[teamId]?.length) return teamSquadsById[teamId]
    const players = await fetchTeamPlayers(teamId)
    setTeamSquadsById(p => ({ ...p, [teamId]: players }))
    return players
  }

  const startBattingTeamId = parseInt(startConfig.batting_team_id || '0', 10)
  const startBowlingTeamId = parseInt(startConfig.bowling_team_id || '0', 10)
  const startBattingPlayers = teamSquadsById[startBattingTeamId] || []
  const startBowlingPlayers = teamSquadsById[startBowlingTeamId] || []
  const startBowlerOptions = startBowlingPlayers.filter((p) => ['bowler', 'all-rounder', 'all rounder', 'wicket-keeper'].includes((p.role || '').toLowerCase()))

  useEffect(() => {
    if (startBattingTeamId > 0) loadTeamPlayersForSelection(startBattingTeamId)
    if (startBowlingTeamId > 0) loadTeamPlayersForSelection(startBowlingTeamId)
  }, [startBattingTeamId, startBowlingTeamId])

  useEffect(() => {
    if (!startBattingTeamId) return
    setStartConfig((prev) => {
      if (!prev.bowling_team_id || Number(prev.bowling_team_id) === startBattingTeamId) {
        const opposite = startBattingTeamId === Number(match?.team_a_id) ? Number(match?.team_b_id) : Number(match?.team_a_id)
        return { ...prev, bowling_team_id: String(opposite || '') }
      }
      return prev
    })
  }, [startBattingTeamId, match?.team_a_id, match?.team_b_id])

  useEffect(() => {
    if (!startBattingPlayers.length) return
    setStartConfig((prev) => {
      const strikerValid = startBattingPlayers.some((p) => String(p.id) === String(prev.striker_id))
      const nonStrikerValid = startBattingPlayers.some((p) => String(p.id) === String(prev.non_striker_id))

      const next = { ...prev }
      if (!strikerValid) next.striker_id = String(startBattingPlayers[0]?.id || '')

      const defaultNon = startBattingPlayers.find((p) => String(p.id) !== String(next.striker_id))
      if (!nonStrikerValid || String(next.non_striker_id) === String(next.striker_id)) {
        next.non_striker_id = String(defaultNon?.id || '')
      }
      return next
    })
  }, [startBattingPlayers])

  useEffect(() => {
    if (!startBowlingPlayers.length) return
    setStartConfig((prev) => {
      const bowlerValid = startBowlingPlayers.some((p) => String(p.id) === String(prev.bowler_id))
      if (bowlerValid) return prev
      const opening = startBowlingPlayers.find((p) => ['bowler', 'all-rounder', 'all rounder'].includes((p.role || '').toLowerCase())) || startBowlingPlayers[0]
      return { ...prev, bowler_id: String(opening?.id || '') }
    })
  }, [startBowlingPlayers])

  const startInnings = async (e) => {
    e.preventDefault()
    const { batting_team_id, bowling_team_id, striker_id, non_striker_id, bowler_id } = startConfig
    if (!batting_team_id || !bowling_team_id || !striker_id || !non_striker_id || !bowler_id) {
      alert('Select teams, striker, non-striker, and opening bowler')
      return
    }
    if (String(striker_id) === String(non_striker_id)) {
      alert('Striker and non-striker must be different players')
      return
    }
    const battingPlayersForStart = await loadTeamPlayersForSelection(parseInt(batting_team_id, 10))
    const bowlingPlayersForStart = await loadTeamPlayersForSelection(parseInt(bowling_team_id, 10))
    const striker = battingPlayersForStart.find((p) => String(p.id) === String(striker_id))
    const nonStriker = battingPlayersForStart.find((p) => String(p.id) === String(non_striker_id))
    const openingBowler = bowlingPlayersForStart.find((p) => String(p.id) === String(bowler_id))
    if (!striker || !nonStriker || !openingBowler) {
      alert('Selected players are not available in team squads')
      return
    }
    const res = await apiCall(`/matches/${matchId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batting_team_id: parseInt(batting_team_id, 10),
        bowling_team_id: parseInt(bowling_team_id, 10),
        striker_id: striker.id,
        non_striker_id: nonStriker.id,
        bowler_id: openingBowler.id
      })
    })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error || 'Failed')
      return
    }
    await loadMatch()
  }

  const initInnings = async () => {
    const { striker_id, non_striker_id, bowler_id } = inningsInitConfig
    if (!striker_id || !non_striker_id || !bowler_id) {
      alert('Select all players')
      return
    }
    const res = await apiCall(`/innings/${currentInnings.id}/initialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        striker_id: parseInt(striker_id, 10),
        non_striker_id: parseInt(non_striker_id, 10),
        bowler_id: parseInt(bowler_id, 10)
      })
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to initialize innings')
      return
    }
    setShowInningsInitModal(false)
    await loadMatch()
  }

  const setBowlerForOver = async () => {
    if (!selectedBowler) {
      alert('Select a bowler')
      return
    }
    const res = await apiCall(`/innings/${currentInnings.id}/select-bowler`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bowler_id: parseInt(selectedBowler, 10) })
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to set bowler')
      return
    }
    bowlerPromptRef.current.suppressedUntil = Date.now() + 5000
    setShowBowlerModal(false)
    setSelectedBowler('')
    await loadMatch()
  }

  const submitBall = async (ballData) => {
    if (!currentInnings) return
    const res = await apiCall(`/innings/${currentInnings.id}/ball`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ballData)
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to record ball')
      return
    }
    await loadMatch()
  }

  const handleWicketFlow = async () => {
    const dismissedId = pendingDismissedEnd === 'striker' ? striker?.id : nonStriker?.id
    await submitBall({
      runs_scored: 0,
      is_wicket: true,
      wicket_type: pendingWicketType,
      dismissed_player_id: dismissedId,
      dismissed_end: pendingDismissedEnd,
      incoming_batsman_id: pendingIncomingBatsman ? parseInt(pendingIncomingBatsman, 10) : undefined
    })
    setShowWicketModal(false)
    setPendingIncomingBatsman('')
    await loadMatch()
  }

  const undoLastBall = async () => {
    if (!currentInnings || balls.length === 0) return
    const ok = confirm('Undo the last recorded ball?')
    if (!ok) return
    const res = await apiCall(`/innings/${currentInnings.id}/ball/last`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert(d.error || 'Failed to undo last ball')
      return
    }
    await loadMatch()
  }

  const endMatch = async () => {
    if (!confirm('End match and finalize result?')) return
    const winner = prompt('Enter winner team name (leave blank for tie):')
    const resultSummary = prompt('Result summary:')
    await apiCall(`/matches/${matchId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_name: winner || '', result_summary: resultSummary || '' })
    })
    try {
      const [mRes, scRes] = await Promise.all([
        apiCall(`/matches/${matchId}`),
        apiCall(`/matches/${matchId}/scorecard`),
      ])
      const fullMatch = mRes.ok ? await mRes.json() : null
      const score = scRes.ok ? await scRes.json() : []
      if (fullMatch) {
        await generateSummaryBannerForMatch(fullMatch, score, { id: fullMatch.league_id, name: fullMatch.league_name, season: fullMatch.season }, { download: false })
        await generateResultBannerForMatch(fullMatch, score, { download: false })
      }
    } catch (_) {
      // Continue to scorecard even if banner generation fails.
    }
    navigate(`/match/${matchId}/scorecard?banner=summary`)
  }

  const fmtOvers = b => !b ? '0.0' : `${Math.floor(b / 6)}.${b % 6}`
  const sr = (r, b) => b > 0 ? ((r / b) * 100).toFixed(0) : '0'
  const eco = (r, b) => b > 0 ? (r / (b / 6)).toFixed(2) : '0.00'

  const ballCls = (b) => {
    if (!b) return 'ls-b-dot'
    if (b.is_wicket) return 'ls-b-W'
    if (b.extras_type === 'wide') return 'ls-b-Wd'
    if (b.extras_type === 'noball') return 'ls-b-Nb'
    if (b.runs_scored === 6) return 'ls-b-6'
    if (b.runs_scored === 4) return 'ls-b-4'
    if (b.runs_scored === 3) return 'ls-b-3'
    if (b.runs_scored === 2) return 'ls-b-2'
    if (b.runs_scored === 1) return 'ls-b-1'
    return 'ls-b-dot'
  }

  const ballLbl = (b) => {
    if (!b) return ''
    if (b.is_wicket) return 'W'
    if (b.extras_type === 'wide') return 'Wd'
    if (b.extras_type === 'noball') return 'Nb'
    return String(b.runs_scored)
  }

  const activeInnings = useMemo(() => scorecard.find(s => s.id === currentInnings?.id), [scorecard, currentInnings])
  const striker = useMemo(() => battingPlayers.find(p => p.id === currentInnings?.striker_id), [battingPlayers, currentInnings])
  const nonStriker = useMemo(() => battingPlayers.find(p => p.id === currentInnings?.non_striker_id), [battingPlayers, currentInnings])
  const strikerStats = useMemo(() => activeInnings?.batting?.find(b => b.player_id === striker?.id), [activeInnings, striker])
  const nonStrkStats = useMemo(() => activeInnings?.batting?.find(b => b.player_id === nonStriker?.id), [activeInnings, nonStriker])
  const bowlerStats = useMemo(() => {
    const bowlerId = currentInnings?.current_bowler_id
    return bowlerId ? activeInnings?.bowling?.find(b => b.player_id === bowlerId) : null
  }, [activeInnings, currentInnings])

  const currentOverBalls = useMemo(() => balls.length
    ? balls.filter(b => b.over_number === balls[balls.length - 1].over_number).slice(-6)
    : [], [balls])
  const overSlots = useMemo(() => Array.from({ length: 6 }, (_, i) => currentOverBalls[i] || null), [currentOverBalls])
  const overNum = Math.floor((activeInnings?.total_balls || 0) / 6)

  const firstInn = match?.innings?.find(i => i.innings_number === 1)
  const isSecond = activeInnings?.innings_number === 2
  const target = isSecond && firstInn ? firstInn.total_runs + 1 : null
  const ballsLeft = isSecond ? (match?.overs_per_innings || 20) * 6 - (activeInnings?.total_balls || 0) : null
  const runsNeeded = target ? target - (activeInnings?.total_runs || 0) : null
  const currentRR = activeInnings?.total_balls > 0 ? ((activeInnings.total_runs / activeInnings.total_balls) * 6).toFixed(2) : '0.00'
  const rrr = runsNeeded && ballsLeft > 0 ? ((runsNeeded / ballsLeft) * 6).toFixed(2) : null

  const availableBatsmen = useMemo(() => {
    const outIds = new Set(
      (activeInnings?.batting || [])
        .filter((b) => b.is_out || b.dismissal_type || b.out_over != null)
        .map((b) => b.player_id)
    )
    balls.forEach((b) => {
      if (b?.is_wicket && b?.dismissed_player_id) outIds.add(b.dismissed_player_id)
    })
    const strikerId = currentInnings?.striker_id
    const nonStrikerId = currentInnings?.non_striker_id
    return battingPlayers.filter((p) => p.id !== strikerId && p.id !== nonStrikerId && !outIds.has(p.id))
  }, [battingPlayers, activeInnings, currentInnings, balls])

  const availableBowlers = useMemo(() => {
    const lastOverBowlerId = currentInnings?.last_over_bowler_id || null
    const specialist = bowlingPlayers.filter((p) => ['bowler', 'all-rounder', 'all rounder'].includes((p.role || '').toLowerCase()))
    const pool = specialist.length > 0 ? specialist : bowlingPlayers
    return pool.filter((p) => p.id !== lastOverBowlerId)
  }, [bowlingPlayers, currentInnings])

  if (!match) {
    return (
      <div className="ls-root">
        <style>{css}</style>
        <div className="ls-shell">
          <div className="ls-loading"><div className="ls-spinner" />Loading match...</div>
        </div>
      </div>
    )
  }

  if (!match.innings || match.innings.length === 0) {
    return (
      <div className="ls-root">
        <style>{css}</style>
        <div className="ls-shell">
          <div className="ls-topbar">
            <button className="ls-back-btn" onClick={() => navigate('/admin')} aria-label="Back">‹</button>
            <span className="ls-brand">Scoring</span>
            <span className="ls-match-info">{match.team_a_name} vs {match.team_b_name}</span>
          </div>
          {dataError && (
            <div className="ls-data-error">
              <span>{dataError}</span>
              <button className="btn btn-sm btn-secondary" onClick={loadMatch}>Retry</button>
            </div>
          )}
          <div className="ls-start-wrap">
            <div className="glass-card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--glass-bd)', background: 'var(--accent-dim)' }}>
                <h3 style={{ color: 'var(--accent)', fontFamily: 'var(--font-display)', fontSize: '.92rem', letterSpacing: 1, textTransform: 'uppercase' }}>Start Match</h3>
                <p style={{ color: 'var(--t2)', fontSize: '.76rem', marginTop: 3 }}>{match.team_a_name} vs {match.team_b_name}</p>
              </div>
              <form onSubmit={startInnings}>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="ls-form-row">
                    <div className="form-group">
                      <label className="form-label">Batting Team</label>
                      <select className="form-select" value={startConfig.batting_team_id} onChange={e => setStartConfig(p => ({ ...p, batting_team_id: e.target.value }))}>
                        <option value="">Select team</option>
                        <option value={match.team_a_id}>{match.team_a_name}</option>
                        <option value={match.team_b_id}>{match.team_b_name}</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Bowling Team</label>
                      <select className="form-select" value={startConfig.bowling_team_id} onChange={e => setStartConfig(p => ({ ...p, bowling_team_id: e.target.value }))}>
                        <option value="">Select team</option>
                        <option value={match.team_a_id}>{match.team_a_name}</option>
                        <option value={match.team_b_id}>{match.team_b_name}</option>
                      </select>
                    </div>
                  </div>

                  <div className="ls-form-row">
                    <div className="form-group">
                      <label className="form-label">Striker</label>
                      <select className="form-select" value={startConfig.striker_id} onChange={e => setStartConfig(p => ({ ...p, striker_id: e.target.value }))}>
                        <option value="">Select striker</option>
                        {startBattingPlayers
                          .filter((p) => String(p.id) !== String(startConfig.non_striker_id || ''))
                          .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Non-Striker</label>
                      <select className="form-select" value={startConfig.non_striker_id} onChange={e => setStartConfig(p => ({ ...p, non_striker_id: e.target.value }))}>
                        <option value="">Select non-striker</option>
                        {startBattingPlayers
                          .filter((p) => String(p.id) !== String(startConfig.striker_id || ''))
                          .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Opening Bowler</label>
                    <select className="form-select" value={startConfig.bowler_id} onChange={e => setStartConfig(p => ({ ...p, bowler_id: e.target.value }))}>
                      <option value="">Select opening bowler</option>
                      {(startBowlerOptions.length ? startBowlerOptions : startBowlingPlayers)
                        .map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role || 'player'})</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--glass-bd)', textAlign: 'right' }}>
                  <button type="submit" className="btn btn-primary">Start 1st Innings</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ls-root" onTouchStart={onTouchStartPull} onTouchMove={onTouchMovePull} onTouchEnd={onTouchEndPull}>
      <style>{css}</style>
      <div className="ls-shell">
      {isPullRefreshing && <div className="ls-data-error"><span>Refreshing live data...</span></div>}

      <div className="ls-topbar">
        <button className="ls-back-btn" onClick={() => navigate('/admin')} aria-label="Back">‹</button>
        <span className="ls-brand">Live Scoring</span>
        <span className="ls-match-info">{match.team_a_name} vs {match.team_b_name} · {match.league_name}</span>
        <span className="ls-live-pill">LIVE</span>
      </div>

      {dataError && (
        <div className="ls-data-error">
          <span>{dataError}</span>
          <button className="btn btn-sm btn-secondary" onClick={loadMatch}>Retry</button>
        </div>
      )}

      <div className="ls-page">
        <div className="ls-left">
          <div className="ls-sb">
            <div className="ls-sb-tag">{activeInnings?.innings_number === 1 ? '1st' : '2nd'} Innings</div>
            <div className="ls-sb-team">{activeInnings?.team_name || '—'}</div>
            <div className="ls-sb-score-row">
              <span className="ls-sb-runs">{activeInnings?.total_runs || 0}</span>
              <span className="ls-sb-sep">/</span>
              <span className="ls-sb-wkts">{activeInnings?.total_wickets || 0}</span>
              <span className="ls-sb-overs">({fmtOvers(activeInnings?.total_balls || 0)} ov)</span>
            </div>
            {target && <div className="ls-sb-target">Target {target} · Need {runsNeeded} off {ballsLeft} balls</div>}
          </div>

          <div className="ls-over-strip">
            <span className="ls-over-lbl">Over {overNum}</span>
            <div className="ls-balls-row">
              {overSlots.map((b, i) => (
                <div key={b?.id || `empty-${i}`} className={`ls-ball ${b ? ballCls(b) : 'ls-b-dot'}`} style={{ border: b ? undefined : '2px solid var(--glass-bd)', background: b ? undefined : 'transparent' }}>
                  {b ? ballLbl(b) : ''}
                </div>
              ))}
            </div>
          </div>

          <div className="ls-metrics">
            <div className="ls-metric">
              <div className="ls-metric-k">CRR</div>
              <div className="ls-metric-v">{currentRR}</div>
            </div>
            <div className="ls-metric">
              <div className="ls-metric-k">{rrr ? 'RRR' : 'Balls Left'}</div>
              <div className="ls-metric-v">{rrr || (ballsLeft ?? '—')}</div>
            </div>
            <div className="ls-metric">
              <div className="ls-metric-k">Need</div>
              <div className="ls-metric-v">{target ? runsNeeded : '—'}</div>
            </div>
          </div>

          <div className="ls-scoring">
            <div className="ls-sec-lbl">Runs</div>
            <div className="ls-run-grid">
              {[0, 1, 2, 3, 4, 6].map(r => (
                <button type="button" key={r} className={`ls-run-btn ls-r${r}`} onClick={() => submitBall({ runs_scored: r })}>{r}</button>
              ))}
            </div>

            <div className="ls-sec-lbl">Extras</div>
            <div className="ls-extras-grid">
              <button type="button" className="ls-ext-btn" onClick={() => submitBall({ runs_scored: 0, extras_type: 'wide', extras_runs: 1 })}>Wide</button>
              <button type="button" className="ls-ext-btn" onClick={() => submitBall({ runs_scored: 0, extras_type: 'noball', extras_runs: 1 })}>No Ball</button>
              <button type="button" className="ls-ext-btn" onClick={() => submitBall({ runs_scored: 0, extras_type: 'bye', extras_runs: 1 })}>Bye</button>
              <button type="button" className="ls-ext-btn" onClick={() => submitBall({ runs_scored: 0, extras_type: 'legbye', extras_runs: 1 })}>Leg Bye</button>
            </div>

            <div className="ls-divider" />
            <button type="button" className="ls-wicket-btn" onClick={() => setShowWicketModal(true)}>Wicket</button>
          </div>
        </div>

        <div className="ls-right">
          <div className="ls-card">
            <div className="ls-card-head"><IcoBat /> Live Batsmen</div>
            <table className="ls-tbl">
              <thead><tr><th>Batsman</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
              <tbody>
                {[strikerStats, nonStrkStats].filter(Boolean).map(b => (
                  <tr key={b.player_id}>
                    <td>
                      {b.player_id === striker?.id && <span className="ls-striker-dot" />}
                      {b.name}
                    </td>
                    <td className="ls-td-runs">{b.runs}</td>
                    <td>{b.balls_faced}</td>
                    <td className="ls-td-hl">{b.fours}</td>
                    <td className="ls-td-hl">{b.sixes}</td>
                    <td>{sr(b.runs, b.balls_faced)}</td>
                  </tr>
                ))}
                {!strikerStats && !nonStrkStats && <tr><td colSpan={6} className="ls-td-empty">Awaiting batsmen selection</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="ls-card">
            <div className="ls-card-head"><IcoBall /> Current Bowler</div>
            <table className="ls-tbl">
              <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
              <tbody>
                {bowlerStats ? (
                  <tr>
                    <td>{bowlerStats.name}</td>
                    <td>{fmtOvers(bowlerStats.balls_bowled)}</td>
                    <td>{bowlerStats.runs_conceded}</td>
                    <td className="ls-td-wkts">{bowlerStats.wickets}</td>
                    <td>{eco(bowlerStats.runs_conceded, bowlerStats.balls_bowled)}</td>
                  </tr>
                ) : (
                  <tr><td colSpan={5} className="ls-td-empty">No bowler selected</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="ls-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div style={{ padding: '10px 12px', textAlign: 'center', borderRight: '1px solid var(--glass-bd)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.56rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 3 }}>Current RR</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.45rem', fontWeight: 700, color: 'var(--sky)', lineHeight: 1 }}>{currentRR}</div>
            </div>
            <div style={{ padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.56rem', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 3 }}>{rrr ? 'Required RR' : 'Balls Left'}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.45rem', fontWeight: 700, color: rrr ? 'var(--orange)' : 'var(--t2)', lineHeight: 1 }}>{rrr || (ballsLeft ?? '—')}</div>
            </div>
          </div>

          <div className="ls-card">
            <div className="ls-card-head"><IcoHist /> Last 12 Balls</div>
            <div className="ls-ball-row">
              {balls.length === 0 && <span style={{ color: 'var(--t3)', fontSize: '.72rem' }}>No balls recorded yet</span>}
              {balls.slice(-12).map(b => (
                <div key={b.id} className={`ls-ball ${ballCls(b)}`}>{ballLbl(b)}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="ls-action-dock">
        <button type="button" className="btn btn-secondary btn-sm" onClick={undoLastBall}>Undo Score/Wicket</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={endMatch}>End Match</button>
      </div>
      </div>

      {showWicketModal && (
        <div className="ls-overlay" onClick={() => setShowWicketModal(false)}>
          <div className="ls-modal" onClick={e => e.stopPropagation()}>
            <div className="ls-modal-head">
              <div className="ls-modal-title">Wicket Event</div>
              <button type="button" className="ls-modal-x" onClick={() => setShowWicketModal(false)}>×</button>
            </div>
            <div className="ls-modal-body">
              <div>
                <label className="ls-flabel">Wicket Type</label>
                <select className="ls-fselect" value={pendingWicketType} onChange={e => setPendingWicketType(e.target.value)}>
                  {WICKET_TYPES.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="ls-flabel">Dismissed End</label>
                <select className="ls-fselect" value={pendingDismissedEnd} onChange={e => setPendingDismissedEnd(e.target.value)}>
                  <option value="striker">Striker - {striker?.name || 'N/A'}</option>
                  <option value="non-striker">Non-Striker - {nonStriker?.name || 'N/A'}</option>
                </select>
              </div>
              <div>
                <label className="ls-flabel">Incoming Batsman</label>
                <select className="ls-fselect" value={pendingIncomingBatsman} onChange={e => setPendingIncomingBatsman(e.target.value)}>
                  <option value="">Select incoming batsman</option>
                  {availableBatsmen.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="ls-modal-foot">
              <button type="button" className="ls-btn-danger" onClick={handleWicketFlow}>Confirm Wicket</button>
            </div>
          </div>
        </div>
      )}

      {showBowlerModal && (
        <div
          className="ls-overlay"
          onClick={() => {
            bowlerPromptRef.current.suppressedUntil = Date.now() + 10000
            setShowBowlerModal(false)
          }}
        >
          <div className="ls-modal" onClick={e => e.stopPropagation()}>
            <div className="ls-modal-head">
              <div className="ls-modal-title">Select Bowler</div>
              <button
                type="button"
                className="ls-modal-x"
                onClick={() => {
                  bowlerPromptRef.current.suppressedUntil = Date.now() + 10000
                  setShowBowlerModal(false)
                }}
              >×</button>
            </div>
            <div className="ls-modal-body">
              <div className="ls-modal-note">Only bowlers and all-rounders shown. Previous over bowler is excluded.</div>
              <div>
                <label className="ls-flabel">Bowler for this Over</label>
                <select className="ls-fselect" value={selectedBowler} onChange={e => setSelectedBowler(e.target.value)}>
                  <option value="">Select bowler</option>
                  {availableBowlers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                </select>
              </div>
            </div>
            <div className="ls-modal-foot">
              <button type="button" className="ls-btn-primary" onClick={setBowlerForOver}>Confirm Bowler</button>
            </div>
          </div>
        </div>
      )}

      {showInningsInitModal && currentInnings && (
        <div className="ls-overlay">
          <div className="ls-modal" onClick={e => e.stopPropagation()}>
            <div className="ls-modal-head">
              <div className="ls-modal-title">Set Opening Players</div>
            </div>
            <div className="ls-modal-body">
              <div className="ls-modal-note">Select striker, non-striker, and opening bowler to begin this innings.</div>
              <div>
                <label className="ls-flabel">Striker</label>
                <select className="ls-fselect" value={inningsInitConfig.striker_id} onChange={e => setInningsInitConfig(p => ({ ...p, striker_id: e.target.value }))}>
                  <option value="">Select striker</option>
                  {battingPlayers.filter(p => p.id !== parseInt(inningsInitConfig.non_striker_id || '0', 10)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="ls-flabel">Non-Striker</label>
                <select className="ls-fselect" value={inningsInitConfig.non_striker_id} onChange={e => setInningsInitConfig(p => ({ ...p, non_striker_id: e.target.value }))}>
                  <option value="">Select non-striker</option>
                  {battingPlayers.filter(p => p.id !== parseInt(inningsInitConfig.striker_id || '0', 10)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="ls-flabel">Opening Bowler</label>
                <select className="ls-fselect" value={inningsInitConfig.bowler_id} onChange={e => setInningsInitConfig(p => ({ ...p, bowler_id: e.target.value }))}>
                  <option value="">Select bowler</option>
                  {bowlingPlayers.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                </select>
              </div>
            </div>
            <div className="ls-modal-foot">
              <button type="button" className="ls-btn-primary" onClick={initInnings}>Start Innings</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
