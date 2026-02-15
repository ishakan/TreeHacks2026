import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, TransformControls } from '@react-three/drei'
import { useShapes } from '../context/ShapeContext'
import { useSketch } from '../context/SketchContext'
import { useSelection } from '../context/SelectionContext'
import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import * as THREE from 'three'
import {
  getSelectionFromHit,
  screenToNDC,
} from '../services/selectionService'
import CameraControlsUI, { EnhancedCameraController } from './CameraControls'
import ImportedObjects from './ImportedObjects'
import { useWorkspace } from '../context/WorkspaceContext'
import { useFeatureTree } from '../context/FeatureTreeContext'
import { createEdgeSelectionRef } from '../services/selectionRef'

const LOG_PREFIX = '[Viewport]'

// Helper to update boot tracker
function bootMark(key, ok, error) {
  if (typeof window !== 'undefined' && window.__BOOT) {
    window.__BOOT.mark(key, ok, error);
  }
}

// Selection highlight colors
const HOVER_COLOR = new THREE.Color(0x88ccff)
const SELECTED_COLOR = new THREE.Color(0xffaa00)
const BASE_EMISSIVE = new THREE.Color(0x000000)
const DEFAULT_SKETCH_PLANE = {
  origin: [0, 0, 0],
  normal: [0, 0, 1],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
}

function toVec3(input, fallback) {
  if (Array.isArray(input) && input.length === 3) {
    const x = Number(input[0])
    const y = Number(input[1])
    const z = Number(input[2])
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      return new THREE.Vector3(x, y, z)
    }
  }
  return fallback.clone()
}

function resolveSketchPlane(plane) {
  const origin = toVec3(plane?.origin, new THREE.Vector3(...DEFAULT_SKETCH_PLANE.origin))
  const normal = toVec3(plane?.normal, new THREE.Vector3(...DEFAULT_SKETCH_PLANE.normal)).normalize()
  const xAxisCandidate = toVec3(plane?.xAxis, new THREE.Vector3(...DEFAULT_SKETCH_PLANE.xAxis))
  let xAxis = xAxisCandidate.clone().normalize()

  if (xAxis.lengthSq() < 1e-9 || Math.abs(xAxis.dot(normal)) > 0.999) {
    xAxis = Math.abs(normal.z) < 0.9
      ? new THREE.Vector3(0, 0, 1).cross(normal).normalize()
      : new THREE.Vector3(0, 1, 0).cross(normal).normalize()
  }

  let yAxis = toVec3(plane?.yAxis, new THREE.Vector3(...DEFAULT_SKETCH_PLANE.yAxis)).normalize()
  if (yAxis.lengthSq() < 1e-9 || Math.abs(yAxis.dot(normal)) > 0.999) {
    yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize()
  }

  if (yAxis.lengthSq() < 1e-9) {
    yAxis = new THREE.Vector3().crossVectors(normal, xAxisCandidate.lengthSq() > 1e-9 ? xAxisCandidate : new THREE.Vector3(1, 0, 0)).normalize()
  }

  return { origin, normal, xAxis, yAxis }
}

function sketchWorldPoint(planeBasis, u, v, normalOffset = 0.001) {
  return planeBasis.origin
    .clone()
    .addScaledVector(planeBasis.xAxis, Number(u) || 0)
    .addScaledVector(planeBasis.yAxis, Number(v) || 0)
    .addScaledVector(planeBasis.normal, normalOffset)
}

function Polyline3D({ points, color, renderOrder = 999, sketchId = null, wireKey = null }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setFromPoints(points)
    return geo
  }, [points])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <line
      geometry={geometry}
      renderOrder={renderOrder}
      userData={{
        selectable: Boolean(sketchId),
        sketchId,
        wireKey,
      }}
    >
      <lineBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
    </line>
  )
}

function PointCloud3D({ points, color, size = 0.045, renderOrder = 1000 }) {
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setFromPoints(points)
    return geo
  }, [points])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry} renderOrder={renderOrder}>
      <pointsMaterial color={color} size={size} sizeAttenuation depthTest={false} depthWrite={false} toneMapped={false} />
    </points>
  )
}

