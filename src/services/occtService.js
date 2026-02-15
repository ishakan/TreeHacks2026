import * as THREE from 'three'

// Named import - opencascade.js only exports { initOpenCascade }
import { initOpenCascade } from 'opencascade.js'

let oc = null
let initPromise = null
let initError = null

// Diagnostic logging prefix
const LOG_PREFIX = '[OCCT Service]'

// Verify import at module load time
console.log(`${LOG_PREFIX} Module loaded`)
console.log(`${LOG_PREFIX} initOpenCascade type:`, typeof initOpenCascade)

/**
 * Initialize OpenCascade.js WASM module
 */
export async function initOCCT() {
  console.log(`${LOG_PREFIX} initOCCT() called`)
  
  if (oc) {
    console.log(`${LOG_PREFIX} Already initialized, returning cached instance`)
    return oc
  }
  if (initError) {
    console.log(`${LOG_PREFIX} Previous initialization failed, rethrowing error`)
    throw initError
  }
  
  if (!initPromise) {
    initPromise = (async () => {
      try {
        console.log(`${LOG_PREFIX} ========== STARTING WASM INITIALIZATION ==========`)
        console.log(`${LOG_PREFIX} Calling initOpenCascade()...`)

        const startTime = performance.now()

        // Configure WASM loading from public folder
        const instance = await initOpenCascade({
          locateFile: (path) => {
            // Load WASM files from public folder
            if (path.endsWith('.wasm') || path.endsWith('.wasm.wasm')) {
              console.log(`${LOG_PREFIX} Loading WASM from public folder: ${path}`)
              return `/opencascade.wasm`
            }
            if (path.endsWith('.js')) {
              return `/opencascade.wasm.js`
            }
            return path
          }
        })

        const endTime = performance.now()

        oc = instance
        console.log(`${LOG_PREFIX} ========== WASM INITIALIZATION COMPLETE ==========`)
        console.log(`${LOG_PREFIX} ✓ OpenCascade.js initialized in ${(endTime - startTime).toFixed(2)}ms`)
        console.log(`${LOG_PREFIX} Instance type:`, typeof oc)
        console.log(`${LOG_PREFIX} Sample APIs:`, Object.keys(oc).slice(0, 5))

        return oc
      } catch (err) {
        console.error(`${LOG_PREFIX} ========== CAD KERNEL CRASH ==========`)
        console.error(`${LOG_PREFIX} Error:`, err.name, '-', err.message)
        console.error(err.stack)

        initError = new Error(
          `Failed to load CAD kernel: ${err.message}. Your browser may not support WebAssembly.`
        )
        initPromise = null
        throw initError
      }
    })()
  } else {
    console.log(`${LOG_PREFIX} Initialization already in progress, waiting...`)
  }
  
  return initPromise
}

/**
 * Check if OCCT is initialized
 */
export function isOCCTReady() {
  return oc !== null
}

/**
 * Get the initialized OCCT instance
 */
export function getOCCT() {
  if (!oc) throw new Error('OCCT not initialized. Call initOCCT() first.')
  return oc
}

/**
 * Create a box shape
 */
export function makeBox(width, height, depth) {
  const box = new oc.BRepPrimAPI_MakeBox_1(width, height, depth)
  return box.Shape()
}

/**
 * Create a cylinder shape
 */
export function makeCylinder(radius, height) {
  const cylinder = new oc.BRepPrimAPI_MakeCylinder_1(radius, height)
  return cylinder.Shape()
}

/**
 * Create a sphere shape
 */
export function makeSphere(radius) {
  const sphere = new oc.BRepPrimAPI_MakeSphere_1(radius)
  return sphere.Shape()
}

/**
 * Create a cone shape
 */
export function makeCone(radius1, radius2, height) {
  const cone = new oc.BRepPrimAPI_MakeCone_1(radius1, radius2, height)
  return cone.Shape()
}

