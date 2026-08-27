import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || '/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

export default function BottomTabBar() {
  const location = useLocation()
  const [liveCount, setLiveCount] = useState(0)

  useEffect(() => {
    const load = () =>
      fetch(`${API}/matches/live/all`).then(r => r.json()).then(d => setLiveCount(Array.isArray(d) ? d.length : 0)).catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const tabs = [
    { to: '/',        icon: '🏠', label: 'Home'    },
    { to: '/leagues', icon: '🏆', label: 'Leagues'  },
    { to: '/fixtures',icon: '📅', label: 'Fixtures' },
    { to: '/live',    icon: '📡', label: 'Live', isLive: true },
    { to: '/results', icon: '🏅', label: 'Results'  },
  ]

  const isActive = (to) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  return (
    <nav className="mobile-tabbar">
      {tabs.map(t => (
        <Link
          key={t.to}
          to={t.to}
          className={`tab-item${isActive(t.to) ? ' active' : ''}${t.isLive ? ' live-tab' : ''}`}
        >
          {t.isLive && liveCount > 0 && <span className="tab-live-dot" />}
          <span className="tab-icon">{t.icon}</span>
          <span className="tab-label">{t.label}</span>
        </Link>
      ))}
      <Link
        to="/stats"
        className={`tab-item${location.pathname === '/stats' ? ' active' : ''}`}
      >
        <span className="tab-icon">📊</span>
        <span className="tab-label">Stats</span>
      </Link>
    </nav>
  )
}
