/**
 * Persistent Selection References
 *
 * Solves the problem of topology references becoming invalid after rebuild.
 *
 * Strategy:
 * 1. Create geometric signatures for faces/edges (surface type, area/length, centroid, bbox)
 * 2. Store adjacency information (neighbor faces/edges)
 * 3. During rebuild, attempt to remap references using signatures + adjacency
 * 4. If remap fails, mark feature as "needs repair" and highlight missing refs
 */

import { getOCCT } from './occtService'
import * as THREE from 'three'

export interface SelectionRef {
  kind: 'FACE' | 'EDGE' | 'VERTEX' | 'BODY'
  bodyId: string
  persistentId: string
  signature: GeometricSignature
  hints?: {
    adjacentFaces?: string[]
    adjacentEdges?: string[]
    index?: number
  }
}

export interface GeometricSignature {
  // For faces
  surfaceType?: string
  area?: number
  centroid?: [number, number, number]
  normal?: [number, number, number]
  bbox?: {
    min: [number, number, number]
    max: [number, number, number]
  }

  // For edges
  curveType?: string
  length?: number
  midpoint?: [number, number, number]
  direction?: [number, number, number]

  // For vertices
  point?: [number, number, number]
}

/**
 * Create a selection reference from a TopoDS shape
 */
export function createSelectionRef(
  kind: 'FACE' | 'EDGE' | 'VERTEX' | 'BODY',
  bodyId: string,
  shape: any,
  topologyMap?: any,
  index?: number
): SelectionRef {
  const signature = computeGeometricSignature(kind, shape)
  const persistentId = generatePersistentId(kind, signature, index)

  return {
    kind,
    bodyId,
    persistentId,
    signature,
    hints: {
      index,
    },
  }
}

/**
 * Compute geometric signature for a shape
 */
function computeGeometricSignature(
  kind: 'FACE' | 'EDGE' | 'VERTEX' | 'BODY',
  shape: any
): GeometricSignature {
  const oc = getOCCT()
  const signature: GeometricSignature = {}

  try {
    if (kind === 'FACE') {
      // Get face properties
      const face = oc.TopoDS.Face_1(shape)

      // Surface type
      const surface = oc.BRep_Tool.Surface_2(face)
      signature.surfaceType = getSurfaceTypeName(surface)

      // Compute area
      try {
        const props = new oc.GProp_GProps_1()
        oc.BRepGProp.SurfaceProperties_1(face, props, false, false)
        signature.area = props.Mass()

        // Centroid
        const center = props.CentreOfMass()
        signature.centroid = [center.X(), center.Y(), center.Z()]
      } catch (e) {
        console.warn('[SelectionRef] Could not compute face properties:', e)
      }

      // Normal at centroid
      try {
        if (signature.centroid) {
          const [u, v] = [0.5, 0.5] // UV params at center (approximate)
          const normalCalc = new oc.GeomLProp_SLProps_2(surface, u, v, 1, 1e-6)
          if (normalCalc.IsNormalDefined()) {
            const normal = normalCalc.Normal()
            signature.normal = [normal.X(), normal.Y(), normal.Z()]
          }
        }
      } catch (e) {
        console.warn('[SelectionRef] Could not compute face normal:', e)
      }

      // Bounding box
      try {
        const bbox = new oc.Bnd_Box_1()
        oc.BRepBndLib.Add(face, bbox, false)
        const min = bbox.CornerMin()
        const max = bbox.CornerMax()
        signature.bbox = {
          min: [min.X(), min.Y(), min.Z()],
          max: [max.X(), max.Y(), max.Z()],
        }
      } catch (e) {
        console.warn('[SelectionRef] Could not compute bbox:', e)
      }
    } else if (kind === 'EDGE') {
      // Get edge properties
      const edge = oc.TopoDS.Edge_1(shape)

      // Curve type
      const curve = oc.BRep_Tool.Curve_2(edge, null, null)
      signature.curveType = getCurveTypeName(curve)

      // Compute length
      try {
        const props = new oc.GProp_GProps_1()
        oc.BRepGProp.LinearProperties_1(edge, props, false, false)
        signature.length = props.Mass()

        // Centroid (midpoint)
        const center = props.CentreOfMass()
        signature.midpoint = [center.X(), center.Y(), center.Z()]
      } catch (e) {
        console.warn('[SelectionRef] Could not compute edge properties:', e)
      }

      // Direction
      try {
        if (signature.midpoint) {
          const [t] = [0.5] // Parameter at midpoint (approximate)
          const point = new oc.gp_Pnt_1()
          const vec = new oc.gp_Vec_1()
          curve.D1(t, point, vec)
          signature.direction = [vec.X(), vec.Y(), vec.Z()]
        }
      } catch (e) {
        console.warn('[SelectionRef] Could not compute edge direction:', e)
      }

      // Bounding box
      try {
        const bbox = new oc.Bnd_Box_1()
        oc.BRepBndLib.Add(edge, bbox, false)
        const min = bbox.CornerMin()
        const max = bbox.CornerMax()
        signature.bbox = {
          min: [min.X(), min.Y(), min.Z()],
          max: [max.X(), max.Y(), max.Z()],
        }
      } catch (e) {
        console.warn('[SelectionRef] Could not compute bbox:', e)
      }
    } else if (kind === 'VERTEX') {
      // Get vertex point
      const vertex = oc.TopoDS.Vertex_1(shape)
      const point = oc.BRep_Tool.Pnt(vertex)
      signature.point = [point.X(), point.Y(), point.Z()]
    }
  } catch (error) {
    console.error(`[SelectionRef] Error computing signature for ${kind}:`, error)
  }

  return signature
}

