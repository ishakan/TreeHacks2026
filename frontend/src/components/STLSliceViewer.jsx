import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

const CAP_COLORS = [0xcc4444, 0x44aa44, 0x4444cc] // X, Y, Z
const PLANE_NORMALS = [
  new THREE.Vector3(-1, 0, 0), // X
  new THREE.Vector3(0, -1, 0), // Y
  new THREE.Vector3(0, 0, -1), // Z
]

const STLSliceViewer = forwardRef(function STLSliceViewer(
  { stlUrl, clipEnabled, clipValues, wireframe, darkBg, onBoundingBox },
  ref
) {
  const containerRef = useRef(null)
  const internals = useRef(null)

  // Expose resetCamera to parent
  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      const ctx = internals.current
      if (!ctx) return
      const { camera, controls, fitTarget, fitDistance } = ctx
      camera.position.copy(fitTarget).add(new THREE.Vector3(0, 0, fitDistance))
      controls.target.copy(fitTarget)
      controls.update()
    },
  }))

  // ── Setup scene (runs once per stlUrl) ──────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container || !stlUrl) return

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true })
    renderer.localClippingEnabled = true
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(container.clientWidth, container.clientHeight)
    container.appendChild(renderer.domElement)

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(darkBg ? 0x111111 : 0xeeeeee)

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    )

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05

    // Lights — bright 3-point setup for PBR materials
    const ambient = new THREE.AmbientLight(0xffffff, 1.0)
    scene.add(ambient)
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0)
    keyLight.position.set(5, 10, 7.5)
    scene.add(keyLight)
    const fillLight = new THREE.DirectionalLight(0xffffff, 1.0)
    fillLight.position.set(-5, 5, -5)
    scene.add(fillLight)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6)
    rimLight.position.set(0, -5, 5)
    scene.add(rimLight)
    // Hemisphere for natural sky/ground fill
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8)
    scene.add(hemi)

    // Grid + Axes
    const grid = new THREE.GridHelper(10, 20, 0x444444, 0x333333)
    scene.add(grid)
    const axes = new THREE.AxesHelper(3)
    scene.add(axes)

    // Clipping planes
    const clippingPlanes = PLANE_NORMALS.map(
      (n) => new THREE.Plane(n.clone(), 0)
    )

    // Store internals early so async callbacks can reference them
    const ctx = {
      renderer,
      scene,
      camera,
      controls,
      clippingPlanes,
      mainMeshes: [],      // all meshes from the model
      mainMaterials: [],    // their original materials
      stencilGroups: [],
      capMeshes: [],
      fitTarget: new THREE.Vector3(),
      fitDistance: 5,
    }
    internals.current = ctx

    // ── Helper: set up clipping on a geometry ──────────────────────
    const stencilGroups = []
    const capMeshes = []

    function setupClipping(geometry, maxDim) {
      for (let i = 0; i < 3; i++) {
        const plane = clippingPlanes[i]
        const otherPlanes = clippingPlanes.filter((_, j) => j !== i)

        // Stencil back-face (IncrementWrap)
        const stencilBackMat = new THREE.MeshBasicMaterial({
          depthWrite: false,
          depthTest: false,
          colorWrite: false,
          stencilWrite: true,
          stencilFunc: THREE.AlwaysStencilFunc,
          stencilFail: THREE.IncrementWrapStencilOp,
          stencilZFail: THREE.IncrementWrapStencilOp,
          stencilZPass: THREE.IncrementWrapStencilOp,
          side: THREE.BackSide,
          clippingPlanes: [plane],
        })
        const stencilBack = new THREE.Mesh(geometry, stencilBackMat)
        stencilBack.renderOrder = i + 1
        scene.add(stencilBack)
        stencilGroups.push(stencilBack)

        // Stencil front-face (DecrementWrap)
        const stencilFrontMat = new THREE.MeshBasicMaterial({
          depthWrite: false,
          depthTest: false,
          colorWrite: false,
          stencilWrite: true,
          stencilFunc: THREE.AlwaysStencilFunc,
          stencilFail: THREE.DecrementWrapStencilOp,
          stencilZFail: THREE.DecrementWrapStencilOp,
          stencilZPass: THREE.DecrementWrapStencilOp,
          side: THREE.FrontSide,
          clippingPlanes: [plane],
        })
        const stencilFront = new THREE.Mesh(geometry, stencilFrontMat)
        stencilFront.renderOrder = i + 1
        scene.add(stencilFront)
        stencilGroups.push(stencilFront)

        // Cap plane
        const capGeom = new THREE.PlaneGeometry(maxDim * 4, maxDim * 4)
        const capMat = new THREE.MeshStandardMaterial({
          color: CAP_COLORS[i],
          metalness: 0.1,
          roughness: 0.75,
          stencilWrite: true,
          stencilRef: 0,
          stencilFunc: THREE.NotEqualStencilFunc,
          stencilFail: THREE.ReplaceStencilOp,
          stencilZFail: THREE.ReplaceStencilOp,
          stencilZPass: THREE.ReplaceStencilOp,
          side: THREE.DoubleSide,
          clippingPlanes: otherPlanes,
        })
        const capMesh = new THREE.Mesh(capGeom, capMat)
        capMesh.renderOrder = i + 1.1
        capMesh.onAfterRender = (r) => r.clearStencil()
        scene.add(capMesh)
        capMeshes.push(capMesh)
      }
    }

    // ── Helper: finalize scene after loading ──────────────────────
    function finalizeModel(modelRoot) {
      // Compute overall bounding box
      const box = new THREE.Box3().setFromObject(modelRoot)
      const size = new THREE.Vector3()
      box.getSize(size)
      const center = new THREE.Vector3()
      box.getCenter(center)
      const maxDim = Math.max(size.x, size.y, size.z)

      // Center the model
      modelRoot.position.sub(center)

      // Report bounding box (centered)
      const halfSize = size.clone().multiplyScalar(0.5)
      if (onBoundingBox) {
        onBoundingBox({
          min: { x: -halfSize.x, y: -halfSize.y, z: -halfSize.z },
          max: { x: halfSize.x, y: halfSize.y, z: halfSize.z },
        })
      }

      // Auto-fit camera
      const fitDistance = maxDim * 1.5
      camera.position.set(0, maxDim * 0.5, fitDistance)
      controls.target.set(0, 0, 0)
      controls.update()

      ctx.fitTarget = new THREE.Vector3(0, 0, 0)
      ctx.fitDistance = fitDistance

      // Add clipping to all mesh materials and collect geometries
      const meshes = []
      const materials = []
      const geometries = []

      modelRoot.traverse((child) => {
        if (child.isMesh) {
          child.renderOrder = 6
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          mats.forEach((mat) => {
            mat.clippingPlanes = clippingPlanes
            mat.side = THREE.DoubleSide
          })
          meshes.push(child)
          materials.push(...mats)
          if (child.geometry) {
            // Transform geometry to world space for stencil
            child.updateMatrixWorld(true)
            const geom = child.geometry.clone()
            geom.applyMatrix4(child.matrixWorld)
            // Undo modelRoot offset
            const offset = new THREE.Matrix4().makeTranslation(
              -modelRoot.position.x,
              -modelRoot.position.y,
              -modelRoot.position.z
            )
            // Actually we need the centered position
            geometries.push(child.geometry)
          }
        }
      })

      ctx.mainMeshes = meshes
      ctx.mainMaterials = materials

      // Setup stencil clipping on the first mesh geometry (primary mesh)
      if (meshes.length > 0) {
        // Merge all geometries or use the largest one for stencil
        let stencilGeom = meshes[0].geometry
        let largestCount = 0
        meshes.forEach((m) => {
          const count = m.geometry.index
            ? m.geometry.index.count
            : (m.geometry.attributes.position?.count || 0)
          if (count > largestCount) {
            largestCount = count
            stencilGeom = m.geometry
          }
        })
        setupClipping(stencilGeom, maxDim)
      }

      ctx.stencilGroups = stencilGroups
      ctx.capMeshes = capMeshes

      scene.add(modelRoot)
    }

    // ── Load model (GLB or STL) ──────────────────────────────────
    // Detect format from blob type or URL
    const isGLB = true // Replicate always returns GLB

    if (isGLB) {
      const gltfLoader = new GLTFLoader()
      gltfLoader.load(stlUrl, (gltf) => {
        finalizeModel(gltf.scene)
      }, undefined, (err) => {
        // Fallback: try STL
        console.warn('GLB load failed, trying STL:', err)
        const stlLoader = new STLLoader()
        stlLoader.load(stlUrl, (geometry) => {
          const mat = new THREE.MeshPhysicalMaterial({
            color: 0x6699cc,
            metalness: 0.3,
            roughness: 0.4,
            side: THREE.DoubleSide,
          })
          const mesh = new THREE.Mesh(geometry, mat)
          const group = new THREE.Group()
          group.add(mesh)
          finalizeModel(group)
        })
      })
    }

    // ── Animation loop ────────────────────────────────────────────
    let animId
    const animate = () => {
      animId = requestAnimationFrame(animate)
      controls.update()

      // Position cap planes
      for (let i = 0; i < 3; i++) {
        const plane = clippingPlanes[i]
        const cap = capMeshes[i]
        if (!cap) continue

        const pos = new THREE.Vector3()
        plane.coplanarPoint(pos)
        cap.position.copy(pos)

        const lookTarget = pos.clone().sub(plane.normal)
        cap.lookAt(lookTarget)
      }

      renderer.render(scene, camera)
    }
    animate()

    // ── Resize handler ────────────────────────────────────────────
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    // ── Cleanup ──────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', handleResize)
      controls.dispose()

      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
          else obj.material.dispose()
        }
      })

      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }

      internals.current = null
    }
  }, [stlUrl]) // Only re-run when stlUrl changes

  // ── Update clipping planes reactively ───────────────────────────
  useEffect(() => {
    const ctx = internals.current
    if (!ctx) return

    const { clippingPlanes, stencilGroups, capMeshes, mainMeshes } = ctx
    const axisKeys = ['x', 'y', 'z']

    for (let i = 0; i < 3; i++) {
      const enabled = clipEnabled[axisKeys[i]]
      const value = clipValues[axisKeys[i]]

      clippingPlanes[i].constant = value

      const backIdx = i * 2
      const frontIdx = i * 2 + 1
      if (stencilGroups[backIdx]) stencilGroups[backIdx].visible = enabled
      if (stencilGroups[frontIdx]) stencilGroups[frontIdx].visible = enabled
      if (capMeshes[i]) capMeshes[i].visible = enabled
    }

    // Update main mesh clipping planes
    if (mainMeshes) {
      const activePlanes = clippingPlanes.filter((_, i) => clipEnabled[axisKeys[i]])
      mainMeshes.forEach((mesh) => {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        mats.forEach((mat) => {
          mat.clippingPlanes = activePlanes.length > 0 ? activePlanes : []
        })
      })
    }

    // Update stencil group clipping planes
    for (let i = 0; i < 3; i++) {
      const backIdx = i * 2
      const frontIdx = i * 2 + 1
      const activePlane = clipEnabled[axisKeys[i]] ? [clippingPlanes[i]] : []
      if (stencilGroups[backIdx]) stencilGroups[backIdx].material.clippingPlanes = activePlane
      if (stencilGroups[frontIdx]) stencilGroups[frontIdx].material.clippingPlanes = activePlane
    }

    // Update cap planes to clip by OTHER active planes
    for (let i = 0; i < 3; i++) {
      if (capMeshes[i]) {
        const otherActivePlanes = clippingPlanes.filter(
          (_, j) => j !== i && clipEnabled[axisKeys[j]]
        )
        capMeshes[i].material.clippingPlanes = otherActivePlanes
      }
    }
  }, [clipEnabled, clipValues])

  // ── Update wireframe reactively ─────────────────────────────────
  useEffect(() => {
    const ctx = internals.current
    if (!ctx?.mainMaterials) return
    ctx.mainMaterials.forEach((mat) => { mat.wireframe = wireframe })
  }, [wireframe])

  // ── Update background reactively ────────────────────────────────
  useEffect(() => {
    const ctx = internals.current
    if (!ctx?.scene) return
    ctx.scene.background = new THREE.Color(darkBg ? 0x111111 : 0xeeeeee)
  }, [darkBg])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
})

export default STLSliceViewer