function SketchesSceneRenderer({ sketches, selectedSketchId, activeDraftSketch, debug }) {
  const showPoints = typeof window !== 'undefined' && Boolean(window.__DEBUG_SKETCH_POINTS__)
  const sketchGroups = useMemo(() => {
    const visibleCommitted = (sketches || []).filter((sketch) => {
      if (!sketch || sketch.visible === false) return false
      if (activeDraftSketch?.id && sketch.id === activeDraftSketch.id) return false
      return true
    })
    const sourceSketches = activeDraftSketch ? [...visibleCommitted, activeDraftSketch] : visibleCommitted

    return sourceSketches.map((sketch, sketchIndex) => {
      const planeBasis = resolveSketchPlane(sketch?.plane)
      const entities = Array.isArray(sketch?.entities) ? sketch.entities : []
      const polylines = []
      const endpoints = []

      entities.forEach((entity) => {
        if (!entity) return
        if (entity.type === 'line') {
          const p1 = entity.p1 || {}
          const p2 = entity.p2 || {}
          const a = sketchWorldPoint(planeBasis, p1.x, p1.y)
          const b = sketchWorldPoint(planeBasis, p2.x, p2.y)
          if (Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z) && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z)) {
            polylines.push([a, b])
            endpoints.push(a, b)
          }
          return
        }

        if (entity.type === 'circle') {
          const center = entity.center || {}
          const radius = Number(entity.radius)
          if (!Number.isFinite(radius) || radius <= 0) return
          const segs = 64
          const pts = []
          for (let i = 0; i <= segs; i += 1) {
            const t = (i / segs) * Math.PI * 2
            const u = (Number(center.x) || 0) + Math.cos(t) * radius
            const v = (Number(center.y) || 0) + Math.sin(t) * radius
            const p = sketchWorldPoint(planeBasis, u, v)
            if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
              pts.push(p)
            }
          }
          if (pts.length > 1) {
            polylines.push(pts)
            endpoints.push(sketchWorldPoint(planeBasis, center.x, center.y))
          }
          return
        }

        if (entity.type === 'arc') {
          const center = entity.center || {}
          const radius = Number(entity.radius)
          const start = Number(entity.startAngle)
          const end = Number(entity.endAngle)
          if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(start) || !Number.isFinite(end)) return
          const segs = 48
          const pts = []
          for (let i = 0; i <= segs; i += 1) {
            const t = start + ((end - start) * i) / segs
            const u = (Number(center.x) || 0) + Math.cos(t) * radius
            const v = (Number(center.y) || 0) + Math.sin(t) * radius
            const p = sketchWorldPoint(planeBasis, u, v)
            if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
              pts.push(p)
            }
          }
          if (pts.length > 1) {
            polylines.push(pts)
            endpoints.push(pts[0], pts[pts.length - 1], sketchWorldPoint(planeBasis, center.x, center.y))
          }
        }
      })

      if (debug) {
        const box = new THREE.Box3()
        endpoints.forEach((pt) => box.expandByPoint(pt))
        if (polylines.length === 0) {
          console.warn('[SketchRenderer] Sketch has invalid points or plane', { sketchId: sketch?.id || null })
        }
        if (endpoints.length > 0 && (box.isEmpty() || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x))) {
          console.warn('[SketchRenderer] Sketch has invalid points or plane', { sketchId: sketch.id })
        }
      }

      const color = sketch.id === selectedSketchId
        ? '#f59e0b'
        : activeDraftSketch?.id === sketch.id
          ? '#34d399'
          : '#38bdf8'

      return {
        id: sketch.id || `sketch-fallback-${sketchIndex}`,
        color,
        polylines,
        points: endpoints,
        sketchId: sketch.id || null,
        wireKey: sketch.regionId || sketch.wireKey || null,
      }
    }).filter((group) => group.polylines.length > 0)
  }, [sketches, selectedSketchId, activeDraftSketch, debug])

  return (
    <group renderOrder={998}>
      {sketchGroups.map((group) => (
        <group key={group.id}>
          {group.polylines.map((polyline, index) => (
            <Polyline3D
              key={`${group.id}-line-${index}`}
              points={polyline}
              color={group.color}
              sketchId={group.sketchId}
              wireKey={group.wireKey}
            />
          ))}
          {showPoints && group.points.length > 0 && (
            <PointCloud3D points={group.points} color={group.color} />
          )}
        </group>
      ))}
    </group>
  )
}

