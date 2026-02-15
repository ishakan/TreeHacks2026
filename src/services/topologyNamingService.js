/**
 * Topology Naming Service
 * 
 * Provides persistent identification for topological entities (faces, edges, vertices)
 * that remains stable across model regenerations. Uses a combination of:
 * - OpenCascade shape hashing
 * - Geometric descriptors (surface type, bounding box, centroid)
 * - Adjacency relationships (neighboring faces, bounding edges)
 * - Generation history (which feature created this element)
 */

import { getOCCT, isOCCTReady } from './occtService'

const LOG_PREFIX = '[TopologyNaming]'

// Surface type constants
export const SurfaceType = {
  PLANE: 'plane',
  CYLINDER: 'cylinder',
  CONE: 'cone',
  SPHERE: 'sphere',
  TORUS: 'torus',
  BEZIER: 'bezier',
  BSPLINE: 'bspline',
  REVOLUTION: 'revolution',
  EXTRUSION: 'extrusion',
  OFFSET: 'offset',
  OTHER: 'other',
}

// Curve type constants
export const CurveType = {
  LINE: 'line',
  CIRCLE: 'circle',
  ELLIPSE: 'ellipse',
  HYPERBOLA: 'hyperbola',
  PARABOLA: 'parabola',
  BEZIER: 'bezier',
  BSPLINE: 'bspline',
  OTHER: 'other',
}

/**
 * Generate a hash code for a shape using OCCT's HashCode
 * @param {TopoDS_Shape} shape - The shape to hash
 * @returns {number} - Hash code
 */
export function getShapeHash(shape) {
  if (!isOCCTReady()) return 0
  const oc = getOCCT()
  
  try {
    // OCCT shapes have a HashCode method
    return shape.HashCode(2147483647) // Max int for good distribution
  } catch (e) {
    console.warn(`${LOG_PREFIX} Failed to hash shape:`, e)
    return 0
  }
}

/**
 * Get the surface type for a face
 * @param {TopoDS_Face} face - The face
 * @returns {string} - Surface type from SurfaceType enum
 */
export function getSurfaceType(face) {
  if (!isOCCTReady()) return SurfaceType.OTHER
  const oc = getOCCT()
  
  try {
    const surface = oc.BRep_Tool.Surface_2(face)
    if (surface.IsNull()) return SurfaceType.OTHER
    
    const surfaceHandle = surface.get()
    
    // Check surface type using DynamicType
    const typeName = surfaceHandle.DynamicType().get().Name()
    
    if (typeName.includes('Geom_Plane')) return SurfaceType.PLANE
    if (typeName.includes('Geom_CylindricalSurface')) return SurfaceType.CYLINDER
    if (typeName.includes('Geom_ConicalSurface')) return SurfaceType.CONE
    if (typeName.includes('Geom_SphericalSurface')) return SurfaceType.SPHERE
    if (typeName.includes('Geom_ToroidalSurface')) return SurfaceType.TORUS
    if (typeName.includes('Geom_BezierSurface')) return SurfaceType.BEZIER
    if (typeName.includes('Geom_BSplineSurface')) return SurfaceType.BSPLINE
    if (typeName.includes('Geom_SurfaceOfRevolution')) return SurfaceType.REVOLUTION
    if (typeName.includes('Geom_SurfaceOfLinearExtrusion')) return SurfaceType.EXTRUSION
    if (typeName.includes('Geom_OffsetSurface')) return SurfaceType.OFFSET
    
    return SurfaceType.OTHER
  } catch (e) {
    return SurfaceType.OTHER
  }
}

/**
 * Get the curve type for an edge
 * @param {TopoDS_Edge} edge - The edge
 * @returns {string} - Curve type from CurveType enum
 */
