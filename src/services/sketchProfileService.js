const EPS = 1e-6

function toPointKey(x, y, precision = 6) {
  return `${Number(x).toFixed(precision)}:${Number(y).toFixed(precision)}`
}

function ensureNodeId(node, fallbackX, fallbackY) {
  if (node?.id) return node.id
  return `pt:${toPointKey(fallbackX, fallbackY)}`
}

function shoelaceArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area * 0.5)
}

function extractClosedLineLoops(entities) {
  const lineEntities = (entities || []).filter((entity) => entity?.type === 'line')
  if (lineEntities.length < 3) return []

  const nodes = new Map()
  const edges = []
  const adjacency = new Map()

  lineEntities.forEach((line, index) => {
    const p1 = line?.p1 || {}
    const p2 = line?.p2 || {}
    const aId = ensureNodeId(p1, p1.x, p1.y)
    const bId = ensureNodeId(p2, p2.x, p2.y)
    if (!Number.isFinite(p1.x) || !Number.isFinite(p1.y) || !Number.isFinite(p2.x) || !Number.isFinite(p2.y)) return
    if (aId === bId) return

    nodes.set(aId, [Number(p1.x), Number(p1.y)])
    nodes.set(bId, [Number(p2.x), Number(p2.y)])

    const edge = { id: line.id || `line-${index}`, a: aId, b: bId }
    const edgeIndex = edges.length
    edges.push(edge)

    if (!adjacency.has(aId)) adjacency.set(aId, [])
    if (!adjacency.has(bId)) adjacency.set(bId, [])
    adjacency.get(aId).push(edgeIndex)
    adjacency.get(bId).push(edgeIndex)
  })

  const loops = []
  const visitedEdges = new Set()

  for (let startEdgeIndex = 0; startEdgeIndex < edges.length; startEdgeIndex += 1) {
    if (visitedEdges.has(startEdgeIndex)) continue

    const componentEdgeIndices = []
    const stack = [startEdgeIndex]
    const componentNodeIds = new Set()

    while (stack.length > 0) {
      const edgeIndex = stack.pop()
      if (visitedEdges.has(edgeIndex)) continue
      visitedEdges.add(edgeIndex)
      componentEdgeIndices.push(edgeIndex)
      const edge = edges[edgeIndex]
      componentNodeIds.add(edge.a)
      componentNodeIds.add(edge.b)

      const neighborsA = adjacency.get(edge.a) || []
      const neighborsB = adjacency.get(edge.b) || []
      neighborsA.forEach((neighbor) => {
        if (!visitedEdges.has(neighbor)) stack.push(neighbor)
      })
      neighborsB.forEach((neighbor) => {
        if (!visitedEdges.has(neighbor)) stack.push(neighbor)
      })
    }

    if (componentEdgeIndices.length < 3) continue

    let allDegreeTwo = true
    componentNodeIds.forEach((nodeId) => {
      const degree = (adjacency.get(nodeId) || []).filter((edgeIndex) => componentEdgeIndices.includes(edgeIndex)).length
      if (degree !== 2) allDegreeTwo = false
    })
    if (!allDegreeTwo) continue

    const componentSet = new Set(componentEdgeIndices)
    const orderedNodeIds = []
    const used = new Set()
    const firstEdge = edges[componentEdgeIndices[0]]
    let currentNode = firstEdge.a
    let prevEdgeIndex = null
    orderedNodeIds.push(currentNode)

    while (true) {
      const candidates = (adjacency.get(currentNode) || []).filter((edgeIndex) => componentSet.has(edgeIndex) && edgeIndex !== prevEdgeIndex)
      const nextEdgeIndex = candidates.find((edgeIndex) => !used.has(edgeIndex))
      if (nextEdgeIndex === undefined) break
      used.add(nextEdgeIndex)
      const edge = edges[nextEdgeIndex]
      const nextNode = edge.a === currentNode ? edge.b : edge.a
      prevEdgeIndex = nextEdgeIndex
      currentNode = nextNode
      orderedNodeIds.push(currentNode)
      if (currentNode === orderedNodeIds[0]) break
    }

    if (orderedNodeIds.length < 4) continue
    if (orderedNodeIds[0] !== orderedNodeIds[orderedNodeIds.length - 1]) continue
    if (used.size !== componentEdgeIndices.length) continue

    const points = orderedNodeIds.slice(0, -1).map((nodeId) => nodes.get(nodeId)).filter(Boolean)
    if (points.length < 3) continue
    const area = shoelaceArea(points)
    if (area <= EPS) continue

    loops.push({
      type: 'polyline',
      points,
      area,
      edgeCount: componentEdgeIndices.length,
      wireKey: `loop:${componentEdgeIndices.map((edgeIndex) => edges[edgeIndex].id).sort().join('|')}`,
    })
  }

  return loops
}

export function getLargestClosedProfile(sketch) {
  const entities = Array.isArray(sketch?.entities) ? sketch.entities : []
  if (entities.length === 0) {
    return {
      ok: false,
      error: 'Sketch has no entities.',
      profile: null,
      wireKey: null,
    }
  }

  const circleProfiles = entities
    .filter((entity) => entity?.type === 'circle')
    .map((circle, index) => {
      const center = circle?.center || {}
      const radius = Number(circle?.radius)
      if (!Number.isFinite(radius) || radius <= EPS || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
        return null
      }
      return {
        type: 'circle',
        center: [Number(center.x), Number(center.y)],
        radius,
        area: Math.PI * radius * radius,
        wireKey: `circle:${circle.id || index}`,
      }
    })
    .filter(Boolean)

  const lineLoops = extractClosedLineLoops(entities)
  const candidates = [...circleProfiles, ...lineLoops].sort((a, b) => b.area - a.area)
  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'Profile not closed. Create a closed loop before extruding.',
      profile: null,
      wireKey: null,
    }
  }

  const winner = candidates[0]
  return {
    ok: true,
    error: null,
    profile: winner,
    wireKey: winner.wireKey,
  }
}
