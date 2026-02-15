import { useEffect, Component, useMemo, useRef } from 'react'
import Viewport from './components/Viewport'
import SketchCanvas from './components/SketchCanvas'
import ConstraintPanel from './components/ConstraintPanel'
import DebugOverlay from './components/DebugOverlay'
import ImportDropOverlay from './components/ImportDropOverlay'
import AppShell from './components/layout/AppShell'
import { ShapeProvider, useShapes } from './context/ShapeContext'
import { SketchProvider, useSketch } from './context/SketchContext'
import { SelectionProvider } from './context/SelectionContext'
import { FeatureHistoryProvider } from './context/FeatureHistoryContext'
import { FeatureTreeProvider, useFeatureTree } from './context/FeatureTreeContext'
import { WorkspaceProvider } from './context/WorkspaceContext'
import { UIStateProvider, useUIState } from './context/UIStateContext'
import { useSelection } from './context/SelectionContext'

if (typeof window !== 'undefined' && window.__BOOT) {
  window.__BOOT.mark('app-render', true)
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    if (typeof window !== 'undefined' && window.__BOOT) {
      window.__BOOT.error('React Error: ' + error.message, error.stack)
    }
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    if (typeof window !== 'undefined' && window.__BOOT) {
      window.__BOOT.error('React Error: ' + error.message, error.stack)
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center p-8 overflow-auto">
          <div className="text-rose-400 text-2xl font-bold mb-4">Something went wrong</div>
          <div className="bg-slate-800 p-4 rounded-lg max-w-2xl w-full mb-4">
            <div className="text-rose-300 text-sm mb-2 font-bold">Error:</div>
            <pre className="text-rose-300 text-sm whitespace-pre-wrap mb-4">
              {this.state.error?.message || 'Unknown error'}
            </pre>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-sky-600 text-white rounded hover:bg-sky-500"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function ExtrudeConnector() {
  const { setExtrudeCallback } = useSketch()
  const { addExtrudedShape } = useShapes()

  useEffect(() => {
    setExtrudeCallback((geometry, topologyMap, length, metadata = {}) => {
      addExtrudedShape(geometry, topologyMap, length, metadata)
    })
  }, [setExtrudeCallback, addExtrudedShape])

  return null
}

function AppContent() {
  const { isLoading, error, shapes } = useShapes()
  const { currentResult, features } = useFeatureTree()
  const { setSelectionSummary, setUndoAvailable, setRedoAvailable } = useUIState()
  const { selectedBodies, selectedFaces, selectedEdges, selectedVertices, selectedSolids } = useSelection()
  const didMarkRef = useRef(false)

  useEffect(() => {
    if (!didMarkRef.current) {
      didMarkRef.current = true
      if (window.__BOOT) window.__BOOT.mark('app-render', true)
    }
  }, [])

  useEffect(() => {
    setUndoAvailable(features.length > 0)
    setRedoAvailable(false)
  }, [features.length, setUndoAvailable, setRedoAvailable])

  const displayShapes = useMemo(() => {
    const result = []
    if (currentResult?.geometry) {
      result.push({
        id: 'feature-result',
        name: 'Feature Result',
        type: 'feature-result',
        occtShape: currentResult.shape,
        shapeRefId: 'shape-feature-result',
        geometry: currentResult.geometry,
        topologyMap: currentResult.topologyMap,
        color: 0x4a90d9,
        position: { x: 0, y: 0, z: 0 },
      })
    }
    result.push(...shapes)
    return result
  }, [currentResult, shapes])

  useEffect(() => {
    const count =
      selectedBodies.length +
      selectedSolids.size +
      Array.from(selectedFaces.values()).reduce((sum, set) => sum + set.size, 0) +
      Array.from(selectedEdges.values()).reduce((sum, set) => sum + set.size, 0) +
      Array.from(selectedVertices.values()).reduce((sum, set) => sum + set.size, 0)
    if (count === 0) {
      setSelectionSummary('No selection')
    } else {
      setSelectionSummary(`${count} selected`)
    }
  }, [selectedBodies, selectedSolids, selectedFaces, selectedEdges, selectedVertices, setSelectionSummary])

  return (
    <>
      <DebugOverlay />
      <ExtrudeConnector />

      {isLoading && (
        <div className="absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-700">
          CAD engine loading...
        </div>
      )}
      {error && (
        <div className="absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded border border-rose-300 bg-rose-50 px-3 py-1 text-xs text-rose-700">
          CAD engine error: {error}
        </div>
      )}

      <AppShell
        viewport={<Viewport customShapes={displayShapes} />}
        overlays={
          <>
            <SketchCanvas />
            <ConstraintPanel />
            <ImportDropOverlay />
          </>
        }
      />
    </>
  )
}

export default function App() {
  useEffect(() => {
    if (window.__BOOT) window.__BOOT.mark('app-render', true)
  }, [])

  return (
    <ErrorBoundary>
      <ShapeProvider>
        <FeatureTreeProvider>
          <FeatureHistoryProvider>
            <SketchProvider>
              <SelectionProvider>
                <WorkspaceProvider>
                  <UIStateProvider>
                    <AppContent />
                  </UIStateProvider>
                </WorkspaceProvider>
              </SelectionProvider>
            </SketchProvider>
          </FeatureHistoryProvider>
        </FeatureTreeProvider>
      </ShapeProvider>
    </ErrorBoundary>
  )
}