export function getCurveType(edge) {
  if (!isOCCTReady()) return CurveType.OTHER
  const oc = getOCCT()
  
  try {
    const curve = oc.BRep_Tool.Curve_2(edge, new oc.TopLoc_Location_1(), 0, 1)
    if (curve.IsNull()) return CurveType.OTHER
    
    const curveHandle = curve.get()
    const typeName = curveHandle.DynamicType().get().Name()
    
    if (typeName.includes('Geom_Line')) return CurveType.LINE
    if (typeName.includes('Geom_Circle')) return CurveType.CIRCLE
    if (typeName.includes('Geom_Ellipse')) return CurveType.ELLIPSE
    if (typeName.includes('Geom_Hyperbola')) return CurveType.HYPERBOLA
    if (typeName.includes('Geom_Parabola')) return CurveType.PARABOLA
    if (typeName.includes('Geom_BezierCurve')) return CurveType.BEZIER
    if (typeName.includes('Geom_BSplineCurve')) return CurveType.BSPLINE
    
    return CurveType.OTHER
  } catch (e) {
    return CurveType.OTHER
  }
}

/**
 * Calculate centroid of a face
 * @param {TopoDS_Face} face - The face
 * @returns {{x: number, y: number, z: number}} - Centroid coordinates
 */
export function getFaceCentroid(face) {
  if (!isOCCTReady()) return { x: 0, y: 0, z: 0 }
  const oc = getOCCT()
  
  try {
    const props = new oc.GProp_GProps_1()
    oc.BRepGProp.SurfaceProperties_1(face, props, false, false)
    const centerOfMass = props.CentreOfMass()
    return {
      x: centerOfMass.X(),
      y: centerOfMass.Y(),
      z: centerOfMass.Z(),
    }
  } catch (e) {
    return { x: 0, y: 0, z: 0 }
  }
}

/**
 * Calculate bounding box for a face
 * @param {TopoDS_Face} face - The face
 * @returns {{min: {x,y,z}, max: {x,y,z}}} - Bounding box
 */
export function getFaceBoundingBox(face) {
  if (!isOCCTReady()) return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  const oc = getOCCT()
  
  try {
    const bbox = new oc.Bnd_Box_1()
    oc.BRepBndLib.Add(face, bbox, false)
    
    const xMin = { current: 0 }, yMin = { current: 0 }, zMin = { current: 0 }
    const xMax = { current: 0 }, yMax = { current: 0 }, zMax = { current: 0 }
    bbox.Get(xMin, yMin, zMin, xMax, yMax, zMax)
    
    return {
      min: { x: xMin.current, y: yMin.current, z: zMin.current },
      max: { x: xMax.current, y: yMax.current, z: zMax.current },
    }
  } catch (e) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  }
}

/**
 * Get neighboring faces for a given face (faces that share an edge)
 * @param {TopoDS_Face} face - The face
 * @param {TopoDS_Shape} shape - The parent shape
 * @returns {Array<{faceIndex: number, sharedEdgeCount: number}>} - Neighbor info
 */
export function getFaceNeighbors(face, shape) {
  if (!isOCCTReady()) return []
  const oc = getOCCT()
  
  try {
    const neighbors = []
    const faceHash = getShapeHash(face)
    
    // Get all edges of this face
    const faceEdges = new Set()
    const edgeExplorer = new oc.TopExp_Explorer_2(
      face,
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )
    while (edgeExplorer.More()) {
      faceEdges.add(getShapeHash(edgeExplorer.Current()))
      edgeExplorer.Next()
    }
    
    // Explore all faces in shape
    let faceIndex = 0
    const shapeExplorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )
    
    while (shapeExplorer.More()) {
      const otherFace = oc.TopoDS.Face_1(shapeExplorer.Current())
      const otherHash = getShapeHash(otherFace)
      
      if (otherHash !== faceHash) {
        // Count shared edges
        let sharedEdgeCount = 0
        const otherEdgeExplorer = new oc.TopExp_Explorer_2(
          otherFace,
          oc.TopAbs_ShapeEnum.TopAbs_EDGE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE
        )
        while (otherEdgeExplorer.More()) {
          if (faceEdges.has(getShapeHash(otherEdgeExplorer.Current()))) {
            sharedEdgeCount++
          }
          otherEdgeExplorer.Next()
        }
        
        if (sharedEdgeCount > 0) {
          neighbors.push({ faceIndex, sharedEdgeCount })
        }
      }
      
      faceIndex++
      shapeExplorer.Next()
    }
    
    return neighbors
  } catch (e) {
    console.warn(`${LOG_PREFIX} Failed to get face neighbors:`, e)
    return []
  }
}