function ShapeMesh({ shape, meshRef }) {
  const {
    hoveredItem,
    isSolidSelected,
    isBodySelected,
  } = useSelection()
  const { registerObject, getBody } = useWorkspace()
  const body = getBody(shape.id)
  const bodyTransform = body?.transform

  // Compute emissive color based on selection/hover state
  const emissiveColor = useMemo(() => {
    // Check if entire solid is selected
    if (isSolidSelected(shape.id) || isBodySelected(shape.id)) {
      return SELECTED_COLOR
    }
    
    // Check hover state
    if (hoveredItem?.shapeId === shape.id) {
      return HOVER_COLOR
    }
    
    return BASE_EMISSIVE
  }, [shape.id, hoveredItem, isSolidSelected, isBodySelected])

  return (
    <mesh
      ref={(mesh) => {
        meshRef(mesh)
        if (mesh) {
          registerObject(`obj-${shape.id}`, mesh)
        }
      }}
      geometry={shape.geometry}
      position={bodyTransform?.position || [shape.position.x, shape.position.y, shape.position.z]}
      rotation={bodyTransform?.rotation || [0, 0, 0]}
      scale={bodyTransform?.scale || [1, 1, 1]}
      castShadow
      receiveShadow
      userData={{ shapeId: shape.id, bodyId: shape.id, bodyKind: 'brep', topologyMap: shape.topologyMap, selectable: true }}
    >
      <meshStandardMaterial
        color={shape.color}
        metalness={0.1}
        roughness={0.5}
        emissive={emissiveColor}
        emissiveIntensity={emissiveColor === BASE_EMISSIVE ? 0 : 0.3}
      />
    </mesh>
  )
}

function SceneLighting() {
  const ambientRef = useRef()
  const directionalRef = useRef()
  
  useEffect(() => {
    console.log(`${LOG_PREFIX} ✓ Ambient light added to scene`, ambientRef.current)
    console.log(`${LOG_PREFIX} ✓ Directional light added to scene`, directionalRef.current)
  }, [])

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.4} />
      <directionalLight 
        ref={directionalRef}
        position={[10, 10, 5]} 
        intensity={1} 
        castShadow 
        shadow-mapSize={[1024, 1024]}
      />
    </>
  )
}

function Scene({ onMeshesReady, customShapes }) {
  const invalidate = useThree((s) => s.invalidate)
  const contextShapes = useShapes()
  // Use customShapes if provided, otherwise fall back to context shapes
  const shapes = customShapes || contextShapes.shapes
  const meshRefs = useRef({})
  
  useEffect(() => {
    console.log(`${LOG_PREFIX} Scene component mounted`)
    bootMark('three', true);
    return () => bootMark('three', false);
  }, [])
  
  // Log when shapes change
  useEffect(() => {
    console.log(`${LOG_PREFIX} Shapes updated - count:`, shapes.length)
    if (shapes.length > 0) {
      shapes.forEach((s, i) => {
        console.log(`${LOG_PREFIX}   Shape ${i}: ${s.type} at (${s.position?.x || 0}, ${s.position?.y || 0}, ${s.position?.z || 0})`)
        console.log(`${LOG_PREFIX}   Geometry vertices: ${s.geometry?.attributes?.position?.count || 0}`)
      })
    }
  }, [shapes])

  // Notify parent when meshes are available
  useEffect(() => {
    const meshes = Object.values(meshRefs.current).filter(Boolean)
    onMeshesReady?.(meshes, shapes)
    invalidate()
  }, [shapes, onMeshesReady, invalidate])

  // Create ref callback for each shape
  const getMeshRef = useCallback((shapeId) => (mesh) => {
    if (mesh) {
      meshRefs.current[shapeId] = mesh
    } else {
      delete meshRefs.current[shapeId]
    }
  }, [])

  return (
    <>
      {/* Lighting */}
      <SceneLighting />
      
      {/* Grid on XZ plane */}
      <Grid 
        args={[20, 20]} 
        cellSize={1}
        cellThickness={0.5}
        cellColor="#6e6e6e"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#9d4b4b"
        fadeDistance={30}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={true}
      />
      
      {/* Render OCCT shapes */}
      {shapes.map((shape) => (
        <ShapeMesh
          key={shape.id}
          shape={shape}
          meshRef={getMeshRef(shape.id)}
        />
      ))}
    </>
  )
}