/**
 * Create an OCCT edge from two 2D points (on XY plane at Z=0)
 */
export function makeEdgeFromPoints(x1, y1, x2, y2) {
  const p1 = new oc.gp_Pnt_3(x1, y1, 0)
  const p2 = new oc.gp_Pnt_3(x2, y2, 0)
  const edge = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)
  return edge.Edge()
}

/**
 * Create an OCCT circle edge from center and radius (on XY plane)
 */
export function makeCircleEdge(cx, cy, radius) {
  const center = new oc.gp_Pnt_3(cx, cy, 0)
  const dir = new oc.gp_Dir_4(0, 0, 1) // Z-up
  const axis = new oc.gp_Ax2_3(center, dir)
  const circle = new oc.gp_Circ_2(axis, radius)
  const edge = new oc.BRepBuilderAPI_MakeEdge_8(circle)
  return edge.Edge()
}

/**
 * Create a wire from an array of edges
 */
export function makeWireFromEdges(edges) {
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()
  
  for (const edge of edges) {
    wireBuilder.Add_1(edge)
  }
  
  if (!wireBuilder.IsDone()) {
    console.warn(`${LOG_PREFIX} Wire construction failed`)
    return null
  }
  
  return wireBuilder.Wire()
}

/**
 * Check wire closure using OCCT APIs available in OpenCascade.js bindings.
 * Note: `wire.Closed()` is not available on JS wrapper objects.
 */
export function isWireClosed(wire) {
  if (!wire) return false

  const isClosedCandidates = [
    oc?.BRep_Tool?.IsClosed,
    oc?.BRep_Tool?.IsClosed_1,
    oc?.BRep_Tool?.IsClosed_2,
  ].filter((fn) => typeof fn === 'function')

  for (const fn of isClosedCandidates) {
    try {
      const result = fn.call(oc.BRep_Tool, wire)
      if (typeof result === 'boolean') return result
      if (result && typeof result.valueOf === 'function') {
        const boolValue = result.valueOf()
        if (typeof boolValue === 'boolean') return boolValue
      }
    } catch (err) {
      // Try fallback strategy below.
    }
  }

  // Fallback: attempt to build a face from the wire.
  // A planar face build succeeds only for a valid closed wire.
  try {
    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
    if (!faceBuilder.IsDone()) return false

    const face = faceBuilder.Face()
    if (!face || (typeof face.IsNull === 'function' && face.IsNull())) return false

    try {
      const analyzer = new oc.BRepCheck_Analyzer(face, false)
      if (typeof analyzer.IsValid === 'function') {
        return Boolean(analyzer.IsValid())
      }
    } catch (err) {
      // If analyzer isn't available in this build, successful face creation is enough.
    }
    return true
  } catch (err) {
    return false
  }
}

/**
 * Create a face from a wire (assumes planar wire)
 */
export function makeFaceFromWire(wire) {
  const faceBuilder = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
  
  if (!faceBuilder.IsDone()) {
    console.warn(`${LOG_PREFIX} Face construction failed`)
    return null
  }
  
  return faceBuilder.Face()
}

/**
 * Extrude a face along a direction vector
 * @param {TopoDS_Face} face - The face to extrude
 * @param {number} length - Extrusion length (positive = +Z direction)
 * @returns {TopoDS_Shape} - The extruded solid
 */
export function extrudeFace(face, length) {
  console.log(`${LOG_PREFIX} extrudeFace() - length: ${length}`)
  
  // Create direction vector for extrusion (along Z axis)
  const direction = new oc.gp_Vec_4(0, 0, length)
  
  // Create prism (linear extrusion)
  const prism = new oc.BRepPrimAPI_MakePrism_1(face, direction, false, true)
  
  if (!prism.IsDone()) {
    console.error(`${LOG_PREFIX} Prism extrusion failed`)
    return null
  }
  
  const shape = prism.Shape()
  console.log(`${LOG_PREFIX} ✓ Extrusion complete`)
  
  return shape
}

