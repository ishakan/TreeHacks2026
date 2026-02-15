const FACE_KIND = 'FACE'
const EDGE_KIND = 'EDGE'
const BODY_KIND = 'BODY'

function computeBboxFromPoints(points) {
  if (!points || points.length === 0) return null
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const point of points) {
    min[0] = Math.min(min[0], point[0])
    min[1] = Math.min(min[1], point[1])
    min[2] = Math.min(min[2], point[2])
    max[0] = Math.max(max[0], point[0])
    max[1] = Math.max(max[1], point[1])
    max[2] = Math.max(max[2], point[2])
  }
  return { min, max }
}

function bboxDistance(a, b) {
  if (!a || !b) return 1
  const ca = [
    (a.min[0] + a.max[0]) * 0.5,
    (a.min[1] + a.max[1]) * 0.5,
    (a.min[2] + a.max[2]) * 0.5,
  ]
  const cb = [
    (b.min[0] + b.max[0]) * 0.5,
    (b.min[1] + b.max[1]) * 0.5,
    (b.min[2] + b.max[2]) * 0.5,
  ]
  const dx = ca[0] - cb[0]
  const dy = ca[1] - cb[1]
  const dz = ca[2] - cb[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function normalizedDifference(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return 0
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-8)
  return Math.abs(a - b) / denom
}

function setOverlapScore(a = [], b = []) {
  if (a.length === 0 && b.length === 0) return 1
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  setA.forEach((value) => {
    if (setB.has(value)) inter += 1
  })
  const union = setA.size + setB.size - inter
  return union > 0 ? inter / union : 0
}

export function createEdgeSelectionRef({ featureId = null, edgeId, edgeData }) {
  if (!edgeId || !edgeData) return null
  const points = (edgeData.vertices || []).map((vertex) => [vertex.x, vertex.y, vertex.z])
  const bbox = edgeData.bbox || computeBboxFromPoints(points)
  return {
    kind: EDGE_KIND,
    featureId: featureId || null,
    geometricSignature: {
      curveType: edgeData.curveType || 'other',
      length: edgeData.length ?? null,
      bbox: bbox || null,
    },
    adjacencyHints: {
      adjacentFaces: edgeData.adjacentFaces || [],
    },
    legacyEdgeId: edgeId,
  }
}

export function createFaceSelectionRef({ featureId = null, faceId, faceData }) {
  if (!faceId || !faceData) return null
  return {
    kind: FACE_KIND,
    featureId: featureId || null,
    geometricSignature: {
      surfaceType: faceData.surfaceType || 'other',
      area: faceData.area ?? null,
      bbox: faceData.bbox || null,
    },
    adjacencyHints: {
      adjacentFaces: faceData.adjacentFaces || [],
    },
    legacyFaceId: faceId,
  }
}

export function createBodySelectionRef({ featureId = null, bodyId }) {
  return {
    kind: BODY_KIND,
    featureId: featureId || null,
    geometricSignature: { bodyId },
    adjacencyHints: {},
  }
}

export function computeEdgeMatchScore(reference, candidate) {
  const refSig = reference?.geometricSignature || {}
  const candidateSig = candidate?.signature || {}
  const refHints = reference?.adjacencyHints || {}
  const candidateHints = candidate?.adjacencyHints || {}

  let score = 0
  let weight = 0

  if (refSig.curveType && candidateSig.curveType) {
    score += refSig.curveType === candidateSig.curveType ? 0.25 : 0
    weight += 0.25
  }
  if (Number.isFinite(refSig.length) && Number.isFinite(candidateSig.length)) {
    score += (1 - Math.min(1, normalizedDifference(refSig.length, candidateSig.length))) * 0.35
    weight += 0.35
  }
  if (refSig.bbox && candidateSig.bbox) {
    const dist = bboxDistance(refSig.bbox, candidateSig.bbox)
    score += Math.max(0, 1 - Math.min(1, dist / 2)) * 0.25
    weight += 0.25
  }
  if ((refHints.adjacentFaces || []).length > 0 || (candidateHints.adjacentFaces || []).length > 0) {
    score += setOverlapScore(refHints.adjacentFaces || [], candidateHints.adjacentFaces || []) * 0.15
    weight += 0.15
  }

  return weight > 0 ? score / weight : 0
}

export function computeFaceMatchScore(reference, candidate) {
  const refSig = reference?.geometricSignature || {}
  const candidateSig = candidate?.signature || {}
  const refHints = reference?.adjacencyHints || {}
  const candidateHints = candidate?.adjacencyHints || {}

  let score = 0
  let weight = 0

  if (refSig.surfaceType && candidateSig.surfaceType) {
    score += refSig.surfaceType === candidateSig.surfaceType ? 0.35 : 0
    weight += 0.35
  }
  if (Number.isFinite(refSig.area) && Number.isFinite(candidateSig.area)) {
    score += (1 - Math.min(1, normalizedDifference(refSig.area, candidateSig.area))) * 0.35
    weight += 0.35
  }
  if (refSig.bbox && candidateSig.bbox) {
    const dist = bboxDistance(refSig.bbox, candidateSig.bbox)
    score += Math.max(0, 1 - Math.min(1, dist / 3)) * 0.2
    weight += 0.2
  }
  if ((refHints.adjacentFaces || []).length > 0 || (candidateHints.adjacentFaces || []).length > 0) {
    score += setOverlapScore(refHints.adjacentFaces || [], candidateHints.adjacentFaces || []) * 0.1
    weight += 0.1
  }

  return weight > 0 ? score / weight : 0
}

export function buildEdgeCandidates(topologyMap) {
  const candidates = []
  const edges = topologyMap?.edges
  if (!edges?.forEach) return candidates

  edges.forEach((edgeData, edgeId) => {
    const points = (edgeData.vertices || []).map((vertex) => [vertex.x, vertex.y, vertex.z])
    const bbox = edgeData.bbox || computeBboxFromPoints(points)
    candidates.push({
      id: edgeId,
      signature: {
        curveType: edgeData.curveType || 'other',
        length: edgeData.length ?? null,
        bbox: bbox || null,
      },
      adjacencyHints: {
        adjacentFaces: edgeData.adjacentFaces || [],
      },
    })
  })
  return candidates
}

export function buildFaceCandidates(topologyMap) {
  const candidates = []
  const faces = topologyMap?.faces
  if (!faces?.forEach) return candidates

  faces.forEach((faceData, faceId) => {
    candidates.push({
      id: faceId,
      signature: {
        surfaceType: faceData.surfaceType || 'other',
        area: faceData.area ?? null,
        bbox: faceData.bbox || null,
      },
      adjacencyHints: {
        adjacentFaces: faceData.adjacentFaces || [],
      },
    })
  })
  return candidates
}

export function remapSelectionReference(reference, topologyMap) {
  if (!reference || !topologyMap) {
    return { matched: null, confidence: 0, reason: 'missing-topology' }
  }

  if (reference.kind === EDGE_KIND) {
    const candidates = buildEdgeCandidates(topologyMap)
    let best = null
    let score = 0
    for (const candidate of candidates) {
      const candidateScore = computeEdgeMatchScore(reference, candidate)
      if (candidateScore > score) {
        score = candidateScore
        best = candidate
      }
    }
    if (!best || score < 0.55) {
      return { matched: null, confidence: score, reason: 'edge-remap-failed' }
    }
    return { matched: best.id, confidence: score, reason: null }
  }

  if (reference.kind === FACE_KIND) {
    const candidates = buildFaceCandidates(topologyMap)
    let best = null
    let score = 0
    for (const candidate of candidates) {
      const candidateScore = computeFaceMatchScore(reference, candidate)
      if (candidateScore > score) {
        score = candidateScore
        best = candidate
      }
    }
    if (!best || score < 0.6) {
      return { matched: null, confidence: score, reason: 'face-remap-failed' }
    }
    return { matched: best.id, confidence: score, reason: null }
  }

  if (reference.kind === BODY_KIND) {
    return { matched: reference.geometricSignature?.bodyId || null, confidence: 1, reason: null }
  }

  return { matched: null, confidence: 0, reason: 'unsupported-kind' }
}