// Camera controller with enhanced features
function CameraController({ onControlsReady, pivotPoint, isSketchMode }) {
  const { camera } = useThree()
  const prevSketchModeRef = useRef(isSketchMode)
  
  // Handle sketch mode transitions
  useEffect(() => {
    if (isSketchMode && !prevSketchModeRef.current) {
      // Entering sketch mode - go to top view
      camera.position.set(0, 10, 0)
      camera.lookAt(0, 0, 0)
      camera.up.set(0, 0, -1)
      console.log(`${LOG_PREFIX} Camera locked to top-down view for sketch mode`)
    } else if (!isSketchMode && prevSketchModeRef.current) {
      // Exiting sketch mode - go to isometric view
      camera.position.set(5, 5, 5)
      camera.lookAt(0, 0, 0)
      camera.up.set(0, 1, 0)
      console.log(`${LOG_PREFIX} Camera reset to 3D view`)
    }
    prevSketchModeRef.current = isSketchMode
  }, [isSketchMode, camera])

  return (
    <EnhancedCameraController
      enabled={!isSketchMode}
      onControlsReady={onControlsReady}
      pivotPoint={pivotPoint}
    />
  )
}

// Selection interaction handler component
function SelectionHandler({ disabled = false }) {
  const { camera, gl, scene } = useThree()
  const invalidate = useThree((s) => s.invalidate)
  const {
    selectionMode,
    selectFace,
    selectEdge,
    selectVertex,
    selectSolid,
    selectBody,
    clearSelection,
    setHover,
  } = useSelection()
  const { isSketchMode, selectSketch } = useSketch()

  const resolveBodyHit = useCallback((hit) => {
    let node = hit?.object
    while (node) {
      if (node.userData?.bodyId) {
        return { bodyId: node.userData.bodyId, bodyKind: node.userData.bodyKind || 'mesh', node }
      }
      node = node.parent
    }
    return null
  }, [])

  const raycastAllSelectable = useCallback((event) => {
    const rect = gl.domElement.getBoundingClientRect()
    const mouse = screenToNDC(event.clientX, event.clientY, rect)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const intersections = raycaster.intersectObjects(scene.children, true)
    return intersections.find((hit) => hit.object?.userData?.selectable) || null
  }, [camera, gl, scene])

  // Handle mouse move for hover
  const handleMouseMove = useCallback((event) => {
    if (isSketchMode || disabled) {
      setHover(null, null, null)
      invalidate()
      return
    }
    const hit = raycastAllSelectable(event)

    if (hit) {
      const bodyHit = resolveBodyHit(hit)
      if (bodyHit && bodyHit.bodyKind === 'mesh') {
        setHover(null, 'solid', null, bodyHit.bodyId, 'mesh')
        invalidate()
        return
      }

      const shapeId = hit.object.userData?.shapeId
      const topologyMap = hit.object.userData?.topologyMap
      
      if (shapeId && topologyMap) {
        const selection = getSelectionFromHit(hit, shapeId, topologyMap, selectionMode)
        if (selection) {
          setHover(shapeId, selection.type, selection.id, shapeId, 'brep')
          invalidate()
          return
        }
      }
    }
    
    setHover(null, null, null)
    invalidate()
  }, [raycastAllSelectable, resolveBodyHit, selectionMode, setHover, isSketchMode, disabled, invalidate])

  // Handle click for selection
  const handleClick = useCallback((event) => {
    if (isSketchMode || disabled) return

    const hit = raycastAllSelectable(event)
    const multiSelect = event.shiftKey

    if (hit) {
      if (hit.object?.userData?.sketchId) {
        selectSketch(hit.object.userData.sketchId)
        invalidate()
        return
      }

      const bodyHit = resolveBodyHit(hit)
      if (bodyHit && bodyHit.bodyKind === 'mesh') {
        selectBody(bodyHit.bodyId, multiSelect)
        invalidate()
        return
      }

      const shapeId = hit.object.userData?.shapeId
      const topologyMap = hit.object.userData?.topologyMap
      
      if (shapeId) {
        const selection = getSelectionFromHit(hit, shapeId, topologyMap, selectionMode)
        
        if (selection) {
          selectBody(shapeId, multiSelect)
          switch (selection.type) {
            case 'face':
              selectFace(shapeId, selection.id, multiSelect)
              break
            case 'edge':
              selectEdge(shapeId, selection.id, multiSelect)
              break
            case 'vertex':
              selectVertex(shapeId, selection.id, multiSelect)
              break
            case 'solid':
              selectSolid(shapeId, multiSelect)
              break
            case 'body':
              selectBody(shapeId, multiSelect)
              break
          }
          invalidate()
          return
        }
      }
    }
    
    // Clicked on nothing - clear selection if not multi-select
    if (!multiSelect) {
      clearSelection()
      invalidate()
    }
  }, [raycastAllSelectable, resolveBodyHit, selectionMode, selectFace, selectEdge, selectVertex, selectSolid, selectBody, clearSelection, isSketchMode, disabled, selectSketch, invalidate])

  // Handle keyboard for Esc deselect
  const handleKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      clearSelection()
    }
  }, [clearSelection])

  // Add event listeners
  useEffect(() => {
    const canvas = gl.domElement
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [gl, handleMouseMove, handleClick, handleKeyDown])

  return null
}

