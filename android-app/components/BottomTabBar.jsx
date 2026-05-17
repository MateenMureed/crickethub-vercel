import { useContext } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

export default function BottomTabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useContext(AuthContext)

  const tabs = [
    { label: 'Home', icon: '🏠', path: '/', color: '#eaf2ff' },
    { label: 'Leagues', icon: '🏆', path: '/leagues', color: '#40c4ff' },
    { label: 'Live', icon: '📡', path: '/live', color: '#ff4d6d' },
    { label: 'Results', icon: '📊', path: '/results', color: '#f7c948' },
    { label: 'Stats', icon: '📈', path: '/stats', color: '#00e896' },
    user
      ? { label: 'Admin', icon: '🛠', path: '/admin', color: '#00e896' }
      : { label: 'Login', icon: '🔐', path: '/login', color: '#40c4ff' },
  ]

  const isActive = (path) => location.pathname === path || (path !== '/' && location.pathname.startsWith(path))

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        @keyframes pulse-badge {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        @keyframes water-drop {
          0% {
            transform: translate(-50%, -50%) scale(0.08);
            opacity: 0.45;
          }
          70% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.14;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.35);
            opacity: 0;
          }
        }

        .bottom-nav-container {
          position: fixed;
           bottom: max(12px, env(safe-area-inset-bottom, 0px));
          left: 0;
          right: 0;
          z-index: 1000;
          animation: slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          display: flex;
          justify-content: center;
          pointer-events: none;
        }

        .bottom-nav-backdrop {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(130% 110% at 50% -30%, rgba(255, 255, 255, 0.24), transparent 54%),
            linear-gradient(120deg, color-mix(in srgb, var(--nav-bg) 86%, rgba(255,255,255,.12)) 0%, color-mix(in srgb, var(--nav-bg) 92%, transparent) 100%);
          backdrop-filter: blur(28px) saturate(200%);
          -webkit-backdrop-filter: blur(28px) saturate(200%);
          border: 1px solid var(--glass-bd);
          border-radius: 999px;
          opacity: 0.96;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
        }

        .bottom-nav-backdrop::after {
          content: '';
          position: absolute;
          inset: 1px;
          border-radius: inherit;
          border: 1px solid rgba(255, 255, 255, 0.18);
          pointer-events: none;
        }

        .bottom-nav-content {
          position: relative;
          z-index: 1;
          display: flex;
          justify-content: space-around;
          align-items: center;
           height: 56px;
           width: min(396px, calc(100vw - 20px));
           padding: 4px;
           gap: 4px;
          pointer-events: auto;
        }

        .nav-tab-button {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          flex: 1;
          height: 100%;
          background: none;
          border: 1px solid transparent;
          border-radius: 999px;
          cursor: pointer;
           padding: 1px 2px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          color: var(--t3);
          font-family: var(--font-display);
          font-weight: 600;
           font-size: 0.62rem;
          letter-spacing: 0.3px;
          isolation: isolate;
          overflow: hidden;
          will-change: transform;
        }

        .nav-tab-button:hover {
          background: rgba(255, 255, 255, 0.04);
          color: var(--t1);
        }

        .nav-tab-button.active {
          background: linear-gradient(135deg, rgba(0, 232, 150, 0.18) 0%, rgba(0, 232, 150, 0.08) 100%);
          border-color: rgba(0, 232, 150, 0.35);
          color: var(--accent);
          transform: translateY(-1px);
        }

        .nav-tab-button.active::before {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          width: 100%;
          height: 180%;
          border-radius: 999px;
          background: radial-gradient(circle, rgba(255,255,255,.38) 0%, rgba(255,255,255,.12) 36%, transparent 72%);
          transform: translate(-50%, -50%) scale(0.08);
          opacity: 0;
          pointer-events: none;
        }

        .nav-tab-button.active::before {
          animation: water-drop 680ms cubic-bezier(0.21, 0.89, 0.22, 1);
        }

        .nav-tab-icon {
          font-size: 0.98rem;
           line-height: 1;
           display: inline-flex;
           align-items: center;
           justify-content: center;
          transition: transform 0.3s ease, filter 0.3s ease;
          filter: drop-shadow(0 0 0px rgba(0, 232, 150, 0));
        }

        .nav-tab-button.active .nav-tab-icon {
           transform: scale(1.05) translateY(-1px);
          filter: drop-shadow(0 2px 8px rgba(0, 232, 150, 0.3));
        }

        .nav-tab-label {
          text-transform: uppercase;
          letter-spacing: 0.25px;
           font-size: 0.5rem;
          transition: all 0.3s ease;
        }

        .nav-tab-button.active .nav-tab-label {
          font-weight: 700;
          letter-spacing: 0.5px;
        }

        .nav-indicator {
          position: absolute;
          bottom: 4px;
          left: 20%;
          right: 20%;
          height: 1.5px;
          background: var(--accent);
          transform: scaleX(0);
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          border-radius: 2px;
        }

        .nav-tab-button.active .nav-indicator {
          box-shadow: 0 0 12px rgba(0, 232, 150, 0.45);
        }

        .nav-tab-button.active .nav-indicator {
          transform: scaleX(1);
        }

        @media (max-width: 480px) {
          .bottom-nav-content {
             height: 52px;
             width: calc(100vw - 12px);
             gap: 2px;
          }

          .nav-tab-button {
             font-size: 0.57rem;
             gap: 1px;
          }

          .nav-tab-icon {
             font-size: 0.92rem;
          }

           .nav-tab-label {
             font-size: 0.46rem;
           }
        }

          @media (max-width: 360px) {
           .bottom-nav-content {
             height: 50px;
             width: calc(100vw - 10px);
           }

           .nav-tab-button {
             font-size: 0;
             gap: 0;
             padding: 0;
           }

           .nav-tab-label {
             display: none;
           }

           .nav-tab-icon {
             font-size: 0.82rem;
           }

           .nav-indicator {
             bottom: 3px;
           }
          }
      `}</style>

      <div className="bottom-nav-container">
        <div className="bottom-nav-backdrop" />
        <div className="bottom-nav-content">
          {tabs.map(tab => (
            <button
              key={tab.path}
              className={`nav-tab-button ${isActive(tab.path) ? 'active' : ''}`}
              onClick={() => navigate(tab.path)}
              title={tab.label}
            >
              <span className="nav-tab-icon">{tab.icon}</span>
              <span className="nav-tab-label">{tab.label}</span>
              <div className="nav-indicator" />
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