/**
 * Convert sketch entities (lines, circles) to an extruded solid
 * @param {Array} entities - Array of sketch entities from SketchContext
 * @param {number} extrudeLength - Length to extrude
 * @returns {Object} - { shape: TopoDS_Shape, geometry: THREE.BufferGeometry }
 */
export function extrudeSketchEntities(entities, extrudeLength) {
  console.log(`${LOG_PREFIX} extrudeSketchEntities() - ${entities.length} entities, length: ${extrudeLength}`)
  
  if (!entities || entities.length === 0) {
    console.warn(`${LOG_PREFIX} No entities to extrude`)
    return null
  }
  
  // Separate entities by type
  const lines = entities.filter(e => e.type === 'line')
  const circles = entities.filter(e => e.type === 'circle')
  
  console.log(`${LOG_PREFIX}   Lines: ${lines.length}, Circles: ${circles.length}`)
  
  // For simplicity, handle the most common case:
  // - If there's a single circle, extrude it as a cylinder
  // - If there are lines forming a closed loop, extrude as a prism
  // - Otherwise, extrude each entity separately and combine
  
  let resultShape = null
  
  // Handle circles (each becomes a cylinder)
  for (const circle of circles) {
    console.log(`${LOG_PREFIX}   Processing circle: center (${circle.center.x.toFixed(2)}, ${circle.center.y.toFixed(2)}), radius ${circle.radius.toFixed(2)}`)
    
    const circleEdge = makeCircleEdge(circle.center.x, circle.center.y, circle.radius)
    const wire = makeWireFromEdges([circleEdge])
    
    if (wire) {
      const face = makeFaceFromWire(wire)
      if (face) {
        const extruded = extrudeFace(face, extrudeLength)
        if (extruded) {
          if (resultShape) {
            // Fuse with existing shape
            const fuse = new oc.BRepAlgoAPI_Fuse_1()
            const listArgs = new oc.TopTools_ListOfShape_1()
            listArgs.Append_1(resultShape)
            fuse.SetArguments(listArgs)
            const listTools = new oc.TopTools_ListOfShape_1()
            listTools.Append_1(extruded)
            fuse.SetTools(listTools)
            fuse.Build()
            resultShape = fuse.Shape()
          } else {
            resultShape = extruded
          }
        }
      }
    }
  }
  
  // Handle lines - try to form a closed wire
  if (lines.length >= 3) {
    console.log(`${LOG_PREFIX}   Attempting to create closed wire from ${lines.length} lines`)
    
    const edges = []
    for (const line of lines) {
      const edge = makeEdgeFromPoints(line.p1.x, line.p1.y, line.p2.x, line.p2.y)
      edges.push(edge)
    }
    
    const wire = makeWireFromEdges(edges)
    
    if (wire && isWireClosed(wire)) {
      console.log(`${LOG_PREFIX}   ✓ Wire is closed`)
      const face = makeFaceFromWire(wire)
      if (face) {
        const extruded = extrudeFace(face, extrudeLength)
        if (extruded) {
          if (resultShape) {
            const fuse = new oc.BRepAlgoAPI_Fuse_2(resultShape, extruded)
            resultShape = fuse.Shape()
          } else {
            resultShape = extruded
          }
        }
      }
    } else {
      console.log(`${LOG_PREFIX}   Wire is not closed, skipping line extrusion`)
    }
  }
  
  if (!resultShape) {
    console.error(`${LOG_PREFIX} Failed to create extruded shape`)
    return null
  }
  
  // Convert to Three.js geometry with topology mapping
  const { geometry, topologyMap } = shapeToGeometry(resultShape)
  
  return {
    shape: resultShape,
    geometry,
    topologyMap,
  }
}