function FrameCounter({ enabled, onFps }) {
  const frameRef = useRef(0)

  useEffect(() => {
    if (!enabled) return undefined
    const interval = setInterval(() => {
      onFps?.(frameRef.current)
      frameRef.current = 0
    }, 1000)
    return () => clearInterval(interval)
  }, [enabled, onFps])

  useFrame(() => {
    if (!enabled) return
    frameRef.current += 1
  })

  return null
}

function TransformInteractionManager({ transformRef, orbitRef, onDraggingChange }) {
  const activeControls = useThree((s) => s.controls)
  const invalidate = useThree((s) => s.invalidate)
  const lockRef = useRef({
    orbit: null,
    active: null,
    dragging: false,
  })

  const captureState = (controls) => ({
    enabled: controls.enabled,
    enableRotate: controls.enableRotate,
    enablePan: controls.enablePan,
    enableZoom: controls.enableZoom,
  })

  const applyDisabledState = (controls) => {
    if (!controls) return
    controls.enabled = false
    if ('enableRotate' in controls) controls.enableRotate = false
    if ('enablePan' in controls) controls.enablePan = false
    if ('enableZoom' in controls) controls.enableZoom = false
  }

  const restoreState = (controls, snapshot) => {
    if (!controls || !snapshot) return
    controls.enabled = snapshot.enabled
    if ('enableRotate' in controls) controls.enableRotate = snapshot.enableRotate
    if ('enablePan' in controls) controls.enablePan = snapshot.enablePan
    if ('enableZoom' in controls) controls.enableZoom = snapshot.enableZoom
  }

  const disableControls = useCallback(() => {
    const orbit = orbitRef.current
    const active = activeControls

    if (orbit && !lockRef.current.orbit) {
      lockRef.current.orbit = captureState(orbit)
    }
    if (active && !lockRef.current.active) {
      lockRef.current.active = captureState(active)
    }

    applyDisabledState(orbit)
    applyDisabledState(active)
    lockRef.current.dragging = true
    onDraggingChange?.(true, orbit, active)
    invalidate()
  }, [activeControls, invalidate, onDraggingChange, orbitRef])

  const restoreControls = useCallback(() => {
    const orbit = orbitRef.current
    const active = activeControls

    restoreState(orbit, lockRef.current.orbit)
    restoreState(active, lockRef.current.active)
    lockRef.current.orbit = null
    lockRef.current.active = null
    lockRef.current.dragging = false
    onDraggingChange?.(false, orbit, active)
    invalidate()
  }, [activeControls, invalidate, onDraggingChange, orbitRef])

  useEffect(() => {
    const transform = transformRef.current
    if (!transform) return undefined

    const onDraggingChanged = (event) => {
      const dragging = Boolean(event.value)
      if (dragging) {
        disableControls()
      } else {
        restoreControls()
      }
    }

    const onMouseDown = () => disableControls()
    const onMouseUp = () => restoreControls()
    const onChange = () => {
      if (lockRef.current.dragging) {
        invalidate()
      }
    }

    transform.addEventListener('dragging-changed', onDraggingChanged)
    transform.addEventListener('mouseDown', onMouseDown)
    transform.addEventListener('mouseUp', onMouseUp)
    transform.addEventListener('change', onChange)

    return () => {
      transform.removeEventListener('dragging-changed', onDraggingChanged)
      transform.removeEventListener('mouseDown', onMouseDown)
      transform.removeEventListener('mouseUp', onMouseUp)
      transform.removeEventListener('change', onChange)
      restoreControls()
    }
  }, [disableControls, invalidate, restoreControls, transformRef])

  useEffect(() => {
    onDraggingChange?.(lockRef.current.dragging, orbitRef.current, activeControls)
  }, [activeControls, onDraggingChange, orbitRef])

  return null
}

