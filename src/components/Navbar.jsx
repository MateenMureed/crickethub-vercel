import { useState, useContext, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled]     = useState(false)
  const [theme, setTheme]           = useState(() => localStorage.getItem('ch-theme') || 'dark')
  const location                    = useLocation()
  const { user, logout }            = useContext(AuthContext)

  // scroll shadow
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 18)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  // close on navigate
  useEffect(() => setMobileOpen(false), [location.pathname])

  // apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ch-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const links = [
    { label: 'Home',     to: '/' },
    { label: 'Leagues',  to: '/leagues' },
    { label: 'Fixtures', to: '/fixtures' },
    { label: 'Live',     to: '/live', live: true },
    { label: 'Results',  to: '/results' },
    { label: 'Stats',    to: '/stats' },
  ]

  const isActive = p => p === '/' ? location.pathname === '/' : location.pathname === p

  const LiveDot = () => (
    <span style={{ width:6,height:6,borderRadius:'50%',background:'var(--red)',display:'inline-block',animation:'livePulse 1.5s ease-in-out infinite',flexShrink:0 }} />
  )

  const OrganizerLink = ({ mobile }) => {
    const base = { display:'flex',alignItems:'center',gap:6,fontFamily:'var(--font-display)',fontWeight:700 }
    if (mobile) return (
      <Link
        to="/admin"
        onClick={() => setMobileOpen(false)}
        style={{ ...base, padding:'10px 12px', borderRadius:'var(--r-sm)', background:'var(--accent-dim)', color:'var(--accent)', border:'1px solid rgba(0,212,132,.25)', fontSize:'.875rem', textDecoration:'none' }}
      >
        ⚙ Organizer Panel
      </Link>
    )
    return (
      <Link
        to="/admin"
        className={`nav-organizer${location.pathname.startsWith('/admin') ? ' active' : ''}`}
      >
        ⚙ Organizer
      </Link>
    )
  }

  return (
    <>
      <nav className={`navbar${scrolled ? ' scrolled' : ''}`} role="navigation">
        <div className="navbar-container container">

          {/* Logo */}
          <Link to="/" className="navbar-logo">
            Cricket<span>Hub</span>
          </Link>

          {/* ── Desktop center links ── */}
          <div className="navbar-links-center">
            {links.map(l => (
              <Link key={l.label} to={l.to} className={`nav-link${isActive(l.to) ? ' active' : ''}`}
                style={l.live ? { color:'var(--red)', display:'flex', alignItems:'center', gap:5 } : {}}>
                {l.live && <LiveDot />}{l.label}
              </Link>
            ))}
          </div>

          {/* ── Desktop right cluster ── */}
          <div className="navbar-right">
            <a href="/CricketHub-debug.apk" download="CricketHub.apk" className="btn btn-sm" style={{ display:'flex', alignItems:'center', gap:4, background:'rgba(0,212,132,0.15)', color:'var(--accent)', border:'1px solid rgba(0,212,132,0.3)', textDecoration:'none', fontWeight:600 }} title="Download Android APK">
              📱 APK
            </a>
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <OrganizerLink />
            {user ? (
              <button onClick={logout} className="btn btn-sm btn-secondary">Logout</button>
            ) : (
              <Link to="/admin/login" className={`btn btn-sm${location.pathname==='/admin/login' ? ' btn-primary' : ' btn-secondary'}`}>
                Login
              </Link>
            )}
          </div>

          {/* ── Mobile right cluster (theme + hamburger) ── */}
          <div style={{ display:'flex',alignItems:'center',gap:6,marginLeft:'auto' }} className="mobile-only-cluster">
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            <button
              className={`mobile-menu-toggle${mobileOpen ? ' open' : ''}`}
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              <span /><span /><span />
            </button>
          </div>
        </div>

        {/* ── Mobile dropdown ── */}
        <div className={`mobile-menu${mobileOpen ? ' open' : ''}`} role="menu">
          {/* Nav links */}
          {links.map(l => (
            <Link key={l.label} to={l.to}
              className={`mobile-nav-link${isActive(l.to) ? ' active' : ''}`}
              onClick={() => setMobileOpen(false)}
              style={l.live ? { color:'var(--red)',fontWeight:700 } : {}}>
              {l.live && <LiveDot />}{l.label}
            </Link>
          ))}

          <div className="mobile-menu-divider" />

          {/* Auth + organizer */}
          <div className="mobile-menu-actions">
            <a href="/CricketHub-debug.apk" download="CricketHub.apk" onClick={() => setMobileOpen(false)}
              className="btn btn-primary" style={{ width:'100%', textAlign:'center', display:'flex', alignItems:'center', justifyContent:'center', gap:6, textDecoration:'none' }}>
              📱 Download Android APK
            </a>
            <OrganizerLink mobile />
            {user ? (
              <button onClick={() => { logout(); setMobileOpen(false) }}
                className="btn btn-secondary" style={{ width:'100%' }}>
                Logout
              </button>
            ) : (
              <Link to="/admin/login" onClick={() => setMobileOpen(false)}
                className="btn btn-secondary" style={{ width:'100%',textAlign:'center' }}>
                Login
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hide mobile-only cluster on desktop */}
      <style>{`
        .mobile-only-cluster { display: none !important; }
        @media (max-width: 900px) { .mobile-only-cluster { display: flex !important; } }
      `}</style>
    </>
  )
}