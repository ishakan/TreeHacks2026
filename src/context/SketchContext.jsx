import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import { 
  Point, Line, Circle, Arc, Constraint, ConstraintType, ConstraintSolver 
} from '../services/constraintSolver'
import { snappingService, SnapType } from '../services/snappingService'
import { extrudeSketchEntities } from '../services/occtService'

const SketchContext = createContext(null)
const LOG_PREFIX = '[SketchContext]'

// Helper to update boot tracker
function bootMark(key, ok, error) {
  if (typeof window !== 'undefined' && window.__BOOT) {
    window.__BOOT.mark(key, ok, error);
  }
}

// Check if solver is disabled
function isSolverDisabled() {
  return typeof window !== 'undefined' && window.__BOOT?.isSolverDisabled?.();
}

export const SketchTool = {
  SELECT: 'select',
  LINE: 'line',
  CIRCLE: 'circle',
  ARC: 'arc',
  POINT: 'point',
  TRIM: 'trim',
  EXTEND: 'extend',
}

export const EditMode = {
  NONE: 'none',
  DRAG_POINT: 'dragPoint',
  DRAG_ENTITY: 'dragEntity',
  ROTATE: 'rotate',
}

export function SketchProvider({ children }) {
  const [isSketchMode, setIsSketchMode] = useState(false)
  const [activeTool, setActiveTool] = useState(SketchTool.SELECT)
  const [entities, setEntities] = useState([]) // lines, circles, arcs
  const [constraints, setConstraints] = useState([])
  const [selectedEntityIds, setSelectedEntityIds] = useState([]) // Multi-select support
  const [selectedEntityId, setSelectedEntityId] = useState(null) // Legacy single select
  const [tempPoints, setTempPoints] = useState([]) // For in-progress drawing
  const [highlightedConstraintId, setHighlightedConstraintId] = useState(null)
  const [highlightedEntityIds, setHighlightedEntityIds] = useState([])
  
  // Editing state
  const [editMode, setEditMode] = useState(EditMode.NONE)
  const [draggedPoint, setDraggedPoint] = useState(null) // { entityId, pointName: 'p1'|'p2'|'center' }
  const [dragStartPos, setDragStartPos] = useState(null)
  const [isConstructionMode, setIsConstructionMode] = useState(false)
  
  // Snapping state
  const [currentSnap, setCurrentSnap] = useState(null)
  const [snappingEnabled, setSnappingEnabled] = useState(true)
  
  // Solver - only create if not disabled
  const solverDisabled = isSolverDisabled();
  const solverRef = useRef(solverDisabled ? null : new ConstraintSolver())
  const isDraggingRef = useRef(false)

  // Mark context as ready on mount
  useEffect(() => {
    bootMark('sketch', true);
    bootMark('solver', !solverDisabled, solverDisabled ? 'Disabled by user' : undefined);
    return () => bootMark('sketch', false);
  }, [solverDisabled])

  // Enter sketch mode
  const enterSketchMode = useCallback(() => {
    console.log(`${LOG_PREFIX} Entering sketch mode`)
    setIsSketchMode(true)
    setActiveTool(SketchTool.LINE)
  }, [])

  // Exit sketch mode
  const exitSketchMode = useCallback(() => {
    console.log(`${LOG_PREFIX} Exiting sketch mode`)
    setIsSketchMode(false)
    setActiveTool(SketchTool.SELECT)
    setTempPoints([])
    setSelectedEntityId(null)
  }, [])

  // Add a line
  const addLine = useCallback((x1, y1, x2, y2) => {
    const p1 = new Point(x1, y1)
    const p2 = new Point(x2, y2)
    const line = new Line(p1, p2)
    line.construction = isConstructionMode
    
    if (solverRef.current) solverRef.current.addLine(line)
    
    setEntities(prev => [...prev, line])
    console.log(`${LOG_PREFIX} Added line ${line.id}: (${x1.toFixed(2)}, ${y1.toFixed(2)}) to (${x2.toFixed(2)}, ${y2.toFixed(2)})`)
    
    return line
  }, [isConstructionMode])

  // Add a circle
  const addCircle = useCallback((cx, cy, radius) => {
    const center = new Point(cx, cy)
    const circle = new Circle(center, radius)
    circle.construction = isConstructionMode
    
    if (solverRef.current) solverRef.current.addCircle(circle)
    
    setEntities(prev => [...prev, circle])
    console.log(`${LOG_PREFIX} Added circle ${circle.id}: center (${cx.toFixed(2)}, ${cy.toFixed(2)}), radius ${radius.toFixed(2)}`)
    
    return circle
  }, [isConstructionMode])

  // Add an arc
  const addArc = useCallback((cx, cy, radius, startAngle, endAngle) => {
    const center = new Point(cx, cy)
    const arc = new Arc(center, radius, startAngle, endAngle)
    arc.construction = isConstructionMode
    
    if (solverRef.current) solverRef.current.addArc(arc)
    
    setEntities(prev => [...prev, arc])
    console.log(`${LOG_PREFIX} Added arc ${arc.id}: center (${cx.toFixed(2)}, ${cy.toFixed(2)}), radius ${radius.toFixed(2)}`)
    
    return arc
  }, [isConstructionMode])

  // Toggle construction mode for an entity
  const toggleConstruction = useCallback((entityId) => {
    const entity = entities.find(e => e.id === entityId)
    if (entity) {
      entity.construction = !entity.construction
      setEntities([...entities])
      console.log(`${LOG_PREFIX} Toggled construction mode for ${entityId}: ${entity.construction}`)
    }
  }, [entities])

  // === SNAPPING ===
  
  // Find snap point for cursor position
  const findSnap = useCallback((x, y, referencePoint = null) => {
    if (!snappingEnabled) {
      setCurrentSnap(null)
      return null
    }
    
    const snap = snappingService.findSnap(x, y, entities, { referencePoint })
    setCurrentSnap(snap)
    return snap
  }, [entities, snappingEnabled])

  // Get snapped position (returns snap point or original)
  const getSnappedPosition = useCallback((x, y, referencePoint = null) => {
    const snap = findSnap(x, y, referencePoint)
    if (snap) {
      return { x: snap.point.x, y: snap.point.y, snap }
    }
    return { x, y, snap: null }
  }, [findSnap])

  // === ENTITY EDITING ===

  // Start dragging a point (endpoint or center)
  const startDragPoint = useCallback((entityId, pointName, startX, startY) => {
    setEditMode(EditMode.DRAG_POINT)
    setDraggedPoint({ entityId, pointName })
    setDragStartPos({ x: startX, y: startY })
    isDraggingRef.current = true
    console.log(`${LOG_PREFIX} Started dragging ${pointName} of ${entityId}`)
  }, [])

  // Start dragging entire entity
  const startDragEntity = useCallback((entityId, startX, startY) => {
    setEditMode(EditMode.DRAG_ENTITY)
    setDraggedPoint({ entityId, pointName: null })
    setDragStartPos({ x: startX, y: startY })
    isDraggingRef.current = true
    console.log(`${LOG_PREFIX} Started dragging entity ${entityId}`)
  }, [])

  // Update during drag - with continuous constraint solving
  const updateDrag = useCallback((x, y) => {
    if (!isDraggingRef.current || !draggedPoint) return

    // Apply snapping
    const { x: snapX, y: snapY } = getSnappedPosition(x, y)
    
    const entity = (solverRef.current?.getEntity(draggedPoint.entityId)) ||
                   entities.find(e => e.id === draggedPoint.entityId)
    
    if (!entity) return

    if (editMode === EditMode.DRAG_POINT) {
      // Move specific point
      if (draggedPoint.pointName === 'p1' && entity.p1) {
        entity.p1.moveTo(snapX, snapY)
      } else if (draggedPoint.pointName === 'p2' && entity.p2) {
        entity.p2.moveTo(snapX, snapY)
      } else if (draggedPoint.pointName === 'center' && entity.center) {
        entity.center.moveTo(snapX, snapY)
      }
    } else if (editMode === EditMode.DRAG_ENTITY) {
      // Move entire entity
      const dx = snapX - dragStartPos.x
      const dy = snapY - dragStartPos.y
      
      if (entity.type === 'line') {
        entity.moveBy(dx, dy)
      } else if (entity.center) {
        entity.center.moveBy(dx, dy)
      }
      setDragStartPos({ x: snapX, y: snapY })
    }

    // Solve constraints continuously (if solver is available)
    if (solverRef.current) {
      solverRef.current.solveContinuous()
      // Force re-render from solver state
      setEntities([
        ...solverRef.current.lines.values(),
        ...solverRef.current.circles.values(),
        ...solverRef.current.arcs.values(),
      ])
    } else {
      // Without solver, just trigger re-render with current entities
      setEntities(prev => [...prev])
    }
  }, [draggedPoint, editMode, dragStartPos, entities, getSnappedPosition])

  // End drag
  const endDrag = useCallback(() => {
    if (!isDraggingRef.current) return
    
    isDraggingRef.current = false
    setEditMode(EditMode.NONE)
    setDraggedPoint(null)
    setDragStartPos(null)
    setCurrentSnap(null)
    
    // Final solve (if solver is available)
    if (solverRef.current) {
      solverRef.current.solve()
      // Update entities from solver
      setEntities([
        ...solverRef.current.lines.values(),
        ...solverRef.current.circles.values(),
        ...solverRef.current.arcs.values(),
      ])
    }
    
    console.log(`${LOG_PREFIX} Ended drag`)
  }, [])

  // Highlight constraint and its entities
  const highlightConstraint = useCallback((constraintId) => {
    setHighlightedConstraintId(constraintId)
    
    if (constraintId) {
      const constraint = constraints.find(c => c.id === constraintId)
      if (constraint) {
        const entityIds = constraint.entities.map(e => e.id)
        setHighlightedEntityIds(entityIds)
      }
    } else {
      setHighlightedEntityIds([])
    }
  }, [constraints])

  // Remove constraint
  const removeConstraint = useCallback((constraintId) => {
    if (solverRef.current) solverRef.current.removeConstraint(constraintId)
    setConstraints(prev => prev.filter(c => c.id !== constraintId))
    console.log(`${LOG_PREFIX} Removed constraint ${constraintId}`)
  }, [])

  // Add a constraint
  const addConstraint = useCallback((type, entityIds, value = null) => {
    if (!solverRef.current) {
      console.warn(`${LOG_PREFIX} Solver is disabled, cannot add constraints`)
      return null
    }
    
    const constrainedEntities = entityIds.map(id => 
      entities.find(e => e.id === id) || 
      solverRef.current.lines.get(id) ||
      solverRef.current.circles.get(id)
    ).filter(Boolean)
    
    if (constrainedEntities.length === 0) {
      console.warn(`${LOG_PREFIX} No valid entities found for constraint`)
      return null
    }

    const constraint = new Constraint(type, constrainedEntities, value)
    solverRef.current.addConstraint(constraint)
    
    // Solve immediately
    solverRef.current.solve()
    
    setConstraints(prev => [...prev, constraint])
    
    // Force re-render of entities
    setEntities([
      ...solverRef.current.lines.values(),
      ...solverRef.current.circles.values(),
      ...solverRef.current.arcs.values(),
    ])
    
    console.log(`${LOG_PREFIX} Added ${type} constraint ${constraint.id}`)
    return constraint
  }, [entities])

  // Apply horizontal constraint to selected line
  const applyHorizontal = useCallback(() => {
    if (!selectedEntityId) return
    const entity = entities.find(e => e.id === selectedEntityId)
    if (entity?.type !== 'line') {
      console.warn(`${LOG_PREFIX} Horizontal constraint requires a line`)
      return
    }
    addConstraint(ConstraintType.HORIZONTAL, [selectedEntityId])
  }, [selectedEntityId, entities, addConstraint])

  // Apply vertical constraint to selected line
  const applyVertical = useCallback(() => {
    if (!selectedEntityId) return
    const entity = entities.find(e => e.id === selectedEntityId)
    if (entity?.type !== 'line') {
      console.warn(`${LOG_PREFIX} Vertical constraint requires a line`)
      return
    }
    addConstraint(ConstraintType.VERTICAL, [selectedEntityId])
  }, [selectedEntityId, entities, addConstraint])

  // Apply dimension constraint
  const applyDimension = useCallback((value) => {
    if (!selectedEntityId) return
    addConstraint(ConstraintType.DIMENSION, [selectedEntityId], value)
  }, [selectedEntityId, addConstraint])

  // Delete selected entity
  const deleteSelected = useCallback(() => {
    if (!selectedEntityId) return
    
    if (solverRef.current) solverRef.current.removeEntity(selectedEntityId)
    setEntities(prev => prev.filter(e => e.id !== selectedEntityId))
    setConstraints(prev => prev.filter(c => !c.entities.some(e => e.id === selectedEntityId)))
    setSelectedEntityId(null)
    
    console.log(`${LOG_PREFIX} Deleted entity ${selectedEntityId}`)
  }, [selectedEntityId])

  // Clear sketch
  const clearSketch = useCallback(() => {
    if (solverRef.current) solverRef.current.clear()
    setEntities([])
    setConstraints([])
    setSelectedEntityId(null)
    setTempPoints([])
    console.log(`${LOG_PREFIX} Cleared sketch`)
  }, [])

  // Extrude callback - will be set by parent component
  const extrudeCallbackRef = useRef(null)
  
  // Set the extrude callback (called by App to connect to ShapeContext)
  const setExtrudeCallback = useCallback((callback) => {
    extrudeCallbackRef.current = callback
  }, [])

  // Extrude the current sketch
  const extrudeSketch = useCallback((length) => {
    console.log(`${LOG_PREFIX} extrudeSketch() - length: ${length}`)
    
    if (entities.length === 0) {
      console.warn(`${LOG_PREFIX} No entities to extrude`)
      return null
    }
    
    try {
      const result = extrudeSketchEntities(entities, length)
      
      if (result && result.geometry) {
        console.log(`${LOG_PREFIX} ✓ Extrusion successful`)
        
        // Call the callback to add the shape to ShapeContext
        if (extrudeCallbackRef.current) {
          extrudeCallbackRef.current(result.geometry, result.topologyMap, length)
        }
        
        // Clear sketch after successful extrusion
        clearSketch()
        exitSketchMode()
        
        return result
      } else {
        console.error(`${LOG_PREFIX} Extrusion returned no result`)
        return null
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Extrusion failed:`, err)
      return null
    }
  }, [entities, clearSketch, exitSketchMode])

  // Get selected entity
  const selectedEntity = entities.find(e => e.id === selectedEntityId)
  
  // Check if sketch can be extruded (has at least one entity)
  const canExtrude = entities.length > 0

  const value = {
    // State
    isSketchMode,
    activeTool,
    entities,
    constraints,
    selectedEntityId,
    selectedEntityIds,
    selectedEntity,
    tempPoints,
    canExtrude,
    editMode,
    isConstructionMode,
    snappingEnabled,
    currentSnap,
    highlightedConstraintId,
    highlightedEntityIds,
    
    // State setters
    setTempPoints,
    setActiveTool,
    setSelectedEntityId,
    setSelectedEntityIds,
    setIsConstructionMode,
    setSnappingEnabled,
    
    // Mode control
    enterSketchMode,
    exitSketchMode,
    
    // Entity creation
    addLine,
    addCircle,
    addArc,
    toggleConstruction,
    
    // Constraints
    addConstraint,
    removeConstraint,
    applyHorizontal,
    applyVertical,
    applyDimension,
    highlightConstraint,
    
    // Entity editing
    startDragPoint,
    startDragEntity,
    updateDrag,
    endDrag,
    deleteSelected,
    clearSketch,
    
    // Snapping
    findSnap,
    getSnappedPosition,
    snappingService, // Expose service for configuration
    
    // Extrusion
    extrudeSketch,
    setExtrudeCallback,
  }

  return (
    <SketchContext.Provider value={value}>
      {children}
    </SketchContext.Provider>
  )
}

export function useSketch() {
  const context = useContext(SketchContext)
  if (!context) {
    throw new Error('useSketch must be used within a SketchProvider')
  }
  return context
}