/**
 * Get the faces adjacent to an edge
 * @param {TopoDS_Edge} edge - The edge
 * @param {TopoDS_Shape} shape - The parent shape
 * @returns {Array<number>} - Face indices
 */
export function getEdgeAdjacentFaces(edge, shape) {
  if (!isOCCTReady()) return []
  const oc = getOCCT()
  
  try {
    const adjacentFaces = []
    const edgeHash = getShapeHash(edge)
    
    let faceIndex = 0
    const faceExplorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_FACE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )
    
    while (faceExplorer.More()) {
      const face = oc.TopoDS.Face_1(faceExplorer.Current())
      
      // Check if this face contains the edge
      const edgeExplorer = new oc.TopExp_Explorer_2(
        face,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
      
      while (edgeExplorer.More()) {
        if (getShapeHash(edgeExplorer.Current()) === edgeHash) {
          adjacentFaces.push(faceIndex)
          break
        }
        edgeExplorer.Next()
      }
      
      faceIndex++
      faceExplorer.Next()
    }
    
    return adjacentFaces
  } catch (e) {
    return []
  }
}

/**
 * Create a persistent ID descriptor for a face
 * @param {TopoDS_Face} face - The face
 * @param {TopoDS_Shape} shape - The parent shape  
 * @param {number} faceIndex - Index of the face
 * @param {string} featureId - ID of the feature that created this face
 * @param {string} featureType - Type of feature (e.g., 'extrusion', 'box')
 * @returns {Object} - Persistent ID descriptor
 */
export function createFacePersistentId(face, shape, faceIndex, featureId, featureType) {
  const hash = getShapeHash(face)
  const surfaceType = getSurfaceType(face)
  const centroid = getFaceCentroid(face)
  const bbox = getFaceBoundingBox(face)
  const neighbors = getFaceNeighbors(face, shape)
  
  return {
    type: 'face',
    hash,
    localIndex: faceIndex,
    surfaceType,
    centroid,
    bbox,
    neighbors: neighbors.map(n => n.faceIndex),
    generation: {
      featureId,
      featureType,
      descriptor: `face_${surfaceType}_${faceIndex}_from_${featureType}`,
    },
    // Unique persistent ID combining feature + local description
    persistentId: `${featureId}:face:${surfaceType}:${faceIndex}`,
  }
}

/**
 * Create a persistent ID descriptor for an edge
 * @param {TopoDS_Edge} edge - The edge
 * @param {TopoDS_Shape} shape - The parent shape
 * @param {number} edgeIndex - Index of the edge
 * @param {string} featureId - ID of the feature that created this edge
 * @param {string} featureType - Type of feature
 * @returns {Object} - Persistent ID descriptor
 */
export function createEdgePersistentId(edge, shape, edgeIndex, featureId, featureType) {
  const hash = getShapeHash(edge)
  const curveType = getCurveType(edge)
  const adjacentFaces = getEdgeAdjacentFaces(edge, shape)
  
  return {
    type: 'edge',
    hash,
    localIndex: edgeIndex,
    curveType,
    adjacentFaces,
    generation: {
      featureId,
      featureType,
      descriptor: adjacentFaces.length === 2 
        ? `edge_${curveType}_between_faces_${adjacentFaces[0]}_${adjacentFaces[1]}`
        : `edge_${curveType}_${edgeIndex}_from_${featureType}`,
    },
    persistentId: `${featureId}:edge:${curveType}:${edgeIndex}`,
  }
}

/**
 * Create a persistent ID descriptor for a vertex
 * @param {TopoDS_Vertex} vertex - The vertex
 * @param {number} vertexIndex - Index of the vertex
 * @param {string} featureId - ID of the feature
 * @param {string} featureType - Type of feature
 * @returns {Object} - Persistent ID descriptor
 */
