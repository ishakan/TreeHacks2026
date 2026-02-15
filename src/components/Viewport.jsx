import { Canvas, useThree } from '@react-three/fiber'
import { Grid } from '@react-three/drei'
import { useShapes } from '../context/ShapeContext'
import { useSketch } from '../context/SketchContext'
import { useSelection, SelectionMode } from '../context/SelectionContext'
import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import * as THREE from 'three'
import {
  raycastMeshes,
  getSelectionFromHit,
  screenToNDC,
} from '../services/selectionService'
import CameraControlsUI, { EnhancedCameraController } from './CameraControls'
import ImportedObjects from './ImportedObjects'

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

function ShapeMesh({ shape, meshRef }) {
  const {
    selectionMode,
    hoveredItem,
    isFaceSelected,
    isSolidSelected,
  } = useSelection()

  // Compute emissive color based on selection/hover state
  const emissiveColor = useMemo(() => {
    // Check if entire solid is selected
    if (isSolidSelected(shape.id)) {
      return SELECTED_COLOR
    }
    
    // Check hover state
    if (hoveredItem?.shapeId === shape.id) {
      return HOVER_COLOR
    }
    
    return BASE_EMISSIVE
  }, [shape.id, hoveredItem, isSolidSelected])

  return (
    <mesh
      ref={meshRef}
      geometry={shape.geometry}
      position={[shape.position.x, shape.position.y, shape.position.z]}
      castShadow
      receiveShadow
      userData={{ shapeId: shape.id, topologyMap: shape.topologyMap }}
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
  }, [shapes, onMeshesReady])

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
function SelectionHandler({ meshes }) {
  const { camera, gl } = useThree()
  const {
    selectionMode,
    selectFace,
    selectEdge,
    selectVertex,
    selectSolid,
    clearSelection,
    setHover,
  } = useSelection()
  const { isSketchMode } = useSketch()

  // Handle mouse move for hover
  const handleMouseMove = useCallback((event) => {
    if (isSketchMode || meshes.length === 0) {
      setHover(null, null, null)
      return
    }

    const rect = gl.domElement.getBoundingClientRect()
    const mouse = screenToNDC(event.clientX, event.clientY, rect)
    const hit = raycastMeshes(mouse, camera, meshes)

    if (hit) {
      const shapeId = hit.mesh.userData?.shapeId
      const topologyMap = hit.mesh.userData?.topologyMap
      
      if (shapeId && topologyMap) {
        const selection = getSelectionFromHit(hit, shapeId, topologyMap, selectionMode)
        if (selection) {
          setHover(shapeId, selection.type, selection.id)
          return
        }
      }
    }
    
    setHover(null, null, null)
  }, [camera, gl, meshes, selectionMode, setHover, isSketchMode])

  // Handle click for selection
  const handleClick = useCallback((event) => {
    if (isSketchMode || meshes.length === 0) return

    const rect = gl.domElement.getBoundingClientRect()
    const mouse = screenToNDC(event.clientX, event.clientY, rect)
    const hit = raycastMeshes(mouse, camera, meshes)
    const multiSelect = event.shiftKey

    if (hit) {
      const shapeId = hit.mesh.userData?.shapeId
      const topologyMap = hit.mesh.userData?.topologyMap
      
      if (shapeId) {
        const selection = getSelectionFromHit(hit, shapeId, topologyMap, selectionMode)
        
        if (selection) {
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
          }
          return
        }
      }
    }
    
    // Clicked on nothing - clear selection if not multi-select
    if (!multiSelect) {
      clearSelection()
    }
  }, [camera, gl, meshes, selectionMode, selectFace, selectEdge, selectVertex, selectSolid, clearSelection, isSketchMode])

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

export default function Viewport({ customShapes }) {
  const { isSketchMode } = useSketch()
  const { selectedSolids } = useSelection()
  const [meshes, setMeshes] = useState([])
  // eslint-disable-next-line no-unused-vars
  const [shapes, setShapes] = useState([])
  const controlsRef = useRef(null)

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
    controlsRef.current = controls
  }, [])

  return (
    <div className={`absolute inset-0 ${isSketchMode ? 'opacity-30 pointer-events-none' : ''}`}>
      <Canvas
        camera={{ position: [5, 5, 5], fov: 50 }}
        shadows
        onCreated={() => {
          console.log(`${LOG_PREFIX} ✓ Canvas created successfully`)
        }}
      >
        <Scene onMeshesReady={handleMeshesReady} customShapes={customShapes} />
        <ImportedObjects />
        <CameraController
          onControlsReady={handleControlsReady}
          pivotPoint={pivotPoint}
          isSketchMode={isSketchMode}
        />
        <SelectionHandler meshes={meshes} />
      </Canvas>
      
      {/* Camera Controls UI (navigation cube, presets toolbar) */}
      <CameraControlsUI
        controlsRef={controlsRef}
        meshes={meshes}
        selectedBounds={selectedBounds}
        disabled={isSketchMode}
      />
    </div>
  )
}
