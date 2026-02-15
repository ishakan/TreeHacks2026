/**
 * CameraControls - Camera presets, navigation cube, and enhanced controls
 * Features:
 * - Camera presets (Top, Front, Right, Back, Left, Bottom, ISO)
 * - Navigation cube widget for quick view changes
 * - Fit-to-selection functionality
 * - Smooth animated transitions between views
 * - Zoom to cursor
 * - Rotate around selection pivot
 */

import { useRef, useEffect, useCallback, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// Debug flag
const DEBUG_ZOOM = typeof window !== 'undefined' &&
  (window.__DEBUG_ZOOM === true || import.meta.env.VITE_DEBUG_ZOOM === 'true')

// Camera preset positions (normalized direction vectors * distance)
export const CameraPresets = {
  TOP: { name: 'Top', position: [0, 1, 0], up: [0, 0, -1] },
  BOTTOM: { name: 'Bottom', position: [0, -1, 0], up: [0, 0, 1] },
  FRONT: { name: 'Front', position: [0, 0, 1], up: [0, 1, 0] },
  BACK: { name: 'Back', position: [0, 0, -1], up: [0, 1, 0] },
  RIGHT: { name: 'Right', position: [1, 0, 0], up: [0, 1, 0] },
  LEFT: { name: 'Left', position: [-1, 0, 0], up: [0, 1, 0] },
  ISO: { name: 'Isometric', position: [1, 1, 1], up: [0, 1, 0] },
  ISO_BACK: { name: 'ISO Back', position: [-1, 1, -1], up: [0, 1, 0] },
}

// Animation duration in seconds
const TRANSITION_DURATION = 0.4

/**
 * Enhanced Camera Controller with smooth transitions
 */
export function EnhancedCameraController({
  enabled = true,
  target = [0, 0, 0],
  onControlsReady,
  pivotPoint = null, // Optional pivot point for rotation (e.g., selection center)
}) {
  const { camera, gl, invalidate } = useThree()
  const controlsRef = useRef()
  const animationRef = useRef(null)
  // Use ref instead of state to avoid re-renders during animation
  const isAnimatingRef = useRef(false)

  // Current target (can be animated)
  const currentTarget = useRef(new THREE.Vector3(...target))

  // Track previous pivot point to avoid unnecessary updates
  const prevPivotPointRef = useRef(null)

  // Expose controls to parent
  useEffect(() => {
    if (controlsRef.current && onControlsReady) {
      onControlsReady(controlsRef.current)
    }
  }, [onControlsReady])

  // Update pivot point when selection changes
  // Only update if pivotPoint reference actually changed and we're not animating
  useEffect(() => {
    if (pivotPoint && controlsRef.current && !isAnimatingRef.current) {
      // Check if pivot actually changed (value comparison, not just reference)
      const changed = !prevPivotPointRef.current ||
        !prevPivotPointRef.current.equals(pivotPoint)

      if (changed) {
        prevPivotPointRef.current = pivotPoint.clone()
        controlsRef.current.target.set(pivotPoint.x, pivotPoint.y, pivotPoint.z)
        controlsRef.current.update()
        invalidate()
      }
    } else if (!pivotPoint && prevPivotPointRef.current) {
      // Pivot was cleared
      prevPivotPointRef.current = null
    }
  }, [pivotPoint])

  // Smooth camera transition
  const animateTo = useCallback((targetPosition, targetLookAt, targetUp, duration = TRANSITION_DURATION) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
    }

    const startPosition = camera.position.clone()
    const startTarget = controlsRef.current?.target.clone() || new THREE.Vector3()
    const startUp = camera.up.clone()

    const endPosition = new THREE.Vector3(...targetPosition)
    const endTarget = new THREE.Vector3(...targetLookAt)
    const endUp = new THREE.Vector3(...targetUp)

    // Calculate distance to maintain (or use current distance)
    const currentDistance = startPosition.distanceTo(startTarget)
    endPosition.normalize().multiplyScalar(currentDistance)
    endPosition.add(endTarget)

    const startTime = performance.now()
    // Use ref instead of setState to avoid re-renders
    isAnimatingRef.current = true

    const animate = () => {
      const elapsed = (performance.now() - startTime) / 1000
      const t = Math.min(elapsed / duration, 1)

      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3)

      // Interpolate position
      camera.position.lerpVectors(startPosition, endPosition, eased)

      // Interpolate up vector
      camera.up.lerpVectors(startUp, endUp, eased).normalize()

      // Interpolate target
      if (controlsRef.current) {
        currentTarget.current.lerpVectors(startTarget, endTarget, eased)
        controlsRef.current.target.copy(currentTarget.current)
        controlsRef.current.update()
      }

      camera.lookAt(currentTarget.current)

      if (t < 1) {
        invalidate()
        animationRef.current = requestAnimationFrame(animate)
      } else {
        // Use ref instead of setState to avoid re-renders
        isAnimatingRef.current = false
        animationRef.current = null
        invalidate()
      }
    }

    animate()
  }, [camera])

  // Go to preset view
  const goToPreset = useCallback((preset) => {
    const { position, up } = preset
    const lookAt = pivotPoint ? [pivotPoint.x, pivotPoint.y, pivotPoint.z] : target
    animateTo(position, lookAt, up)
  }, [animateTo, target, pivotPoint])

  // Fit camera to bounding box
  const fitToBounds = useCallback((boundingBox, padding = 1.5) => {
    if (!boundingBox || boundingBox.isEmpty()) return
    
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    boundingBox.getCenter(center)
    boundingBox.getSize(size)
    
    const maxDim = Math.max(size.x, size.y, size.z)
    const fov = camera.fov * (Math.PI / 180)
    const distance = (maxDim * padding) / (2 * Math.tan(fov / 2))
    
    // Keep current direction, just adjust distance
    const direction = camera.position.clone().sub(controlsRef.current?.target || new THREE.Vector3()).normalize()
    const newPosition = center.clone().add(direction.multiplyScalar(distance))
    
    animateTo(
      [newPosition.x, newPosition.y, newPosition.z],
      [center.x, center.y, center.z],
      [camera.up.x, camera.up.y, camera.up.z]
    )
  }, [camera, animateTo])

  // Expose methods via ref
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.goToPreset = goToPreset
      controlsRef.current.fitToBounds = fitToBounds
      controlsRef.current.animateTo = animateTo
    }
  }, [goToPreset, fitToBounds, animateTo])

  // Custom zoom-to-cursor enhancement (optional, only when Shift is held)
  const handleZoomToCursor = useCallback((event) => {
    if (!controlsRef.current || !enabled || isAnimatingRef.current) return
    if (!controlsRef.current.enabled) return
    if (!event.shiftKey) return // Only activate with Shift key

    // Get mouse position in NDC
    const rect = gl.domElement.getBoundingClientRect()
    const mouseX = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const mouseY = -((event.clientY - rect.top) / rect.height) * 2 + 1

    // Create ray from camera through mouse position
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), camera)

    // Find intersection point with a plane at the target
    const targetPlane = new THREE.Plane()
    targetPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(),
      controlsRef.current.target
    )

    const intersectPoint = new THREE.Vector3()
    raycaster.ray.intersectPlane(targetPlane, intersectPoint)

    if (intersectPoint) {
      event.preventDefault()

      // Calculate zoom factor
      const zoomFactor = event.deltaY > 0 ? 1.1 : 0.9

      // Move target towards cursor position slightly
      const targetOffset = intersectPoint.clone().sub(controlsRef.current.target)
      targetOffset.multiplyScalar((1 - zoomFactor) * 0.3)

      controlsRef.current.target.add(targetOffset)

      // Zoom
      const direction = camera.position.clone().sub(controlsRef.current.target)
      direction.multiplyScalar(zoomFactor)
      camera.position.copy(controlsRef.current.target).add(direction)

      controlsRef.current.update()
      invalidate()
    }
  }, [camera, gl, enabled, invalidate])

  // Optional: Add custom zoom-to-cursor when Shift is held
  useEffect(() => {
    const canvas = gl.domElement

    const wheelHandler = (event) => {
      // Only intercept if Shift is held for zoom-to-cursor
      if (event.shiftKey) {
        handleZoomToCursor(event)
      }
      // Otherwise let OrbitControls handle it normally
    }

    canvas.addEventListener('wheel', wheelHandler, { passive: false })
    return () => canvas.removeEventListener('wheel', wheelHandler)
  }, [gl, handleZoomToCursor])

  // Store target in state to avoid accessing ref during render
  const [targetState] = useState(() => currentTarget.current)
  
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      args={[camera, gl.domElement]}
      enableDamping
      dampingFactor={0.08}
      minDistance={0.02}
      maxDistance={1000}
      enabled={enabled}
      enableZoom={true} // Enable built-in zoom (Shift+wheel for zoom-to-cursor)
      zoomSpeed={1.0}
      rotateSpeed={0.8}
      panSpeed={0.8}
      target={targetState}
      onChange={() => invalidate()}
      onStart={() => invalidate()}
      onEnd={() => invalidate()}
    />
  )
}

