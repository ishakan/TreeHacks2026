import { useMemo, useState } from 'react'
import { useSelection, SelectionMode } from '../context/SelectionContext'
import { useShapes } from '../context/ShapeContext'
import { useSketch } from '../context/SketchContext'
import { useFeatureHistory } from '../context/FeatureHistoryContext'

export default function SelectionInspector() {
  const {
    selectionMode,
    setSelectionMode,
    selectedFaces,
    selectedEdges,
    selectedVertices,
    selectedSolids,
    hoveredItem,
    getSelectedFacesFlat,
    getSelectedEdgesFlat,
    getSelectedVerticesFlat,
  } = useSelection()
  
  const { shapes } = useShapes()
  const { isSketchMode } = useSketch()
  
  // Get feature history for persistent ID info
  const {
    debugMode,
    setDebugMode,
    getPersistentIdsForShape,
    getDescriptor,
  } = useFeatureHistory()
  
  const isDebugMode = debugMode
  const toggleDebugMode = setDebugMode

  // Get flattened selection data with properties
  const selectedFacesData = useMemo(() => 
    getSelectedFacesFlat(shapes), 
    [getSelectedFacesFlat, shapes]
  )
  
  const selectedEdgesData = useMemo(() => 
    getSelectedEdgesFlat(shapes), 
    [getSelectedEdgesFlat, shapes]
  )
  
  const selectedVerticesData = useMemo(() => 
    getSelectedVerticesFlat(shapes), 
    [getSelectedVerticesFlat, shapes]
  )

  // Calculate totals
  const totalFaces = selectedFacesData.length
  const totalEdges = selectedEdgesData.length
  const totalVertices = selectedVerticesData.length
  const totalSolids = selectedSolids.size
  const totalSelection = totalFaces + totalEdges + totalVertices + totalSolids

  // Calculate total area for selected faces
  const totalArea = useMemo(() => {
    return selectedFacesData.reduce((sum, face) => sum + (face.area || 0), 0)
  }, [selectedFacesData])

  // Calculate total length for selected edges
  const totalLength = useMemo(() => {
    return selectedEdgesData.reduce((sum, edge) => sum + (edge.length || 0), 0)
  }, [selectedEdgesData])

  // Don't show in sketch mode
  if (isSketchMode) return null

  // Mode button styles
  const getModeButtonClass = (mode) => {
    const isActive = selectionMode === mode
    return `px-2 py-1 text-xs rounded transition-colors ${
      isActive 
        ? 'bg-blue-600 text-white' 
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`
  }

  return (
    <div className="absolute bottom-4 right-4 w-64 bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-gray-750 border-b border-gray-700">
        <h3 className="text-sm font-medium text-white">Selection Inspector</h3>
      </div>

      {/* Selection Mode */}
      <div className="p-3 border-b border-gray-700">
        <div className="text-xs text-gray-400 mb-2">Selection Mode</div>
        <div className="flex gap-1">
          <button 
            onClick={() => setSelectionMode(SelectionMode.FACE)}
            className={getModeButtonClass(SelectionMode.FACE)}
          >
            Face
          </button>
          <button 
            onClick={() => setSelectionMode(SelectionMode.EDGE)}
            className={getModeButtonClass(SelectionMode.EDGE)}
          >
            Edge
          </button>
          <button 
            onClick={() => setSelectionMode(SelectionMode.VERTEX)}
            className={getModeButtonClass(SelectionMode.VERTEX)}
          >
            Vertex
          </button>
          <button 
            onClick={() => setSelectionMode(SelectionMode.SOLID)}
            className={getModeButtonClass(SelectionMode.SOLID)}
          >
            Solid
          </button>
        </div>
      </div>

      {/* Debug Mode Toggle */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <span className="text-xs text-gray-400">Debug Mode</span>
        <button
          onClick={() => toggleDebugMode(!isDebugMode)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            isDebugMode
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
          }`}
        >
          {isDebugMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Hover Info */}
      {hoveredItem && (
        <HoverInfo 
          hoveredItem={hoveredItem} 
          isDebugMode={isDebugMode}
          shapes={shapes}
          getPersistentIdsForShape={getPersistentIdsForShape}
          getDescriptor={getDescriptor}
        />
      )}

      {/* Selection Summary */}
      <div className="p-3">
        {totalSelection === 0 ? (
          <div className="text-sm text-gray-500 text-center py-2">
            No selection
          </div>
        ) : (
          <div className="space-y-2">
            {/* Selection Counts */}
            <div className="text-xs text-gray-400">Selected</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {totalFaces > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Faces:</span>
                  <span className="text-orange-400">{totalFaces}</span>
                </div>
              )}
              {totalEdges > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Edges:</span>
                  <span className="text-orange-400">{totalEdges}</span>
                </div>
              )}
              {totalVertices > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Vertices:</span>
                  <span className="text-orange-400">{totalVertices}</span>
                </div>
              )}
              {totalSolids > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Solids:</span>
                  <span className="text-orange-400">{totalSolids}</span>
                </div>
              )}
            </div>

            {/* Properties */}
            {(totalArea > 0 || totalLength > 0) && (
              <>
                <div className="border-t border-gray-700 my-2" />
                <div className="text-xs text-gray-400">Properties</div>
                <div className="space-y-1 text-sm">
                  {totalArea > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Total Area:</span>
                      <span className="text-green-400">{totalArea.toFixed(4)} u²</span>
                    </div>
                  )}
                  {totalLength > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-400">Total Length:</span>
                      <span className="text-green-400">{totalLength.toFixed(4)} u</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Individual Face Details */}
            {selectedFacesData.length > 0 && selectedFacesData.length <= 5 && (
              <>
                <div className="border-t border-gray-700 my-2" />
                <div className="text-xs text-gray-400">Face Details</div>
                <div className="space-y-1 text-xs max-h-24 overflow-y-auto">
                  {selectedFacesData.map((face, i) => (
                    <div key={`${face.shapeId}-${face.faceId}`} className="flex justify-between text-gray-300">
                      <span>{face.faceId}</span>
                      <span className="text-gray-500">
                        {face.area?.toFixed(3)} u²
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Individual Edge Details */}
            {selectedEdgesData.length > 0 && selectedEdgesData.length <= 5 && (
              <>
                <div className="border-t border-gray-700 my-2" />
                <div className="text-xs text-gray-400">Edge Details</div>
                <div className="space-y-1 text-xs max-h-24 overflow-y-auto">
                  {selectedEdgesData.map((edge, i) => (
                    <div key={`${edge.shapeId}-${edge.edgeId}`} className="flex justify-between text-gray-300">
                      <span>{edge.edgeId}</span>
                      <span className="text-gray-500">
                        {edge.length?.toFixed(3)} u
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Vertex Position Details */}
            {selectedVerticesData.length > 0 && selectedVerticesData.length <= 5 && (
              <>
                <div className="border-t border-gray-700 my-2" />
                <div className="text-xs text-gray-400">Vertex Details</div>
                <div className="space-y-1 text-xs max-h-24 overflow-y-auto">
                  {selectedVerticesData.map((vertex, i) => (
                    <div key={`${vertex.shapeId}-${vertex.vertexId}`} className="flex justify-between text-gray-300">
                      <span>{vertex.vertexId}</span>
                      <span className="text-gray-500">
                        ({vertex.position?.x?.toFixed(2)}, {vertex.position?.y?.toFixed(2)}, {vertex.position?.z?.toFixed(2)})
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="px-3 py-2 bg-gray-750 border-t border-gray-700">
        <div className="text-xs text-gray-500">
          <span className="text-gray-400">Shift+Click</span> multi-select • <span className="text-gray-400">Esc</span> deselect
        </div>
      </div>
    </div>
  )
}

/**
 * Hover info component with debug mode support
 */
function HoverInfo({ hoveredItem, isDebugMode, shapes, getPersistentIdsForShape, getDescriptor }) {
  // Find the shape being hovered
  const shape = shapes.find(s => s.id === hoveredItem.shapeId)
  
  // Get persistent ID info if in debug mode
  const persistentIdInfo = useMemo(() => {
    if (!isDebugMode || !getPersistentIdsForShape || !hoveredItem.shapeId) return null
    
    const allIds = getPersistentIdsForShape(hoveredItem.shapeId)
    
    // Find the specific hovered item
    if (hoveredItem.type === 'face' && hoveredItem.topologyId) {
      const face = allIds.faces.find(f => f.localIndex === parseInt(hoveredItem.topologyId.split('-')[1]))
      return face || null
    }
    if (hoveredItem.type === 'edge' && hoveredItem.topologyId) {
      const edge = allIds.edges.find(e => e.localIndex === parseInt(hoveredItem.topologyId.split('-')[1]))
      return edge || null
    }
    if (hoveredItem.type === 'vertex' && hoveredItem.topologyId) {
      const vertex = allIds.vertices.find(v => v.localIndex === parseInt(hoveredItem.topologyId.split('-')[1]))
      return vertex || null
    }
    
    return null
  }, [isDebugMode, getPersistentIdsForShape, hoveredItem])

  return (
    <div className="px-3 py-2 border-b border-gray-700 bg-gray-750">
      <div className="text-xs text-gray-400">Hover</div>
      <div className="text-sm text-blue-400">
        {hoveredItem.type}: {hoveredItem.topologyId || hoveredItem.shapeId}
      </div>
      
      {/* Debug mode: Show persistent ID info */}
      {isDebugMode && persistentIdInfo && (
        <div className="mt-2 space-y-1">
          <div className="border-t border-gray-600 pt-2">
            <div className="text-xs text-purple-400 font-medium">Persistent ID Info</div>
          </div>
          
          {/* Persistent ID */}
          <div className="text-xs">
            <span className="text-gray-500">ID: </span>
            <span className="text-purple-300 font-mono text-[10px]">
              {persistentIdInfo.persistentId || persistentIdInfo.id}
            </span>
          </div>
          
          {/* Hash */}
          <div className="text-xs">
            <span className="text-gray-500">Hash: </span>
            <span className="text-gray-300">{persistentIdInfo.hash}</span>
          </div>
          
          {/* Surface/Curve type */}
          {persistentIdInfo.surfaceType && (
            <div className="text-xs">
              <span className="text-gray-500">Surface: </span>
              <span className="text-cyan-400">{persistentIdInfo.surfaceType}</span>
            </div>
          )}
          {persistentIdInfo.curveType && (
            <div className="text-xs">
              <span className="text-gray-500">Curve: </span>
              <span className="text-cyan-400">{persistentIdInfo.curveType}</span>
            </div>
          )}
          
          {/* Centroid for faces */}
          {persistentIdInfo.centroid && (
            <div className="text-xs">
              <span className="text-gray-500">Centroid: </span>
              <span className="text-gray-300">
                ({persistentIdInfo.centroid.x?.toFixed(2)}, 
                 {persistentIdInfo.centroid.y?.toFixed(2)}, 
                 {persistentIdInfo.centroid.z?.toFixed(2)})
              </span>
            </div>
          )}
          
          {/* Neighbors for faces */}
          {persistentIdInfo.neighbors && persistentIdInfo.neighbors.length > 0 && (
            <div className="text-xs">
              <span className="text-gray-500">Neighbors: </span>
              <span className="text-yellow-400">
                [{persistentIdInfo.neighbors.join(', ')}]
              </span>
            </div>
          )}
          
          {/* Adjacent faces for edges */}
          {persistentIdInfo.adjacentFaces && persistentIdInfo.adjacentFaces.length > 0 && (
            <div className="text-xs">
              <span className="text-gray-500">Adj Faces: </span>
              <span className="text-yellow-400">
                [{persistentIdInfo.adjacentFaces.join(', ')}]
              </span>
            </div>
          )}
          
          {/* Generation info */}
          {persistentIdInfo.generation && (
            <div className="text-xs mt-1">
              <div className="text-gray-500">Generation:</div>
              <div className="text-[10px] text-green-400 font-mono pl-2 break-all">
                {persistentIdInfo.generation.descriptor}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Debug mode hint when no info available */}
      {isDebugMode && !persistentIdInfo && (
        <div className="mt-1 text-xs text-gray-500 italic">
          No persistent ID data (shape may not be registered)
        </div>
      )}
    </div>
  )
}
