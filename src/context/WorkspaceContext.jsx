import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { shapeToGeometry, getOCCT, isOCCTReady } from '../services/occtService'

const WorkspaceContext = createContext(null)

function makeBodyId(prefix = 'body') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function defaultTransform() {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }
}

function cloneTransform(transform) {
  return {
    position: [...(transform?.position || [0, 0, 0])],
    rotation: [...(transform?.rotation || [0, 0, 0])],
    scale: [...(transform?.scale || [1, 1, 1])],
  }
}

function applyTransformToObject(obj, transform) {
  if (!obj) return
  obj.position.set(...transform.position)
  obj.rotation.set(...transform.rotation)
  obj.scale.set(...transform.scale)
  obj.updateMatrixWorld(true)
}

function toTuple(vec) {
  return [vec.x, vec.y, vec.z]
}

function isRenderableMesh(node) {
  return (node?.isMesh || node?.isSkinnedMesh) && node.geometry?.attributes?.position?.count > 0
}

function extractTrianglesFromObject(object) {
  if (!object) {
    return { triangles: [], bbox: new THREE.Box3(), meshCount: 0, triangleCount: 0 }
  }

  object.updateWorldMatrix(true, true)

  const triangles = []
  const bbox = new THREE.Box3()
  let meshCount = 0
  let triangleCount = 0

  const pA = new THREE.Vector3()
  const pB = new THREE.Vector3()
  const pC = new THREE.Vector3()
  const local = new THREE.Vector3()

  object.traverse((child) => {
    if (!isRenderableMesh(child)) return
    meshCount += 1
    child.updateWorldMatrix(true, false)

    const geometry = child.geometry
    const position = geometry.attributes.position
    const index = geometry.index
    const triangleSourceCount = index ? index.count : position.count
    triangleCount += Math.floor(triangleSourceCount / 3)

    const readVertex = (vertexIndex, target) => {
      if (child.isSkinnedMesh && typeof child.boneTransform === 'function') {
        local.fromBufferAttribute(position, vertexIndex)
        child.boneTransform(vertexIndex, target.copy(local))
      } else {
        target.fromBufferAttribute(position, vertexIndex)
      }
      target.applyMatrix4(child.matrixWorld)
    }

    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const ia = index.getX(i)
        const ib = index.getX(i + 1)
        const ic = index.getX(i + 2)
        readVertex(ia, pA)
        readVertex(ib, pB)
        readVertex(ic, pC)
        bbox.expandByPoint(pA)
        bbox.expandByPoint(pB)
        bbox.expandByPoint(pC)
        triangles.push([toTuple(pA), toTuple(pB), toTuple(pC)])
      }
      return
    }

    for (let i = 0; i < position.count; i += 3) {
      readVertex(i, pA)
      readVertex(i + 1, pB)
      readVertex(i + 2, pC)
      bbox.expandByPoint(pA)
      bbox.expandByPoint(pB)
      bbox.expandByPoint(pC)
      triangles.push([toTuple(pA), toTuple(pB), toTuple(pC)])
    }
  })

  return { triangles, bbox, meshCount, triangleCount }
}

function buildProxySolidFromBbox(oc, bbox) {
  if (bbox.isEmpty()) {
    throw new Error('No mesh triangles found in imported object; cannot convert.')
  }

  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  bbox.getSize(size)
  bbox.getCenter(center)
  if (size.x <= 1e-6 || size.y <= 1e-6 || size.z <= 1e-6) {
    throw new Error('Mesh bounds are degenerate')
  }

  const mk = new oc.BRepPrimAPI_MakeBox_1(size.x, size.y, size.z)
  let shape = mk.Shape()
  const trsf = new oc.gp_Trsf_1()
  trsf.SetTranslation_1(new oc.gp_Vec_4(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2))
  const move = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
  shape = move.Shape()
  return shape
}

function buildSolidFromTriangles(oc, triangles) {
  if (triangles.length === 0) {
    throw new Error('No mesh triangles found in imported object; cannot convert.')
  }

  // OpenCascade.js triangle-face APIs are unstable across bindings.
  // We currently validate triangle extraction and then build a proxy solid from triangle bbox.
  const bbox = new THREE.Box3()
  for (const tri of triangles) {
    bbox.expandByPoint(new THREE.Vector3(...tri[0]))
    bbox.expandByPoint(new THREE.Vector3(...tri[1]))
    bbox.expandByPoint(new THREE.Vector3(...tri[2]))
  }
  return {
    shape: buildProxySolidFromBbox(oc, bbox),
    warning: 'Experimental conversion used extracted triangle bounds. Sewing/solidify is not yet available in this binding.',
  }
}

