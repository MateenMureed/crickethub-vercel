export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div>
          <div className="footer-logo">CricketHub</div>
          <p className="footer-text" style={{ marginTop: 5 }}>
            Professional Cricket League Management Platform
          </p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <a href="/CricketHub-debug.apk" download="CricketHub.apk" style={{ color:'var(--accent)', fontSize:'.875rem', textDecoration:'none', fontWeight:600 }}>
            📱 Download Android APK
          </a>
          <span style={{ opacity:0.3 }}>|</span>
          <p className="footer-text">
            © {new Date().getFullYear()} CricketHub. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}