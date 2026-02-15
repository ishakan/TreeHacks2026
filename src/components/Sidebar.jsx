import { useShapes } from '../context/ShapeContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSelection } from '../context/SelectionContext'
import { useFeatureTree } from '../context/FeatureTreeContext'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  featureParamsToTransform,
  isTransformFeatureForBody,
} from '../services/transformFeatureUtils'

function ShapeIcon({ type }) {
  const icons = {
    box: '📦',
    cylinder: '🛢️',
    sphere: '🔮',
    cone: '🔺',
    origin: '📍',
  }
  return <span className="mr-2">{icons[type] || '📄'}</span>
}

export default function Sidebar() {
  const { shapes, selectedShapeId, setSelectedShapeId, removeShape, isLoading } = useShapes()
  const { selectedBodies } = useSelection()
  const {
    activeBodyId,
    getTransformTarget,
    updateBodyTransform,
    applyTransformToBodyObject,
    transformMode,
    setTransformMode,
    uniformScale,
    setUniformScale,
    transformSnapping,
    setTransformSnapping,
  } = useWorkspace()
  const {
    features,
    selectedFeatureId,
    getFeature,
    upsertTransformFeatureForBody,
  } = useFeatureTree()
  const [draft, setDraft] = useState({
    position: ['0', '0', '0'],
    rotation: ['0', '0', '0'],
    scale: ['1', '1', '1'],
  })

  const selectedBodyIds = selectedBodies.length > 0 ? selectedBodies : (activeBodyId ? [activeBodyId] : [])
  const isMultiSelection = selectedBodyIds.length > 1
  const selectedBodyId = selectedBodyIds.length === 1 ? selectedBodyIds[0] : null

  const transformTarget = useMemo(() => {
    if (!selectedBodyId) return null
    return getTransformTarget(selectedBodyId)
  }, [getTransformTarget, selectedBodyId])

  const activeTransformFeature = useMemo(() => {
    const feature = selectedFeatureId ? getFeature(selectedFeatureId) : null
    if (feature && isTransformFeatureForBody(feature, selectedBodyId)) {
      return feature
    }
    for (let i = features.length - 1; i >= 0; i -= 1) {
      if (isTransformFeatureForBody(features[i], selectedBodyId)) {
        return features[i]
      }
    }
    return null
  }, [selectedFeatureId, getFeature, features, selectedBodyId])

  useEffect(() => {
    if (!transformTarget) {
      setDraft({
        position: ['0', '0', '0'],
        rotation: ['0', '0', '0'],
        scale: ['1', '1', '1'],
      })
      return
    }

    const sourceTransform = (
      transformTarget.kind === 'brep' && activeTransformFeature
        ? featureParamsToTransform(activeTransformFeature.params)
        : transformTarget.currentTransform
    )
    const { position, rotation, scale } = sourceTransform
    setDraft({
      position: position.map((value) => value.toFixed(3)),
      rotation: rotation.map((value) => (value * 180 / Math.PI).toFixed(2)),
      scale: scale.map((value) => value.toFixed(3)),
    })
  }, [transformTarget, activeTransformFeature])

  const parseField = useCallback((value, fallback, options = {}) => {
    const numeric = Number.parseFloat(value)
    if (!Number.isFinite(numeric)) return fallback
    if (typeof options.min === 'number') return Math.max(options.min, numeric)
    return numeric
  }, [])

  const toTransformFromDraft = useCallback((nextDraft) => {
    if (!transformTarget) return null
    const fallback = transformTarget.currentTransform
    return {
      position: nextDraft.position.map((value, index) => parseField(value, fallback.position[index])),
      rotation: nextDraft.rotation.map((value, index) => parseField(value, fallback.rotation[index] * 180 / Math.PI) * Math.PI / 180),
      scale: nextDraft.scale.map((value, index) => parseField(value, fallback.scale[index], { min: 0.0001 })),
    }
  }, [parseField, transformTarget])

  const previewDraft = useCallback((nextDraft) => {
    if (!transformTarget) return
    const nextTransform = toTransformFromDraft(nextDraft)
    if (!nextTransform) return
    applyTransformToBodyObject(transformTarget.id, nextTransform)
  }, [applyTransformToBodyObject, toTransformFromDraft, transformTarget])

  const commitDraft = useCallback((nextDraft = draft) => {
    if (!transformTarget) return
    const nextTransform = toTransformFromDraft(nextDraft)
    if (!nextTransform) return

    if (transformTarget.kind === 'brep') {
      upsertTransformFeatureForBody(
        transformTarget.id,
        transformTarget.id,
        nextTransform,
        activeTransformFeature?.id || null
      )
      const identity = {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
      applyTransformToBodyObject(transformTarget.id, identity)
      updateBodyTransform(transformTarget.id, identity)
    } else {
      applyTransformToBodyObject(transformTarget.id, nextTransform)
      updateBodyTransform(transformTarget.id, nextTransform)
    }

    setDraft({
      position: nextTransform.position.map((value) => value.toFixed(3)),
      rotation: nextTransform.rotation.map((value) => (value * 180 / Math.PI).toFixed(2)),
      scale: nextTransform.scale.map((value) => value.toFixed(3)),
    })
  }, [
    activeTransformFeature?.id,
    applyTransformToBodyObject,
    draft,
    toTransformFromDraft,
    transformTarget,
    updateBodyTransform,
    upsertTransformFeatureForBody,
  ])

  const updateAxisDraft = useCallback((key, axis, rawValue) => {
    setDraft((prev) => {
      const next = {
        ...prev,
        [key]: [...prev[key]],
      }

      if (key === 'scale' && uniformScale) {
        next.scale = [rawValue, rawValue, rawValue]
      } else {
        next[key][axis] = rawValue
      }

      previewDraft(next)
      return next
    })
  }, [previewDraft, uniformScale])

  const resetTransformPart = useCallback((type) => {
    if (!transformTarget) return
    const sourceTransform = (
      transformTarget.kind === 'brep' && activeTransformFeature
        ? featureParamsToTransform(activeTransformFeature.params)
        : transformTarget.currentTransform
    )
    const base = {
      position: [...sourceTransform.position],
      rotation: [...sourceTransform.rotation],
      scale: [...sourceTransform.scale],
    }

    if (type === 'position' || type === 'all') base.position = [0, 0, 0]
    if (type === 'rotation' || type === 'all') base.rotation = [0, 0, 0]
    if (type === 'scale' || type === 'all') base.scale = [1, 1, 1]

    if (transformTarget.kind === 'brep') {
      upsertTransformFeatureForBody(
        transformTarget.id,
        transformTarget.id,
        base,
        activeTransformFeature?.id || null
      )
      const identity = {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
      applyTransformToBodyObject(transformTarget.id, identity)
      updateBodyTransform(transformTarget.id, identity)
    } else {
      applyTransformToBodyObject(transformTarget.id, base)
      updateBodyTransform(transformTarget.id, base)
    }

    setDraft({
      position: base.position.map((value) => value.toFixed(3)),
      rotation: base.rotation.map((value) => (value * 180 / Math.PI).toFixed(2)),
      scale: base.scale.map((value) => value.toFixed(3)),
    })
  }, [
    activeTransformFeature,
    applyTransformToBodyObject,
    transformTarget,
    updateBodyTransform,
    upsertTransformFeatureForBody,
  ])

  const renderAxisInputs = (title, key, unit = '') => (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">
        {title}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {['X', 'Y', 'Z'].map((axisName, axisIndex) => (
          <label key={`${key}-${axisName}`} className="text-[11px] text-gray-400">
            <span className="mb-1 block">{axisName}</span>
            <input
              value={draft[key][axisIndex]}
              onChange={(event) => updateAxisDraft(key, axisIndex, event.target.value)}
              onBlur={() => commitDraft()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
              className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            {unit ? <span className="mt-1 block text-[10px] text-gray-500">{unit}</span> : null}
          </label>
        ))}
      </div>
    </div>
  )

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-white font-semibold text-sm uppercase tracking-wide">
          Feature Tree
        </h2>
      </div>
      
      {/* Loading State */}
      {isLoading && (
        <div className="p-4 text-center text-gray-400 text-sm">
          Initializing OCCT...
        </div>
      )}

      {/* Origin (always shown) */}
      <div className="p-2 border-b border-gray-700">
        <div className="flex items-center px-3 py-2 text-sm text-gray-400">
          <ShapeIcon type="origin" />
          Origin
        </div>
      </div>
      
      {/* Shape List */}
      <div className="flex-1 overflow-y-auto p-2">
        {shapes.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-4">
            No shapes yet. Add one from the toolbar.
          </p>
        ) : (
          shapes.map((shape) => (
            <div
              key={shape.id}
              onClick={() => setSelectedShapeId(shape.id)}
              className={`
                flex items-center justify-between px-3 py-2 rounded-md cursor-pointer
                text-sm transition-colors group
                ${selectedShapeId === shape.id 
                  ? 'bg-blue-600 text-white' 
                  : 'text-gray-300 hover:bg-gray-700'
                }
              `}
            >
              <div className="flex items-center">
                <ShapeIcon type={shape.type} />
                {shape.name}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeShape(shape.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
      
      {/* Footer */}
      <div className="p-3 border-t border-gray-700">
        <p className="text-gray-500 text-xs">
          {shapes.length} shape{shapes.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="p-3 border-t border-gray-700 space-y-3">
        <div>
          <h3 className="text-white font-semibold text-xs uppercase tracking-wide">Transform</h3>
          {isMultiSelection ? (
            <p className="mt-2 text-xs text-gray-400">Multiple selection. Select one body to edit transform.</p>
          ) : !transformTarget ? (
            <p className="mt-2 text-xs text-gray-400">Select a body/import to edit transform.</p>
          ) : (
            <p className="mt-2 text-xs text-gray-400">{transformTarget.kind.toUpperCase()} • {transformTarget.id}</p>
          )}
        </div>

        {!isMultiSelection && transformTarget && (
          <>
            <div className="grid grid-cols-3 gap-1">
              {[
                ['translate', 'Move'],
                ['rotate', 'Rotate'],
                ['scale', 'Scale'],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTransformMode(mode)}
                  className={`rounded px-2 py-1 text-xs border ${
                    transformMode === mode
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-gray-700 bg-gray-900 text-gray-200 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {renderAxisInputs('Position', 'position')}
            {renderAxisInputs('Rotation', 'rotation', 'deg')}
            {renderAxisInputs('Scale', 'scale')}

            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={uniformScale}
                onChange={(event) => setUniformScale(event.target.checked)}
                className="rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
              />
              Uniform scale
            </label>

            <div className="space-y-1">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Snap</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-400">
                  Translate
                  <input
                    value={String(transformSnapping.translate)}
                    onChange={(event) => {
                      const value = Number.parseFloat(event.target.value)
                      setTransformSnapping({ translate: Number.isFinite(value) ? Math.max(0, value) : 0 })
                    }}
                    className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="text-[11px] text-gray-400">
                  Rotate (deg)
                  <input
                    value={String(transformSnapping.rotateDeg)}
                    onChange={(event) => {
                      const value = Number.parseFloat(event.target.value)
                      setTransformSnapping({ rotateDeg: Number.isFinite(value) ? Math.max(0, value) : 0 })
                    }}
                    className="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => resetTransformPart('position')}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
              >
                Reset Position
              </button>
              <button
                type="button"
                onClick={() => resetTransformPart('rotation')}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
              >
                Reset Rotation
              </button>
              <button
                type="button"
                onClick={() => resetTransformPart('scale')}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
              >
                Reset Scale
              </button>
              <button
                type="button"
                onClick={() => resetTransformPart('all')}
                className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
              >
                Reset All
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