/**
 * Generate persistent ID from signature
 */
function generatePersistentId(
  kind: string,
  signature: GeometricSignature,
  index?: number
): string {
  // Create a deterministic ID based on geometric properties
  const parts: string[] = [kind]

  if (signature.area !== undefined) {
    parts.push(`a${signature.area.toFixed(6)}`)
  }
  if (signature.length !== undefined) {
    parts.push(`l${signature.length.toFixed(6)}`)
  }
  if (signature.centroid) {
    parts.push(
      `c${signature.centroid[0].toFixed(3)},${signature.centroid[1].toFixed(3)},${signature.centroid[2].toFixed(3)}`
    )
  }
  if (signature.midpoint) {
    parts.push(
      `m${signature.midpoint[0].toFixed(3)},${signature.midpoint[1].toFixed(3)},${signature.midpoint[2].toFixed(3)}`
    )
  }
  if (signature.point) {
    parts.push(
      `p${signature.point[0].toFixed(3)},${signature.point[1].toFixed(3)},${signature.point[2].toFixed(3)}`
    )
  }
  if (signature.surfaceType) {
    parts.push(`s${signature.surfaceType}`)
  }
  if (signature.curveType) {
    parts.push(`t${signature.curveType}`)
  }
  if (index !== undefined) {
    parts.push(`i${index}`)
  }

  return parts.join('_')
}

/**
 * Attempt to remap a selection reference to new topology
 * @param ref - Selection reference to remap
 * @param newShape - New shape after rebuild
 * @param newTopologyMap - New topology map
 * @returns Remapped shape or null if not found
 */
export function remapSelectionRef(
  ref: SelectionRef,
  newShape: any,
  newTopologyMap?: any
): { shape: any; confidence: number } | null {
  const oc = getOCCT()

  try {
    if (ref.kind === 'FACE') {
      // Collect all faces from new shape
      const faces = collectFacesWithSignatures(newShape)

      // Find best match by signature
      let bestMatch: any = null
      let bestScore = 0

      for (const { face, signature } of faces) {
        const score = matchSignatures(ref.signature, signature)
        if (score > bestScore) {
          bestScore = score
          bestMatch = face
        }
      }

      if (bestMatch && bestScore > 0.8) {
        // Good match
        return { shape: bestMatch, confidence: bestScore }
      }

      return null
    } else if (ref.kind === 'EDGE') {
      // Collect all edges from new shape
      const edges = collectEdgesWithSignatures(newShape)

      // Find best match
      let bestMatch: any = null
      let bestScore = 0

      for (const { edge, signature } of edges) {
        const score = matchSignatures(ref.signature, signature)
        if (score > bestScore) {
          bestScore = score
          bestMatch = edge
        }
      }

      if (bestMatch && bestScore > 0.8) {
        return { shape: bestMatch, confidence: bestScore }
      }

      return null
    } else if (ref.kind === 'VERTEX') {
      // Collect all vertices
      const vertices = collectVerticesWithSignatures(newShape)

      // Find closest vertex
      let bestMatch: any = null
      let bestScore = 0

      for (const { vertex, signature } of vertices) {
        const score = matchSignatures(ref.signature, signature)
        if (score > bestScore) {
          bestScore = score
          bestMatch = vertex
        }
      }

      if (bestMatch && bestScore > 0.99) {
        // Vertices need higher threshold
        return { shape: bestMatch, confidence: bestScore }
      }

      return null
    }
  } catch (error) {
    console.error('[SelectionRef] Error remapping reference:', error)
  }

  return null
}

/**
 * Match two geometric signatures and return similarity score (0-1)
 */
