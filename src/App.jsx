import { useState, useEffect, Component, useMemo, useRef } from 'react'
import Viewport from './components/Viewport'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import SketchCanvas from './components/SketchCanvas'
import ConstraintPanel from './components/ConstraintPanel'
import SelectionInspector from './components/SelectionInspector'
import FeatureTree, { FeatureEditor } from './components/FeatureTree'
import DebugOverlay from './components/DebugOverlay'
import ImportDropOverlay from './components/ImportDropOverlay'
import ImportsPanel from './components/ImportsPanel'
import { ShapeProvider, useShapes } from './context/ShapeContext'
import { SketchProvider, useSketch } from './context/SketchContext'
import { SelectionProvider } from './context/SelectionContext'
import { FeatureHistoryProvider } from './context/FeatureHistoryContext'
import { FeatureTreeProvider, useFeatureTree } from './context/FeatureTreeContext'
import { ImportsProvider } from './context/ImportsContext'

// Mark app-render in boot tracker
if (typeof window !== 'undefined' && window.__BOOT) {
  window.__BOOT.mark('app-render', true);
}

// Error Boundary to catch render errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    // Report to boot tracker
    if (typeof window !== 'undefined' && window.__BOOT) {
      window.__BOOT.error('React Error: ' + error.message, error.stack);
    }
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
    this.setState({ errorInfo })
    
    // Report to boot tracker
    if (typeof window !== 'undefined' && window.__BOOT) {
      window.__BOOT.error('React Error: ' + error.message, error.stack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center p-8 overflow-auto">
          <div className="text-red-500 text-2xl font-bold mb-4">Something went wrong</div>
          <div className="bg-gray-800 p-4 rounded-lg max-w-2xl w-full mb-4">
            <div className="text-red-400 text-sm mb-2 font-bold">Error:</div>
            <pre className="text-red-400 text-sm whitespace-pre-wrap mb-4">
              {this.state.error?.message || 'Unknown error'}
            </pre>
            {this.state.error?.stack && (
              <>
                <div className="text-gray-400 text-xs mb-1">Stack trace:</div>
                <pre className="text-gray-500 text-xs whitespace-pre-wrap max-h-48 overflow-auto">
                  {this.state.error.stack}
                </pre>
              </>
            )}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Component to connect sketch extrusion to shape context
function ExtrudeConnector() {
  const { setExtrudeCallback } = useSketch()
  const { addExtrudedShape } = useShapes()
  
  useEffect(() => {
    // Set the callback that will be called when extrude is performed
    setExtrudeCallback((geometry, topologyMap, length) => {
      addExtrudedShape(geometry, topologyMap, length)
    })
  }, [setExtrudeCallback, addExtrudedShape])
  
  return null
}

// Component to sync feature tree results to ShapeContext for viewport display
function FeatureViewportConnector() {
  const { currentResult, features } = useFeatureTree()
  const { shapes, clearShapes } = useShapes()
  const [lastResultId, setLastResultId] = useState(null)

  useEffect(() => {
    // Generate a unique ID for the current result based on features
    const resultId = features.map(f => `${f.id}:${f.status}`).join(',')
    
    // Only update if the result actually changed
    if (currentResult && resultId !== lastResultId) {
      // For now, we'll display the feature result directly in a custom way
      // by passing it through ShapeContext
      setLastResultId(resultId)
    }
  }, [currentResult, features, lastResultId])

  return null
}

function AppContent() {
  const [activeTool, setActiveTool] = useState(null)
  const { isLoading, isReady, error } = useShapes()
  const didMarkRef = useRef(false)

  // Mark app-render once (not blocking on OCCT)
  useEffect(() => {
    if (!didMarkRef.current) {
      didMarkRef.current = true;
      if (window.__BOOT) window.__BOOT.mark('app-render', true);
    }
  }, [])

  // NON-BLOCKING: Always render the UI, show status overlay for OCCT
  // The UI should render even if OCCT is loading or failed
  
  return (
    <div className="w-full h-screen flex flex-col bg-gray-900">
      {/* Debug Overlay */}
      <DebugOverlay />

      {/* OCCT Status Banner (non-blocking) */}
      {isLoading && (
        <div className="bg-yellow-900 text-yellow-200 px-4 py-1 text-sm text-center">
          ⏳ CAD Engine loading... (UI is functional)
        </div>
      )}
      {error && (
        <div className="bg-red-900 text-red-200 px-4 py-1 text-sm text-center">
          ⚠️ CAD Engine error: {error} (Some features unavailable)
        </div>
      )}

      {/* Connect sketch extrusion to shape context */}
      <ExtrudeConnector />
      <FeatureViewportConnector />

      {/* Top Toolbar */}
      <Toolbar activeTool={activeTool} onToolSelect={setActiveTool} />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Feature Tree */}
        <div className="w-56 flex flex-col">
          <FeatureTree />
        </div>

        {/* 3D Viewport with Sketch Canvas overlay */}
        <div className="flex-1 relative">
          <FeatureViewport />
          <SketchCanvas />
          <ConstraintPanel />
          <SelectionInspector />
          <ImportDropOverlay />
        </div>

        {/* Right Panel: Feature Editor + Imports + Original Sidebar */}
        <div className="w-64 flex flex-col border-l border-gray-700">
          <div className="border-b border-gray-700">
            <FeatureEditor />
          </div>
          <div className="border-b border-gray-700">
            <ImportsPanel />
          </div>
          <Sidebar />
        </div>
      </div>
    </div>
  )
}

// Viewport that displays feature tree result
function FeatureViewport() {
  const { currentResult } = useFeatureTree()
  const { shapes } = useShapes()
  const { isSketchMode } = useSketch()

  // Combine feature result with any direct shapes
  // Feature result takes priority for display
  const displayShapes = useMemo(() => {
    const result = []
    
    // Add feature tree result as a shape
    if (currentResult?.geometry) {
      result.push({
        id: 'feature-result',
        name: 'Feature Result',
        type: 'feature-result',
        geometry: currentResult.geometry,
        topologyMap: currentResult.topologyMap,
        color: 0x4a90d9,
        position: { x: 0, y: 0, z: 0 },
      })
    }
    
    // Also include any direct shapes (from sketch extrusion, etc.)
    result.push(...shapes)
    
    return result
  }, [currentResult, shapes])

  return <Viewport customShapes={displayShapes} />
}

export default function App() {
  // Mark that App function is being called
  useEffect(() => {
    if (window.__BOOT) window.__BOOT.mark('app-render', true);
  }, [])

  return (
    <ErrorBoundary>
      <ShapeProvider>
        <FeatureTreeProvider>
          <FeatureHistoryProvider>
            <SketchProvider>
              <SelectionProvider>
                <ImportsProvider>
                  <AppContent />
                </ImportsProvider>
              </SelectionProvider>
            </SketchProvider>
          </FeatureHistoryProvider>
        </FeatureTreeProvider>
      </ShapeProvider>
    </ErrorBoundary>
  )
}
