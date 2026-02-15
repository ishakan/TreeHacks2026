import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelection, SelectionMode } from '../context/SelectionContext'
import { useShapes } from '../context/ShapeContext'
import { useSketch } from '../context/SketchContext'
import { useFeatureHistory } from '../context/FeatureHistoryContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useFeatureTree } from '../context/FeatureTreeContext'

export default function SelectionInspector() {
  const {
    selectionMode,
    setSelectionMode,
    selectedFaces,
    selectedEdges,
    selectedVertices,
    selectedSolids,
    selectedBodies,
    hoveredItem,
    getSelectedFacesFlat,
    getSelectedEdgesFlat,
    getSelectedVerticesFlat,
  } = useSelection()
  
  const { shapes } = useShapes()
  const { isSketchMode } = useSketch()
  const {
    bodies,
    activeBodyId,
    getBody,
    updateBodyTransform,
    transformMode,
    setTransformMode,
    convertMeshBodyToSolid,
    booleanBodies,
    getBodyDebugInfo,
    highlightBodyMeshes,
    debugEnabled,
  } = useWorkspace()
  const { features, selectedFeatureId, getFeature, upsertTransformFeatureForBody } = useFeatureTree()
  const [highlightMeshes, setHighlightMeshes] = useState(false)
  const lastHighlightedBodyRef = useRef(null)
  
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
  const totalBodyCount = selectedBodies.length
  const totalSelection = totalFaces + totalEdges + totalVertices + totalSolids + totalBodyCount

  const selectedBody = useMemo(() => {
    const selectedId = selectedBodies[0] || activeBodyId
    return selectedId ? getBody(selectedId) : null
  }, [selectedBodies, activeBodyId, getBody])

  const selectedBodyTransform = useMemo(() => {
    if (!selectedBody) return null
    if (selectedBody.kind !== 'brep') return selectedBody.transform

    const selectedFeature = selectedFeatureId ? getFeature(selectedFeatureId) : null
    const matching = (
      selectedFeature?.type === 'transform' && selectedFeature.params?.bodyId === selectedBody.id
    )
      ? selectedFeature
      : [...features].reverse().find((feature) => (
        feature.type === 'transform' && feature.params?.bodyId === selectedBody.id
      ))

    if (!matching) return selectedBody.transform
    return {
      position: [
        matching.params.translateX ?? 0,
        matching.params.translateY ?? 0,
        matching.params.translateZ ?? 0,
      ],
      rotation: [
        (matching.params.rotateX ?? 0) * Math.PI / 180,
        (matching.params.rotateY ?? 0) * Math.PI / 180,
        (matching.params.rotateZ ?? 0) * Math.PI / 180,
      ],
      scale: [
        matching.params.scaleX ?? matching.params.scale ?? 1,
        matching.params.scaleY ?? matching.params.scale ?? 1,
        matching.params.scaleZ ?? matching.params.scale ?? 1,
      ],
    }
  }, [selectedBody, selectedFeatureId, getFeature, features])

  const selectedBodiesResolved = useMemo(() => {
    return selectedBodies.map((id) => bodies.find((b) => b.id === id)).filter(Boolean)
  }, [selectedBodies, bodies])

  const selectedBodyDebug = useMemo(() => {
    if (!selectedBody || !debugEnabled) return null
    return getBodyDebugInfo(selectedBody.id)
  }, [selectedBody, debugEnabled, getBodyDebugInfo])

  useEffect(() => {
    if (lastHighlightedBodyRef.current) {
      highlightBodyMeshes(lastHighlightedBodyRef.current, false)
      lastHighlightedBodyRef.current = null
    }
    setHighlightMeshes(false)
  }, [selectedBody?.id, highlightBodyMeshes])

  useEffect(() => {
    return () => {
      if (lastHighlightedBodyRef.current) {
        highlightBodyMeshes(lastHighlightedBodyRef.current, false)
      }
    }
  }, [highlightBodyMeshes])

  // Calculate total area for selected faces
  const totalArea = useMemo(() => {
    return selectedFacesData.reduce((sum, face) => sum + (face.area || 0), 0)
  }, [selectedFacesData])

  // Calculate total length for selected edges
  const totalLength = useMemo(() => {
    return selectedEdgesData.reduce((sum, edge) => sum + (edge.length || 0), 0)
  }, [selectedEdgesData])

  const updateSelectedBodyTransformAxis = (group, axis, value) => {
    if (!selectedBody || !selectedBodyTransform) return
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    const nextTransform = {
      position: [...selectedBodyTransform.position],
      rotation: [...selectedBodyTransform.rotation],
      scale: [...selectedBodyTransform.scale],
    }
    nextTransform[group][axis] = numeric
    if (selectedBody.kind === 'brep') {
      const selectedFeature = selectedFeatureId ? getFeature(selectedFeatureId) : null
      const preferredFeatureId = (
        selectedFeature?.type === 'transform' && selectedFeature.params?.bodyId === selectedBody.id
      )
        ? selectedFeature.id
        : null
      upsertTransformFeatureForBody(selectedBody.id, selectedBody.name, nextTransform, preferredFeatureId)
      updateBodyTransform(selectedBody.id, {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      })
      return
    }
    updateBodyTransform(selectedBody.id, nextTransform)
  }

  const handleConvertToSolid = () => {
    if (!selectedBody || selectedBody.kind !== 'mesh') return
    const result = convertMeshBodyToSolid(selectedBody.id)
    if (!result.ok) {
      alert(`Convert mesh to solid failed: ${result.error}`)
      return
    }
    if (result.warning) {
      alert(`Converted with warning: ${result.warning}`)
    }
  }

  const handleBoolean = (operation) => {
    if (selectedBodiesResolved.length < 2) {
      alert('Select exactly two bodies (target first, tool second).')
      return
    }
    const [target, tool] = selectedBodiesResolved
    const result = booleanBodies(target.id, tool.id, operation)
    if (!result.ok) {
      alert(`Boolean failed: ${result.error}`)
    }
  }

  const toggleHighlightMeshes = () => {
    if (!selectedBody) return
    const next = !highlightMeshes
    setHighlightMeshes(next)
    highlightBodyMeshes(selectedBody.id, next)
    lastHighlightedBodyRef.current = next ? selectedBody.id : null
  }

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
            onClick={() => setSelectionMode(SelectionMode.BODY)}
            className={getModeButtonClass(SelectionMode.BODY)}
          >
            Body
          </button>
        </div>
      </div>

      {/* Body Transform and Workflow */}
      {selectedBody && (
        <div className="p-3 border-b border-gray-700 space-y-2">
          <div className="text-xs text-gray-400">Body</div>
          <div className="text-sm text-blue-300">{selectedBody.name} ({selectedBody.kind})</div>

          <div className="flex gap-1">
            <button
              onClick={() => setTransformMode('translate')}
              className={`px-2 py-1 text-xs rounded ${transformMode === 'translate' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              Move
            </button>
            <button
              onClick={() => setTransformMode('rotate')}
              className={`px-2 py-1 text-xs rounded ${transformMode === 'rotate' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              Rotate
            </button>
            <button
              onClick={() => setTransformMode('scale')}
              className={`px-2 py-1 text-xs rounded ${transformMode === 'scale' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              Scale
            </button>
          </div>

          <TransformRow
            label="Position"
            values={selectedBodyTransform?.position || [0, 0, 0]}
            onChange={(axis, value) => updateSelectedBodyTransformAxis('position', axis, value)}
          />
          <TransformRow
            label="Rotation"
            values={selectedBodyTransform?.rotation || [0, 0, 0]}
            onChange={(axis, value) => updateSelectedBodyTransformAxis('rotation', axis, value)}
          />
          <TransformRow
            label="Scale"
            values={selectedBodyTransform?.scale || [1, 1, 1]}
            onChange={(axis, value) => updateSelectedBodyTransformAxis('scale', axis, value)}
          />

          {selectedBody.kind === 'mesh' && (
            <button
              onClick={handleConvertToSolid}
              className="w-full px-2 py-1 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600"
            >
              Convert Mesh to Solid (Experimental)
            </button>
          )}

          <div className="text-[11px] text-gray-500">
            Mesh: Move/Rotate/Scale and Mesh Boolean (approx). Solid-only features require conversion.
          </div>

          {debugEnabled && selectedBodyDebug && (
            <div className="mt-2 rounded border border-gray-700 p-2 text-[11px] text-gray-300 space-y-1">
              <div className="text-gray-400">Debug (Imported Body)</div>
              <div>uuid: <span className="text-gray-500">{selectedBodyDebug.objectUuid || 'n/a'}</span></div>
              <div>meshCount: {selectedBodyDebug.meshCount ?? 0}</div>
              <div>triangles: {selectedBodyDebug.triangles ?? 0}</div>
              <div>
                bbox: {selectedBodyDebug.bbox
                  ? `min(${selectedBodyDebug.bbox.min.map((v) => v.toFixed(3)).join(', ')}) max(${selectedBodyDebug.bbox.max.map((v) => v.toFixed(3)).join(', ')})`
                  : 'empty'}
              </div>
              <button
                onClick={toggleHighlightMeshes}
                className="w-full px-2 py-1 rounded bg-amber-700 text-white hover:bg-amber-600"
              >
                {highlightMeshes ? 'Unhighlight meshes' : 'Highlight meshes'}
              </button>
            </div>
          )}
        </div>
      )}

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
              {totalBodyCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Bodies:</span>
                  <span className="text-orange-400">{totalBodyCount}</span>
                </div>
              )}
            </div>

            {selectedBodiesResolved.length >= 2 && (
              <>
                <div className="border-t border-gray-700 my-2" />
                <div className="text-xs text-gray-400">Boolean (Body)</div>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={() => handleBoolean('union')}
                    className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
                  >
                    Join
                  </button>
                  <button
                    onClick={() => handleBoolean('cut')}
                    className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
                  >
                    Cut
                  </button>
                  <button
                    onClick={() => handleBoolean('intersect')}
                    className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
                  >
                    Intersect
                  </button>
                </div>
                <div className="text-[11px] text-gray-500">
                  Mesh bodies use Mesh Boolean (approx). Mixed mesh/solid operations run via OCCT with proxy mesh conversion.
                </div>
              </>
            )}

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

function TransformRow({ label, values, onChange }) {
  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        {[0, 1, 2].map((axis) => (
          <input
            key={`${label}-${axis}`}
            type="number"
            step={label === 'Scale' ? 0.01 : 0.1}
            value={values[axis]}
            onChange={(e) => onChange(axis, e.target.value)}
            className="w-full px-1 py-1 text-xs bg-gray-700 text-gray-200 rounded border border-gray-600"
          />
        ))}
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