/**
 * Convert an OCCT shape to Three.js BufferGeometry with topology mapping
 * Returns: { geometry, topologyMap }
 * topologyMap: { faces: Map<faceId, { triangleStart, triangleCount, area }>, 
 *               triangleToFace: Array<faceId>,
 *               edges: Map<edgeId, { vertices: [v1, v2], length }>,
 *               vertices: Map<vertexId, { position: {x,y,z} }> }
 */
export function shapeToGeometry(shape, linearDeflection = 0.1, angularDeflection = 0.5) {
  console.log(`${LOG_PREFIX} shapeToGeometry() - Starting triangulation`)
  console.log(`${LOG_PREFIX}   linearDeflection: ${linearDeflection}, angularDeflection: ${angularDeflection}`)
  
  // Mesh the shape for visualization
  const mesher = new oc.BRepMesh_IncrementalMesh_2(
    shape,
    linearDeflection,
    false,
    angularDeflection,
    false
  )
  console.log(`${LOG_PREFIX}   Mesher created, IsDone: ${mesher.IsDone()}`)

  const vertices = []
  const indices = []
  let faceCount = 0
  let totalTriangles = 0

  // Topology mapping data structures
  const faces = new Map() // faceId -> { triangleStart, triangleCount, area, surfaceType, bbox, adjacentFaces }
  const triangleToFace = [] // triangleIndex -> faceId
  const edges = new Map() // edgeId -> { vertices, length, curveType, adjacentFaces, bbox }
  const vertexMap = new Map() // vertexId -> { position }
  const edgeAdjacencyMap = new Map() // edgeHash -> Set(faceId)

  // Iterate through all faces
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  let indexOffset = 0
  let triangleIndex = 0

  while (faceExplorer.More()) {
    const faceId = `face-${faceCount}`
    const face = oc.TopoDS.Face_1(faceExplorer.Current())
    const location = new oc.TopLoc_Location_1()
    const triangulation = oc.BRep_Tool.Triangulation(face, location)

    const triangleStart = triangleIndex
    let faceArea = 0
    let surfaceType = 'other'
    const faceMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    const faceMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]

    // Build adjacency data for this face via its edges
    const faceEdgeExplorer = new oc.TopExp_Explorer_2(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )
    while (faceEdgeExplorer.More()) {
      const edgeHash = faceEdgeExplorer.Current().HashCode(2147483647)
      if (!edgeAdjacencyMap.has(edgeHash)) {
        edgeAdjacencyMap.set(edgeHash, new Set())
      }
      edgeAdjacencyMap.get(edgeHash).add(faceId)
      faceEdgeExplorer.Next()
    }

    if (!triangulation.IsNull()) {
      const tri = triangulation.get()
      const transform = location.Transformation()
      try {
        const surfaceHandle = oc.BRep_Tool.Surface_2(face)
        surfaceType = surfaceHandle?.IsNull?.()
          ? 'other'
          : (surfaceHandle.get()?.DynamicType?.()?.get?.()?.Name?.() || 'other')
      } catch (e) {
        surfaceType = 'other'
      }
      
      // Check face orientation
      const orientation = face.Orientation_1()
      const reversed = orientation === oc.TopAbs_Orientation.TopAbs_REVERSED

      // Get nodes (vertices)
      const nbNodes = tri.NbNodes()
      for (let i = 1; i <= nbNodes; i++) {
        const node = tri.Node(i)
        const transformedNode = node.Transformed(transform)
        const x = transformedNode.X()
        const y = transformedNode.Y()
        const z = transformedNode.Z()
        faceMin[0] = Math.min(faceMin[0], x)
        faceMin[1] = Math.min(faceMin[1], y)
        faceMin[2] = Math.min(faceMin[2], z)
        faceMax[0] = Math.max(faceMax[0], x)
        faceMax[1] = Math.max(faceMax[1], y)
        faceMax[2] = Math.max(faceMax[2], z)
        vertices.push(x, y, z)
      }

      // Get triangles and calculate face area
      const nbTriangles = tri.NbTriangles()
      totalTriangles += nbTriangles
      for (let i = 1; i <= nbTriangles; i++) {
        const triangle = tri.Triangle(i)
        let n1 = triangle.Value(1) - 1 + indexOffset
        let n2 = triangle.Value(2) - 1 + indexOffset
        let n3 = triangle.Value(3) - 1 + indexOffset

        // Reverse winding if face is reversed
        if (reversed) {
          indices.push(n1, n3, n2)
        } else {
          indices.push(n1, n2, n3)
        }

        // Map this triangle to its face
        triangleToFace.push(faceId)
        triangleIndex++

        // Calculate triangle area for face area sum
        const v1Idx = n1 * 3
        const v2Idx = n2 * 3
        const v3Idx = n3 * 3
        faceArea += calculateTriangleArea(
          vertices[v1Idx], vertices[v1Idx + 1], vertices[v1Idx + 2],
          vertices[v2Idx], vertices[v2Idx + 1], vertices[v2Idx + 2],
          vertices[v3Idx], vertices[v3Idx + 1], vertices[v3Idx + 2]
        )
      }

      indexOffset += nbNodes
    } else {
      console.warn(`${LOG_PREFIX}   Face ${faceCount} has NULL triangulation`)
    }

    faces.set(faceId, {
      triangleStart,
      triangleCount: triangleIndex - triangleStart,
      area: faceArea,
      surfaceType,
      bbox: Number.isFinite(faceMin[0]) ? { min: faceMin, max: faceMax } : null,
      adjacentFaces: [],
    })

    faceCount++
    faceExplorer.Next()
  }

  // Extract edges from the shape
  let edgeCount = 0
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (edgeExplorer.More()) {
    const edgeId = `edge-${edgeCount}`
    const edgeHash = edgeExplorer.Current().HashCode(2147483647)
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current())
    
    try {
      // Get edge length using GProp
      const props = new oc.GProp_GProps_1()
      oc.BRepGProp.LinearProperties(edge, props, false, false)
      const length = props.Mass()

      // Get edge vertices (first and last)
      const curve = oc.BRep_Tool.Curve_2(edge, new oc.TopLoc_Location_1(), 0, 1)
      const firstParam = oc.BRep_Tool.Parameter_1(oc.TopExp.FirstVertex_1(edge, true), edge, null)
      const lastParam = oc.BRep_Tool.Parameter_1(oc.TopExp.LastVertex_1(edge, true), edge, null)
      
      if (!curve.IsNull()) {
        const curveHandle = curve.get()
        const curveType = curveHandle.DynamicType?.()?.get?.()?.Name?.() || 'other'
        const p1 = curveHandle.Value(firstParam)
        const p2 = curveHandle.Value(lastParam)
        const bbox = {
          min: [Math.min(p1.X(), p2.X()), Math.min(p1.Y(), p2.Y()), Math.min(p1.Z(), p2.Z())],
          max: [Math.max(p1.X(), p2.X()), Math.max(p1.Y(), p2.Y()), Math.max(p1.Z(), p2.Z())],
        }
        
        edges.set(edgeId, {
          vertices: [
            { x: p1.X(), y: p1.Y(), z: p1.Z() },
            { x: p2.X(), y: p2.Y(), z: p2.Z() },
          ],
          length,
          curveType,
          bbox,
          adjacentFaces: Array.from(edgeAdjacencyMap.get(edgeHash) || []),
        })
      } else {
        edges.set(edgeId, {
          vertices: [],
          length,
          curveType: 'other',
          bbox: null,
          adjacentFaces: Array.from(edgeAdjacencyMap.get(edgeHash) || []),
        })
      }
    } catch (e) {
      // Some edges may not have simple curve representation
      edges.set(edgeId, {
        vertices: [],
        length: 0,
        curveType: 'other',
        bbox: null,
        adjacentFaces: Array.from(edgeAdjacencyMap.get(edgeHash) || []),
      })
    }
    
    edgeCount++
    edgeExplorer.Next()
  }

  // Populate face-to-face adjacency via shared edges
  edgeAdjacencyMap.forEach((faceIdsSet) => {
    const faceIds = Array.from(faceIdsSet)
    for (let i = 0; i < faceIds.length; i += 1) {
      const source = faces.get(faceIds[i])
      if (!source) continue
      const nextAdj = new Set(source.adjacentFaces || [])
      for (let j = 0; j < faceIds.length; j += 1) {
        if (i === j) continue
        nextAdj.add(faceIds[j])
      }
      source.adjacentFaces = Array.from(nextAdj)
    }
  })

  // Extract vertices from the shape
  let vertexCount = 0
  const vertexExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (vertexExplorer.More()) {
    const vertexId = `vertex-${vertexCount}`
    const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current())
    
    try {
      const pnt = oc.BRep_Tool.Pnt(vertex)
      vertexMap.set(vertexId, {
        position: { x: pnt.X(), y: pnt.Y(), z: pnt.Z() },
      })
    } catch (e) {
      vertexMap.set(vertexId, { position: { x: 0, y: 0, z: 0 } })
    }
    
    vertexCount++
    vertexExplorer.Next()
  }

  console.log(`${LOG_PREFIX}   Processed ${faceCount} faces, ${edgeCount} edges, ${vertexCount} vertices`)
  console.log(`${LOG_PREFIX}   Total triangles: ${totalTriangles}`)
  console.log(`${LOG_PREFIX}   Vertices array length: ${vertices.length} (${vertices.length/3} points)`)
  console.log(`${LOG_PREFIX}   Indices array length: ${indices.length}`)

  // Create BufferGeometry
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  
  // Compute bounding box for debugging
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  console.log(`${LOG_PREFIX}   BoundingBox: (${bb.min.x.toFixed(2)}, ${bb.min.y.toFixed(2)}, ${bb.min.z.toFixed(2)}) to (${bb.max.x.toFixed(2)}, ${bb.max.y.toFixed(2)}, ${bb.max.z.toFixed(2)})`)

  // Create topology map
  const topologyMap = {
    faces,
    triangleToFace,
    edges,
    vertices: vertexMap,
  }

  return { geometry, topologyMap }
}

