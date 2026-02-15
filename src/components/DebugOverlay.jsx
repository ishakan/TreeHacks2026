/**
 * Debug Overlay - Shows render metrics and detects infinite loops
 * Enable with DEBUG=true environment variable or window.__DEBUG = true
 */

import { useEffect, useRef, useState } from 'react'

const DEBUG_ENABLED = typeof window !== 'undefined' &&
  (window.__DEBUG === true || import.meta.env.VITE_DEBUG === 'true' || true) // Temporarily enabled by default

export default function DebugOverlay() {
  const [metrics, setMetrics] = useState({
    renderCount: 0,
    frameCount: 0,
    stateUpdatesPerSec: 0,
    lastCameraPos: null,
    lastCameraTarget: null,
    isTransitionActive: false,
  })

  const renderCountRef = useRef(0)
  const frameCountRef = useRef(0)
  const stateUpdateCountRef = useRef(0)
  const lastUpdateTimeRef = useRef(Date.now())
  const updateIntervalRef = useRef(null)

  // Track renders
  useEffect(() => {
    renderCountRef.current += 1
    stateUpdateCountRef.current += 1
  })

  // Update metrics display every 100ms
  useEffect(() => {
    updateIntervalRef.current = setInterval(() => {
      const now = Date.now()
      const elapsed = (now - lastUpdateTimeRef.current) / 1000
      const updatesPerSec = stateUpdateCountRef.current / elapsed

      setMetrics(prev => ({
        ...prev,
        renderCount: renderCountRef.current,
        frameCount: frameCountRef.current,
        stateUpdatesPerSec: Math.round(updatesPerSec),
      }))

      stateUpdateCountRef.current = 0
      lastUpdateTimeRef.current = now
    }, 100)

    return () => clearInterval(updateIntervalRef.current)
  }, [])

  // Track animation frame
  useEffect(() => {
    let rafId
    const tick = () => {
      frameCountRef.current += 1
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  if (!DEBUG_ENABLED) return null

  const isThrashing = metrics.stateUpdatesPerSec > 200

  return (
    <div className="fixed bottom-2 left-2 z-50 bg-black/80 text-white p-3 rounded-lg font-mono text-xs space-y-1 pointer-events-none">
      <div className="font-bold text-yellow-400 mb-2">🔧 DEBUG METRICS</div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-gray-400">Renders:</span>
        <span className="text-green-400">{metrics.renderCount}</span>

        <span className="text-gray-400">Frames:</span>
        <span className="text-green-400">{metrics.frameCount}</span>

        <span className="text-gray-400">Updates/sec:</span>
        <span className={isThrashing ? 'text-red-500 font-bold' : 'text-green-400'}>
          {metrics.stateUpdatesPerSec}
        </span>
      </div>

      {isThrashing && (
        <div className="mt-2 p-2 bg-red-900/50 border border-red-500 rounded text-red-200 font-bold">
          ⚠️ CAMERA STATE THRASHING
        </div>
      )}

      <div className="mt-2 text-gray-500 text-[10px]">
        Idle target: &lt;10 updates/sec
      </div>
    </div>
  )
}

// Hook to enable debug mode
export function useDebugMode() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      console.log('[DEBUG] Debug overlay enabled. Set window.__DEBUG = false to disable.')
      window.__DEBUG = true
    }
  }, [])
}
