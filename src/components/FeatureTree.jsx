import { useState, useCallback, useMemo } from 'react'
import { useFeatureTree } from '../context/FeatureTreeContext'
import { FeatureStatus } from '../services/featureSystem'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSelection, SelectionMode } from '../context/SelectionContext'
import { useShapes } from '../context/ShapeContext'
import { useSketch } from '../context/SketchContext'
import { createEdgeSelectionRef } from '../services/selectionRef'
import { createPrimitiveFeature, isPrimitiveFeatureType } from '../services/primitiveTools'

/**
 * Feature Tree Component
 * 
 * Visual representation of the parametric feature tree with:
 * - Drag/drop reordering
 * - Rollback marker (blue line)
 * - Suppression toggle
 * - Error indicators
 * - Feature selection and editing
 */
export default function FeatureTree() {
  const {
    features,
    currentResult,
    rollbackIndex,
    isRegenerating,
    rebuildErrors,
    selectedFeatureId,
    setSelectedFeatureId,
    addFeature,
    removeFeature,
    toggleSuppression,
    reorderFeatures,
    rollbackTo,
    getAvailableFeatureTypes,
  } = useFeatureTree()

  const [showAddMenu, setShowAddMenu] = useState(false)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const { selectedBodies, selectedEdges, selectionMode, setSelectionMode } = useSelection()
  const { getBody } = useWorkspace()
  const { shapes } = useShapes()
  const {
    selectedSketchId,
    getSketchById,
    getExtrudableProfileForSketch,
  } = useSketch()

  const featureTypes = useMemo(() => getAvailableFeatureTypes(), [getAvailableFeatureTypes])
  const selectedEdgeCount = useMemo(() => {
    let count = 0
    selectedEdges.forEach((edgeSet) => {
      count += edgeSet.size
    })
    return count
  }, [selectedEdges])

  // Handle adding a new feature
  const handleAddFeature = useCallback((type) => {
    if (type === 'extrude') {
      const sketchId = selectedSketchId
      if (!sketchId) {
        alert('Select a sketch first (Sketches tab or click sketch geometry) before creating an extrude.')
        return
      }
      const profileResult = getExtrudableProfileForSketch(sketchId)
      if (!profileResult.ok) {
        alert(profileResult.error || 'Profile not closed. Create a closed loop before extruding.')
        return
      }
      const sketch = getSketchById(sketchId) || profileResult.sketch
      const extrudeCount = features.filter((entry) => entry.type === 'extrude').length + 1
      addFeature('extrude', `Extrude ${extrudeCount}`, {
        sketchId,
        sketchName: sketch?.name || `Sketch ${sketchId}`,
        plane: sketch?.plane || null,
        profile: profileResult.profile,
        wireKey: profileResult.wireKey || null,
        regionId: profileResult.wireKey || null,
        length: 10,
        direction: 'normal',
        operation: 'new',
        targetBodyId: null,
      }, [])
      setShowAddMenu(false)
      return
    }

    if (isPrimitiveFeatureType(type)) {
      createPrimitiveFeature({
        type,
        features,
        addFeature,
      })
      setShowAddMenu(false)
      return
    }

    const selectedBody = selectedBodies.length > 0 ? getBody(selectedBodies[0]) : null
    const solidOnlyTypes = new Set(['fillet', 'chamfer', 'shell', 'draft'])
    if (selectedBody?.kind === 'mesh' && solidOnlyTypes.has(type)) {
      alert('Convert mesh to solid to use this feature.')
      return
    }

    const isEdgeDriven = type === 'fillet' || type === 'chamfer'
    const selectedEdgeRefs = []
    selectedEdges.forEach((edgeSet, shapeId) => {
      edgeSet.forEach((edgeId) => {
        selectedEdgeRefs.push({ shapeId, edgeId })
      })
    })

    if (isEdgeDriven && selectionMode !== SelectionMode.EDGE) {
      setSelectionMode(SelectionMode.EDGE)
      alert('Fillet/Chamfer require edge selection. Switched to Edge mode; select edges and try again.')
      return
    }

    if (isEdgeDriven && selectedEdgeRefs.length === 0) {
      alert('Select one or more edges to create a fillet/chamfer feature.')
      return
    }

    const topologyLookup = new Map()
    if (currentResult?.topologyMap) {
      topologyLookup.set('feature-result', currentResult.topologyMap)
    }
    shapes.forEach((shape) => {
      if (shape?.id && shape?.topologyMap) {
        topologyLookup.set(shape.id, shape.topologyMap)
      }
    })

    const references = isEdgeDriven
      ? selectedEdgeRefs
        .map(({ shapeId, edgeId }) => {
          const topologyMap = topologyLookup.get(shapeId)
          const edgeData = topologyMap?.edges?.get?.(edgeId)
          return createEdgeSelectionRef({
            featureId: selectedFeatureId || null,
            edgeId,
            edgeData,
          })
        })
        .filter(Boolean)
      : []

    if (isEdgeDriven && references.length === 0) {
      alert('Selected edges have no stable topology metadata yet. Rebuild and try again.')
      return
    }

    const typeInfo = featureTypes.find(t => t.type === type)
    const name = `${typeInfo?.label || type} ${features.length + 1}`
    const params = isEdgeDriven ? { allEdges: false } : {}
    addFeature(type, name, params, references)
    setShowAddMenu(false)
  }, [
    addFeature,
    currentResult,
    featureTypes,
    features,
    selectedFeatureId,
    selectedBodies,
    selectedEdges,
    selectionMode,
    setSelectionMode,
    shapes,
    getBody,
    selectedSketchId,
    getSketchById,
    getExtrudableProfileForSketch,
  ])

  // Drag and drop handlers
  const handleDragStart = useCallback((e, index) => {
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault()
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index)
    }
  }, [draggedIndex])

  const handleDragEnd = useCallback(() => {
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      reorderFeatures(draggedIndex, dragOverIndex)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [draggedIndex, dragOverIndex, reorderFeatures])

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  // Get status icon
  const getStatusIcon = (feature, index) => {
    if (rollbackIndex !== -1 && index > rollbackIndex) {
      return '⏸️' // Rolled back
    }
    switch (feature.status) {
      case FeatureStatus.OK:
        return '✅'
      case FeatureStatus.NEEDS_REPAIR:
        return '🛠️'
      case FeatureStatus.ERROR:
        return '❌'
      case FeatureStatus.SUPPRESSED:
        return '🚫'
      case FeatureStatus.PENDING:
        return '⏳'
      default:
        return '⚪'
    }
  }

  // Get feature icon by type
  const getFeatureIcon = (type) => {
    switch (type) {
      case 'box': return '📦'
      case 'cylinder': return '🛢️'
      case 'sphere': return '🔮'
      case 'cut': return '✂️'
      case 'fuse': return '🔗'
      case 'common': return '🎯'
      case 'fillet': return '⭕'
      case 'chamfer': return '📐'
      case 'transform': return '🔄'
      case 'extrude': return '⬆️'
      default: return '🔧'
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-800 border-r border-gray-700">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Feature Tree</h3>
        <div className="flex items-center gap-2">
          {isRegenerating && (
            <span className="text-xs text-yellow-400 animate-pulse">Rebuilding...</span>
          )}
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Add Feature Menu */}
      {showAddMenu && (
        <div className="px-2 py-2 border-b border-gray-700 bg-gray-750">
          <div className="text-xs text-gray-400 mb-2">Add Feature:</div>
          <div className="text-[11px] text-gray-500 mb-2">
            Edge selection: {selectedEdgeCount} {selectionMode === SelectionMode.EDGE ? '(valid)' : '(switch to Edge mode)'}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {featureTypes.map(({ type, label }) => {
              const requiresEdge = type === 'fillet' || type === 'chamfer'
              const disabled = requiresEdge && (selectionMode !== SelectionMode.EDGE || selectedEdgeCount === 0)
              return (
              <button
                key={type}
                onClick={() => handleAddFeature(type)}
                disabled={disabled}
                className={`px-2 py-1 text-xs rounded transition-colors text-left ${
                  disabled
                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                    : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                }`}
              >
                {getFeatureIcon(type)} {label}
              </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Rollback Controls */}
      {features.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-700 bg-gray-750">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Rollback</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => rollbackTo(-1)}
                className={`px-2 py-0.5 text-xs rounded ${
                  rollbackIndex === -1 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                All
              </button>
              {rollbackIndex !== -1 && (
                <span className="text-xs text-blue-400">
                  @ {features[rollbackIndex]?.name}
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-gray-500">All</span>
            <input
              type="range"
              min={0}
              max={features.length}
              value={rollbackIndex === -1 ? features.length : rollbackIndex + 1}
              onChange={(e) => {
                const numeric = Number(e.target.value)
                if (numeric >= features.length) {
                  rollbackTo(-1)
                } else {
                  rollbackTo(Math.max(0, numeric - 1))
                }
              }}
              className="flex-1 accent-blue-500"
            />
            <span className="text-[11px] text-gray-500">0</span>
          </div>
        </div>
      )}

      {/* Feature List */}
      <div className="flex-1 overflow-y-auto">
        {features.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No features yet.
            <br />
            Click "+ Add" to create a feature.
          </div>
        ) : (
          <div className="py-1">
            {features.map((feature, index) => (
              <FeatureItem
                key={feature.id}
                feature={feature}
                index={index}
                isSelected={feature.id === selectedFeatureId}
                isRolledBack={rollbackIndex !== -1 && index > rollbackIndex}
                isRollbackTarget={rollbackIndex === index}
                isDragging={draggedIndex === index}
                isDragOver={dragOverIndex === index}
                statusIcon={getStatusIcon(feature, index)}
                featureIcon={getFeatureIcon(feature.type)}
                onSelect={() => setSelectedFeatureId(feature.id)}
                onToggleSuppression={() => toggleSuppression(feature.id)}
                onRemove={() => removeFeature(feature.id)}
                onRollbackTo={() => rollbackTo(index)}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDragLeave={handleDragLeave}
                error={rebuildErrors.find(e => e.featureId === feature.id)?.message}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error Summary */}
      {rebuildErrors.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-700 bg-red-900/30">
          <div className="text-xs text-red-400">
            {rebuildErrors.length} rebuild error{rebuildErrors.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Individual Feature Item
 */
function FeatureItem({
  feature,
  index,
  isSelected,
  isRolledBack,
  isRollbackTarget,
  isDragging,
  isDragOver,
  statusIcon,
  featureIcon,
  onSelect,
  onToggleSuppression,
  onRemove,
  onRollbackTo,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragLeave,
  error,
}) {
  const [showContextMenu, setShowContextMenu] = useState(false)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragLeave={onDragLeave}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowContextMenu(!showContextMenu)
      }}
      className={`
        group relative px-2 py-1.5 mx-1 rounded cursor-pointer transition-all
        ${isSelected ? 'bg-blue-600/30 border border-blue-500' : 'hover:bg-gray-700 border border-transparent'}
        ${feature.status === FeatureStatus.NEEDS_REPAIR ? 'ring-1 ring-amber-500/60' : ''}
        ${isDragging ? 'opacity-50' : ''}
        ${isDragOver ? 'border-t-2 border-t-blue-400' : ''}
        ${isRolledBack ? 'opacity-40' : ''}
        ${feature.suppressed ? 'opacity-50 line-through' : ''}
      `}
    >
      {/* Rollback marker */}
      {isRollbackTarget && (
        <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-blue-500" />
      )}

      <div className="flex items-center gap-2">
        {/* Drag handle */}
        <div className="text-gray-500 cursor-grab hover:text-gray-300 text-xs">⋮⋮</div>

        {/* Status icon */}
        <span className="text-xs">{statusIcon}</span>

        {/* Feature icon */}
        <span className="text-sm">{featureIcon}</span>

        {/* Feature name */}
        <span className={`flex-1 text-sm truncate ${
          feature.suppressed ? 'text-gray-500' : 'text-gray-200'
        }`}>
          {feature.name}
        </span>

        {/* Quick actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleSuppression()
            }}
            className="p-0.5 text-xs hover:bg-gray-600 rounded"
            title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
          >
            {feature.suppressed ? '👁️' : '🚫'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRollbackTo()
            }}
            className="p-0.5 text-xs hover:bg-gray-600 rounded"
            title="Rollback to here"
          >
            ⏪
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="p-0.5 text-xs hover:bg-red-600 rounded text-red-400"
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-1 text-xs text-red-400 pl-6">
          ⚠️ {error}
        </div>
      )}
      {feature.status === FeatureStatus.NEEDS_REPAIR && Array.isArray(feature.needsRepair) && feature.needsRepair.length > 0 && (
        <div className="mt-1 text-xs text-amber-300 pl-6">
          Missing refs: {feature.needsRepair.length}
        </div>
      )}

      {/* Context menu */}
      {showContextMenu && (
        <div 
          className="absolute left-full top-0 ml-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50"
          onMouseLeave={() => setShowContextMenu(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleSuppression()
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
          >
            {feature.suppressed ? 'Unsuppress' : 'Suppress'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRollbackTo()
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
          >
            Rollback to here
          </button>
          <hr className="border-gray-600" />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-gray-700"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Feature Parameter Editor
 */
export function FeatureEditor() {
  const {
    selectedFeatureId,
    getFeature,
    updateFeatureParams,
    getAvailableFeatureTypes,
  } = useFeatureTree()

  const feature = selectedFeatureId ? getFeature(selectedFeatureId) : null
  const featureTypes = useMemo(() => getAvailableFeatureTypes(), [getAvailableFeatureTypes])

  if (!feature) {
    return (
      <div className="p-4 text-sm text-gray-500 text-center">
        Select a feature to edit its parameters
      </div>
    )
  }

  const typeInfo = featureTypes.find(t => t.type === feature.type)
  const paramDefs = typeInfo?.paramDefs || []

  const handleParamChange = (name, value) => {
    updateFeatureParams(feature.id, { [name]: value })
  }

  return (
    <div className="p-3 space-y-3">
      <div className="text-sm font-medium text-white">{feature.name}</div>
      <div className="text-xs text-gray-400">Type: {feature.type}</div>

      {paramDefs.length > 0 ? (
        <div className="space-y-2">
          {paramDefs.map(param => (
            <ParameterInput
              key={param.name}
              param={param}
              value={feature.params[param.name]}
              onChange={(value) => handleParamChange(param.name, value)}
            />
          ))}
        </div>
      ) : (
        <div className="text-xs text-gray-500">
          Edit parameters directly in JSON:
        </div>
      )}

      {/* Raw params for non-standard features */}
      {paramDefs.length === 0 && (
        <textarea
          className="w-full h-32 text-xs bg-gray-700 text-gray-200 p-2 rounded font-mono"
          value={JSON.stringify(feature.params, null, 2)}
          onChange={(e) => {
            try {
              const newParams = JSON.parse(e.target.value)
              updateFeatureParams(feature.id, newParams)
            } catch (err) {
              // Invalid JSON, ignore
            }
          }}
        />
      )}

      {/* Status */}
      <div className="text-xs">
        <span className="text-gray-400">Status: </span>
        <span className={
          feature.status === FeatureStatus.OK ? 'text-green-400' :
          feature.status === FeatureStatus.NEEDS_REPAIR ? 'text-amber-300' :
          feature.status === FeatureStatus.ERROR ? 'text-red-400' :
          feature.status === FeatureStatus.SUPPRESSED ? 'text-gray-500' :
          'text-yellow-400'
        }>
          {feature.status}
        </span>
      </div>

      {feature.status === FeatureStatus.NEEDS_REPAIR && Array.isArray(feature.needsRepair) && feature.needsRepair.length > 0 && (
        <div className="text-xs text-amber-300 bg-amber-900/20 p-2 rounded">
          Needs repair: {feature.needsRepair.length} missing reference{feature.needsRepair.length !== 1 ? 's' : ''}.
        </div>
      )}

      {feature.error && (
        <div className="text-xs text-red-400 bg-red-900/20 p-2 rounded">
          {feature.error}
        </div>
      )}
    </div>
  )
}

/**
 * Parameter Input Component
 */
function ParameterInput({ param, value, onChange }) {
  const handleChange = (e) => {
    let newValue = e.target.value
    
    if (param.type === 'number') {
      newValue = parseFloat(newValue)
      if (isNaN(newValue)) return
      if (param.min !== undefined && newValue < param.min) newValue = param.min
      if (param.max !== undefined && newValue > param.max) newValue = param.max
    } else if (param.type === 'boolean') {
      newValue = e.target.checked
    }
    
    onChange(newValue)
  }

  if (param.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs text-gray-300">
        <input
          type="checkbox"
          checked={value ?? param.default}
          onChange={handleChange}
          className="rounded bg-gray-700"
        />
        {param.label}
      </label>
    )
  }

  if (param.type === 'select') {
    return (
      <div>
        <label className="text-xs text-gray-400">{param.label}</label>
        <select
          value={value ?? param.default}
          onChange={handleChange}
          className="w-full mt-1 px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded border border-gray-600"
        >
          {param.options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    )
  }

  // Default: number input
  return (
    <div>
      <label className="text-xs text-gray-400">{param.label}</label>
      <input
        type="number"
        value={value ?? param.default}
        onChange={handleChange}
        step={param.type === 'number' ? 0.1 : 1}
        min={param.min}
        max={param.max}
        className="w-full mt-1 px-2 py-1 text-xs bg-gray-700 text-gray-200 rounded border border-gray-600"
      />
    </div>
  )
}