/**
 * Navigation Cube Widget
 * Interactive 3D cube for quick view orientation
 */
export function NavigationCube({ onSelectView, currentView, size = 80 }) {
  const [hovered, setHovered] = useState(null)
  
  const faces = [
    { id: 'TOP', label: 'T', position: 'top-1/2 left-1/2 -translate-x-1/2', transform: 'rotateX(90deg) translateZ(25px)' },
    { id: 'BOTTOM', label: 'Bo', position: 'top-1/2 left-1/2 -translate-x-1/2', transform: 'rotateX(-90deg) translateZ(25px)' },
    { id: 'FRONT', label: 'F', position: 'top-1/2 left-1/2 -translate-x-1/2', transform: 'translateZ(25px)' },
    { id: 'BACK', label: 'Bk', position: 'top-1/2 left-1/2 -translate-x-1/2', transform: 'rotateY(180deg) translateZ(25px)' },
    { id: 'RIGHT', label: 'R', position: 'top-1/2 left-1/2 -translate-x-1/2', transform: 'rotateY(90deg) translateZ(25px)' },
    { id: 'LEFT', label: 'L', position: 'top-1/2 left-1/2 -translate-x-1/2', transform: 'rotateY(-90deg) translateZ(25px)' },
  ]

  return (
    <div 
      className="relative select-none"
      style={{ 
        width: size, 
        height: size,
        perspective: '200px',
      }}
    >
      {/* 3D Cube */}
      <div 
        className="absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(-20deg) rotateY(-30deg)',
        }}
      >
        {faces.map(face => (
          <div
            key={face.id}
            className={`absolute flex items-center justify-center cursor-pointer transition-colors text-xs font-bold
              ${hovered === face.id ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300'}
              ${currentView === face.id ? 'ring-2 ring-blue-400' : ''}
              border border-gray-600 hover:bg-blue-600`}
            style={{
              width: 50,
              height: 50,
              transform: face.transform,
              left: '50%',
              top: '50%',
              marginLeft: -25,
              marginTop: -25,
              backfaceVisibility: 'hidden',
            }}
            onClick={() => onSelectView(face.id)}
            onMouseEnter={() => setHovered(face.id)}
            onMouseLeave={() => setHovered(null)}
          >
            {face.label}
          </div>
        ))}
      </div>

      {/* Corner buttons for ISO views */}
      <button
        className={`absolute top-0 right-0 w-5 h-5 rounded text-[8px] font-bold transition-colors
          ${hovered === 'ISO' ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-400'}
          hover:bg-blue-600 border border-gray-600`}
        onClick={() => onSelectView('ISO')}
        onMouseEnter={() => setHovered('ISO')}
        onMouseLeave={() => setHovered(null)}
        title="Isometric View"
      >
        ISO
      </button>
    </div>
  )
}