export function createVertexPersistentId(vertex, vertexIndex, featureId, featureType) {
  if (!isOCCTReady()) return null
  const oc = getOCCT()
  
  const hash = getShapeHash(vertex)
  let position = { x: 0, y: 0, z: 0 }
  
  try {
    const pnt = oc.BRep_Tool.Pnt(vertex)
    position = { x: pnt.X(), y: pnt.Y(), z: pnt.Z() }
  } catch (e) {}
  
  return {
    type: 'vertex',
    hash,
    localIndex: vertexIndex,
    position,
    generation: {
      featureId,
      featureType,
      descriptor: `vertex_${vertexIndex}_at_${position.x.toFixed(2)}_${position.y.toFixed(2)}_${position.z.toFixed(2)}`,
    },
    persistentId: `${featureId}:vertex:${vertexIndex}`,
  }
}

/**
 * Calculate similarity score between two face descriptors
 * Used for re-matching after model regeneration
 * @param {Object} oldDesc - Old face descriptor
 * @param {Object} newDesc - New face descriptor
 * @returns {number} - Similarity score (0-1)
 */
export function calculateFaceSimilarity(oldDesc, newDesc) {
  let score = 0
  let weights = 0
  
  // Surface type match (weight: 0.3)
  if (oldDesc.surfaceType === newDesc.surfaceType) {
    score += 0.3
  }
  weights += 0.3
  
  // Centroid proximity (weight: 0.25)
  const centroidDist = Math.sqrt(
    Math.pow(oldDesc.centroid.x - newDesc.centroid.x, 2) +
    Math.pow(oldDesc.centroid.y - newDesc.centroid.y, 2) +
    Math.pow(oldDesc.centroid.z - newDesc.centroid.z, 2)
  )
  const centroidScore = Math.max(0, 1 - centroidDist / 5) // Normalize by 5 units
  score += 0.25 * centroidScore
  weights += 0.25
  
  // Bounding box similarity (weight: 0.25)
  const oldSize = {
    x: oldDesc.bbox.max.x - oldDesc.bbox.min.x,
    y: oldDesc.bbox.max.y - oldDesc.bbox.min.y,
    z: oldDesc.bbox.max.z - oldDesc.bbox.min.z,
  }
  const newSize = {
    x: newDesc.bbox.max.x - newDesc.bbox.min.x,
    y: newDesc.bbox.max.y - newDesc.bbox.min.y,
    z: newDesc.bbox.max.z - newDesc.bbox.min.z,
  }
  const sizeDiff = Math.sqrt(
    Math.pow(oldSize.x - newSize.x, 2) +
    Math.pow(oldSize.y - newSize.y, 2) +
    Math.pow(oldSize.z - newSize.z, 2)
  )
  const sizeScore = Math.max(0, 1 - sizeDiff / 5)
  score += 0.25 * sizeScore
  weights += 0.25
  
  // Neighbor count similarity (weight: 0.2)
  const neighborDiff = Math.abs(oldDesc.neighbors.length - newDesc.neighbors.length)
  const neighborScore = Math.max(0, 1 - neighborDiff / 4)
  score += 0.2 * neighborScore
  weights += 0.2
  
  return score / weights
}

/**
 * Calculate similarity score between two edge descriptors
 * @param {Object} oldDesc - Old edge descriptor
 * @param {Object} newDesc - New edge descriptor
 * @returns {number} - Similarity score (0-1)
 */
export function calculateEdgeSimilarity(oldDesc, newDesc) {
  let score = 0
  
  // Curve type match (weight: 0.4)
  if (oldDesc.curveType === newDesc.curveType) {
    score += 0.4
  }
  
  // Adjacent face count match (weight: 0.3)
  if (oldDesc.adjacentFaces.length === newDesc.adjacentFaces.length) {
    score += 0.3
  } else if (Math.abs(oldDesc.adjacentFaces.length - newDesc.adjacentFaces.length) === 1) {
    score += 0.15
  }
  
  // Same feature origin (weight: 0.3)
  if (oldDesc.generation?.featureId === newDesc.generation?.featureId) {
    score += 0.3
  }
  
  return score
}

/**
 * Re-match old topology references to new topology after model regeneration
 * @param {Map} oldPersistentIds - Map of old persistent ID -> descriptor
 * @param {Map} newPersistentIds - Map of new persistent ID -> descriptor  
 * @param {number} threshold - Minimum similarity score to consider a match (default 0.6)
 * @returns {Map} - Map of old persistent ID -> new persistent ID (or null if no match)
 */
