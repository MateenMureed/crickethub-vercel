import { useState, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

const API = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_URL || 'https://cricket-android.azurewebsites.net/api').replace(/\/$/, '')
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()
const API_FALLBACK = (() => {
  const raw = (import.meta.env.VITE_ANDROID_BACKEND_FALLBACK_URL || '').replace(/\/$/, '')
  if (!raw) return ''
  if (!raw.startsWith('http')) return raw
  return raw.endsWith('/api') ? raw : `${raw}/api`
})()

function buildAuthUrls(endpoint) {
  const urls = [`${API}${endpoint}`]
  if (API_FALLBACK && API_FALLBACK !== API) {
    urls.push(`${API_FALLBACK}${endpoint}`)
  }
  return [...new Set(urls)]
}

export default function AdminLogin() {
  const [isLogin, setIsLogin]   = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [photoError, setPhotoError] = useState(false)
  const [loading, setLoading]   = useState(false)
  const { login }               = useContext(AuthContext)
  const navigate                = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const endpoint = isLogin ? '/auth/login' : '/auth/signup'
    try {
      const urls = buildAuthUrls(endpoint)
      let lastError = 'Authentication failed'

      for (let i = 0; i < urls.length; i++) {
        try {
          const res = await fetch(urls[i], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          })

          const text = await res.text()
          let data = {}
          try {
            data = text ? JSON.parse(text) : {}
          } catch {
            data = { error: text || `HTTP ${res.status}` }
          }

          if (!res.ok) {
            lastError = data.error || `HTTP ${res.status}`
            continue
          }

          if (isLogin) { login(data); navigate('/admin') }
          else { setError(''); setIsLogin(true); setUsername(''); setPassword('') }
          return
        } catch {
          lastError = 'Network error. Please try again.'
        }
      }

      setError(lastError)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-logo"><img src="/crickethub-logo.svg" alt="CricketHub" /></div>
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 900, marginBottom: 4 }}>
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p style={{ color: 'var(--t2)', fontSize: '.82rem' }}>
            {isLogin ? 'Sign in to manage your leagues' : 'Register a new organizer account'}
          </p>
        </div>

        {error && <div className="error-banner">! {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              className="form-input"
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              autoComplete="username"
            />
          </div>
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>
          <button type="submit" className="btn btn-accent btn-full" disabled={loading}>
            {loading
              ? (isLogin ? 'Signing in...' : 'Creating...')
              : (isLogin ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: 'var(--t2)', fontSize: '.82rem', marginTop: 16 }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setIsLogin(l => !l); setError('') }}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, padding: 0, fontFamily: 'var(--font)', fontSize: '.82rem' }}
          >
            {isLogin ? 'Sign Up' : 'Login'}
          </button>
        </p>

        <div style={{
          marginTop: 18,
          borderTop: '1px solid var(--glass-bd)',
          paddingTop: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'var(--glass-bg)',
          borderRadius: 12,
          padding: 12,
        }}>
          {!photoError ? (
            <img
              src="/developer-mateen.jpg"
              alt="Mateen Mureed"
              onError={() => setPhotoError(true)}
              style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--glass-bd)', flexShrink: 0 }}
            />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 900, border: '1px solid var(--glass-bd)', flexShrink: 0 }}>
              MM
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '.84rem', color: 'var(--t1)' }}>Mateen Mureed</div>
            <div style={{ fontSize: '.72rem', color: 'var(--t2)' }}>AI Engineer and Full Stack Developer</div>
            <div style={{ fontSize: '.7rem', color: 'var(--t3)', marginTop: 2 }}>mateenmurid@gmail.com · 03009070520</div>
          </div>
        </div>
      </div>
    </div>
  )
}