function shapeToStandaloneMesh(shape) {
  const { geometry } = shapeToGeometry(shape)
  const material = new THREE.MeshStandardMaterial({
    color: 0x7c8a9a,
    metalness: 0.12,
    roughness: 0.55,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.add(mesh)
  return group
}

function doBoolean(oc, op, targetShape, toolShape) {
  let algo
  if (op === 'union') {
    algo = new oc.BRepAlgoAPI_Fuse_1()
  } else if (op === 'cut') {
    algo = new oc.BRepAlgoAPI_Cut_1()
  } else {
    algo = new oc.BRepAlgoAPI_Common_1()
  }

  const args = new oc.TopTools_ListOfShape_1()
  args.Append_1(targetShape)
  algo.SetArguments(args)

  const tools = new oc.TopTools_ListOfShape_1()
  tools.Append_1(toolShape)
  algo.SetTools(tools)

  algo.Build()
  if (!algo.IsDone()) {
    throw new Error(`Boolean ${op} failed`)
  }

  return algo.Shape()
}

export function WorkspaceProvider({ children }) {
  const [bodies, setBodies] = useState([])
  const [activeBodyId, setActiveBodyId] = useState(null)
  const [transformMode, setTransformMode] = useState('translate')
  const [uniformScale, setUniformScale] = useState(true)
  const [transformSnapping, setTransformSnappingState] = useState({
    translate: 0,
    rotateDeg: 0,
  })

  const shapeRegistry = useRef(new Map())
  const objectRegistry = useRef(new Map())
  const highlightStateRef = useRef(new Map())
  const debugEnabled = typeof window !== 'undefined' && Boolean(window.__DEBUG_IMPORTED__)

  const getBody = useCallback((bodyId) => {
    return bodies.find((body) => body.id === bodyId) || null
  }, [bodies])

  const registerShape = useCallback((shapeRefId, shapeHandle) => {
    if (!shapeRefId || !shapeHandle) return
    shapeRegistry.current.set(shapeRefId, shapeHandle)
  }, [])

  const registerObject = useCallback((objectRefId, object3D) => {
    if (!objectRefId || !object3D) return
    objectRegistry.current.set(objectRefId, object3D)
  }, [])

  const unregisterObject = useCallback((objectRefId) => {
    if (!objectRefId) return
    objectRegistry.current.delete(objectRefId)
  }, [])

  const getShape = useCallback((shapeRefId) => {
    return shapeRegistry.current.get(shapeRefId)
  }, [])

  const getObject = useCallback((objectRefId) => {
    return objectRegistry.current.get(objectRefId)
  }, [])

  const getTransformTarget = useCallback((bodyId) => {
    if (!bodyId) return null
    const body = bodies.find((entry) => entry.id === bodyId)
    if (!body) return null
    const objectRefId = body.mesh?.objectRefId || `obj-${body.id}`
    const object3DRef = objectRegistry.current.get(objectRefId) || null
    return {
      id: body.id,
      kind: body.kind,
      object3DRef,
      currentTransform: cloneTransform(body.transform),
    }
  }, [bodies])

  const getBodyDebugInfo = useCallback((bodyId) => {
    const body = bodies.find((b) => b.id === bodyId)
    if (!body) return null
    const objectRefId = body.mesh?.objectRefId || `obj-${body.id}`
    const object = objectRegistry.current.get(objectRefId)
    if (!object) {
      return {
        bodyId,
        objectRefId,
        missingObject: true,
      }
    }
    const extraction = extractTrianglesFromObject(object)
    return {
      bodyId,
      objectRefId,
      objectUuid: object.uuid,
      meshCount: extraction.meshCount,
      triangles: extraction.triangleCount,
      bbox: extraction.bbox.isEmpty() ? null : {
        min: [extraction.bbox.min.x, extraction.bbox.min.y, extraction.bbox.min.z],
        max: [extraction.bbox.max.x, extraction.bbox.max.y, extraction.bbox.max.z],
      },
    }
  }, [bodies])

  const highlightBodyMeshes = useCallback((bodyId, enabled) => {
    const body = bodies.find((b) => b.id === bodyId)
    if (!body) return
    const objectRefId = body.mesh?.objectRefId || `obj-${body.id}`
    const object = objectRegistry.current.get(objectRefId)
    if (!object) return

    object.traverse((child) => {
      if (!child.isMesh || !child.material) return
      const material = Array.isArray(child.material) ? child.material : [child.material]
      material.forEach((mat, idx) => {
        const key = `${child.uuid}-${idx}`
        if (enabled) {
          if (!highlightStateRef.current.has(key)) {
            highlightStateRef.current.set(key, {
              color: mat.color?.clone?.() || null,
              emissive: mat.emissive?.clone?.() || null,
              emissiveIntensity: mat.emissiveIntensity,
            })
          }
          if (mat.color) mat.color.set(0xff3366)
          if (mat.emissive) mat.emissive.set(0x330000)
          mat.emissiveIntensity = 0.4
          return
        }

        const original = highlightStateRef.current.get(key)
        if (original) {
          if (mat.color && original.color) mat.color.copy(original.color)
          if (mat.emissive && original.emissive) mat.emissive.copy(original.emissive)
          if (typeof original.emissiveIntensity === 'number') {
            mat.emissiveIntensity = original.emissiveIntensity
          }
          highlightStateRef.current.delete(key)
        }
      })
    })
  }, [bodies])

  const addMeshBody = useCallback((payload) => {
    const bodyId = payload.id || makeBodyId('mesh')
    const objectRefId = payload.mesh?.objectRefId || `obj-${bodyId}`

    const meshInfo = payload.object3D ? extractTrianglesFromObject(payload.object3D) : null
    const nextBody = {
      id: bodyId,
      name: payload.name || 'Imported Mesh',
      kind: 'mesh',
      visible: payload.visible ?? true,
      transform: cloneTransform(payload.transform || defaultTransform()),
      mesh: {
        objectRefId,
        sourceType: payload.mesh?.sourceType || 'stl',
        stats: payload.mesh?.stats || {
          meshes: meshInfo?.meshCount || 0,
          triangles: meshInfo?.triangleCount || 0,
        },
        bbox: meshInfo?.bbox && !meshInfo.bbox.isEmpty() ? {
          min: [meshInfo.bbox.min.x, meshInfo.bbox.min.y, meshInfo.bbox.min.z],
          max: [meshInfo.bbox.max.x, meshInfo.bbox.max.y, meshInfo.bbox.max.z],
        } : null,
      },
      status: payload.status || 'ready',
      error: payload.error || null,
    }

    setBodies((prev) => [...prev, nextBody])

    if (payload.object3D) {
      registerObject(objectRefId, payload.object3D)
      applyTransformToObject(payload.object3D, nextBody.transform)
      payload.object3D.visible = nextBody.visible
    }

    return nextBody
  }, [registerObject])

  const upsertBrepBody = useCallback((payload) => {
    const bodyId = payload.id || makeBodyId('brep')
    const shapeRefId = payload.occt?.shapeRefId || `shape-${bodyId}`
    const objectRefId = payload.objectRefId || `obj-${bodyId}`

    if (payload.shapeHandle) {
      registerShape(shapeRefId, payload.shapeHandle)
    }

    if (payload.object3D) {
      registerObject(objectRefId, payload.object3D)
      applyTransformToObject(payload.object3D, payload.transform || defaultTransform())
      payload.object3D.visible = payload.visible ?? true
    }

    const nextBody = {
      id: bodyId,
      name: payload.name || 'Solid Body',
      kind: 'brep',
      visible: payload.visible ?? true,
      transform: cloneTransform(payload.transform || defaultTransform()),
      occt: { shapeRefId },
      status: payload.status || 'ready',
      error: payload.error || null,
    }

    setBodies((prev) => {
      const idx = prev.findIndex((body) => body.id === bodyId)
      if (idx === -1) return [...prev, nextBody]
      const updated = [...prev]
      updated[idx] = {
        ...updated[idx],
        ...nextBody,
        transform: updated[idx].transform || nextBody.transform,
      }
      return updated
    })

    return nextBody
  }, [registerObject, registerShape])

  const syncBrepBodiesFromShapes = useCallback((shapes) => {
    if (!Array.isArray(shapes) || shapes.length === 0) return

    setBodies((prev) => {
      const persistentBodies = prev.filter((body) => body.kind === 'mesh' || body.id.startsWith('brep-'))
      const nextBrepBodies = shapes.map((shape) => {
        const existing = prev.find((b) => b.id === shape.id)
        const shapeRefId = shape.shapeRefId || `shape-${shape.id}`

        if (shape.occtShape) {
          registerShape(shapeRefId, shape.occtShape)
        }

        return {
          id: shape.id,
          name: shape.name || shape.id,
          kind: 'brep',
          visible: true,
          transform: existing?.transform || defaultTransform(),
          occt: { shapeRefId },
          status: 'ready',
          error: null,
        }
      })

      return [...persistentBodies, ...nextBrepBodies]
    })
  }, [registerShape])

  const selectBody = useCallback((bodyId) => {
    setActiveBodyId(bodyId)
  }, [])

  const removeBody = useCallback((bodyId) => {
    setBodies((prev) => prev.filter((body) => body.id !== bodyId))
    if (activeBodyId === bodyId) {
      setActiveBodyId(null)
    }
  }, [activeBodyId])

  const renameBody = useCallback((bodyId, name) => {
    setBodies((prev) => prev.map((body) => (body.id === bodyId ? { ...body, name } : body)))
  }, [])

  const setBodyVisibility = useCallback((bodyId, visible) => {
    setBodies((prev) => {
      const body = prev.find((b) => b.id === bodyId)
      if (body) {
        const objectRefId = body.mesh?.objectRefId || `obj-${bodyId}`
        const obj = objectRegistry.current.get(objectRefId)
        if (obj) {
          obj.visible = visible
        }
      }
      return prev.map((entry) => (entry.id === bodyId ? { ...entry, visible } : entry))
    })
  }, [])

  const updateBodyTransform = useCallback((bodyId, transformPatch) => {
    setBodies((prev) => prev.map((body) => {
      if (body.id !== bodyId) return body
      return {
        ...body,
        transform: {
          position: transformPatch.position || body.transform.position,
          rotation: transformPatch.rotation || body.transform.rotation,
          scale: transformPatch.scale || body.transform.scale,
        },
      }
    }))
  }, [])

  const setTransformSnapping = useCallback((patch) => {
    setTransformSnappingState((prev) => ({
      ...prev,
      ...patch,
    }))
  }, [])

  const applyTransformToBodyObject = useCallback((bodyId, transform) => {
    const body = bodies.find((b) => b.id === bodyId)
    if (!body) return
    const objectRefId = body.mesh?.objectRefId || `obj-${bodyId}`
    const obj = objectRegistry.current.get(objectRefId)
    if (!obj) return
    applyTransformToObject(obj, transform)
  }, [bodies])

  const convertMeshBodyToSolid = useCallback((meshBodyId) => {
    const meshBody = bodies.find((body) => body.id === meshBodyId)
    if (!meshBody || meshBody.kind !== 'mesh') {
      return { ok: false, error: 'Selected body is not a mesh body' }
    }

    const sourceObject = objectRegistry.current.get(meshBody.mesh?.objectRefId)
    if (!sourceObject) {
      return { ok: false, error: 'Mesh object is missing from runtime registry' }
    }

    try {
      const extraction = extractTrianglesFromObject(sourceObject)
      if (extraction.triangles.length === 0 || extraction.bbox.isEmpty()) {
        return { ok: false, error: 'No mesh triangles found in imported object; cannot convert.' }
      }

      const oc = getOCCT()
      const { shape, warning } = buildSolidFromTriangles(oc, extraction.triangles)
      const { geometry, topologyMap } = shapeToGeometry(shape)
      const shapeRefId = `shape-${meshBodyId}-converted-${Date.now()}`
      registerShape(shapeRefId, shape)

      const bodyId = `brep-${meshBodyId}-${Date.now()}`
      const previewObject = shapeToStandaloneMesh(shape)
      registerObject(`obj-${bodyId}`, previewObject)
      const solidBody = {
        id: bodyId,
        name: `${meshBody.name} (Solid)` ,
        kind: 'brep',
        visible: true,
        transform: defaultTransform(),
        occt: { shapeRefId },
        status: 'ready',
      }

      setBodies((prev) => {
        const updated = prev.map((body) => (
          body.id === meshBody.id ? { ...body, visible: false } : body
        ))
        updated.push(solidBody)
        return updated
      })

      return {
        ok: true,
        warning,
        extraction: {
          meshCount: extraction.meshCount,
          triangleCount: extraction.triangleCount,
          bbox: {
            min: [extraction.bbox.min.x, extraction.bbox.min.y, extraction.bbox.min.z],
            max: [extraction.bbox.max.x, extraction.bbox.max.y, extraction.bbox.max.z],
          },
        },
        body: solidBody,
        geometry,
        topologyMap,
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [bodies, registerShape])

  const booleanBodies = useCallback((targetBodyId, toolBodyId, operation) => {
    if (!isOCCTReady()) {
      return { ok: false, error: 'OCCT is not ready' }
    }

    const target = bodies.find((body) => body.id === targetBodyId)
    const tool = bodies.find((body) => body.id === toolBodyId)

    if (!target || !tool) {
      return { ok: false, error: 'Two valid bodies are required' }
    }

    const oc = getOCCT()

    const resolveShape = (body) => {
      if (body.kind === 'brep') {
        const shape = shapeRegistry.current.get(body.occt?.shapeRefId)
        if (!shape) {
          throw new Error(`Missing B-Rep handle for ${body.name}`)
        }
        return shape
      }

      const obj = objectRegistry.current.get(body.mesh?.objectRefId)
      if (!obj) {
        throw new Error(`Missing mesh object for ${body.name}`)
      }

      const extraction = extractTrianglesFromObject(obj)
      if (extraction.triangles.length === 0 || extraction.bbox.isEmpty()) {
        throw new Error(`No mesh triangles found in imported object "${body.name}"`)
      }
      const { shape } = buildSolidFromTriangles(oc, extraction.triangles)
      return shape
    }

    try {
      const targetShape = resolveShape(target)
      const toolShape = resolveShape(tool)
      const resultShape = doBoolean(oc, operation, targetShape, toolShape)

      const resultKind = target.kind === 'brep' || tool.kind === 'brep' ? 'brep' : 'mesh'
      const resultName = `${target.name} ${operation} ${tool.name}`

      if (resultKind === 'brep') {
        const { geometry, topologyMap } = shapeToGeometry(resultShape)
        const bodyId = makeBodyId('brep')
        const shapeRefId = `shape-${bodyId}`
        registerShape(shapeRefId, resultShape)
        const previewObject = shapeToStandaloneMesh(resultShape)
        registerObject(`obj-${bodyId}`, previewObject)

        const resultBody = {
          id: bodyId,
          name: resultName,
          kind: 'brep',
          visible: true,
          transform: defaultTransform(),
          occt: { shapeRefId },
          status: 'ready',
        }
        setBodies((prev) => [...prev, resultBody])

        return {
          ok: true,
          mode: 'occt',
          resultBody,
          geometry,
          topologyMap,
        }
      }

      // Mesh fallback: keep result as mesh body (approximate)
      const resultObject = shapeToStandaloneMesh(resultShape)
      const bodyId = makeBodyId('mesh')
      const objectRefId = `obj-${bodyId}`
      registerObject(objectRefId, resultObject)

      const resultBody = {
        id: bodyId,
        name: `${resultName} (Mesh Boolean approx)`,
        kind: 'mesh',
        visible: true,
        transform: defaultTransform(),
        mesh: {
          objectRefId,
          sourceType: 'stl',
        },
        status: 'ready',
      }

      setBodies((prev) => [...prev, resultBody])

      return {
        ok: true,
        mode: 'mesh-boolean-approx',
        resultBody,
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }, [bodies, registerObject, registerShape])

  const value = useMemo(() => ({
    bodies,
    activeBodyId,
    transformMode,
    setTransformMode,
    uniformScale,
    setUniformScale,
    transformSnapping,
    setTransformSnapping,
    shapeRegistry,
    objectRegistry,
    getBody,
    getTransformTarget,
    addMeshBody,
    upsertBrepBody,
    syncBrepBodiesFromShapes,
    selectBody,
    removeBody,
    renameBody,
    setBodyVisibility,
    updateBodyTransform,
    applyTransformToBodyObject,
    convertMeshBodyToSolid,
    booleanBodies,
    registerShape,
    registerObject,
    unregisterObject,
    getShape,
    getObject,
    getBodyDebugInfo,
    highlightBodyMeshes,
    debugEnabled,
  }), [
    bodies,
    activeBodyId,
    transformMode,
    uniformScale,
    transformSnapping,
    getBody,
    getTransformTarget,
    addMeshBody,
    upsertBrepBody,
    syncBrepBodiesFromShapes,
    selectBody,
    removeBody,
    renameBody,
    setBodyVisibility,
    updateBodyTransform,
    applyTransformToBodyObject,
    convertMeshBodyToSolid,
    booleanBodies,
    registerShape,
    registerObject,
    unregisterObject,
    getShape,
    getObject,
    setTransformSnapping,
    setUniformScale,
    getBodyDebugInfo,
    highlightBodyMeshes,
    debugEnabled,
  ])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}
