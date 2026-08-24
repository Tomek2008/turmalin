import { useState, useEffect } from 'react'

function App() {
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch('http://localhost:8000/api/insights/')
      .then(res => res.json())
      .then(data => setData(data))
      .catch(console.error)
  }, [])

  return (
    <div className="min-h-screen relative w-full overflow-hidden bg-plntr-900">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 bg-grid-pattern opacity-20 pointer-events-none" style={{ backgroundSize: '40px 40px' }}></div>
      <div className="absolute inset-0 bg-gradient-to-br from-plntr-900 to-plntr-800 opacity-90 pointer-events-none"></div>

      <div className="relative z-10 p-4 md:p-8 max-w-7xl mx-auto flex flex-col gap-8">
        <header className="flex justify-between items-end pb-4 border-b border-slate-700/50">
          <div>
            <div className="text-[10px] text-slate-500 font-mono tracking-[0.2em] mb-1">GLOBAL INTELLIGENCE</div>
            <h1 className="text-3xl font-bold tracking-widest text-plntr-glow glow-text">PALANTYR.NET</h1>
          </div>
          <div className="flex gap-4">
            <div className="px-3 py-1 rounded bg-plntr-800/80 text-[10px] font-mono tracking-widest border border-slate-700/50">
              SYS: {data ? data.status : 'LOADING'}
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="glass-panel p-6 rounded-lg flex flex-col gap-4">
            <h2 className="text-xs tracking-widest text-slate-400 font-mono">GLOBAL NODES</h2>
            <div className="text-5xl text-plntr-glow font-light glow-text tracking-tight">{data ? data.nodes_connected.toLocaleString() : '--'}</div>
            <div className="text-[10px] text-green-400 font-mono tracking-tight flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
              Network stable
            </div>
          </div>

          <div className="glass-panel p-6 rounded-lg flex flex-col gap-4">
            <h2 className="text-xs tracking-widest text-slate-400 font-mono">THREAT LEVEL</h2>
            <div className="text-5xl text-slate-200 font-light tracking-tight">{data ? data.threat_level : '--'}</div>
            <div className="text-[10px] text-slate-400 font-mono tracking-tight">&gt; Standard protocol</div>
          </div>

          <div className="glass-panel p-6 rounded-lg flex flex-col gap-4">
            <h2 className="text-xs tracking-widest text-slate-400 font-mono">ACTIVE ANOMALIES</h2>
            <div className="text-5xl text-plntr-accent font-light glow-text tracking-tight">{data ? data.active_anomalies : '--'}</div>
            <div className="text-[10px] text-slate-400 font-mono tracking-tight">&gt; Investigating ({data ? data.active_anomalies : 0})</div>
          </div>

          <div className="glass-panel p-6 rounded-lg md:col-span-3 min-h-[400px] flex gap-8 relative overflow-hidden">

            {/* Left side data feed list */}
            <div className="font-mono w-1/3 flex flex-col gap-2 border-r border-slate-700/50 pr-6 relative z-10">
              <div className="text-xs text-slate-500 mb-2">LIVE DATA FEED</div>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="text-[10px] text-slate-400 border-b border-slate-800 pb-2 flex justify-between">
                  <span>DATA_PACKET_{Math.floor(Math.random() * 1000)}</span>
                  <span className="text-plntr-glow">OK</span>
                </div>
              ))}
            </div>

            {/* Map Visualization Placeholder */}
            <div className="flex-1 font-mono text-slate-500 tracking-widest flex flex-col gap-4 items-center justify-center relative z-10">
              <div className="relative w-48 h-48 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-plntr-glow/30"></div>
                <div className="absolute inset-4 rounded-full border border-plntr-glow/20"></div>
                <div className="absolute inset-8 rounded-full border border-plntr-glow/10"></div>

                <div className="absolute w-2 h-2 rounded-full bg-plntr-glow shadow-[0_0_10px_#38BDF8] top-1/4 left-1/4 animate-ping"></div>
                <div className="absolute w-2 h-2 rounded-full bg-plntr-accent shadow-[0_0_10px_#818CF8] bottom-1/3 right-1/4 animate-ping" style={{ animationDelay: '1s' }}></div>

                {/* Radar sweep effect */}
                <div className="h-1/2 w-1/2 bg-gradient-to-r from-plntr-glow/0 to-plntr-glow/20 absolute top-0 right-0 origin-bottom-left animate-spin" style={{ animationDuration: '3s', borderRadius: '0 100% 0 0' }}></div>

              </div>
              <div className="text-xs text-plntr-glow mt-4 bg-plntr-900/50 px-4 py-2 border border-slate-700 backdrop-blur-sm">
                {data ? data.message : "Establishing connection..."}
              </div>
            </div>

            {/* Add grid lines specifically for this panel */}
            <div className="absolute inset-0 bg-grid-pattern opacity-10 pointer-events-none" style={{ backgroundSize: '20px 20px' }}></div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
