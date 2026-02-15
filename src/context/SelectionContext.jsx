import { createContext, useContext, useState, useCallback } from 'react'

const SelectionContext = createContext(null)
const LOG_PREFIX = '[SelectionContext]'

// Selection modes
export const SelectionMode = {
  FACE: 'face',
  EDGE: 'edge',
  VERTEX: 'vertex',
  SOLID: 'solid',
  BODY: 'body',
}

export function SelectionProvider({ children }) {
  // Current selection mode
  const [selectionMode, setSelectionMode] = useState(SelectionMode.FACE)
  
  // Selected items: Map of shapeId -> Set of topologyIds
  const [selectedFaces, setSelectedFaces] = useState(new Map())
  const [selectedEdges, setSelectedEdges] = useState(new Map())
  const [selectedVertices, setSelectedVertices] = useState(new Map())
  const [selectedSolids, setSelectedSolids] = useState(new Set())
  const [selectedBodies, setSelectedBodies] = useState([])
  
  // Hover state for preselection highlighting
  const [hoveredItem, setHoveredItem] = useState(null) // { shapeId, type, topologyId }
  
  // Get total selection count
  const getSelectionCount = useCallback(() => {
    let count = 0
    selectedFaces.forEach(set => count += set.size)
    selectedEdges.forEach(set => count += set.size)
    selectedVertices.forEach(set => count += set.size)
    count += selectedSolids.size
    count += selectedBodies.length
    return count
  }, [selectedFaces, selectedEdges, selectedVertices, selectedSolids, selectedBodies])

  // Select a face
  const selectFace = useCallback((shapeId, faceId, multiSelect = false) => {
    console.log(`${LOG_PREFIX} selectFace: shape=${shapeId}, face=${faceId}, multi=${multiSelect}`)
    
    setSelectedFaces(prev => {
      const newMap = multiSelect ? new Map(prev) : new Map()
      
      if (!newMap.has(shapeId)) {
        newMap.set(shapeId, new Set())
      }
      
      const faceSet = newMap.get(shapeId)
      if (multiSelect && faceSet.has(faceId)) {
        // Toggle off if already selected
        faceSet.delete(faceId)
        if (faceSet.size === 0) newMap.delete(shapeId)
      } else {
        if (!multiSelect) {
          // Clear existing selection for this shape
          newMap.set(shapeId, new Set([faceId]))
        } else {
          faceSet.add(faceId)
        }
      }
      
      return newMap
    })
    
    // Clear other selection types if not multi-select
    if (!multiSelect) {
      setSelectedEdges(new Map())
      setSelectedVertices(new Map())
      setSelectedSolids(new Set())
    }
  }, [])

  // Select an edge
  const selectEdge = useCallback((shapeId, edgeId, multiSelect = false) => {
    console.log(`${LOG_PREFIX} selectEdge: shape=${shapeId}, edge=${edgeId}, multi=${multiSelect}`)
    
    setSelectedEdges(prev => {
      const newMap = multiSelect ? new Map(prev) : new Map()
      
      if (!newMap.has(shapeId)) {
        newMap.set(shapeId, new Set())
      }
      
      const edgeSet = newMap.get(shapeId)
      if (multiSelect && edgeSet.has(edgeId)) {
        edgeSet.delete(edgeId)
        if (edgeSet.size === 0) newMap.delete(shapeId)
      } else {
        if (!multiSelect) {
          newMap.set(shapeId, new Set([edgeId]))
        } else {
          edgeSet.add(edgeId)
        }
      }
      
      return newMap
    })
    
    if (!multiSelect) {
      setSelectedFaces(new Map())
      setSelectedVertices(new Map())
      setSelectedSolids(new Set())
    }
  }, [])

  // Select a vertex
  const selectVertex = useCallback((shapeId, vertexId, multiSelect = false) => {
    console.log(`${LOG_PREFIX} selectVertex: shape=${shapeId}, vertex=${vertexId}, multi=${multiSelect}`)
    
    setSelectedVertices(prev => {
      const newMap = multiSelect ? new Map(prev) : new Map()
      
      if (!newMap.has(shapeId)) {
        newMap.set(shapeId, new Set())
      }
      
      const vertexSet = newMap.get(shapeId)
      if (multiSelect && vertexSet.has(vertexId)) {
        vertexSet.delete(vertexId)
        if (vertexSet.size === 0) newMap.delete(shapeId)
      } else {
        if (!multiSelect) {
          newMap.set(shapeId, new Set([vertexId]))
        } else {
          vertexSet.add(vertexId)
        }
      }
      
      return newMap
    })
    
    if (!multiSelect) {
      setSelectedFaces(new Map())
      setSelectedEdges(new Map())
      setSelectedSolids(new Set())
    }
  }, [])

  // Select a solid (entire shape)
  const selectSolid = useCallback((shapeId, multiSelect = false) => {
    console.log(`${LOG_PREFIX} selectSolid: shape=${shapeId}, multi=${multiSelect}`)
    
    setSelectedSolids(prev => {
      const newSet = multiSelect ? new Set(prev) : new Set()
      
      if (multiSelect && newSet.has(shapeId)) {
        newSet.delete(shapeId)
      } else {
        newSet.add(shapeId)
      }
      
      return newSet
    })
    
    if (!multiSelect) {
      setSelectedFaces(new Map())
      setSelectedEdges(new Map())
      setSelectedVertices(new Map())
      setSelectedBodies([shapeId])
    }
  }, [])

  const selectBody = useCallback((bodyId, multiSelect = false) => {
    setSelectedBodies((prev) => {
      if (!multiSelect) return [bodyId]
      if (prev.includes(bodyId)) return prev.filter((id) => id !== bodyId)
      return [...prev, bodyId]
    })

    if (!multiSelect) {
      setSelectedFaces(new Map())
      setSelectedEdges(new Map())
      setSelectedVertices(new Map())
      setSelectedSolids(new Set([bodyId]))
    }
  }, [])

  // Clear all selections
  const clearSelection = useCallback(() => {
    console.log(`${LOG_PREFIX} clearSelection`)
    setSelectedFaces(new Map())
    setSelectedEdges(new Map())
    setSelectedVertices(new Map())
    setSelectedSolids(new Set())
    setSelectedBodies([])
    setHoveredItem(null)
  }, [])

  // Set hover state
  const setHover = useCallback((shapeId, type, topologyId, bodyId = null, subkind = null) => {
    if (shapeId === null && bodyId === null) {
      setHoveredItem(null)
    } else {
      setHoveredItem({ shapeId, type, topologyId, bodyId, subkind })
    }
  }, [])

  // Check if a face is selected
  const isFaceSelected = useCallback((shapeId, faceId) => {
    return selectedFaces.get(shapeId)?.has(faceId) || false
  }, [selectedFaces])

  // Check if an edge is selected
  const isEdgeSelected = useCallback((shapeId, edgeId) => {
    return selectedEdges.get(shapeId)?.has(edgeId) || false
  }, [selectedEdges])

  // Check if a vertex is selected
  const isVertexSelected = useCallback((shapeId, vertexId) => {
    return selectedVertices.get(shapeId)?.has(vertexId) || false
  }, [selectedVertices])

  // Check if a solid is selected
  const isSolidSelected = useCallback((shapeId) => {
    return selectedSolids.has(shapeId)
  }, [selectedSolids])

  const isBodySelected = useCallback((bodyId) => {
    return selectedBodies.includes(bodyId)
  }, [selectedBodies])

  // Get selected faces as flat array: [{ shapeId, faceId, data }]
  const getSelectedFacesFlat = useCallback((shapes) => {
    const result = []
    selectedFaces.forEach((faceSet, shapeId) => {
      const shape = shapes.find(s => s.id === shapeId)
      if (shape?.topologyMap?.faces) {
        faceSet.forEach(faceId => {
          const faceData = shape.topologyMap.faces.get(faceId)
          if (faceData) {
            result.push({ shapeId, faceId, ...faceData })
          }
        })
      }
    })
    return result
  }, [selectedFaces])

  // Get selected edges as flat array
  const getSelectedEdgesFlat = useCallback((shapes) => {
    const result = []
    selectedEdges.forEach((edgeSet, shapeId) => {
      const shape = shapes.find(s => s.id === shapeId)
      if (shape?.topologyMap?.edges) {
        edgeSet.forEach(edgeId => {
          const edgeData = shape.topologyMap.edges.get(edgeId)
          if (edgeData) {
            result.push({ shapeId, edgeId, ...edgeData })
          }
        })
      }
    })
    return result
  }, [selectedEdges])

  // Get selected vertices as flat array
  const getSelectedVerticesFlat = useCallback((shapes) => {
    const result = []
    selectedVertices.forEach((vertexSet, shapeId) => {
      const shape = shapes.find(s => s.id === shapeId)
      if (shape?.topologyMap?.vertices) {
        vertexSet.forEach(vertexId => {
          const vertexData = shape.topologyMap.vertices.get(vertexId)
          if (vertexData) {
            result.push({ shapeId, vertexId, ...vertexData })
          }
        })
      }
    })
    return result
  }, [selectedVertices])

  const value = {
    selectionMode,
    setSelectionMode,
    selectedFaces,
    selectedEdges,
    selectedVertices,
    selectedSolids,
    selectedBodies,
    hoveredItem,
    getSelectionCount,
    selectFace,
    selectEdge,
    selectVertex,
    selectSolid,
    selectBody,
    clearSelection,
    setHover,
    isFaceSelected,
    isEdgeSelected,
    isVertexSelected,
    isSolidSelected,
    isBodySelected,
    getSelectedFacesFlat,
    getSelectedEdgesFlat,
    getSelectedVerticesFlat,
  }

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection() {
  const context = useContext(SelectionContext)
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider')
  }
  return context
}
