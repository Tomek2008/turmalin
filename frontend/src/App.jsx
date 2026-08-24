import { useState, useEffect, useRef } from 'react'
import {
  Viewer,
  ImageryLayer,
} from 'resium'
import {
  Ion,
  ArcGisMapServerImageryProvider,
  Color,
  Cartesian3,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

Ion.defaultAccessToken = undefined

function App() {
  const [data, setData] = useState(null)
  const viewerRef = useRef(null)
  const drawerRef = useRef(null)
  const toggleBtnRef = useRef(null)
  const [imageryProvider, setImageryProvider] = useState(null)

  // Load ESRI satellite imagery (free, no token)
  useEffect(() => {
    ArcGisMapServerImageryProvider.fromUrl(
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
    ).then(provider => {
      setImageryProvider(provider)
    })
  }, [])

  // Fetch backend data
  useEffect(() => {
    fetch('http://localhost:8000/api/insights/')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => { })
  }, [])

  // Configure camera after viewer mounts
  useEffect(() => {
    const interval = setInterval(() => {
      if (viewerRef.current?.cesiumElement) {
        const viewer = viewerRef.current.cesiumElement
        viewer.scene.skyBox.show = true
        viewer.scene.backgroundColor = Color.fromCssColorString('#0a0e1a')
        viewer.scene.globe.enableLighting = false
        viewer.scene.globe.showGroundAtmosphere = true
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(19.0, 50.0, 20000000),
          duration: 0,
        })
        clearInterval(interval)
      }
    }, 200)
    return () => clearInterval(interval)
  }, [])

  // Toggle drawer using direct DOM manipulation to prevent component/map reloading or re-rendering
  const handleToggle = () => {
    if (drawerRef.current && toggleBtnRef.current) {
      const isOpen = drawerRef.current.style.left === '0px'
      drawerRef.current.style.left = isOpen ? '-260px' : '0px'
      toggleBtnRef.current.innerHTML = isOpen ? '☰' : '✕'
    }
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', background: '#0a0e1a', fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif"
    }}>

      {/* ── Header ── */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 28px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'rgba(10,14,26,0.92)', backdropFilter: 'blur(12px)',
        zIndex: 30, position: 'relative', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Menu Toggle Button */}
          <button
            ref={toggleBtnRef}
            onClick={handleToggle}
            style={{
              background: 'none', border: 'none', color: '#ffffff', fontSize: 24,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 4, width: 32, height: 32
            }}
            title="Toggle Menu Panel"
          >
            ☰
          </button>

          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '0.18em', color: '#ffffff', textShadow: '0 0 14px rgba(255,255,255,0.3)' }}>
              TURMALIN
            </div>
          </div>
        </div>

        <div></div>
      </header>

      {/* ── Body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>

        {/* ── Slide-out Menu (Drawer) ── */}
        <div
          ref={drawerRef}
          style={{
            position: 'absolute', top: 0, left: '-260px',
            width: 260, height: '100%',
            display: 'flex', flexDirection: 'column',
            borderRight: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(10,14,26,0.95)',
            backdropFilter: 'blur(16px)', zIndex: 25,
            transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}
        >
          <Stat label="NODES" value={data ? data.nodes_connected.toLocaleString() : '—'} color="#ffffff" />
          <Stat label="THREAT" value={data ? data.threat_level : '—'} color="#cbd5e1" />
          <Stat label="ANOMALIES" value={data ? String(data.active_anomalies) : '—'} color="#ffffff" />

          <div style={{ flex: 1, padding: '16px 20px', overflow: 'hidden' }}>
            <div style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace', letterSpacing: '0.15em', marginBottom: 10 }}>
              DATA FEED
            </div>
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'monospace',
                color: '#475569', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)'
              }}>
                <span>PKT_{String(1001 + i)}</span>
                <span style={{ color: '#ffffff' }}>OK</span>
              </div>
            ))}
          </div>

          <div style={{
            padding: '10px 20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            fontSize: 9, fontFamily: 'monospace', color: '#ffffff', letterSpacing: '0.05em'
          }}>
            {data ? data.message : 'Connecting...'}
          </div>
        </div>

        {/* ── Globe ── */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Viewer
            ref={viewerRef}
            full
            timeline={false}
            animation={false}
            homeButton={false}
            geocoder={false}
            baseLayerPicker={false}
            navigationHelpButton={false}
            sceneModePicker={false}
            fullscreenButton={false}
            vrButton={false}
            selectionIndicator={false}
            infoBox={false}
            scene3DOnly={true}
            imageryProvider={false}
            creditContainer={document.createElement('div')}
          >
            {imageryProvider && <ImageryLayer imageryProvider={imageryProvider} />}
          </Viewer>
        </div>
      </div>
    </div>
  )
}

/* ── Small Components ── */

function Stat({ label, value, color }) {
  return (
    <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <div style={{ fontSize: 9, color: '#64748b', fontFamily: 'monospace', letterSpacing: '0.15em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 200, color, lineHeight: 1, letterSpacing: '-0.02em', textShadow: `0 0 10px ${color}33` }}>{value}</div>
    </div>
  )
}

export default App