/**
 * Camera Toolbar - Preset buttons and controls
 */
export function CameraToolbar({ onSelectPreset, onFitToSelection, currentPreset }) {
  const presets = [
    { key: 'TOP', label: '⬆', title: 'Top View (Numpad 7)' },
    { key: 'FRONT', label: '⬛', title: 'Front View (Numpad 1)' },
    { key: 'RIGHT', label: '➡', title: 'Right View (Numpad 3)' },
    { key: 'ISO', label: '◢', title: 'Isometric View (Numpad 0)' },
  ]

  return (
    <div className="flex items-center gap-1 bg-gray-800/90 rounded-lg p-1 backdrop-blur-sm">
      {presets.map(({ key, label, title }) => (
        <button
          key={key}
          className={`w-7 h-7 rounded text-sm transition-colors
            ${currentPreset === key 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
          onClick={() => onSelectPreset(key)}
          title={title}
        >
          {label}
        </button>
      ))}
      <div className="w-px h-5 bg-gray-600 mx-1" />
      <button
        className="w-7 h-7 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 text-sm transition-colors"
        onClick={onFitToSelection}
        title="Fit to Selection (F)"
      >
        ⊡
      </button>
    </div>
  )
}

/**
 * Debug HUD for zoom information
 */
function ZoomDebugHUD({ controlsRef }) {
  const [debugInfo, setDebugInfo] = useState({
    cameraType: '',
    distance: 0,
    zoom: 1,
    lastWheel: 0,
  })

  const lastWheelRef = useRef(0)

  // Track wheel events
  useEffect(() => {
    const handleWheel = (event) => {
      lastWheelRef.current = event.deltaY
      // Update immediately on wheel
      updateDebugInfo()
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])

  // Update debug info via polling
  const updateDebugInfo = useCallback(() => {
    if (!controlsRef?.current) return

    const controls = controlsRef.current
    const camera = controls.object

    if (!camera) return

    const target = controls.target
    const distance = camera.position.distanceTo(target)

    setDebugInfo({
      cameraType: camera.type,
      distance: distance.toFixed(2),
      zoom: camera.zoom?.toFixed(2) || 'N/A',
      lastWheel: lastWheelRef.current,
    })
  }, [controlsRef])

  // Poll for updates
  useEffect(() => {
    const interval = setInterval(updateDebugInfo, 100) // 10 FPS
    return () => clearInterval(interval)
  }, [updateDebugInfo])

  if (!DEBUG_ZOOM) return null

  return (
    <div className="absolute top-20 right-2 z-20 bg-black/80 text-white p-2 rounded text-xs font-mono space-y-0.5 pointer-events-none">
      <div className="font-bold text-yellow-400 mb-1">🔍 Zoom Debug</div>
      <div>Camera: {debugInfo.cameraType}</div>
      <div>Distance: {debugInfo.distance}</div>
      <div>Zoom: {debugInfo.zoom}</div>
      <div>Last Wheel: {debugInfo.lastWheel}</div>
      <div className="text-gray-400 text-[10px] mt-1 border-t border-gray-600 pt-1">
        Shift+Wheel: Zoom to cursor
      </div>
    </div>
  )
}

/**
 * Full Camera Controls UI Component
 * Combines navigation cube, toolbar, and keyboard shortcuts
 */
export default function CameraControlsUI({
  controlsRef,
  meshes = [],
  selectedBounds = null,
  disabled = false,
}) {
  const [currentPreset, setCurrentPreset] = useState(null)

  // Handle preset selection
  const handleSelectPreset = useCallback((presetKey) => {
    if (disabled || !controlsRef?.current?.goToPreset) return
    
    const preset = CameraPresets[presetKey]
    if (preset) {
      controlsRef.current.goToPreset(preset)
      setCurrentPreset(presetKey)
    }
  }, [controlsRef, disabled])

  // Handle fit to selection
  const handleFitToSelection = useCallback(() => {
    if (disabled || !controlsRef?.current?.fitToBounds) return
    
    let bounds = selectedBounds
    
    // If no selection, fit to all meshes
    if (!bounds && meshes.length > 0) {
      bounds = new THREE.Box3()
      meshes.forEach(mesh => {
        if (mesh.geometry) {
          mesh.geometry.computeBoundingBox()
          const meshBounds = mesh.geometry.boundingBox.clone()
          meshBounds.applyMatrix4(mesh.matrixWorld)
          bounds.union(meshBounds)
        }
      })
    }
    
    if (bounds && !bounds.isEmpty()) {
      controlsRef.current.fitToBounds(bounds)
    }
  }, [controlsRef, meshes, selectedBounds, disabled])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (disabled) return
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return
      
      switch (event.key) {
        case '7':
        case 'Home':
          if (event.ctrlKey) handleSelectPreset('BOTTOM')
          else handleSelectPreset('TOP')
          break
        case '1':
        case 'End':
          if (event.ctrlKey) handleSelectPreset('BACK')
          else handleSelectPreset('FRONT')
          break
        case '3':
        case 'PageDown':
          if (event.ctrlKey) handleSelectPreset('LEFT')
          else handleSelectPreset('RIGHT')
          break
        case '0':
        case 'Insert':
          handleSelectPreset('ISO')
          break
        case 'f':
        case 'F':
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault()
            handleFitToSelection()
          }
          break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSelectPreset, handleFitToSelection, disabled])

  if (disabled) return null

  return (
    <>
      {/* Navigation Cube - Top Right */}
      <div className="absolute top-2 right-2 z-10">
        <NavigationCube
          onSelectView={handleSelectPreset}
          currentView={currentPreset}
          size={70}
        />
      </div>

      {/* Zoom Debug HUD */}
      <ZoomDebugHUD controlsRef={controlsRef} />

      {/* Camera Toolbar - Bottom Center */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <CameraToolbar
          onSelectPreset={handleSelectPreset}
          onFitToSelection={handleFitToSelection}
          currentPreset={currentPreset}
        />
      </div>
    </>
  )
}