export function rematchTopology(oldPersistentIds, newPersistentIds, threshold = 0.6) {
  const matches = new Map()
  const usedNewIds = new Set()
  
  console.log(`${LOG_PREFIX} Re-matching ${oldPersistentIds.size} old IDs to ${newPersistentIds.size} new IDs`)
  
  // Process faces first, then edges, then vertices
  const typeOrder = ['face', 'edge', 'vertex']
  
  for (const type of typeOrder) {
    const oldOfType = [...oldPersistentIds.entries()].filter(([, desc]) => desc.type === type)
    const newOfType = [...newPersistentIds.entries()].filter(([, desc]) => desc.type === type)
    
    for (const [oldId, oldDesc] of oldOfType) {
      let bestMatch = null
      let bestScore = threshold
      
      for (const [newId, newDesc] of newOfType) {
        if (usedNewIds.has(newId)) continue
        
        let similarity
        if (type === 'face') {
          similarity = calculateFaceSimilarity(oldDesc, newDesc)
        } else if (type === 'edge') {
          similarity = calculateEdgeSimilarity(oldDesc, newDesc)
        } else {
          // Vertex matching: primarily by position
          const dist = Math.sqrt(
            Math.pow(oldDesc.position.x - newDesc.position.x, 2) +
            Math.pow(oldDesc.position.y - newDesc.position.y, 2) +
            Math.pow(oldDesc.position.z - newDesc.position.z, 2)
          )
          similarity = Math.max(0, 1 - dist / 0.1) // Very tight tolerance for vertices
        }
        
        if (similarity > bestScore) {
          bestScore = similarity
          bestMatch = newId
        }
      }
      
      if (bestMatch) {
        matches.set(oldId, { newId: bestMatch, confidence: bestScore })
        usedNewIds.add(bestMatch)
        console.log(`${LOG_PREFIX} Matched ${oldId} -> ${bestMatch} (confidence: ${bestScore.toFixed(2)})`)
      } else {
        matches.set(oldId, null)
        console.log(`${LOG_PREFIX} No match found for ${oldId}`)
      }
    }
  }
  
  return matches
}

/**
 * Extract full topology with persistent IDs from a shape
 * @param {TopoDS_Shape} shape - The shape
 * @param {string} featureId - Feature ID
 * @param {string} featureType - Feature type
 * @returns {Object} - { faces: Map, edges: Map, vertices: Map }
 */
export function extractTopologyWithPersistentIds(shape, featureId, featureType) {
  if (!isOCCTReady()) return { faces: new Map(), edges: new Map(), vertices: new Map() }
  const oc = getOCCT()
  
  const faces = new Map()
  const edges = new Map()
  const vertices = new Map()
  
  // Extract faces
  let faceIndex = 0
  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )
  
  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current())
    const desc = createFacePersistentId(face, shape, faceIndex, featureId, featureType)
    faces.set(desc.persistentId, desc)
    faceIndex++
    faceExplorer.Next()
  }
  
  // Extract edges
  let edgeIndex = 0
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )
  
  while (edgeExplorer.More()) {
    const edge = oc.TopoDS.Edge_1(edgeExplorer.Current())
    const desc = createEdgePersistentId(edge, shape, edgeIndex, featureId, featureType)
    edges.set(desc.persistentId, desc)
    edgeIndex++
    edgeExplorer.Next()
  }
  
  // Extract vertices
  let vertexIndex = 0
  const vertexExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )
  
  while (vertexExplorer.More()) {
    const vertex = oc.TopoDS.Vertex_1(vertexExplorer.Current())
    const desc = createVertexPersistentId(vertex, vertexIndex, featureId, featureType)
    vertices.set(desc.persistentId, desc)
    vertexIndex++
    vertexExplorer.Next()
  }
  
  console.log(`${LOG_PREFIX} Extracted topology: ${faces.size} faces, ${edges.size} edges, ${vertices.size} vertices`)
  
  return { faces, edges, vertices }
}