export default function Viewport({ customShapes }) {
  const { isSketchMode, sketches, selectedSketchId, activeSketchId, entities } = useSketch()
  const { selectedSolids, selectedBodies, selectedEdges } = useSelection()
  const {
    activeBodyId,
    getBody,
    getObject,
    applyTransformToBodyObject,
    updateBodyTransform,
    transformMode,
    setTransformMode,
    transformSnapping,
    syncBrepBodiesFromShapes,
  } = useWorkspace()
  const {
    selectedFeatureId,
    getFeature,
    addFeature,
    toggleSuppression,
    upsertTransformFeatureForBody,
  } = useFeatureTree()
  const [meshes, setMeshes] = useState([])
  // eslint-disable-next-line no-unused-vars
  const [shapes, setShapes] = useState([])
  const orbitRef = useRef(null)
  const transformRef = useRef(null)
  const [isTransformDragging, setIsTransformDragging] = useState(false)
  const [controlsDebug, setControlsDebug] = useState({
    orbitEnabled: null,
    activeEnabled: null,
  })
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0 })
  const debugControls = typeof window !== 'undefined' && Boolean(window.__DEBUG_TRANSFORM_CONTROLS__)
  const debugSketch = typeof window !== 'undefined' && Boolean(window.__DEBUG_SKETCH__)
  const debugRender = typeof window !== 'undefined' && Boolean(window.__DEBUG_RENDER__)
  const viewportRenderCountRef = useRef(0)
  const viewportSampleRef = useRef({ ts: Date.now(), count: 0 })
  const [viewportRenderPerSec, setViewportRenderPerSec] = useState(0)
  const [viewportFps, setViewportFps] = useState(0)
  viewportRenderCountRef.current += 1

  // Use refs to store stable bounds and pivot to avoid recreating on every render
  const selectedBoundsRef = useRef(null)
  const pivotPointRef = useRef(null)

  // Calculate selection bounds for fit-to-selection
  // Only create new objects when actual values change
  const selectedBounds = useMemo(() => {
    if (meshes.length === 0) {
      selectedBoundsRef.current = null
      return null
    }

    // Check if any solids are selected
    if (selectedSolids.size > 0) {
      const bounds = new THREE.Box3()
      meshes.forEach(mesh => {
        if (selectedSolids.has(mesh.userData?.shapeId)) {
          if (mesh.geometry) {
            mesh.geometry.computeBoundingBox()
            const meshBounds = mesh.geometry.boundingBox.clone()
            meshBounds.applyMatrix4(mesh.matrixWorld)
            bounds.union(meshBounds)
          }
        }
      })
      if (!bounds.isEmpty()) {
        // Check if bounds actually changed
        if (selectedBoundsRef.current &&
            selectedBoundsRef.current.min.equals(bounds.min) &&
            selectedBoundsRef.current.max.equals(bounds.max)) {
          return selectedBoundsRef.current // Return same reference
        }
        selectedBoundsRef.current = bounds
        return bounds
      }
    }

    selectedBoundsRef.current = null
    return null
  }, [meshes, selectedSolids])

  // Calculate pivot point from selection
  // Only create new Vector3 when bounds actually change
  const pivotPoint = useMemo(() => {
    if (selectedBounds && !selectedBounds.isEmpty()) {
      const center = new THREE.Vector3()
      selectedBounds.getCenter(center)

      // Check if pivot actually changed
      if (pivotPointRef.current && pivotPointRef.current.equals(center)) {
        return pivotPointRef.current // Return same reference
      }

      pivotPointRef.current = center
      return center
    }

    pivotPointRef.current = null
    return null
  }, [selectedBounds])
  
  useEffect(() => {
    console.log(`${LOG_PREFIX} ========== VIEWPORT MOUNTED ==========`)
    return () => {
      console.log(`${LOG_PREFIX} ========== VIEWPORT UNMOUNTED ==========`)
    }
  }, [])

  const handleMeshesReady = useCallback((newMeshes, newShapes) => {
    setMeshes(newMeshes)
    setShapes(newShapes)
  }, [])
  
  const handleControlsReady = useCallback((controls) => {
    orbitRef.current = controls
  }, [])

  useEffect(() => {
    syncBrepBodiesFromShapes(customShapes || [])
  }, [customShapes, syncBrepBodiesFromShapes])

  const transformBody = useMemo(() => {
    const bodyId = selectedBodies[0] || activeBodyId
    if (!bodyId) return null
    return getBody(bodyId)
  }, [selectedBodies, activeBodyId, getBody])

  const transformTarget = useMemo(() => {
    if (!transformBody) return null
    const objectRefId = transformBody.mesh?.objectRefId || `obj-${transformBody.id}`
    return getObject(objectRefId) || null
  }, [transformBody, getObject])

  const commitTransform = useCallback(() => {
    if (!transformBody || !transformTarget) return
    const nextTransform = {
      position: [transformTarget.position.x, transformTarget.position.y, transformTarget.position.z],
      rotation: [transformTarget.rotation.x, transformTarget.rotation.y, transformTarget.rotation.z],
      scale: [transformTarget.scale.x, transformTarget.scale.y, transformTarget.scale.z],
    }

    if (transformBody.kind === 'brep') {
      const selectedFeature = selectedFeatureId ? getFeature(selectedFeatureId) : null
      const preferredFeatureId = (
        selectedFeature?.type === 'transform' && selectedFeature.params?.bodyId === transformBody.id
      )
        ? selectedFeature.id
        : null

      upsertTransformFeatureForBody(
        transformBody.id,
        transformBody.name,
        nextTransform,
        preferredFeatureId
      )

      const identity = {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      }
      applyTransformToBodyObject(transformBody.id, identity)
      updateBodyTransform(transformBody.id, identity)
      return
    }

    updateBodyTransform(transformBody.id, nextTransform)
  }, [
    transformBody,
    transformTarget,
    selectedFeatureId,
    getFeature,
    upsertTransformFeatureForBody,
    applyTransformToBodyObject,
    updateBodyTransform,
  ])

  const stopCapture = useCallback((e) => {
    e.stopPropagation()
    e.nativeEvent?.stopImmediatePropagation?.()
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev))
  }, [])

  useEffect(() => {
    if (!contextMenu.open) return undefined
    const onWindowClick = () => closeContextMenu()
    window.addEventListener('pointerdown', onWindowClick)
    return () => window.removeEventListener('pointerdown', onWindowClick)
  }, [contextMenu.open, closeContextMenu])

  const collectSelectedEdgeRefs = useCallback(() => {
    const topologyLookup = new Map()
    shapes.forEach((shape) => {
      if (shape?.id && shape?.topologyMap) {
        topologyLookup.set(shape.id, shape.topologyMap)
      }
    })

    const refs = []
    selectedEdges.forEach((edgeSet, shapeId) => {
      edgeSet.forEach((edgeId) => {
        const topologyMap = topologyLookup.get(shapeId)
        const edgeData = topologyMap?.edges?.get?.(edgeId)
        const ref = createEdgeSelectionRef({
          featureId: selectedFeatureId || null,
          edgeId,
          edgeData,
        })
        if (ref) refs.push(ref)
      })
    })
    return refs
  }, [selectedEdges, shapes, selectedFeatureId])

  const addContextFeature = useCallback((type) => {
    const refs = type === 'fillet' || type === 'chamfer' ? collectSelectedEdgeRefs() : []
    if ((type === 'fillet' || type === 'chamfer') && refs.length === 0) {
      alert('Select one or more edges before creating this feature.')
      closeContextMenu()
      return
    }
    const name = `${type.charAt(0).toUpperCase()}${type.slice(1)} ${Date.now().toString().slice(-4)}`
    addFeature(type, name, type === 'fillet' || type === 'chamfer' ? { allEdges: false } : {}, refs)
    closeContextMenu()
  }, [addFeature, closeContextMenu, collectSelectedEdgeRefs])

  const suppressSelectedFeature = useCallback(() => {
    if (!selectedFeatureId) {
      alert('Select a feature in the feature tree to suppress.')
      closeContextMenu()
      return
    }
    toggleSuppression(selectedFeatureId)
    closeContextMenu()
  }, [selectedFeatureId, toggleSuppression, closeContextMenu])

  const activateTransformMode = useCallback(() => {
    setTransformMode('translate')
    if (transformBody?.kind === 'brep' && transformTarget) {
      upsertTransformFeatureForBody(transformBody.id, transformBody.name, {
        position: [transformTarget.position.x, transformTarget.position.y, transformTarget.position.z],
        rotation: [transformTarget.rotation.x, transformTarget.rotation.y, transformTarget.rotation.z],
        scale: [transformTarget.scale.x, transformTarget.scale.y, transformTarget.scale.z],
      }, selectedFeatureId || null)
    }
    closeContextMenu()
  }, [
    setTransformMode,
    transformBody,
    transformTarget,
    upsertTransformFeatureForBody,
    selectedFeatureId,
    closeContextMenu,
  ])

  const activeDraftSketch = useMemo(() => {
    if (!isSketchMode) return null
    if (!Array.isArray(entities) || entities.length === 0) return null
    const activeMeta = sketches.find((item) => item.id === activeSketchId)
    return {
      id: activeSketchId || '__active-draft__',
      name: activeMeta?.name || 'Active Sketch',
      plane: activeMeta?.plane || DEFAULT_SKETCH_PLANE,
      entities,
      visible: true,
      status: 'editing',
    }
  }, [isSketchMode, entities, sketches, activeSketchId])

  useEffect(() => {
    if (!debugRender) return undefined
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = Math.max((now - viewportSampleRef.current.ts) / 1000, 0.001)
      const total = viewportRenderCountRef.current
      const delta = total - viewportSampleRef.current.count
      setViewportRenderPerSec(Number((delta / elapsed).toFixed(1)))
      viewportSampleRef.current = { ts: now, count: total }
    }, 1000)
    return () => clearInterval(interval)
  }, [debugRender])

  return (
    <div
      className={`absolute inset-0 ${isSketchMode ? 'opacity-40' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault()
        if (isSketchMode) return
        setContextMenu({
          open: true,
          x: event.clientX,
          y: event.clientY,
        })
      }}
    >
      <Canvas
        frameloop="demand"
        style={{ touchAction: 'none' }}
        camera={{ position: [5, 5, 5], fov: 50 }}
        shadows
        onCreated={() => {
          console.log(`${LOG_PREFIX} ✓ Canvas created successfully`)
        }}
      >
        <Scene onMeshesReady={handleMeshesReady} customShapes={customShapes} />
        <ImportedObjects />
        <SketchesSceneRenderer
          sketches={sketches}
          selectedSketchId={selectedSketchId}
          activeDraftSketch={activeDraftSketch}
          debug={debugSketch}
        />
        <CameraController
          onControlsReady={handleControlsReady}
          pivotPoint={pivotPoint}
          isSketchMode={isSketchMode}
        />
        <SelectionHandler disabled={isTransformDragging} />
        {debugRender && <FrameCounter enabled={debugRender} onFps={setViewportFps} />}
        {!isSketchMode && transformTarget && (
          <>
            <TransformControls
              ref={transformRef}
              object={transformTarget}
              mode={transformMode}
              translationSnap={transformSnapping.translate > 0 ? transformSnapping.translate : null}
              rotationSnap={transformSnapping.rotateDeg > 0 ? THREE.MathUtils.degToRad(transformSnapping.rotateDeg) : null}
              onMouseUp={commitTransform}
              onPointerDownCapture={stopCapture}
              onPointerMoveCapture={stopCapture}
              onPointerUpCapture={stopCapture}
              onWheelCapture={stopCapture}
            />
            <TransformInteractionManager
              transformRef={transformRef}
              orbitRef={orbitRef}
              onDraggingChange={(dragging, orbit, active) => {
                setIsTransformDragging(dragging)
                setControlsDebug({
                  orbitEnabled: orbit?.enabled ?? null,
                  activeEnabled: active?.enabled ?? null,
                })
              }}
            />
          </>
        )}
      </Canvas>
      
      {/* Camera Controls UI (navigation cube, presets toolbar) */}
      <CameraControlsUI
        controlsRef={orbitRef}
        meshes={meshes}
        selectedBounds={selectedBounds}
        disabled={isSketchMode}
      />
      {debugControls && (
        <div className="absolute left-4 bottom-4 z-50 bg-black/70 text-xs text-white px-2 py-1 rounded">
          drag={String(isTransformDragging)} orbit={String(controlsDebug.orbitEnabled)} active={String(controlsDebug.activeEnabled)}
        </div>
      )}
      {debugRender && (
        <div className="absolute left-4 top-4 z-50 rounded border border-cyan-500/40 bg-black/70 px-2 py-1 text-[11px] text-cyan-200">
          viewport renders/sec={viewportRenderPerSec} frames/sec={viewportFps}
        </div>
      )}
      {contextMenu.open && (
        <div
          className="fixed z-[100] min-w-36 rounded border border-gray-700 bg-gray-900 p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-800"
            onClick={() => addContextFeature('fillet')}
          >
            Fillet
          </button>
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-800"
            onClick={() => addContextFeature('chamfer')}
          >
            Chamfer
          </button>
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-800"
            onClick={activateTransformMode}
          >
            Transform
          </button>
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-gray-200 hover:bg-gray-800"
            onClick={suppressSelectedFeature}
          >
            Suppress
          </button>
        </div>
      )}
    </div>
  )
}
