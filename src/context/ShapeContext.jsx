import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { initOCCT, createShape, shapeToGeometry } from '../services/occtService'

const ShapeContext = createContext(null)
const LOG_PREFIX = '[ShapeContext]'

// Helper to update boot tracker
function bootMark(key, ok, error) {
  if (typeof window !== 'undefined' && window.__BOOT) {
    window.__BOOT.mark(key, ok, error);
  }
}

export function ShapeProvider({ children }) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [shapes, setShapes] = useState([])
  const [selectedShapeId, setSelectedShapeId] = useState(null)
  const initStartedRef = useRef(false)

  // Initialize OCCT on mount with timeout
  useEffect(() => {
    // Guard against double-init in StrictMode
    if (initStartedRef.current) return;
    initStartedRef.current = true;
    
    // Check if OCCT is disabled via localStorage
    if (typeof window !== 'undefined' && window.__BOOT?.isOCCTDisabled?.()) {
      console.log(`${LOG_PREFIX} OCCT disabled via localStorage`)
      bootMark('occt', false, 'Disabled by user');
      setError('OCCT disabled by user (click Enable OCCT to re-enable)');
      setIsLoading(false);
      return;
    }
    
    console.log(`${LOG_PREFIX} Starting OCCT initialization`);
    bootMark('occt', false); // Mark as in-progress
    
    let timeoutId = null;
    let didTimeout = false;
    
    // Timeout after 30 seconds
    timeoutId = setTimeout(() => {
      didTimeout = true;
      console.warn(`${LOG_PREFIX} OCCT initialization timed out after 30s`);
      bootMark('occt', false, 'Timeout after 30s');
      setError('CAD engine initialization timed out.');
      setIsLoading(false);
    }, 30000);
    
    initOCCT()
      .then(() => {
        if (didTimeout) return;
        clearTimeout(timeoutId);
        console.log(`${LOG_PREFIX} ✓ OCCT initialization SUCCESS`);
        bootMark('occt', true);
        setIsReady(true);
        setIsLoading(false);
      })
      .catch((err) => {
        if (didTimeout) return;
        clearTimeout(timeoutId);
        console.error(`${LOG_PREFIX} ✗ OCCT initialization FAILED:`, err);
        bootMark('occt', false, err.message);
        setError(err.message);
        setIsLoading(false);
      });
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [])

  // Add a new shape
  const addShape = useCallback((definition) => {
    console.log(`${LOG_PREFIX} addShape() called with:`, definition)
    
    if (!isReady) {
      console.warn(`${LOG_PREFIX} OCCT not ready, cannot add shape`)
      return null
    }

    try {
      console.log(`${LOG_PREFIX} Step 1: Creating OCCT B-Rep shape...`)
      const occtShape = createShape(definition)
      console.log(`${LOG_PREFIX} ✓ OCCT shape created:`, occtShape ? 'valid' : 'NULL')
      
      console.log(`${LOG_PREFIX} Step 2: Triangulating shape...`)
      const { geometry, topologyMap } = shapeToGeometry(occtShape)
      console.log(`${LOG_PREFIX} ✓ Geometry created:`)
      console.log(`${LOG_PREFIX}   - Vertices: ${geometry.attributes.position?.count || 0}`)
      console.log(`${LOG_PREFIX}   - Indices: ${geometry.index?.count || 0}`)
      console.log(`${LOG_PREFIX}   - Faces: ${topologyMap.faces.size}, Edges: ${topologyMap.edges.size}, Vertices: ${topologyMap.vertices.size}`)
      
      const newShape = {
        id: `shape-${Date.now()}`,
        name: definition.name || `${definition.type} ${shapes.length + 1}`,
        type: definition.type,
        occtShape,
        shapeRefId: `shape-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        params: definition.params,
        color: definition.color || 0x4a90d9,
        position: definition.position || { x: 0, y: 0, z: 0 },
        geometry,
        topologyMap,
      }

      console.log(`${LOG_PREFIX} Step 3: Adding shape to state:`, newShape.id)
      setShapes((prev) => {
        const updated = [...prev, newShape]
        console.log(`${LOG_PREFIX} ✓ Shapes array now has ${updated.length} items`)
        return updated
      })
      setSelectedShapeId(newShape.id)
      
      return newShape
    } catch (err) {
      console.error(`${LOG_PREFIX} ✗ Failed to create shape:`, err)
      console.error(err.stack)
      setError(err.message)
      return null
    }
  }, [isReady, shapes.length])

  // Remove a shape
  const removeShape = useCallback((id) => {
    setShapes((prev) => prev.filter((s) => s.id !== id))
    if (selectedShapeId === id) {
      setSelectedShapeId(null)
    }
  }, [selectedShapeId])

  // Update a shape
  const updateShape = useCallback((id, updates) => {
    setShapes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    )
  }, [])

  // Clear all shapes
  const clearShapes = useCallback(() => {
    setShapes([])
    setSelectedShapeId(null)
  }, [])

  // Add an extruded shape (from sketch extrusion)
  const addExtrudedShape = useCallback((geometry, topologyMap, extrudeLength, metadata = {}) => {
    console.log(`${LOG_PREFIX} addExtrudedShape() - length: ${extrudeLength}`)
    
    const newShape = {
      id: `extrude-${Date.now()}`,
      name: `Extrusion ${shapes.length + 1}`,
      type: 'extrusion',
      params: { length: extrudeLength, sketchId: metadata.sketchId || null },
      color: 0x6b5b95,
      position: { x: 0, y: 0, z: 0 },
      geometry,
      topologyMap: topologyMap || null,
    }

    console.log(`${LOG_PREFIX} ✓ Adding extruded shape:`, newShape.id)
    setShapes((prev) => [...prev, newShape])
    setSelectedShapeId(newShape.id)
    
    return newShape
  }, [shapes.length])

  const value = {
    isLoading,
    isReady,
    error,
    shapes,
    selectedShapeId,
    setSelectedShapeId,
    addShape,
    addExtrudedShape,
    removeShape,
    updateShape,
    clearShapes,
  }

  return (
    <ShapeContext.Provider value={value}>
      {children}
    </ShapeContext.Provider>
  )
}

export function useShapes() {
  const context = useContext(ShapeContext)
  if (!context) {
    throw new Error('useShapes must be used within a ShapeProvider')
  }
  return context
}
