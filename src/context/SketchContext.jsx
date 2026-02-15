import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { 
  Point, Line, Circle, Arc, Constraint, ConstraintType, ConstraintSolver 
} from '../services/constraintSolver'
import { snappingService, SnapType } from '../services/snappingService'
import { extrudeSketchEntities } from '../services/occtService'
import { getLargestClosedProfile } from '../services/sketchProfileService'

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

const DEFAULT_PLANE = {
  id: 'top',
  label: 'Top',
  origin: [0, 0, 0],
  normal: [0, 0, 1],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
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
  const [pointNodes, setPointNodes] = useState([]) // [{ id, x, y }]
  const [sketches, setSketches] = useState([])
  const [activeSketchId, setActiveSketchId] = useState(null)
  const [selectedSketchId, setSelectedSketchId] = useState(null)
  const [draftSketchMeta, setDraftSketchMeta] = useState(null)
  
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
  const pointIdRef = useRef(0)
  const sketchIdRef = useRef(0)
  const sketchNameCounterRef = useRef(0)
  const pointNodesRef = useRef([])
  const pointObjectsRef = useRef(new Map())
  const entitiesRef = useRef([])
  const activeSketchIdRef = useRef(null)
  const draftSketchMetaRef = useRef(null)
  const sketchesRef = useRef([])

  useEffect(() => {
    pointNodesRef.current = pointNodes
  }, [pointNodes])

  useEffect(() => {
    entitiesRef.current = entities
  }, [entities])

  useEffect(() => {
    activeSketchIdRef.current = activeSketchId
  }, [activeSketchId])

  useEffect(() => {
    draftSketchMetaRef.current = draftSketchMeta
  }, [draftSketchMeta])

  useEffect(() => {
    sketchesRef.current = sketches
    const maxNum = sketches.reduce((max, sketch) => {
      const match = /^Sketch\s+(\d+)$/i.exec(sketch?.name || '')
      if (!match) return max
      return Math.max(max, Number(match[1]) || 0)
    }, 0)
    if (maxNum > sketchNameCounterRef.current) {
      sketchNameCounterRef.current = maxNum
    }
  }, [sketches])

  const resetEditorState = useCallback(() => {
    if (solverRef.current) solverRef.current.clear()
    setEntities([])
    setConstraints([])
    setSelectedEntityId(null)
    setSelectedEntityIds([])
    setTempPoints([])
    setPointNodes([])
    setCurrentSnap(null)
    pointNodesRef.current = []
    pointObjectsRef.current.clear()
  }, [])

  const serializeEntity = useCallback((entity) => {
    if (entity.type === 'line') {
      return {
        id: entity.id,
        type: 'line',
        p1: { id: entity.p1?.id || null, x: entity.p1?.x ?? 0, y: entity.p1?.y ?? 0 },
        p2: { id: entity.p2?.id || null, x: entity.p2?.x ?? 0, y: entity.p2?.y ?? 0 },
        construction: Boolean(entity.construction),
      }
    }
    if (entity.type === 'circle') {
      return {
        id: entity.id,
        type: 'circle',
        center: { id: entity.center?.id || null, x: entity.center?.x ?? 0, y: entity.center?.y ?? 0 },
        radius: entity.radius ?? 0,
        construction: Boolean(entity.construction),
      }
    }
    if (entity.type === 'arc') {
      return {
        id: entity.id,
        type: 'arc',
        center: { id: entity.center?.id || null, x: entity.center?.x ?? 0, y: entity.center?.y ?? 0 },
        radius: entity.radius ?? 0,
        startAngle: entity.startAngle ?? 0,
        endAngle: entity.endAngle ?? 0,
        construction: Boolean(entity.construction),
      }
    }
    return null
  }, [])

  const getPointObject = useCallback((node) => {
    if (!node) return null
    const existing = pointObjectsRef.current.get(node.id)
    if (existing) {
      existing.x = node.x
      existing.y = node.y
      return existing
    }
    const created = new Point(node.x, node.y)
    created.id = node.id
    pointObjectsRef.current.set(node.id, created)
    return created
  }, [])

  const captureWorkingSketchSnapshot = useCallback((baseSketch) => {
    const serializedEntities = entities
      .map(serializeEntity)
      .filter(Boolean)
    const pointsMap = new Map()
    pointNodesRef.current.forEach((pt) => {
      pointsMap.set(pt.id, { id: pt.id, x: pt.x, y: pt.y })
    })
    serializedEntities.forEach((entity) => {
      if (entity.p1?.id) pointsMap.set(entity.p1.id, { id: entity.p1.id, x: entity.p1.x, y: entity.p1.y })
      if (entity.p2?.id) pointsMap.set(entity.p2.id, { id: entity.p2.id, x: entity.p2.x, y: entity.p2.y })
      if (entity.center?.id) pointsMap.set(entity.center.id, { id: entity.center.id, x: entity.center.x, y: entity.center.y })
    })
    const now = new Date().toISOString()
    return {
      id: baseSketch.id,
      name: baseSketch.name,
      plane: baseSketch.plane || DEFAULT_PLANE,
      entities: serializedEntities,
      points: Array.from(pointsMap.values()),
      visible: baseSketch.visible ?? true,
      status: serializedEntities.length > 0 ? 'ready' : 'empty',
      createdAt: baseSketch.createdAt || now,
      updatedAt: now,
    }
  }, [entities, serializeEntity])

  const restoreSketchToEditor = useCallback((sketch) => {
    const sourcePoints = Array.isArray(sketch?.points) ? sketch.points : []
    const normalizedPoints = sourcePoints
      .filter((pt) => pt && pt.id)
      .map((pt) => ({ id: pt.id, x: Number(pt.x) || 0, y: Number(pt.y) || 0 }))

    if (solverRef.current) solverRef.current.clear()
    pointObjectsRef.current.clear()

    const pointById = new Map(normalizedPoints.map((pt) => [pt.id, pt]))
    const getPointForEntity = (nodeRef) => {
      if (!nodeRef) return null
      const node = pointById.get(nodeRef.id) || { id: nodeRef.id || `skpt-${++pointIdRef.current}`, x: Number(nodeRef.x) || 0, y: Number(nodeRef.y) || 0 }
      pointById.set(node.id, node)
      return getPointObject(node)
    }

    const restoredEntities = []
    for (const entity of sketch?.entities || []) {
      if (entity.type === 'line') {
        const p1 = getPointForEntity(entity.p1)
        const p2 = getPointForEntity(entity.p2)
        if (!p1 || !p2) continue
        const line = new Line(p1, p2)
        line.id = entity.id || line.id
        line.construction = Boolean(entity.construction)
        if (solverRef.current) solverRef.current.addLine(line)
        restoredEntities.push(line)
        continue
      }
      if (entity.type === 'circle') {
        const center = getPointForEntity(entity.center)
        if (!center) continue
        const circle = new Circle(center, Number(entity.radius) || 0)
        circle.id = entity.id || circle.id
        circle.construction = Boolean(entity.construction)
        if (solverRef.current) solverRef.current.addCircle(circle)
        restoredEntities.push(circle)
        continue
      }
      if (entity.type === 'arc') {
        const center = getPointForEntity(entity.center)
        if (!center) continue
        const arc = new Arc(center, Number(entity.radius) || 0, Number(entity.startAngle) || 0, Number(entity.endAngle) || 0)
        arc.id = entity.id || arc.id
        arc.construction = Boolean(entity.construction)
        if (solverRef.current) solverRef.current.addArc(arc)
        restoredEntities.push(arc)
      }
    }

    const restoredPoints = Array.from(pointById.values())
    pointNodesRef.current = restoredPoints
    setPointNodes(restoredPoints)
    setEntities(restoredEntities)
    setConstraints([])
    setSelectedEntityId(null)
    setSelectedEntityIds([])
    setTempPoints([])
    setCurrentSnap(null)
  }, [getPointObject])

  const commitActiveSketch = useCallback((options = {}) => {
    const { discardEmptyNew = true, name, plane } = options
    const currentActiveSketchId = activeSketchIdRef.current
    const currentSketches = sketchesRef.current
    const currentDraft = draftSketchMetaRef.current
    const existingSketch = currentActiveSketchId ? currentSketches.find((item) => item.id === currentActiveSketchId) : null
    const baseSketch = existingSketch || currentDraft
    if (!baseSketch) return null

    const snapshot = captureWorkingSketchSnapshot({
      ...baseSketch,
      name: name || baseSketch.name,
      plane: plane || baseSketch.plane,
    })
    if (typeof window !== 'undefined' && window.__DEBUG_SKETCH__) {
      console.log(`${LOG_PREFIX} commitActiveSketch`, {
        entityCount: entitiesRef.current.length,
        activeSketchId: currentActiveSketchId,
        snapshotId: snapshot.id,
      })
    }
    if (!existingSketch && discardEmptyNew && snapshot.entities.length === 0) {
      setSelectedSketchId(null)
      setDraftSketchMeta(null)
      setActiveSketchId(null)
      return null
    }

    setSketches((prev) => {
      const hasExisting = prev.some((item) => item.id === snapshot.id)
      if (hasExisting) {
        return prev.map((item) => (item.id === snapshot.id ? snapshot : item))
      }
      return [...prev, snapshot]
    })
    setSelectedSketchId(snapshot.id)
    setDraftSketchMeta(null)
    return snapshot
  }, [captureWorkingSketchSnapshot])

  const commitWorkingSketch = commitActiveSketch

  useEffect(() => {
    if (activeSketchId || draftSketchMeta) return
    const usedPoints = new Map()
    entities.forEach((entity) => {
      if (entity?.p1?.id) usedPoints.set(entity.p1.id, { id: entity.p1.id, x: entity.p1.x, y: entity.p1.y })
      if (entity?.p2?.id) usedPoints.set(entity.p2.id, { id: entity.p2.id, x: entity.p2.x, y: entity.p2.y })
      if (entity?.center?.id) usedPoints.set(entity.center.id, { id: entity.center.id, x: entity.center.x, y: entity.center.y })
    })
    const next = Array.from(usedPoints.values())
    pointNodesRef.current = next
    setPointNodes(next)
  }, [entities, activeSketchId, draftSketchMeta])

  // Mark context as ready on mount
  useEffect(() => {
    bootMark('sketch', true);
    bootMark('solver', !solverDisabled, solverDisabled ? 'Disabled by user' : undefined);
    return () => bootMark('sketch', false);
  }, [solverDisabled])

  // Enter sketch mode
  const enterSketchMode = useCallback(() => {
    console.log(`${LOG_PREFIX} Entering sketch mode`)
    const now = new Date().toISOString()
    sketchNameCounterRef.current += 1
    const sketchId = `sketch-${Date.now()}-${++sketchIdRef.current}`
    const draft = {
      id: sketchId,
      name: `Sketch ${sketchNameCounterRef.current}`,
      plane: DEFAULT_PLANE,
      visible: true,
      status: 'editing',
      entities: [],
      points: [],
      createdAt: now,
      updatedAt: now,
    }
    resetEditorState()
    setDraftSketchMeta(draft)
    setActiveSketchId(sketchId)
    setSelectedSketchId(sketchId)
    setIsSketchMode(true)
    setActiveTool(SketchTool.LINE)
  }, [resetEditorState])

  // Exit sketch mode
  const exitSketchMode = useCallback(() => {
    console.log(`${LOG_PREFIX} Exiting sketch mode`)
    const committed = commitActiveSketch({ discardEmptyNew: true })
    setIsSketchMode(false)
    setActiveTool(SketchTool.SELECT)
    setTempPoints([])
    setSelectedEntityId(null)
    setSelectedEntityIds([])
    setActiveSketchId(committed?.id || null)
    setSelectedSketchId(committed?.id || null)
    setDraftSketchMeta(null)
    resetEditorState()
  }, [commitActiveSketch, resetEditorState])

  const editSketch = useCallback((sketchId) => {
    const sketch = sketches.find((item) => item.id === sketchId)
    if (!sketch) return
    if (isSketchMode) {
      commitActiveSketch({ discardEmptyNew: true })
    }
    const editableSketch = sketch.visible ? sketch : { ...sketch, visible: true, updatedAt: new Date().toISOString() }
    if (!sketch.visible) {
      setSketches((prev) => prev.map((item) => (item.id === sketchId ? editableSketch : item)))
    }
    restoreSketchToEditor(editableSketch)
    setDraftSketchMeta(null)
    setActiveSketchId(editableSketch.id)
    setSelectedSketchId(editableSketch.id)
    setIsSketchMode(true)
    setActiveTool(SketchTool.LINE)
  }, [commitActiveSketch, isSketchMode, restoreSketchToEditor, sketches])

  const renameSketch = useCallback((sketchId, name) => {
    const nextName = name?.trim()
    if (!nextName) return
    setSketches((prev) => prev.map((item) => (
      item.id === sketchId ? { ...item, name: nextName, updatedAt: new Date().toISOString() } : item
    )))
    if (draftSketchMeta?.id === sketchId) {
      setDraftSketchMeta((prev) => prev ? { ...prev, name: nextName, updatedAt: new Date().toISOString() } : prev)
    }
  }, [draftSketchMeta])

  const deleteSketch = useCallback((sketchId) => {
    setSketches((prev) => prev.filter((item) => item.id !== sketchId))
    if (selectedSketchId === sketchId) setSelectedSketchId(null)
    if (activeSketchId === sketchId) {
      setActiveSketchId(null)
      setIsSketchMode(false)
      setDraftSketchMeta(null)
      resetEditorState()
    }
  }, [activeSketchId, resetEditorState, selectedSketchId])

  const setSketchVisibility = useCallback((sketchId, visible) => {
    setSketches((prev) => prev.map((item) => (
      item.id === sketchId ? { ...item, visible, updatedAt: new Date().toISOString() } : item
    )))
    if (draftSketchMeta?.id === sketchId) {
      setDraftSketchMeta((prev) => prev ? { ...prev, visible, updatedAt: new Date().toISOString() } : prev)
    }
  }, [draftSketchMeta])

  const selectSketch = useCallback((sketchId) => {
    setSelectedSketchId(sketchId)
  }, [])

  const getSketchById = useCallback((sketchId) => {
    if (!sketchId) return null
    return sketches.find((item) => item.id === sketchId) || null
  }, [sketches])

  const getExtrudableProfileForSketch = useCallback((sketchId) => {
    const sketch = sketches.find((item) => item.id === sketchId) || null
    if (!sketch) {
      return {
        ok: false,
        error: 'Select a sketch before extruding.',
        sketch: null,
        profile: null,
        wireKey: null,
      }
    }

    const profileResult = getLargestClosedProfile(sketch)
    return {
      ...profileResult,
      sketch,
    }
  }, [sketches])

  // Add a line
  const createOrReusePoint = useCallback((x, y, preferredId = null, epsilon = 1e-6) => {
    const points = pointNodesRef.current
    if (preferredId) {
      const existingById = points.find((pt) => pt.id === preferredId)
      if (existingById) return existingById
    }

    const existing = points.find((pt) => (
      Math.abs(pt.x - x) <= epsilon && Math.abs(pt.y - y) <= epsilon
    ))
    if (existing) return existing

    const id = preferredId || `skpt-${++pointIdRef.current}`
    const node = { id, x, y }
    setPointNodes((prev) => [...prev, node])
    return node
  }, [])

  const syncPointNode = useCallback((nodeId, x, y) => {
    setPointNodes((prev) => prev.map((pt) => (
      pt.id === nodeId ? { ...pt, x, y } : pt
    )))
    const pointObject = pointObjectsRef.current.get(nodeId)
    if (pointObject) {
      pointObject.x = x
      pointObject.y = y
    }
  }, [])

  // Add a line
  const addLine = useCallback((x1, y1, x2, y2, p1Id = null, p2Id = null) => {
    const p1Node = createOrReusePoint(x1, y1, p1Id)
    const p2Node = createOrReusePoint(x2, y2, p2Id)
    const p1 = getPointObject(p1Node)
    const p2 = getPointObject(p2Node)
    const line = new Line(p1, p2)
    line.construction = isConstructionMode
    
    if (solverRef.current) solverRef.current.addLine(line)
    
    setEntities(prev => [...prev, line])
    console.log(`${LOG_PREFIX} Added line ${line.id}: (${x1.toFixed(2)}, ${y1.toFixed(2)}) to (${x2.toFixed(2)}, ${y2.toFixed(2)})`)
    
    return line
  }, [createOrReusePoint, getPointObject, isConstructionMode])

  // Add a circle
  const addCircle = useCallback((cx, cy, radius, centerId = null) => {
    const centerNode = createOrReusePoint(cx, cy, centerId)
    const center = getPointObject(centerNode)
    const circle = new Circle(center, radius)
    circle.construction = isConstructionMode
    
    if (solverRef.current) solverRef.current.addCircle(circle)
    
    setEntities(prev => [...prev, circle])
    console.log(`${LOG_PREFIX} Added circle ${circle.id}: center (${cx.toFixed(2)}, ${cy.toFixed(2)}), radius ${radius.toFixed(2)}`)
    
    return circle
  }, [createOrReusePoint, getPointObject, isConstructionMode])

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
  const findSnap = useCallback((x, y, referencePoint = null, maxDistance = null) => {
    if (!snappingEnabled) {
      setCurrentSnap(null)
      return null
    }
    
    const snap = snappingService.findSnap(x, y, entities, { referencePoint })
    if (snap && Number.isFinite(maxDistance) && snap.distance > maxDistance) {
      setCurrentSnap(null)
      return null
    }
    setCurrentSnap(snap)
    return snap
  }, [entities, snappingEnabled])

  // Get snapped position (returns snap point or original)
  const getSnappedPosition = useCallback((x, y, referencePoint = null, maxDistance = null) => {
    const snap = findSnap(x, y, referencePoint, maxDistance)
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
        syncPointNode(entity.p1.id, entity.p1.x, entity.p1.y)
      } else if (draggedPoint.pointName === 'p2' && entity.p2) {
        entity.p2.moveTo(snapX, snapY)
        syncPointNode(entity.p2.id, entity.p2.x, entity.p2.y)
      } else if (draggedPoint.pointName === 'center' && entity.center) {
        entity.center.moveTo(snapX, snapY)
        syncPointNode(entity.center.id, entity.center.x, entity.center.y)
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
  }, [draggedPoint, editMode, dragStartPos, entities, getSnappedPosition, syncPointNode])

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
    setPointNodes([])
    pointNodesRef.current = []
    pointObjectsRef.current.clear()
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
          extrudeCallbackRef.current(result.geometry, result.topologyMap, length, {
            sketchId: activeSketchId || selectedSketchId || draftSketchMeta?.id || null,
          })
        }
        
        // Keep sketch persisted, then leave sketch mode.
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
  }, [activeSketchId, draftSketchMeta?.id, entities, exitSketchMode, selectedSketchId])

  // Get selected entity
  const selectedEntity = entities.find(e => e.id === selectedEntityId)
  
  // Check if sketch can be extruded (has at least one entity)
  const canExtrude = entities.length > 0
  const sketchById = useMemo(() => {
    const map = new Map()
    sketches.forEach((item) => {
      map.set(item.id, item)
    })
    return map
  }, [sketches])

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
    pointNodes,
    sketches,
    sketchById,
    activeSketchId,
    selectedSketchId,
    
    // State setters
    setTempPoints,
    setActiveTool,
    setSelectedEntityId,
    setSelectedEntityIds,
    setIsConstructionMode,
    setSnappingEnabled,
    setSelectedSketchId,
    
    // Mode control
    enterSketchMode,
    exitSketchMode,
    editSketch,
    renameSketch,
    deleteSketch,
    setSketchVisibility,
    selectSketch,
    getSketchById,
    getExtrudableProfileForSketch,
    
    // Entity creation
    addLine,
    addCircle,
    addArc,
    createOrReusePoint,
    syncPointNode,
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
    commitActiveSketch,
    commitWorkingSketch,
    
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