/**
 * Calculate triangle area from 3 vertices
 */
function calculateTriangleArea(x1, y1, z1, x2, y2, z2, x3, y3, z3) {
  const ax = x2 - x1, ay = y2 - y1, az = z2 - z1
  const bx = x3 - x1, by = y3 - y1, bz = z3 - z1
  const cx = ay * bz - az * by
  const cy = az * bx - ax * bz
  const cz = ax * by - ay * bx
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
}

/**
 * Create a shape from definition object
 */
export function createShape(definition) {
  const { type, params } = definition

  switch (type) {
    case 'box':
      return makeBox(params.width || 1, params.height || 1, params.depth || 1)
    case 'cylinder':
      return makeCylinder(params.radius || 0.5, params.height || 1)
    case 'sphere':
      return makeSphere(params.radius || 0.5)
    case 'cone':
      return makeCone(params.radius1 || 0.5, params.radius2 || 0, params.height || 1)
    default:
      throw new Error(`Unknown shape type: ${type}`)
  }
}

/**
 * Create a Three.js mesh from shape definition
 */
export function createMeshFromDefinition(definition, material) {
  const shape = createShape(definition)
  const geometry = shapeToGeometry(shape)
  
  const defaultMaterial = material || new THREE.MeshStandardMaterial({
    color: definition.color || 0x4a90d9,
    metalness: 0.1,
    roughness: 0.5,
  })

  const mesh = new THREE.Mesh(geometry, defaultMaterial)
  
  if (definition.position) {
    mesh.position.set(
      definition.position.x || 0,
      definition.position.y || 0,
      definition.position.z || 0
    )
  }

  return mesh
}
