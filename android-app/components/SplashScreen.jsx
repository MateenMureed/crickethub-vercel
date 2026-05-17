import { useState, useEffect } from 'react'

export default function SplashScreen() {
  const [show, setShow] = useState(true)

  useEffect(() => {
    // Reduced from 3000ms to 1200ms for faster startup feel
    const timer = setTimeout(() => setShow(false), 1200)
    return () => clearTimeout(timer)
  }, [])

  if (!show) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'radial-gradient(120% 90% at 8% 0%, rgba(0, 232, 150, 0.24) 0%, transparent 52%), radial-gradient(120% 90% at 92% 100%, rgba(64, 196, 255, 0.2) 0%, transparent 58%), linear-gradient(165deg, #050b16 0%, #0a1629 54%, #06111f 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      animation: 'splashFadeOut 0.4s ease-in-out 0.8s forwards',
    }}>
      <style>{`
        @keyframes splashFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes splashMarkPulse {
          0%, 100% { transform: translateY(0) scale(1); box-shadow: 0 16px 46px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.12) inset; }
          50% { transform: translateY(-4px) scale(1.02); box-shadow: 0 18px 52px rgba(0, 0, 0, 0.52), 0 0 0 1px rgba(255, 255, 255, 0.24) inset; }
        }
        @keyframes splashSweep {
          0% { transform: translateX(-110%); }
          100% { transform: translateX(110%); }
        }
        @keyframes splashBlink {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 1; }
        }
        @keyframes splashCricketBounce {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-8px) rotate(-5deg); }
          50% { transform: translateY(-14px) rotate(0deg); }
          75% { transform: translateY(-8px) rotate(5deg); }
        }
        .splash-mark { animation: splashMarkPulse 1.6s ease-in-out infinite; }
      `}</style>

      <div style={{
        position: 'absolute',
        width: 330,
        height: 330,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,232,150,0.26) 0%, transparent 68%)',
        top: '18%',
        left: '4%',
        filter: 'blur(48px)',
      }} />
      <div style={{
        position: 'absolute',
        width: 300,
        height: 300,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(64,196,255,0.22) 0%, transparent 70%)',
        bottom: '14%',
        right: '3%',
        filter: 'blur(52px)',
      }} />

      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}>
        <div className="splash-mark" style={{
          width: 134,
          height: 134,
          borderRadius: 30,
          background: 'linear-gradient(145deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(255,255,255,0.18)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <img src="/crickethub-logo.svg" alt="CricketHub" style={{ width: 94, height: 94, display: 'block' }} />
          <div style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: '34%',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.42) 45%, transparent 100%)',
            animation: 'splashSweep 1.4s ease-in-out infinite',
          }} />
        </div>

        {/* Lightweight CSS cricket ball animation — no external dependency */}
        <div style={{
          width: 48,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'splashCricketBounce 1.2s ease-in-out infinite',
          fontSize: '2rem',
          marginTop: -6,
          marginBottom: -6,
        }}>
          🏏
        </div>

        <div style={{
          textAlign: 'center',
        }}>
          <h1 style={{
            fontSize: '2.1rem',
            fontWeight: 900,
            color: '#f5f8ff',
            margin: 0,
            marginBottom: 6,
            letterSpacing: '-0.015em',
            fontFamily: 'var(--font-display)',
          }}>
            Cricket<span style={{ color: '#00e896' }}>Hub</span>
          </h1>
          <p style={{
            fontSize: '0.78rem',
            color: 'rgba(232, 240, 255, 0.72)',
            margin: 0,
            fontWeight: 700,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
          }}>
            LIVE LEAGUE ENGINE
          </p>
        </div>

        <div style={{
          display: 'flex',
          gap: 7,
          marginTop: 14,
        }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#00e896',
              animation: `splashBlink 1.2s ease-in-out ${i * 0.18}s infinite`,
              boxShadow: '0 0 14px rgba(0,232,150,0.45)',
            }} />
          ))}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 34,
        textAlign: 'center',
        zIndex: 10,
      }}>
        <p style={{
          color: 'rgba(226, 236, 255, 0.66)',
          fontSize: '0.72rem',
          margin: 0,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
        }}>
          Preparing Scoreboards
        </p>
      </div>
    </div>
  )
}
