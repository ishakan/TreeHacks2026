import { useSketch } from '../context/SketchContext'
import { ConstraintType } from '../services/constraintSolver'

/**
 * ConstraintList - Displays all constraints with click-to-highlight
 */
export default function ConstraintList() {
  const { 
    constraints, 
    highlightedConstraintId,
    highlightConstraint,
    removeConstraint,
  } = useSketch()

  // Get icon for constraint type
  const getConstraintIcon = (type) => {
    switch (type) {
      case ConstraintType.HORIZONTAL: return '─'
      case ConstraintType.VERTICAL: return '│'
      case ConstraintType.COINCIDENT: return '⊙'
      case ConstraintType.CONCENTRIC: return '◎'
      case ConstraintType.PARALLEL: return '∥'
      case ConstraintType.PERPENDICULAR: return '⊥'
      case ConstraintType.TANGENT: return '◯'
      case ConstraintType.EQUAL: return '='
      case ConstraintType.MIDPOINT: return '◆'
      case ConstraintType.SYMMETRIC: return '⇔'
      case ConstraintType.FIX: return '📌'
      case ConstraintType.LENGTH: return '↔'
      case ConstraintType.DISTANCE: return '⟷'
      case ConstraintType.RADIUS: return 'R'
      case ConstraintType.DIAMETER: return 'Ø'
      case ConstraintType.ANGLE: return '∠'
      case ConstraintType.HORIZONTAL_DISTANCE: return '↔H'
      case ConstraintType.VERTICAL_DISTANCE: return '↕V'
      default: return '?'
    }
  }

  // Get label for constraint type
  const getConstraintLabel = (constraint) => {
    const type = constraint.type
    const value = constraint.value
    
    switch (type) {
      case ConstraintType.HORIZONTAL: return 'Horizontal'
      case ConstraintType.VERTICAL: return 'Vertical'
      case ConstraintType.COINCIDENT: return 'Coincident'
      case ConstraintType.CONCENTRIC: return 'Concentric'
      case ConstraintType.PARALLEL: return 'Parallel'
      case ConstraintType.PERPENDICULAR: return 'Perpendicular'
      case ConstraintType.TANGENT: return 'Tangent'
      case ConstraintType.EQUAL: return 'Equal'
      case ConstraintType.MIDPOINT: return 'Midpoint'
      case ConstraintType.SYMMETRIC: return 'Symmetric'
      case ConstraintType.FIX: return 'Fixed'
      case ConstraintType.LENGTH: return `Length = ${value?.toFixed(2) || '?'}`
      case ConstraintType.DISTANCE: return `Distance = ${value?.toFixed(2) || '?'}`
      case ConstraintType.RADIUS: return `Radius = ${value?.toFixed(2) || '?'}`
      case ConstraintType.DIAMETER: return `Diameter = ${value?.toFixed(2) || '?'}`
      case ConstraintType.ANGLE: return `Angle = ${value?.toFixed(1) || '?'}°`
      case ConstraintType.HORIZONTAL_DISTANCE: return `H-Distance = ${value?.toFixed(2) || '?'}`
      case ConstraintType.VERTICAL_DISTANCE: return `V-Distance = ${value?.toFixed(2) || '?'}`
      default: return type
    }
  }

  // Get status color
  const getStatusColor = (constraint) => {
    if (!constraint.enabled) return '#666'
    if (constraint.satisfied) return '#4ade80' // green
    return '#f87171' // red
  }

  if (constraints.length === 0) {
    return (
      <div className="p-2 text-gray-500 text-sm italic">
        No constraints
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
      {constraints.map((constraint) => {
        const isHighlighted = constraint.id === highlightedConstraintId
        
        return (
          <div
            key={constraint.id}
            className={`
              flex items-center gap-2 px-2 py-1 rounded cursor-pointer
              transition-colors duration-150
              ${isHighlighted 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}
            `}
            onClick={() => highlightConstraint(isHighlighted ? null : constraint.id)}
            onMouseEnter={() => highlightConstraint(constraint.id)}
            onMouseLeave={() => highlightConstraint(null)}
          >
            {/* Status indicator */}
            <div 
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: getStatusColor(constraint) }}
              title={constraint.satisfied ? 'Satisfied' : 'Unsatisfied'}
            />
            
            {/* Icon */}
            <span className="w-6 text-center font-mono text-sm">
              {getConstraintIcon(constraint.type)}
            </span>
            
            {/* Label */}
            <span className="flex-1 text-sm truncate">
              {getConstraintLabel(constraint)}
            </span>
            
            {/* Delete button */}
            <button
              className={`
                px-1 rounded text-xs opacity-50 hover:opacity-100
                ${isHighlighted ? 'hover:bg-blue-500' : 'hover:bg-gray-500'}
              `}
              onClick={(e) => {
                e.stopPropagation()
                removeConstraint(constraint.id)
              }}
              title="Remove constraint"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
