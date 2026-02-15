import { useEffect, useRef, useState } from 'react'
import TopToolbar from './TopToolbar'
import LeftDock from './LeftDock'
import RightDock from './RightDock'
import StatusBar from './StatusBar'

export default function AppShell({ viewport, overlays }) {
  const debugRender = typeof window !== 'undefined' && Boolean(window.__DEBUG_RENDER__)
  const renderCountRef = useRef(0)
  const lastSampleRef = useRef({ ts: Date.now(), count: 0 })
  const [renderPerSec, setRenderPerSec] = useState(0)
  renderCountRef.current += 1

  useEffect(() => {
    if (!debugRender) return undefined

    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = Math.max((now - lastSampleRef.current.ts) / 1000, 0.001)
      const totalRenders = renderCountRef.current
      const delta = totalRenders - lastSampleRef.current.count
      setRenderPerSec(Number((delta / elapsed).toFixed(1)))
      lastSampleRef.current = { ts: now, count: totalRenders }
    }, 1000)

    return () => clearInterval(interval)
  }, [debugRender])

  return (
    <div className="h-screen w-full bg-slate-100 text-slate-800">
      {debugRender && (
        <div className="pointer-events-none fixed left-3 top-3 z-[120] rounded border border-cyan-500/40 bg-black/70 px-2 py-1 text-[11px] text-cyan-200">
          AppShell renders/sec: {renderPerSec}
        </div>
      )}
      <TopToolbar />
      <div className="flex h-[calc(100vh-48px)] min-h-0">
        <LeftDock />
        <main className="relative min-w-0 flex-1 bg-gradient-to-b from-slate-100 via-slate-200 to-slate-300 p-2">
          <div className="relative h-full overflow-hidden rounded-md border border-slate-300 bg-slate-200">
            {viewport || null}
            {overlays || null}
            <StatusBar />
          </div>
        </main>
        <RightDock />
      </div>
    </div>
  )
}
