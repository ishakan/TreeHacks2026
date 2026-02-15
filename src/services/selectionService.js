import * as THREE from 'three'

const LOG_PREFIX = '[SelectionService]'

/**
 * Perform raycasting against meshes and return hit information
 * @param {THREE.Vector2} mouse - Normalized mouse coordinates (-1 to 1)
 * @param {THREE.Camera} camera - The camera
 * @param {THREE.Mesh[]} meshes - Array of meshes to test
 * @returns {Object|null} - { mesh, point, faceIndex, distance } or null
 */
export function raycastMeshes(mouse, camera, meshes) {
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(mouse, camera)
  
  const intersects = raycaster.intersectObjects(meshes, false)
  
  if (intersects.length > 0) {
    const hit = intersects[0]
    return {
      mesh: hit.object,
      point: hit.point,
      faceIndex: hit.faceIndex,
      distance: hit.distance,
    }
  }
  
  return null
}

/**
 * Get the face ID from a triangle index using topology map
 * @param {number} triangleIndex - Index of the triangle hit
 * @param {Object} topologyMap - The topology map from shapeToGeometry
 * @returns {string|null} - Face ID or null
 */
export function getFaceIdFromTriangle(triangleIndex, topologyMap) {
  if (!topologyMap?.triangleToFace) return null
  return topologyMap.triangleToFace[triangleIndex] || null
}

/**
 * Find the nearest edge to a point on a mesh
 * @param {THREE.Vector3} point - The hit point
 * @param {Object} topologyMap - The topology map
 * @param {number} threshold - Distance threshold for edge selection
 * @returns {Object|null} - { edgeId, distance } or null
 */
export function findNearestEdge(point, topologyMap, threshold = 0.1) {
  if (!topologyMap?.edges) return null
  
  let nearestEdge = null
  let minDistance = Infinity
  
  topologyMap.edges.forEach((edgeData, edgeId) => {
    if (edgeData.vertices.length < 2) return
    
    const v1 = new THREE.Vector3(
      edgeData.vertices[0].x,
      edgeData.vertices[0].y,
      edgeData.vertices[0].z
    )
    const v2 = new THREE.Vector3(
      edgeData.vertices[1].x,
      edgeData.vertices[1].y,
      edgeData.vertices[1].z
    )
    
    // Calculate distance from point to line segment
    const dist = distanceToLineSegment(point, v1, v2)
    
    if (dist < minDistance && dist < threshold) {
      minDistance = dist
      nearestEdge = { edgeId, distance: dist }
    }
  })
  
  return nearestEdge
}

/**
 * Find the nearest vertex to a point
 * @param {THREE.Vector3} point - The hit point
 * @param {Object} topologyMap - The topology map
 * @param {number} threshold - Distance threshold for vertex selection
 * @returns {Object|null} - { vertexId, distance, position } or null
 */
export function findNearestVertex(point, topologyMap, threshold = 0.15) {
  if (!topologyMap?.vertices) return null
  
  let nearestVertex = null
  let minDistance = Infinity
  
  topologyMap.vertices.forEach((vertexData, vertexId) => {
    const pos = vertexData.position
    const v = new THREE.Vector3(pos.x, pos.y, pos.z)
    const dist = point.distanceTo(v)
    
    if (dist < minDistance && dist < threshold) {
      minDistance = dist
      nearestVertex = { vertexId, distance: dist, position: pos }
    }
  })
  
  return nearestVertex
}

/**
 * Calculate distance from a point to a line segment
 * @param {THREE.Vector3} point - The point
 * @param {THREE.Vector3} v1 - Line segment start
 * @param {THREE.Vector3} v2 - Line segment end
 * @returns {number} - Distance
 */
function distanceToLineSegment(point, v1, v2) {
  const line = new THREE.Vector3().subVectors(v2, v1)
  const len = line.length()
  
  if (len === 0) return point.distanceTo(v1)
  
  line.normalize()
  
  const v1ToPoint = new THREE.Vector3().subVectors(point, v1)
  const t = Math.max(0, Math.min(len, v1ToPoint.dot(line)))
  
  const projection = new THREE.Vector3().copy(v1).add(line.multiplyScalar(t))
  return point.distanceTo(projection)
}

/**
 * Perform selection based on raycast hit and selection mode
 * @param {Object} hit - Raycast hit result
 * @param {string} shapeId - ID of the hit shape
 * @param {Object} topologyMap - Topology map for the shape
 * @param {string} selectionMode - 'face', 'edge', 'vertex', or 'solid'
 * @returns {Object|null} - { type, id } or null
 */
export function getSelectionFromHit(hit, shapeId, topologyMap, selectionMode) {
  if (!hit || !topologyMap) return null
  
  switch (selectionMode) {
    case 'face': {
      const faceId = getFaceIdFromTriangle(hit.faceIndex, topologyMap)
      if (faceId) {
        return { type: 'face', id: faceId }
      }
      break
    }
    
    case 'edge': {
      const nearestEdge = findNearestEdge(hit.point, topologyMap, 0.2)
      if (nearestEdge) {
        return { type: 'edge', id: nearestEdge.edgeId }
      }
      break
    }
    
    case 'vertex': {
      const nearestVertex = findNearestVertex(hit.point, topologyMap, 0.25)
      if (nearestVertex) {
        return { type: 'vertex', id: nearestVertex.vertexId }
      }
      // Fallback to edge, then face
      const nearestEdge = findNearestEdge(hit.point, topologyMap, 0.2)
      if (nearestEdge) {
        return { type: 'edge', id: nearestEdge.edgeId }
      }
      const faceId = getFaceIdFromTriangle(hit.faceIndex, topologyMap)
      if (faceId) {
        return { type: 'face', id: faceId }
      }
      break
    }
    
    case 'solid': {
      return { type: 'solid', id: shapeId }
    }
    case 'body': {
      return { type: 'body', id: shapeId }
    }
    
    default:
      return null
  }
  
  return null
}

/**
 * Create highlight colors for selection states
 */
export const SelectionColors = {
  HOVER: 0x88ccff,       // Light blue for hover
  SELECTED: 0xffaa00,    // Orange for selected
  MULTI_SELECTED: 0xff6600, // Darker orange for multi-select
}

/**
 * Get triangle indices for a specific face
 * @param {string} faceId - The face ID
 * @param {Object} topologyMap - The topology map
 * @returns {number[]} - Array of triangle indices
 */
export function getTrianglesForFace(faceId, topologyMap) {
  if (!topologyMap?.faces || !topologyMap?.triangleToFace) return []
  
  const faceData = topologyMap.faces.get(faceId)
  if (!faceData) return []
  
  const triangles = []
  for (let i = faceData.triangleStart; i < faceData.triangleStart + faceData.triangleCount; i++) {
    triangles.push(i)
  }
  return triangles
}

/**
 * Convert screen coordinates to normalized device coordinates
 * @param {number} x - Screen X coordinate
 * @param {number} y - Screen Y coordinate
 * @param {DOMRect} rect - Canvas bounding rect
 * @returns {THREE.Vector2} - Normalized coordinates
 */
export function screenToNDC(x, y, rect) {
  return new THREE.Vector2(
    ((x - rect.left) / rect.width) * 2 - 1,
    -((y - rect.top) / rect.height) * 2 + 1
  )
}
