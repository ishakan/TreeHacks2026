import { useRef, useEffect, useCallback, useState } from 'react'
import { useSketch, SketchTool, EditMode } from '../context/SketchContext'
import { SnapType } from '../services/snappingService'

const LOG_PREFIX = '[SketchCanvas]'

// Colors
const COLORS = {
  background: '#1a1a2e',
  grid: '#2a2a4a',
  gridMajor: '#3a3a5a',
  line: '#4a90d9',
  lineSelected: '#ffa500',
  lineHighlighted: '#ff6b6b',
  lineConstruction: '#6b7280',
  circle: '#4a90d9',
  circleSelected: '#ffa500',
  circleConstruction: '#6b7280',
  arc: '#4a90d9',
  point: '#ffffff',
  pointHover: '#ffff00',
  temp: '#888888',
  constraint: '#00ff00',
  constraintBad: '#ff4444',
  snap: {
    endpoint: '#00ff00',
    midpoint: '#00ffff',
    center: '#ff00ff',
    intersection: '#ffff00',
    perpendicular: '#ff8800',
    tangent: '#8800ff',
    nearest: '#00ff88',
    grid: '#888888',
    angle: '#ff0088',
    horizontal: '#00aaff',
    vertical: '#00aaff',
  }
}

export default function SketchCanvas() {
  const canvasRef = useRef(null)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(50) // pixels per unit
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState(null) // { x, y, pointId }
  const [currentPoint, setCurrentPoint] = useState(null)
  const [cursorPoint, setCursorPoint] = useState(null)
  const [pendingCircleCenter, setPendingCircleCenter] = useState(null) // { x, y, pointId }
  const [hoveredPoint, setHoveredPoint] = useState(null) // { entityId, pointName }
  const [isPanning, setIsPanning] = useState(false)
  const [lastPanPos, setLastPanPos] = useState(null)
  const [lastPointerDownAt, setLastPointerDownAt] = useState(null)
  const [debugNote, setDebugNote] = useState('')

  const {
    isSketchMode,
    activeTool,
    entities,
    constraints,
    selectedEntityId,
    selectedEntityIds,
    setSelectedEntityId,
    setSelectedEntityIds,
    addLine,
    addCircle,
    addArc,
    editMode,
    startDragPoint,
    startDragEntity,
    updateDrag,
    endDrag,
    currentSnap,
    findSnap,
    getSnappedPosition,
    createOrReusePoint,
    highlightedEntityIds,
    pointNodes,
    sketches,
    activeSketchId,
  } = useSketch()
  const debugSketch = typeof window !== 'undefined' && Boolean(window.__DEBUG_SKETCH__)
  const currentStage = startPoint ? 'hasStart' : 'idle'
  const snapDistance = Math.max(0.08, 12 / zoom)
  const activeSketchMeta = sketches.find((item) => item.id === activeSketchId) || null
  const isActiveSketchVisible = activeSketchMeta ? activeSketchMeta.visible !== false : true

  const resolvePointIdFromSnap = useCallback((snap) => {
    if (!snap?.sourceEntity) return null

    const entity = snap.sourceEntity
    if (snap.type === SnapType.ENDPOINT && entity.type === 'line') {
      const isP1 = Math.abs(entity.p1.x - snap.point.x) < 1e-6 && Math.abs(entity.p1.y - snap.point.y) < 1e-6
      if (isP1) return entity.p1.id || null
      const isP2 = Math.abs(entity.p2.x - snap.point.x) < 1e-6 && Math.abs(entity.p2.y - snap.point.y) < 1e-6
      if (isP2) return entity.p2.id || null
    }

    if (snap.type === SnapType.CENTER && entity.center) {
      return entity.center.id || null
    }

    return null
  }, [])

  // Convert screen coordinates to world coordinates
  const screenToWorld = useCallback((screenX, screenY) => {
    const centerX = canvasSize.width / 2 + pan.x
    const centerY = canvasSize.height / 2 + pan.y
    return {
      x: (screenX - centerX) / zoom,
      y: -(screenY - centerY) / zoom, // Flip Y for standard math coordinates
    }
  }, [canvasSize, pan, zoom])

  // Convert world coordinates to screen coordinates
  const worldToScreen = useCallback((worldX, worldY) => {
    const centerX = canvasSize.width / 2 + pan.x
    const centerY = canvasSize.height / 2 + pan.y
    return {
      x: worldX * zoom + centerX,
      y: -worldY * zoom + centerY, // Flip Y
    }
  }, [canvasSize, pan, zoom])

  // Draw grid
  const drawGrid = useCallback((ctx) => {
    const { width, height } = canvasSize
    const gridSize = 1 // 1 unit
    const majorGridSize = 5 // Every 5 units

    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 0.5

    // Calculate visible range
    const topLeft = screenToWorld(0, 0)
    const bottomRight = screenToWorld(width, height)

    const startX = Math.floor(topLeft.x / gridSize) * gridSize
    const endX = Math.ceil(bottomRight.x / gridSize) * gridSize
    const startY = Math.floor(bottomRight.y / gridSize) * gridSize
    const endY = Math.ceil(topLeft.y / gridSize) * gridSize

    // Vertical lines
    for (let x = startX; x <= endX; x += gridSize) {
      const screen = worldToScreen(x, 0)
      ctx.strokeStyle = x % majorGridSize === 0 ? COLORS.gridMajor : COLORS.grid
      ctx.beginPath()
      ctx.moveTo(screen.x, 0)
      ctx.lineTo(screen.x, height)
      ctx.stroke()
    }

    // Horizontal lines
    for (let y = startY; y <= endY; y += gridSize) {
      const screen = worldToScreen(0, y)
      ctx.strokeStyle = y % majorGridSize === 0 ? COLORS.gridMajor : COLORS.grid
      ctx.beginPath()
      ctx.moveTo(0, screen.y)
      ctx.lineTo(width, screen.y)
      ctx.stroke()
    }

    // Draw axes
    const origin = worldToScreen(0, 0)
    ctx.strokeStyle = '#ff4444'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(origin.x, 0)
    ctx.lineTo(origin.x, height)
    ctx.stroke()

    ctx.strokeStyle = '#44ff44'
    ctx.beginPath()
    ctx.moveTo(0, origin.y)
    ctx.lineTo(width, origin.y)
    ctx.stroke()
  }, [canvasSize, screenToWorld, worldToScreen])

  // Draw a line entity
  const drawLine = useCallback((ctx, line, isSelected, isHighlighted = false) => {
    const p1Screen = worldToScreen(line.p1.x, line.p1.y)
    const p2Screen = worldToScreen(line.p2.x, line.p2.y)

    // Determine color based on state
    let strokeColor = COLORS.line
    if (line.construction) strokeColor = COLORS.lineConstruction
    if (isHighlighted) strokeColor = COLORS.lineHighlighted
    if (isSelected) strokeColor = COLORS.lineSelected

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isSelected ? 3 : 2
    
    // Construction geometry uses dashed lines
    if (line.construction) {
      ctx.setLineDash([8, 4])
    }
    
    ctx.beginPath()
    ctx.moveTo(p1Screen.x, p1Screen.y)
    ctx.lineTo(p2Screen.x, p2Screen.y)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw endpoints (larger if hovered or selected)
    const p1Hovered = hoveredPoint?.entityId === line.id && hoveredPoint?.pointName === 'p1'
    const p2Hovered = hoveredPoint?.entityId === line.id && hoveredPoint?.pointName === 'p2'
    
    ctx.fillStyle = p1Hovered ? COLORS.pointHover : COLORS.point
    ctx.beginPath()
    ctx.arc(p1Screen.x, p1Screen.y, p1Hovered ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()
    
    ctx.fillStyle = p2Hovered ? COLORS.pointHover : COLORS.point
    ctx.beginPath()
    ctx.arc(p2Screen.x, p2Screen.y, p2Hovered ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()
  }, [worldToScreen, hoveredPoint])

  // Draw a circle entity
  const drawCircle = useCallback((ctx, circle, isSelected, isHighlighted = false) => {
    const centerScreen = worldToScreen(circle.center.x, circle.center.y)
    const radiusScreen = circle.radius * zoom

    let strokeColor = COLORS.circle
    if (circle.construction) strokeColor = COLORS.circleConstruction
    if (isHighlighted) strokeColor = COLORS.lineHighlighted
    if (isSelected) strokeColor = COLORS.circleSelected

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isSelected ? 3 : 2
    
    if (circle.construction) {
      ctx.setLineDash([8, 4])
    }
    
    ctx.beginPath()
    ctx.arc(centerScreen.x, centerScreen.y, radiusScreen, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw center point
    const centerHovered = hoveredPoint?.entityId === circle.id && hoveredPoint?.pointName === 'center'
    ctx.fillStyle = centerHovered ? COLORS.pointHover : COLORS.point
    ctx.beginPath()
    ctx.arc(centerScreen.x, centerScreen.y, centerHovered ? 6 : 4, 0, Math.PI * 2)
    ctx.fill()
  }, [worldToScreen, zoom, hoveredPoint])

  // Draw an arc entity
  const drawArc = useCallback((ctx, arc, isSelected, isHighlighted = false) => {
    const centerScreen = worldToScreen(arc.center.x, arc.center.y)
    const radiusScreen = arc.radius * zoom

    let strokeColor = COLORS.arc
    if (arc.construction) strokeColor = COLORS.circleConstruction
    if (isHighlighted) strokeColor = COLORS.lineHighlighted
    if (isSelected) strokeColor = COLORS.circleSelected

    ctx.strokeStyle = strokeColor
    ctx.lineWidth = isSelected ? 3 : 2
    
    if (arc.construction) {
      ctx.setLineDash([8, 4])
    }
    
    // Note: Canvas arc goes clockwise, our angles are counter-clockwise
    ctx.beginPath()
    ctx.arc(centerScreen.x, centerScreen.y, radiusScreen, -arc.endAngle, -arc.startAngle)
    ctx.stroke()
    ctx.setLineDash([])

    // Draw endpoints and center
    const startScreen = worldToScreen(
      arc.center.x + arc.radius * Math.cos(arc.startAngle),
      arc.center.y + arc.radius * Math.sin(arc.startAngle)
    )
    const endScreen = worldToScreen(
      arc.center.x + arc.radius * Math.cos(arc.endAngle),
      arc.center.y + arc.radius * Math.sin(arc.endAngle)
    )

    ctx.fillStyle = COLORS.point
    ctx.beginPath()
    ctx.arc(startScreen.x, startScreen.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(endScreen.x, endScreen.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(centerScreen.x, centerScreen.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }, [worldToScreen, zoom])

  // Draw constraint indicators
  const drawConstraints = useCallback((ctx) => {
    constraints.forEach(constraint => {
      const color = constraint.satisfied ? COLORS.constraint : COLORS.constraintBad
      ctx.fillStyle = color
      ctx.font = '11px monospace'
      
      if (constraint.type === 'horizontal' && constraint.entities[0]?.type === 'line') {
        const line = constraint.entities[0]
        const mid = worldToScreen((line.p1.x + line.p2.x) / 2, (line.p1.y + line.p2.y) / 2)
        ctx.fillText('H', mid.x - 5, mid.y - 10)
      }
      else if (constraint.type === 'vertical' && constraint.entities[0]?.type === 'line') {
        const line = constraint.entities[0]
        const mid = worldToScreen((line.p1.x + line.p2.x) / 2, (line.p1.y + line.p2.y) / 2)
        ctx.fillText('V', mid.x + 5, mid.y - 10)
      }
      else if (constraint.type === 'length' || constraint.type === 'dimension') {
        const entity = constraint.entities[0]
        if (entity?.type === 'line') {
          const mid = worldToScreen((entity.p1.x + entity.p2.x) / 2, (entity.p1.y + entity.p2.y) / 2)
          ctx.fillText(`${constraint.value?.toFixed(2) || '?'}`, mid.x, mid.y + 20)
        }
      }
      else if (constraint.type === 'radius') {
        const entity = constraint.entities[0]
        if (entity?.center) {
          const pos = worldToScreen(entity.center.x, entity.center.y)
          ctx.fillText(`R${constraint.value?.toFixed(2) || '?'}`, pos.x + 10, pos.y - 10)
        }
      }
      else if (constraint.type === 'coincident') {
        const p1 = constraint.entities[0]
        if (p1) {
          const pos = worldToScreen(p1.x || p1.center?.x || 0, p1.y || p1.center?.y || 0)
          ctx.fillText('⊙', pos.x - 5, pos.y - 8)
        }
      }
      else if (constraint.type === 'parallel') {
        const line = constraint.entities[0]
        if (line?.type === 'line') {
          const mid = worldToScreen((line.p1.x + line.p2.x) / 2, (line.p1.y + line.p2.y) / 2)
          ctx.fillText('∥', mid.x + 10, mid.y - 8)
        }
      }
      else if (constraint.type === 'perpendicular') {
        const line = constraint.entities[0]
        if (line?.type === 'line') {
          const mid = worldToScreen((line.p1.x + line.p2.x) / 2, (line.p1.y + line.p2.y) / 2)
          ctx.fillText('⊥', mid.x + 10, mid.y - 8)
        }
      }
    })
  }, [constraints, worldToScreen])

  // Draw snap indicator
  const drawSnapIndicator = useCallback((ctx) => {
    if (!currentSnap) return
    
    const snapScreen = worldToScreen(currentSnap.point.x, currentSnap.point.y)
    const snapColor = COLORS.snap[currentSnap.type] || '#ffffff'
    
    ctx.save()
    ctx.strokeStyle = snapColor
    ctx.fillStyle = snapColor
    ctx.lineWidth = 2
    
    // Draw snap symbol based on type
    const size = 10
    switch (currentSnap.type) {
      case SnapType.ENDPOINT:
        // Circle
        ctx.beginPath()
        ctx.arc(snapScreen.x, snapScreen.y, size, 0, Math.PI * 2)
        ctx.stroke()
        break
      case SnapType.MIDPOINT:
        // Triangle
        ctx.beginPath()
        ctx.moveTo(snapScreen.x, snapScreen.y - size)
        ctx.lineTo(snapScreen.x - size, snapScreen.y + size)
        ctx.lineTo(snapScreen.x + size, snapScreen.y + size)
        ctx.closePath()
        ctx.stroke()
        break
      case SnapType.CENTER:
        // Cross with circle
        ctx.beginPath()
        ctx.arc(snapScreen.x, snapScreen.y, size * 0.7, 0, Math.PI * 2)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(snapScreen.x - size, snapScreen.y)
        ctx.lineTo(snapScreen.x + size, snapScreen.y)
        ctx.moveTo(snapScreen.x, snapScreen.y - size)
        ctx.lineTo(snapScreen.x, snapScreen.y + size)
        ctx.stroke()
        break
      case SnapType.INTERSECTION:
        // X mark
        ctx.beginPath()
        ctx.moveTo(snapScreen.x - size, snapScreen.y - size)
        ctx.lineTo(snapScreen.x + size, snapScreen.y + size)
        ctx.moveTo(snapScreen.x + size, snapScreen.y - size)
        ctx.lineTo(snapScreen.x - size, snapScreen.y + size)
        ctx.stroke()
        break
      case SnapType.GRID:
        // Small plus
        ctx.beginPath()
        ctx.moveTo(snapScreen.x - size/2, snapScreen.y)
        ctx.lineTo(snapScreen.x + size/2, snapScreen.y)
        ctx.moveTo(snapScreen.x, snapScreen.y - size/2)
        ctx.lineTo(snapScreen.x, snapScreen.y + size/2)
        ctx.stroke()
        break
      default:
        // Filled circle
        ctx.beginPath()
        ctx.arc(snapScreen.x, snapScreen.y, 5, 0, Math.PI * 2)
        ctx.fill()
    }
    
    ctx.restore()
  }, [currentSnap, worldToScreen])

  // Draw temporary line/circle while drawing
  const drawTemp = useCallback((ctx) => {
    if (!isDrawing || !startPoint || !currentPoint) return

    ctx.strokeStyle = COLORS.temp
    ctx.lineWidth = 1
    ctx.setLineDash([5, 5])

    const startScreen = worldToScreen(startPoint.x, startPoint.y)
    const currentScreen = worldToScreen(currentPoint.x, currentPoint.y)

    // Show anchored start node immediately after first click.
    ctx.fillStyle = COLORS.point
    ctx.beginPath()
    ctx.arc(startScreen.x, startScreen.y, 4, 0, Math.PI * 2)
    ctx.fill()

    if (activeTool === SketchTool.LINE) {
      ctx.beginPath()
      ctx.moveTo(startScreen.x, startScreen.y)
      ctx.lineTo(currentScreen.x, currentScreen.y)
      ctx.stroke()
    } else if (activeTool === SketchTool.CIRCLE) {
      const radius = Math.sqrt(
        Math.pow(currentPoint.x - startPoint.x, 2) +
        Math.pow(currentPoint.y - startPoint.y, 2)
      ) * zoom
      ctx.beginPath()
      ctx.arc(startScreen.x, startScreen.y, radius, 0, Math.PI * 2)
      ctx.stroke()
    }

    ctx.setLineDash([])
  }, [isDrawing, startPoint, currentPoint, activeTool, worldToScreen, zoom])

  // Main render function
  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    // Clear canvas
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height)

    // Draw grid
    drawGrid(ctx)

    // Draw entities
    if (isActiveSketchVisible) {
      entities.forEach(entity => {
        const isSelected = entity.id === selectedEntityId || selectedEntityIds?.includes(entity.id)
        const isHighlighted = highlightedEntityIds?.includes(entity.id)
        
        if (entity.type === 'line') {
          drawLine(ctx, entity, isSelected, isHighlighted)
        } else if (entity.type === 'circle') {
          drawCircle(ctx, entity, isSelected, isHighlighted)
        } else if (entity.type === 'arc') {
          drawArc(ctx, entity, isSelected, isHighlighted)
        }
      })
    }

    // Draw constraints
    if (isActiveSketchVisible) {
      drawConstraints(ctx)
    }

    // Draw temp shape
    if (isActiveSketchVisible) {
      drawTemp(ctx)
    }
    
    // Draw snap indicator
    if (isActiveSketchVisible) {
      drawSnapIndicator(ctx)
    }
  }, [
    canvasSize,
    drawGrid,
    entities,
    selectedEntityId,
    selectedEntityIds,
    highlightedEntityIds,
    drawLine,
    drawCircle,
    drawArc,
    drawConstraints,
    drawTemp,
    drawSnapIndicator,
    isActiveSketchVisible,
  ])

  // Handle canvas resize
  useEffect(() => {
    const handleResize = () => {
      const container = canvasRef.current?.parentElement
      if (container) {
        setCanvasSize({
          width: container.clientWidth,
          height: container.clientHeight,
        })
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Render loop
  useEffect(() => {
    render()
  }, [render])

  // Find point near cursor (for drag editing)
  const findNearPoint = useCallback((worldPos, threshold = 0.3) => {
    for (const entity of entities) {
      if (entity.type === 'line') {
        const d1 = Math.sqrt((worldPos.x - entity.p1.x) ** 2 + (worldPos.y - entity.p1.y) ** 2)
        if (d1 < threshold) return { entityId: entity.id, pointName: 'p1', entity }
        const d2 = Math.sqrt((worldPos.x - entity.p2.x) ** 2 + (worldPos.y - entity.p2.y) ** 2)
        if (d2 < threshold) return { entityId: entity.id, pointName: 'p2', entity }
      } else if (entity.type === 'circle' || entity.type === 'arc') {
        const dc = Math.sqrt((worldPos.x - entity.center.x) ** 2 + (worldPos.y - entity.center.y) ** 2)
        if (dc < threshold) return { entityId: entity.id, pointName: 'center', entity }
      }
    }
    return null
  }, [entities])

  // Mouse handlers
  const handleMouseDown = (e) => {
    if (!isActiveSketchVisible) return
    const rect = canvasRef.current.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const worldPos = screenToWorld(screenX, screenY)

    // Middle mouse button for panning
    if (e.button === 1) {
      setIsPanning(true)
      setLastPanPos({ x: screenX, y: screenY })
      return
    }

    if (activeTool === SketchTool.SELECT) {
      // Check if clicking on a point (for dragging)
      const nearPoint = findNearPoint(worldPos)
      if (nearPoint) {
        // Start dragging the point
        startDragPoint(nearPoint.entityId, nearPoint.pointName, worldPos.x, worldPos.y)
        return
      }

      // Find clicked entity for selection
      let clickedEntity = null
      for (const entity of entities) {
        if (entity.type === 'line') {
          const dist = distanceToLine(worldPos, entity.p1, entity.p2)
          if (dist < 0.2) {
            clickedEntity = entity
            break
          }
        } else if (entity.type === 'circle' || entity.type === 'arc') {
          const dist = Math.abs(
            Math.sqrt((worldPos.x - entity.center.x) ** 2 + (worldPos.y - entity.center.y) ** 2) - entity.radius
          )
          if (dist < 0.2) {
            clickedEntity = entity
            break
          }
        }
      }

      // Handle selection (with Shift for multi-select)
      if (e.shiftKey && clickedEntity) {
        // Toggle in multi-select
        setSelectedEntityIds(prev => {
          if (prev.includes(clickedEntity.id)) {
            return prev.filter(id => id !== clickedEntity.id)
          } else {
            return [...prev, clickedEntity.id]
          }
        })
      } else {
        setSelectedEntityId(clickedEntity?.id || null)
        setSelectedEntityIds(clickedEntity ? [clickedEntity.id] : [])
      }

      // Double-click to start dragging entire entity
      if (e.detail === 2 && clickedEntity) {
        startDragEntity(clickedEntity.id, worldPos.x, worldPos.y)
      }
    } else if (activeTool === SketchTool.LINE) {
      const snapped = getSnappedPosition(worldPos.x, worldPos.y, pendingCircleCenter || startPoint, snapDistance)
      const preferredId = resolvePointIdFromSnap(snapped.snap)
      const startNode = createOrReusePoint(snapped.x, snapped.y, preferredId)
      setDebugNote(snapped.snap ? `SNAP:${snapped.snap.type}` : 'FREE')

      if (!startPoint) {
        setStartPoint({ x: startNode.x, y: startNode.y, pointId: startNode.id })
        setCurrentPoint({ x: startNode.x, y: startNode.y })
        setIsDrawing(true)
        return
      }

      const endNode = createOrReusePoint(snapped.x, snapped.y, preferredId)
      if (startPoint.pointId !== endNode.id) {
        addLine(startPoint.x, startPoint.y, endNode.x, endNode.y, startPoint.pointId, endNode.id)
      }
      // Continue polyline until Enter/Esc.
      setStartPoint({ x: endNode.x, y: endNode.y, pointId: endNode.id })
      setCurrentPoint({ x: endNode.x, y: endNode.y })
      setIsDrawing(true)
    } else if (activeTool === SketchTool.CIRCLE) {
      const snapped = getSnappedPosition(worldPos.x, worldPos.y, pendingCircleCenter || startPoint, snapDistance)
      const preferredId = resolvePointIdFromSnap(snapped.snap)
      const centerNode = createOrReusePoint(snapped.x, snapped.y, preferredId)
      setDebugNote(snapped.snap ? `SNAP:${snapped.snap.type}` : 'FREE')
      if (!pendingCircleCenter) {
        setPendingCircleCenter({ x: centerNode.x, y: centerNode.y, pointId: centerNode.id })
        setStartPoint({ x: centerNode.x, y: centerNode.y, pointId: centerNode.id })
        setCurrentPoint({ x: centerNode.x, y: centerNode.y })
        setIsDrawing(true)
        return
      }

      const radius = Math.sqrt(
        (snapped.x - pendingCircleCenter.x) ** 2 +
        (snapped.y - pendingCircleCenter.y) ** 2
      )
      if (radius > 1e-4) {
        addCircle(pendingCircleCenter.x, pendingCircleCenter.y, radius, pendingCircleCenter.pointId)
      }
      setPendingCircleCenter(null)
      setStartPoint(null)
      setCurrentPoint(null)
      setIsDrawing(false)
    }
  }

  const handleMouseMove = (e) => {
    if (!isActiveSketchVisible) return
    const rect = canvasRef.current.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const worldPos = screenToWorld(screenX, screenY)
    setCursorPoint(worldPos)

    // Handle panning
    if (isPanning && lastPanPos) {
      const dx = screenX - lastPanPos.x
      const dy = screenY - lastPanPos.y
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }))
      setLastPanPos({ x: screenX, y: screenY })
      return
    }

    // Handle drag editing
    if (editMode !== EditMode.NONE) {
      updateDrag(worldPos.x, worldPos.y)
      return
    }

    // Update hovered point for visual feedback
    const nearPoint = findNearPoint(worldPos)
    setHoveredPoint(nearPoint)

    // Drawing mode
    if (isDrawing) {
      // Apply snapping during drawing
      const snapped = getSnappedPosition(
        worldPos.x,
        worldPos.y,
        pendingCircleCenter || startPoint,
        snapDistance
      )
      setCurrentPoint({ x: snapped.x, y: snapped.y })
    } else {
      // Just update snap indicator when not drawing
      findSnap(worldPos.x, worldPos.y, pendingCircleCenter || startPoint, snapDistance)
    }
  }

  const handleMouseUp = (e) => {
    if (!isActiveSketchVisible) return
    // End panning
    if (isPanning) {
      setIsPanning(false)
      setLastPanPos(null)
      return
    }

    // End drag editing
    if (editMode !== EditMode.NONE) {
      endDrag()
      return
    }

    // Click-click workflows commit on second click in handleMouseDown.
  }

  // Handle wheel zoom
  const handleWheel = (e) => {
    e.preventDefault()
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.min(200, Math.max(10, prev * zoomFactor)))
  }

  const handlePointerDownCapture = useCallback((event) => {
    if (!isSketchMode) return
    setLastPointerDownAt(Date.now())
    event.stopPropagation()
    event.nativeEvent?.stopImmediatePropagation?.()
  }, [isSketchMode])

  const stopPointerPropagation = useCallback((event) => {
    if (!isSketchMode) return
    event.stopPropagation()
  }, [isSketchMode])

  const handleKeyDown = useCallback((event) => {
    if (!isSketchMode) return

    if (event.key === 'Escape') {
      setIsDrawing(false)
      setStartPoint(null)
      setCurrentPoint(null)
      setPendingCircleCenter(null)
      return
    }
    if (event.key === 'Enter' && activeTool === SketchTool.LINE) {
      setIsDrawing(false)
      setStartPoint(null)
      setCurrentPoint(null)
    }
  }, [activeTool, isSketchMode])

  useEffect(() => {
    if (!isSketchMode) return

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown, isSketchMode])

  if (!isSketchMode) return null

  return (
    <>
      <canvas
        ref={canvasRef}
        width={canvasSize.width}
        height={canvasSize.height}
        className="absolute inset-0 z-30 cursor-crosshair pointer-events-auto"
        onPointerDownCapture={handlePointerDownCapture}
        onPointerMoveCapture={stopPointerPropagation}
        onPointerUpCapture={stopPointerPropagation}
        onWheelCapture={stopPointerPropagation}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {debugSketch && (
        <div className="absolute left-2 top-2 z-40 rounded border border-cyan-400/40 bg-black/60 px-2 py-1 text-[11px] text-cyan-200 pointer-events-none">
          tool={activeTool} sketch={String(isSketchMode)} stage={currentStage} cursor=(
          {Number.isFinite(cursorPoint?.x) ? cursorPoint.x.toFixed(3) : 'NaN'},{' '}
          {Number.isFinite(cursorPoint?.y) ? cursorPoint.y.toFixed(3) : 'NaN'}) entities={entities.length} points={pointNodes.length} visible={String(isActiveSketchVisible)}{' '}
          pointerDownAt={lastPointerDownAt ? new Date(lastPointerDownAt).toLocaleTimeString() : '-'} {debugNote}
        </div>
      )}
    </>
  )
}

// Helper: distance from point to line segment
function distanceToLine(point, lineP1, lineP2) {
  const A = point.x - lineP1.x
  const B = point.y - lineP1.y
  const C = lineP2.x - lineP1.x
  const D = lineP2.y - lineP1.y

  const dot = A * C + B * D
  const lenSq = C * C + D * D
  let param = -1

  if (lenSq !== 0) param = dot / lenSq

  let xx, yy

  if (param < 0) {
    xx = lineP1.x
    yy = lineP1.y
  } else if (param > 1) {
    xx = lineP2.x
    yy = lineP2.y
  } else {
    xx = lineP1.x + param * C
    yy = lineP1.y + param * D
  }

  const dx = point.x - xx
  const dy = point.y - yy
  return Math.sqrt(dx * dx + dy * dy)
}
