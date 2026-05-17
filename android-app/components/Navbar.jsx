import { useState, useContext, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

export default function Navbar() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ch-theme') || 'dark')
  const { user, logout } = useContext(AuthContext)
  const navigate = useNavigate()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('ch-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  return (
    <nav className="topbar">
      <Link to="/" className="topbar-logo">
        <img src="/crickethub-logo.svg" alt="CricketHub" className="topbar-logo-mark" />
        <span>Cricket<span>Hub</span></span>
      </Link>
      <div className="topbar-actions">
        <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        {user ? (
          <>
            <Link to="/admin" className="btn btn-sm btn-ghost">⚙️</Link>
            <button onClick={handleLogout} className="btn btn-sm btn-danger">Out</button>
          </>
        ) : (
          <Link to="/login" className="btn btn-sm btn-accent">Login</Link>
        )}
      </div>
    </nav>
  )
}