function matchSignatures(sig1: GeometricSignature, sig2: GeometricSignature): number {
  let score = 0
  let weights = 0

  // Surface/curve type must match
  if (sig1.surfaceType && sig2.surfaceType) {
    if (sig1.surfaceType === sig2.surfaceType) {
      score += 0.3
    } else {
      return 0 // Type mismatch
    }
    weights += 0.3
  }

  if (sig1.curveType && sig2.curveType) {
    if (sig1.curveType === sig2.curveType) {
      score += 0.3
    } else {
      return 0 // Type mismatch
    }
    weights += 0.3
  }

  // Area/length similarity
  if (sig1.area !== undefined && sig2.area !== undefined) {
    const areaDiff = Math.abs(sig1.area - sig2.area) / Math.max(sig1.area, sig2.area)
    score += (1 - areaDiff) * 0.3
    weights += 0.3
  }

  if (sig1.length !== undefined && sig2.length !== undefined) {
    const lengthDiff = Math.abs(sig1.length - sig2.length) / Math.max(sig1.length, sig2.length)
    score += (1 - lengthDiff) * 0.3
    weights += 0.3
  }

  // Centroid/midpoint similarity
  if (sig1.centroid && sig2.centroid) {
    const dist = Math.sqrt(
      Math.pow(sig1.centroid[0] - sig2.centroid[0], 2) +
        Math.pow(sig1.centroid[1] - sig2.centroid[1], 2) +
        Math.pow(sig1.centroid[2] - sig2.centroid[2], 2)
    )
    // Normalize by typical model size (assume 10 units)
    const normalizedDist = Math.min(dist / 10, 1)
    score += (1 - normalizedDist) * 0.4
    weights += 0.4
  }

  if (sig1.midpoint && sig2.midpoint) {
    const dist = Math.sqrt(
      Math.pow(sig1.midpoint[0] - sig2.midpoint[0], 2) +
        Math.pow(sig1.midpoint[1] - sig2.midpoint[1], 2) +
        Math.pow(sig1.midpoint[2] - sig2.midpoint[2], 2)
    )
    const normalizedDist = Math.min(dist / 10, 1)
    score += (1 - normalizedDist) * 0.4
    weights += 0.4
  }

  if (sig1.point && sig2.point) {
    const dist = Math.sqrt(
      Math.pow(sig1.point[0] - sig2.point[0], 2) +
        Math.pow(sig1.point[1] - sig2.point[1], 2) +
        Math.pow(sig1.point[2] - sig2.point[2], 2)
    )
    const normalizedDist = Math.min(dist / 0.01, 1) // Vertices need tighter tolerance
    score += (1 - normalizedDist) * 1.0
    weights += 1.0
  }

  return weights > 0 ? score / weights : 0
}

/**
 * Collect all faces with signatures
 */
function collectFacesWithSignatures(shape: any): Array<{ face: any; signature: GeometricSignature }> {
  const oc = getOCCT()
  const faces: Array<{ face: any; signature: GeometricSignature }> = []

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current())
    const signature = computeGeometricSignature('FACE', face)
    faces.push({ face, signature })
    explorer.Next()
  }

  return faces
}

/**
 * Collect all edges with signatures
 */
function collectEdgesWithSignatures(shape: any): Array<{ edge: any; signature: GeometricSignature }> {
  const oc = getOCCT()
  const edges: Array<{ edge: any; signature: GeometricSignature }> = []

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current())
    const signature = computeGeometricSignature('EDGE', edge)
    edges.push({ edge, signature })
    explorer.Next()
  }

  return edges
}

/**
 * Collect all vertices with signatures
 */
function collectVerticesWithSignatures(
  shape: any
): Array<{ vertex: any; signature: GeometricSignature }> {
  const oc = getOCCT()
  const vertices: Array<{ vertex: any; signature: GeometricSignature }> = []

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (explorer.More()) {
    const vertex = oc.TopoDS.Vertex_1(explorer.Current())
    const signature = computeGeometricSignature('VERTEX', vertex)
    vertices.push({ vertex, signature })
    explorer.Next()
  }

  return vertices
}

/**
 * Get surface type name
 */
function getSurfaceTypeName(surface: any): string {
  const oc = getOCCT()

  try {
    const handle = surface.get()
    const typeName = handle.DynamicType().Name()
    return typeName
  } catch (e) {
    return 'Unknown'
  }
}

/**
 * Get curve type name
 */
function getCurveTypeName(curve: any): string {
  const oc = getOCCT()

  try {
    const handle = curve.get()
    const typeName = handle.DynamicType().Name()
    return typeName
  } catch (e) {
    return 'Unknown'
  }
}
