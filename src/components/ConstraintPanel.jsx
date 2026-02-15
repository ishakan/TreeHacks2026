import { useState } from 'react'
import { useSketch } from '../context/SketchContext'
import { ConstraintType } from '../services/constraintSolver'
import ConstraintList from './ConstraintList'

export default function ConstraintPanel() {
  const {
    isSketchMode,
    selectedEntity,
    selectedEntityIds,
    entities,
    constraints,
    addConstraint,
    applyHorizontal,
    applyVertical,
    applyDimension,
    deleteSelected,
    isConstructionMode,
    setIsConstructionMode,
    toggleConstruction,
    snappingEnabled,
    setSnappingEnabled,
  } = useSketch()

  const [dimensionValue, setDimensionValue] = useState('')
  const [dimensionType, setDimensionType] = useState('length')
  const [showConstraintList, setShowConstraintList] = useState(false)

  if (!isSketchMode) return null

  const handleDimension = () => {
    const value = parseFloat(dimensionValue)
    if (!isNaN(value) && value > 0 && selectedEntity) {
      const typeMap = {
        'length': ConstraintType.LENGTH,
        'radius': ConstraintType.RADIUS,
        'diameter': ConstraintType.DIAMETER,
        'angle': ConstraintType.ANGLE,
        'hdistance': ConstraintType.HORIZONTAL_DISTANCE,
        'vdistance': ConstraintType.VERTICAL_DISTANCE,
      }
      addConstraint(typeMap[dimensionType] || ConstraintType.LENGTH, [selectedEntity.id], value)
      setDimensionValue('')
    }
  }

  // Apply constraint between two selected entities
  const applyTwoEntityConstraint = (type) => {
    if (selectedEntityIds.length >= 2) {
      addConstraint(type, selectedEntityIds.slice(0, 2))
    }
  }

  // Get constraints for selected entity
  const entityConstraints = selectedEntity
    ? constraints.filter(c => c.entities.some(e => e.id === selectedEntity.id))
    : []

  // Button component for cleaner code
  const ConstraintButton = ({ onClick, label, icon, disabled = false, color = 'green' }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex-1 px-2 py-1.5 text-white text-xs rounded transition-colors
        flex items-center justify-center gap-1
        ${disabled 
          ? 'bg-gray-600 cursor-not-allowed opacity-50' 
          : `bg-${color}-700 hover:bg-${color}-600`}
      `}
      title={label}
    >
      <span className="font-mono">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  )

  return (
    <div className="absolute bottom-4 left-4 w-72 bg-gray-800 rounded-lg shadow-xl border border-gray-700 p-3 max-h-[80vh] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">Constraints</h3>
        <div className="flex gap-1">
          <button
            onClick={() => setShowConstraintList(!showConstraintList)}
            className={`px-2 py-1 text-xs rounded ${showConstraintList ? 'bg-blue-600' : 'bg-gray-700'} text-white`}
          >
            List
          </button>
        </div>
      </div>

      {/* Options */}
      <div className="flex gap-2 mb-3">
        <label className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={isConstructionMode}
            onChange={(e) => setIsConstructionMode(e.target.checked)}
            className="w-3 h-3"
          />
          Construction
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={snappingEnabled}
            onChange={(e) => setSnappingEnabled(e.target.checked)}
            className="w-3 h-3"
          />
          Snapping
        </label>
      </div>

      {/* Constraint List (collapsible) */}
      {showConstraintList && (
        <div className="mb-3 border-b border-gray-700 pb-3">
          <ConstraintList />
        </div>
      )}
      
      {selectedEntity ? (
        <>
          {/* Selected entity info */}
          <div className="bg-gray-700 rounded p-2 mb-3">
            <div className="flex items-center justify-between">
              <p className="text-gray-300 text-xs">
                <span className="text-blue-400">{selectedEntity.type}</span>
                {selectedEntity.construction && <span className="text-yellow-400 ml-1">(C)</span>}
              </p>
              <button
                onClick={() => toggleConstruction(selectedEntity.id)}
                className="text-xs text-gray-400 hover:text-white"
              >
                {selectedEntity.construction ? 'Make Real' : 'Make Constr.'}
              </button>
            </div>
            {selectedEntity.type === 'line' && (
              <p className="text-gray-400 text-xs mt-1">
                Length: {selectedEntity.length?.toFixed(3) || 'N/A'}
              </p>
            )}
            {(selectedEntity.type === 'circle' || selectedEntity.type === 'arc') && (
              <p className="text-gray-400 text-xs mt-1">
                Radius: {selectedEntity.radius?.toFixed(3) || 'N/A'}
              </p>
            )}
          </div>

          {/* Geometric Constraints - Single Entity */}
          {selectedEntity.type === 'line' && (
            <div className="mb-2">
              <p className="text-gray-400 text-xs mb-1">Line Constraints</p>
              <div className="flex gap-1">
                <ConstraintButton onClick={applyHorizontal} label="Horiz" icon="─" />
                <ConstraintButton onClick={applyVertical} label="Vert" icon="│" />
                <ConstraintButton 
                  onClick={() => addConstraint(ConstraintType.FIX, [selectedEntity.p1.id], [selectedEntity.p1.x, selectedEntity.p1.y])} 
                  label="Fix" 
                  icon="📌" 
                />
              </div>
            </div>
          )}

          {/* Two-Entity Constraints */}
          {selectedEntityIds.length >= 2 && (
            <div className="mb-2">
              <p className="text-gray-400 text-xs mb-1">Two-Entity Constraints</p>
              <div className="grid grid-cols-3 gap-1">
                <ConstraintButton 
                  onClick={() => applyTwoEntityConstraint(ConstraintType.COINCIDENT)} 
                  label="Coincident" icon="⊙" 
                />
                <ConstraintButton 
                  onClick={() => applyTwoEntityConstraint(ConstraintType.PARALLEL)} 
                  label="Parallel" icon="∥" 
                />
                <ConstraintButton 
                  onClick={() => applyTwoEntityConstraint(ConstraintType.PERPENDICULAR)} 
                  label="Perp" icon="⊥" 
                />
                <ConstraintButton 
                  onClick={() => applyTwoEntityConstraint(ConstraintType.EQUAL)} 
                  label="Equal" icon="=" 
                />
                <ConstraintButton 
                  onClick={() => applyTwoEntityConstraint(ConstraintType.TANGENT)} 
                  label="Tangent" icon="◯" 
                />
                <ConstraintButton 
                  onClick={() => applyTwoEntityConstraint(ConstraintType.CONCENTRIC)} 
                  label="Concentric" icon="◎" 
                />
              </div>
            </div>
          )}

          {/* Dimension Constraints */}
          <div className="mb-2">
            <p className="text-gray-400 text-xs mb-1">Dimensions</p>
            <div className="flex gap-1 mb-1">
              <select
                value={dimensionType}
                onChange={(e) => setDimensionType(e.target.value)}
                className="flex-1 px-2 py-1 bg-gray-700 text-white text-xs rounded border border-gray-600"
              >
                <option value="length">Length</option>
                <option value="radius">Radius</option>
                <option value="diameter">Diameter</option>
                <option value="angle">Angle (°)</option>
                <option value="hdistance">H-Distance</option>
                <option value="vdistance">V-Distance</option>
              </select>
              <input
                type="number"
                value={dimensionValue}
                onChange={(e) => setDimensionValue(e.target.value)}
                placeholder="Value"
                className="w-20 px-2 py-1 bg-gray-700 text-white text-xs rounded border border-gray-600"
              />
              <button
                onClick={handleDimension}
                className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-500"
              >
                Set
              </button>
            </div>
          </div>

          {/* Delete button */}
          <button
            onClick={deleteSelected}
            className="w-full px-3 py-1.5 bg-red-700 text-white text-sm rounded hover:bg-red-600 transition-colors"
          >
            Delete Selected
          </button>

          {/* Applied constraints */}
          {entityConstraints.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-600">
              <p className="text-gray-400 text-xs mb-2">Active ({entityConstraints.length}):</p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {entityConstraints.map(c => (
                  <div key={c.id} className="text-xs flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${c.satisfied ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-gray-300">
                      {c.type} {c.value != null ? `= ${c.value}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-gray-500 text-sm">
          Select an entity to apply constraints.
          <br />
          <span className="text-xs">Shift+click for multi-select.</span>
        </p>
      )}
    </div>
  )
}
