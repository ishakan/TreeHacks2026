/**
 * Advanced Geometric Constraint Solver
 * Full-featured Cassowary-inspired solver for 2D sketch constraints
 * Supports: coincident, concentric, parallel, perpendicular, tangent, equal, 
 * midpoint, symmetric, fix, and all dimension types
 */

const LOG_PREFIX = '[ConstraintSolver]'

// Unique ID generator
let entityId = 0
const nextId = () => `entity-${++entityId}`
const resetIds = () => { entityId = 0 }

/**
 * Point class - represents a 2D point with x, y coordinates
 */
export class Point {
  constructor(x = 0, y = 0) {
    this.id = nextId()
    this.type = 'point'
    this.x = x
    this.y = y
    this.fixed = false
    this.construction = false // Construction geometry flag
  }

  distanceTo(other) {
    const dx = this.x - other.x
    const dy = this.y - other.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  clone() {
    const p = new Point(this.x, this.y)
    p.id = this.id
    p.fixed = this.fixed
    p.construction = this.construction
    return p
  }

  moveTo(x, y) {
    if (!this.fixed) {
      this.x = x
      this.y = y
    }
  }

  moveBy(dx, dy) {
    if (!this.fixed) {
      this.x += dx
      this.y += dy
    }
  }
}

/**
 * Line class - defined by two points
 */
export class Line {
  constructor(p1, p2) {
    this.id = nextId()
    this.type = 'line'
    this.p1 = p1
    this.p2 = p2
    this.construction = false
  }

  get length() {
    return this.p1.distanceTo(this.p2)
  }

  get midpoint() {
    return { x: (this.p1.x + this.p2.x) / 2, y: (this.p1.y + this.p2.y) / 2 }
  }

  get angle() {
    return Math.atan2(this.p2.y - this.p1.y, this.p2.x - this.p1.x)
  }

  get dx() { return this.p2.x - this.p1.x }
  get dy() { return this.p2.y - this.p1.y }

  // Get direction vector (normalized)
  get direction() {
    const len = this.length
    if (len === 0) return { x: 1, y: 0 }
    return { x: this.dx / len, y: this.dy / len }
  }

  // Get perpendicular vector
  get perpendicular() {
    const dir = this.direction
    return { x: -dir.y, y: dir.x }
  }

  // Point at parameter t (0 = p1, 1 = p2)
  pointAt(t) {
    return {
      x: this.p1.x + t * this.dx,
      y: this.p1.y + t * this.dy
    }
  }

  // Project point onto line, returns parameter t
  projectPoint(px, py) {
    const len2 = this.dx * this.dx + this.dy * this.dy
    if (len2 === 0) return 0
    return ((px - this.p1.x) * this.dx + (py - this.p1.y) * this.dy) / len2
  }

  // Distance from point to line
  distanceToPoint(px, py) {
    const t = Math.max(0, Math.min(1, this.projectPoint(px, py)))
    const closest = this.pointAt(t)
    return Math.sqrt((px - closest.x) ** 2 + (py - closest.y) ** 2)
  }

  moveBy(dx, dy) {
    this.p1.moveBy(dx, dy)
    this.p2.moveBy(dx, dy)
  }

  rotate(angle, cx, cy) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    
    if (!this.p1.fixed) {
      const x1 = this.p1.x - cx
      const y1 = this.p1.y - cy
      this.p1.x = cx + x1 * cos - y1 * sin
      this.p1.y = cy + x1 * sin + y1 * cos
    }
    if (!this.p2.fixed) {
      const x2 = this.p2.x - cx
      const y2 = this.p2.y - cy
      this.p2.x = cx + x2 * cos - y2 * sin
      this.p2.y = cy + x2 * sin + y2 * cos
    }
  }
}

/**
 * Arc class - defined by center, radius, start angle, end angle
 */
export class Arc {
  constructor(center, radius = 1, startAngle = 0, endAngle = Math.PI / 2) {
    this.id = nextId()
    this.type = 'arc'
    this.center = center
    this.radius = radius
    this.startAngle = startAngle
    this.endAngle = endAngle
    this.construction = false
  }

  get startPoint() {
    return {
      x: this.center.x + this.radius * Math.cos(this.startAngle),
      y: this.center.y + this.radius * Math.sin(this.startAngle)
    }
  }

  get endPoint() {
    return {
      x: this.center.x + this.radius * Math.cos(this.endAngle),
      y: this.center.y + this.radius * Math.sin(this.endAngle)
    }
  }

  get midAngle() {
    return (this.startAngle + this.endAngle) / 2
  }

  get arcLength() {
    return this.radius * Math.abs(this.endAngle - this.startAngle)
  }
}

/**
 * Circle class - defined by center point and radius
 */
export class Circle {
  constructor(center, radius = 1) {
    this.id = nextId()
    this.type = 'circle'
    this.center = center
    this.radius = radius
    this.construction = false
  }

  get diameter() { return this.radius * 2 }
  set diameter(d) { this.radius = d / 2 }

  get circumference() { return 2 * Math.PI * this.radius }
  get area() { return Math.PI * this.radius * this.radius }

  // Point on circle at angle (radians)
  pointAt(angle) {
    return {
      x: this.center.x + this.radius * Math.cos(angle),
      y: this.center.y + this.radius * Math.sin(angle)
    }
  }

  // Distance from point to circle edge
  distanceToPoint(px, py) {
    const distToCenter = Math.sqrt((px - this.center.x) ** 2 + (py - this.center.y) ** 2)
    return Math.abs(distToCenter - this.radius)
  }

  // Get tangent points from external point
  tangentPointsFrom(px, py) {
    const dx = px - this.center.x
    const dy = py - this.center.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    
    if (dist <= this.radius) return [] // Point inside circle
    
    const angle = Math.atan2(dy, dx)
    const tangentAngle = Math.acos(this.radius / dist)
    
    return [
      this.pointAt(angle + tangentAngle + Math.PI / 2),
      this.pointAt(angle - tangentAngle + Math.PI / 2)
    ]
  }
}

/**
 * Constraint types - comprehensive set
 */
export const ConstraintType = {
  // Geometric constraints
  COINCIDENT: 'coincident',       // Two points at same location
  CONCENTRIC: 'concentric',       // Two circles/arcs share center
  PARALLEL: 'parallel',           // Two lines parallel
  PERPENDICULAR: 'perpendicular', // Two lines at 90°
  TANGENT: 'tangent',             // Line tangent to circle, or circles tangent
  EQUAL: 'equal',                 // Equal length lines or equal radius
  MIDPOINT: 'midpoint',           // Point at midpoint of line
  SYMMETRIC: 'symmetric',         // Two points symmetric about line
  COLINEAR: 'colinear',           // Points/lines on same line
  
  // Position constraints
  HORIZONTAL: 'horizontal',       // Line horizontal
  VERTICAL: 'vertical',           // Line vertical
  FIX: 'fix',                     // Lock point position
  
  // Dimension constraints
  DISTANCE: 'distance',           // Distance between two points/entities
  LENGTH: 'length',               // Line length
  RADIUS: 'radius',               // Circle/arc radius
  DIAMETER: 'diameter',           // Circle/arc diameter
  ANGLE: 'angle',                 // Angle between two lines
  HORIZONTAL_DISTANCE: 'hdistance', // Horizontal distance
  VERTICAL_DISTANCE: 'vdistance',   // Vertical distance
  
  // Legacy aliases for backwards compatibility
  DIMENSION: 'length',
  FIXED: 'fix',
}

/**
 * Constraint class with priority and error tracking
 */
export class Constraint {
  constructor(type, entities, value = null, priority = 1) {
    this.id = nextId()
    this.type = type
    this.entities = entities
    this.value = value
    this.priority = priority
    this.satisfied = false
    this.error = 0
    this.enabled = true
  }

  // Get human-readable description
  get description() {
    const entityNames = this.entities.map(e => e.id).join(', ')
    switch (this.type) {
      case ConstraintType.COINCIDENT: return `Coincident (${entityNames})`
      case ConstraintType.CONCENTRIC: return `Concentric (${entityNames})`
      case ConstraintType.PARALLEL: return `Parallel (${entityNames})`
      case ConstraintType.PERPENDICULAR: return `Perpendicular (${entityNames})`
      case ConstraintType.TANGENT: return `Tangent (${entityNames})`
      case ConstraintType.EQUAL: return `Equal (${entityNames})`
      case ConstraintType.MIDPOINT: return `Midpoint (${entityNames})`
      case ConstraintType.SYMMETRIC: return `Symmetric (${entityNames})`
      case ConstraintType.HORIZONTAL: return `Horizontal (${entityNames})`
      case ConstraintType.VERTICAL: return `Vertical (${entityNames})`
      case ConstraintType.FIX: return `Fixed (${entityNames})`
      case ConstraintType.LENGTH: return `Length = ${this.value} (${entityNames})`
      case ConstraintType.DISTANCE: return `Distance = ${this.value} (${entityNames})`
      case ConstraintType.RADIUS: return `Radius = ${this.value} (${entityNames})`
      case ConstraintType.DIAMETER: return `Diameter = ${this.value} (${entityNames})`
      case ConstraintType.ANGLE: return `Angle = ${this.value}° (${entityNames})`
      case ConstraintType.HORIZONTAL_DISTANCE: return `H-Distance = ${this.value} (${entityNames})`
      case ConstraintType.VERTICAL_DISTANCE: return `V-Distance = ${this.value} (${entityNames})`
      default: return `${this.type} (${entityNames})`
    }
  }
}

/**
 * Advanced Constraint Solver
 * Uses iterative relaxation with priority weighting
 */
export class ConstraintSolver {
  constructor() {
    this.points = new Map()
    this.lines = new Map()
    this.circles = new Map()
    this.arcs = new Map()
    this.constraints = new Map()
    this.maxIterations = 200
    this.tolerance = 0.0001
    this.relaxationFactor = 0.5
    this.isSolving = false
    this.lastSolveTime = 0
    this.onSolveComplete = null
  }

  // Entity management
  addPoint(point) {
    this.points.set(point.id, point)
    return point
  }

  addLine(line) {
    this.lines.set(line.id, line)
    this.points.set(line.p1.id, line.p1)
    this.points.set(line.p2.id, line.p2)
    return line
  }

  addCircle(circle) {
    this.circles.set(circle.id, circle)
    this.points.set(circle.center.id, circle.center)
    return circle
  }

  addArc(arc) {
    this.arcs.set(arc.id, arc)
    this.points.set(arc.center.id, arc.center)
    return arc
  }

  addConstraint(constraint) {
    this.constraints.set(constraint.id, constraint)
    return constraint
  }

  removeConstraint(constraintId) {
    this.constraints.delete(constraintId)
  }

  removeEntity(entityId) {
    this.points.delete(entityId)
    this.lines.delete(entityId)
    this.circles.delete(entityId)
    this.arcs.delete(entityId)
    
    // Remove constraints involving this entity
    for (const [cid, constraint] of this.constraints) {
      if (constraint.entities.some(e => e.id === entityId)) {
        this.constraints.delete(cid)
      }
    }
  }

  getEntity(entityId) {
    return this.points.get(entityId) || 
           this.lines.get(entityId) || 
           this.circles.get(entityId) || 
           this.arcs.get(entityId)
  }

  /**
   * Solve all constraints - main solver loop
   * @param {boolean} continuous - If true, called during drag operations
   */
  solve(continuous = false) {
    if (this.isSolving) return false
    this.isSolving = true
    
    const startTime = performance.now()
    let iteration = 0
    let maxError = Infinity
    let prevError = Infinity

    // Sort constraints by priority
    const sortedConstraints = [...this.constraints.values()]
      .filter(c => c.enabled)
      .sort((a, b) => b.priority - a.priority)

    while (iteration < this.maxIterations && maxError > this.tolerance) {
      maxError = 0

      for (const constraint of sortedConstraints) {
        const error = this.applyConstraint(constraint)
        constraint.error = error
        constraint.satisfied = error < this.tolerance
        maxError = Math.max(maxError, error)
      }

      // Check for convergence stall
      if (Math.abs(prevError - maxError) < this.tolerance * 0.01) {
        break
      }
      prevError = maxError
      iteration++
    }

    this.lastSolveTime = performance.now() - startTime
    this.isSolving = false

    if (!continuous) {
      console.log(`${LOG_PREFIX} Solved in ${iteration} iterations, ${this.lastSolveTime.toFixed(2)}ms, max error: ${maxError.toFixed(6)}`)
    }

    if (this.onSolveComplete) {
      this.onSolveComplete(maxError <= this.tolerance, iteration, maxError)
    }

    return maxError <= this.tolerance
  }

  /**
   * Solve continuously during drag - optimized for real-time
   */
  solveContinuous() {
    return this.solve(true)
  }

  /**
   * Apply a single constraint
   */
  applyConstraint(constraint) {
    switch (constraint.type) {
      // Geometric constraints
      case ConstraintType.COINCIDENT: return this.applyCoincident(constraint)
      case ConstraintType.CONCENTRIC: return this.applyConcentric(constraint)
      case ConstraintType.PARALLEL: return this.applyParallel(constraint)
      case ConstraintType.PERPENDICULAR: return this.applyPerpendicular(constraint)
      case ConstraintType.TANGENT: return this.applyTangent(constraint)
      case ConstraintType.EQUAL: return this.applyEqual(constraint)
      case ConstraintType.MIDPOINT: return this.applyMidpoint(constraint)
      case ConstraintType.SYMMETRIC: return this.applySymmetric(constraint)
      case ConstraintType.COLINEAR: return this.applyColinear(constraint)
      
      // Position constraints
      case ConstraintType.HORIZONTAL: return this.applyHorizontal(constraint)
      case ConstraintType.VERTICAL: return this.applyVertical(constraint)
      case ConstraintType.FIX: return this.applyFix(constraint)
      
      // Dimension constraints
      case ConstraintType.DISTANCE: return this.applyDistance(constraint)
      case ConstraintType.LENGTH: return this.applyLength(constraint)
      case ConstraintType.RADIUS: return this.applyRadius(constraint)
      case ConstraintType.DIAMETER: return this.applyDiameter(constraint)
      case ConstraintType.ANGLE: return this.applyAngle(constraint)
      case ConstraintType.HORIZONTAL_DISTANCE: return this.applyHorizontalDistance(constraint)
      case ConstraintType.VERTICAL_DISTANCE: return this.applyVerticalDistance(constraint)
      
      default:
        console.warn(`${LOG_PREFIX} Unknown constraint type: ${constraint.type}`)
        return 0
    }
  }

  // ========== GEOMETRIC CONSTRAINTS ==========

  applyCoincident(constraint) {
    const [e1, e2] = constraint.entities
    if (!e1 || !e2) return 0

    // Get points to constrain
    const p1 = e1.type === 'point' ? e1 : (e1.center || e1.p1)
    const p2 = e2.type === 'point' ? e2 : (e2.center || e2.p1)
    
    if (!p1 || !p2) return 0

    const error = p1.distanceTo(p2)
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    const avgX = (p1.x + p2.x) / 2
    const avgY = (p1.y + p2.y) / 2

    if (!p1.fixed) {
      p1.x += (avgX - p1.x) * factor
      p1.y += (avgY - p1.y) * factor
    }
    if (!p2.fixed) {
      p2.x += (avgX - p2.x) * factor
      p2.y += (avgY - p2.y) * factor
    }

    return error
  }

  applyConcentric(constraint) {
    const [c1, c2] = constraint.entities
    if (!c1?.center || !c2?.center) return 0

    return this.applyCoincident({ 
      ...constraint, 
      entities: [c1.center, c2.center] 
    })
  }

  applyParallel(constraint) {
    const [l1, l2] = constraint.entities
    if (l1?.type !== 'line' || l2?.type !== 'line') return 0

    const angle1 = l1.angle
    const angle2 = l2.angle
    let angleDiff = angle2 - angle1

    // Normalize angle difference
    while (angleDiff > Math.PI / 2) angleDiff -= Math.PI
    while (angleDiff < -Math.PI / 2) angleDiff += Math.PI

    const error = Math.abs(angleDiff)
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor * 0.5
    const mid = l2.midpoint

    // Rotate l2 to be parallel to l1
    if (!l2.p1.fixed && !l2.p2.fixed) {
      l2.rotate(-angleDiff * factor, mid.x, mid.y)
    }

    return error
  }

  applyPerpendicular(constraint) {
    const [l1, l2] = constraint.entities
    if (l1?.type !== 'line' || l2?.type !== 'line') return 0

    const angle1 = l1.angle
    const angle2 = l2.angle
    let angleDiff = angle2 - angle1

    // Normalize to find perpendicular angle
    while (angleDiff > Math.PI) angleDiff -= Math.PI
    while (angleDiff < 0) angleDiff += Math.PI

    const targetDiff = Math.PI / 2
    const error = Math.abs(angleDiff - targetDiff)
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor * 0.5
    const mid = l2.midpoint
    const correction = (angleDiff - targetDiff) * factor

    if (!l2.p1.fixed && !l2.p2.fixed) {
      l2.rotate(-correction, mid.x, mid.y)
    }

    return error
  }

  applyTangent(constraint) {
    const [e1, e2] = constraint.entities
    
    // Line tangent to circle
    if (e1?.type === 'line' && e2?.type === 'circle') {
      return this.applyLineTangentToCircle(e1, e2)
    }
    if (e1?.type === 'circle' && e2?.type === 'line') {
      return this.applyLineTangentToCircle(e2, e1)
    }
    
    // Circle tangent to circle
    if (e1?.type === 'circle' && e2?.type === 'circle') {
      return this.applyCircleTangentToCircle(e1, e2)
    }

    return 0
  }

  applyLineTangentToCircle(line, circle) {
    // Distance from center to line should equal radius
    const dist = line.distanceToPoint(circle.center.x, circle.center.y)
    const error = Math.abs(dist - circle.radius)
    
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    const t = line.projectPoint(circle.center.x, circle.center.y)
    const closest = line.pointAt(Math.max(0, Math.min(1, t)))
    
    const dx = circle.center.x - closest.x
    const dy = circle.center.y - closest.y
    const currentDist = Math.sqrt(dx * dx + dy * dy)
    
    if (currentDist > 0) {
      const scale = (circle.radius - currentDist) / currentDist * factor
      if (!circle.center.fixed) {
        circle.center.x += dx * scale * 0.5
        circle.center.y += dy * scale * 0.5
      }
      if (!line.p1.fixed && !line.p2.fixed) {
        line.p1.x -= dx * scale * 0.25
        line.p1.y -= dy * scale * 0.25
        line.p2.x -= dx * scale * 0.25
        line.p2.y -= dy * scale * 0.25
      }
    }

    return error
  }

  applyCircleTangentToCircle(c1, c2) {
    const dist = c1.center.distanceTo(c2.center)
    const targetDist = c1.radius + c2.radius // External tangent
    const error = Math.abs(dist - targetDist)
    
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    const dx = c2.center.x - c1.center.x
    const dy = c2.center.y - c1.center.y
    
    if (dist > 0) {
      const scale = (targetDist - dist) / dist * factor
      if (!c1.center.fixed) {
        c1.center.x -= dx * scale * 0.5
        c1.center.y -= dy * scale * 0.5
      }
      if (!c2.center.fixed) {
        c2.center.x += dx * scale * 0.5
        c2.center.y += dy * scale * 0.5
      }
    }

    return error
  }

  applyEqual(constraint) {
    const [e1, e2] = constraint.entities
    
    // Equal length lines
    if (e1?.type === 'line' && e2?.type === 'line') {
      const len1 = e1.length
      const len2 = e2.length
      const avgLen = (len1 + len2) / 2
      const error = Math.abs(len1 - len2)
      
      if (error < this.tolerance) return error
      
      this.scaleLine(e1, avgLen)
      this.scaleLine(e2, avgLen)
      
      return error
    }
    
    // Equal radius circles
    if (e1?.type === 'circle' && e2?.type === 'circle') {
      const avgRadius = (e1.radius + e2.radius) / 2
      const error = Math.abs(e1.radius - e2.radius)
      
      e1.radius = avgRadius
      e2.radius = avgRadius
      
      return error
    }

    return 0
  }

  applyMidpoint(constraint) {
    const [point, line] = constraint.entities
    if (point?.type !== 'point' || line?.type !== 'line') return 0

    const mid = line.midpoint
    const error = Math.sqrt((point.x - mid.x) ** 2 + (point.y - mid.y) ** 2)
    
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    
    if (!point.fixed) {
      point.x += (mid.x - point.x) * factor
      point.y += (mid.y - point.y) * factor
    } else {
      // Move line endpoints equally to put midpoint at point
      const dx = (point.x - mid.x) * factor
      const dy = (point.y - mid.y) * factor
      if (!line.p1.fixed) {
        line.p1.x += dx
        line.p1.y += dy
      }
      if (!line.p2.fixed) {
        line.p2.x += dx
        line.p2.y += dy
      }
    }

    return error
  }

  applySymmetric(constraint) {
    const [p1, p2, line] = constraint.entities
    if (!p1 || !p2 || line?.type !== 'line') return 0

    // Reflect p1 across line to get target for p2
    const mid = line.midpoint
    const perp = line.perpendicular
    
    // Project p1 onto line
    const t = line.projectPoint(p1.x, p1.y)
    const proj = line.pointAt(t)
    
    // Reflected point
    const targetX = 2 * proj.x - p1.x
    const targetY = 2 * proj.y - p1.y
    
    const error = Math.sqrt((p2.x - targetX) ** 2 + (p2.y - targetY) ** 2)
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    if (!p2.fixed) {
      p2.x += (targetX - p2.x) * factor
      p2.y += (targetY - p2.y) * factor
    }

    return error
  }

  applyColinear(constraint) {
    const entities = constraint.entities
    if (entities.length < 2) return 0

    // Get all points
    const points = entities.flatMap(e => {
      if (e.type === 'point') return [e]
      if (e.type === 'line') return [e.p1, e.p2]
      return []
    })

    if (points.length < 3) return 0

    // Find best fit line through points
    const n = points.length
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
    
    for (const p of points) {
      sumX += p.x
      sumY += p.y
      sumXY += p.x * p.y
      sumX2 += p.x * p.x
    }

    const avgX = sumX / n
    const avgY = sumY / n
    const denom = sumX2 - sumX * sumX / n
    
    let angle
    if (Math.abs(denom) < this.tolerance) {
      angle = Math.PI / 2 // Vertical line
    } else {
      const slope = (sumXY - sumX * sumY / n) / denom
      angle = Math.atan(slope)
    }

    // Project points onto line
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    let maxError = 0

    for (const p of points) {
      if (p.fixed) continue
      const dx = p.x - avgX
      const dy = p.y - avgY
      const projDist = dx * cos + dy * sin
      const perpDist = -dx * sin + dy * cos
      
      maxError = Math.max(maxError, Math.abs(perpDist))
      
      p.x -= perpDist * sin * this.relaxationFactor
      p.y += perpDist * cos * this.relaxationFactor
    }

    return maxError
  }

  // ========== POSITION CONSTRAINTS ==========

  applyHorizontal(constraint) {
    const entity = constraint.entities[0]
    if (entity?.type !== 'line') return 0

    const avgY = (entity.p1.y + entity.p2.y) / 2
    const error = Math.abs(entity.p1.y - entity.p2.y)

    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    if (!entity.p1.fixed) entity.p1.y += (avgY - entity.p1.y) * factor
    if (!entity.p2.fixed) entity.p2.y += (avgY - entity.p2.y) * factor

    return error
  }

  applyVertical(constraint) {
    const entity = constraint.entities[0]
    if (entity?.type !== 'line') return 0

    const avgX = (entity.p1.x + entity.p2.x) / 2
    const error = Math.abs(entity.p1.x - entity.p2.x)

    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    if (!entity.p1.fixed) entity.p1.x += (avgX - entity.p1.x) * factor
    if (!entity.p2.fixed) entity.p2.x += (avgX - entity.p2.x) * factor

    return error
  }

  applyFix(constraint) {
    const entity = constraint.entities[0]
    const [targetX, targetY] = constraint.value

    let point
    if (entity.type === 'point') point = entity
    else if (entity.center) point = entity.center
    else if (entity.p1) point = entity.p1
    else return 0

    const error = Math.sqrt((point.x - targetX) ** 2 + (point.y - targetY) ** 2)
    
    point.x = targetX
    point.y = targetY
    point.fixed = true

    return error
  }

  // ========== DIMENSION CONSTRAINTS ==========

  applyDistance(constraint) {
    const [e1, e2] = constraint.entities
    const targetDist = constraint.value

    // Get points
    const p1 = e1.type === 'point' ? e1 : (e1.center || e1.p1)
    const p2 = e2.type === 'point' ? e2 : (e2.center || e2.p1)
    
    if (!p1 || !p2) return 0

    const currentDist = p1.distanceTo(p2)
    const error = Math.abs(currentDist - targetDist)
    
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    
    if (currentDist > 0) {
      const scale = (targetDist - currentDist) / currentDist * factor
      
      if (!p1.fixed && !p2.fixed) {
        p1.x -= dx * scale * 0.5
        p1.y -= dy * scale * 0.5
        p2.x += dx * scale * 0.5
        p2.y += dy * scale * 0.5
      } else if (!p2.fixed) {
        p2.x += dx * scale
        p2.y += dy * scale
      } else if (!p1.fixed) {
        p1.x -= dx * scale
        p1.y -= dy * scale
      }
    }

    return error
  }

  applyLength(constraint) {
    const line = constraint.entities[0]
    if (line?.type !== 'line') return 0

    const targetLength = constraint.value
    const currentLength = line.length
    const error = Math.abs(currentLength - targetLength)
    
    if (error < this.tolerance) return error

    this.scaleLine(line, targetLength)
    return error
  }

  applyRadius(constraint) {
    const entity = constraint.entities[0]
    if (!entity?.radius) return 0

    const error = Math.abs(entity.radius - constraint.value)
    entity.radius = constraint.value
    return error
  }

  applyDiameter(constraint) {
    const entity = constraint.entities[0]
    if (!entity?.radius) return 0

    const targetRadius = constraint.value / 2
    const error = Math.abs(entity.radius - targetRadius)
    entity.radius = targetRadius
    return error
  }

  applyAngle(constraint) {
    const [l1, l2] = constraint.entities
    if (l1?.type !== 'line' || l2?.type !== 'line') return 0

    const targetAngle = constraint.value * Math.PI / 180 // Convert to radians
    const currentAngle = Math.abs(l2.angle - l1.angle)
    const normalizedCurrent = currentAngle % Math.PI
    
    const error = Math.abs(normalizedCurrent - targetAngle)
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor * 0.5
    const mid = l2.midpoint
    const correction = (normalizedCurrent - targetAngle) * factor

    if (!l2.p1.fixed && !l2.p2.fixed) {
      l2.rotate(-correction, mid.x, mid.y)
    }

    return error
  }

  applyHorizontalDistance(constraint) {
    const [e1, e2] = constraint.entities
    const targetDist = constraint.value

    const p1 = e1.type === 'point' ? e1 : (e1.center || e1.p1)
    const p2 = e2.type === 'point' ? e2 : (e2.center || e2.p1)
    
    if (!p1 || !p2) return 0

    const currentDist = Math.abs(p2.x - p1.x)
    const error = Math.abs(currentDist - targetDist)
    
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    const diff = (targetDist - currentDist) * Math.sign(p2.x - p1.x || 1)
    
    if (!p1.fixed && !p2.fixed) {
      p1.x -= diff * factor * 0.5
      p2.x += diff * factor * 0.5
    } else if (!p2.fixed) {
      p2.x += diff * factor
    } else if (!p1.fixed) {
      p1.x -= diff * factor
    }

    return error
  }

  applyVerticalDistance(constraint) {
    const [e1, e2] = constraint.entities
    const targetDist = constraint.value

    const p1 = e1.type === 'point' ? e1 : (e1.center || e1.p1)
    const p2 = e2.type === 'point' ? e2 : (e2.center || e2.p1)
    
    if (!p1 || !p2) return 0

    const currentDist = Math.abs(p2.y - p1.y)
    const error = Math.abs(currentDist - targetDist)
    
    if (error < this.tolerance) return error

    const factor = this.relaxationFactor
    const diff = (targetDist - currentDist) * Math.sign(p2.y - p1.y || 1)
    
    if (!p1.fixed && !p2.fixed) {
      p1.y -= diff * factor * 0.5
      p2.y += diff * factor * 0.5
    } else if (!p2.fixed) {
      p2.y += diff * factor
    } else if (!p1.fixed) {
      p1.y -= diff * factor
    }

    return error
  }

  // ========== HELPER METHODS ==========

  scaleLine(line, targetLength) {
    const currentLength = line.length
    if (currentLength === 0) return

    const factor = this.relaxationFactor
    const scale = 1 + (targetLength / currentLength - 1) * factor
    const mid = line.midpoint

    if (!line.p1.fixed) {
      line.p1.x = mid.x + (line.p1.x - mid.x) * scale
      line.p1.y = mid.y + (line.p1.y - mid.y) * scale
    }
    if (!line.p2.fixed) {
      line.p2.x = mid.x + (line.p2.x - mid.x) * scale
      line.p2.y = mid.y + (line.p2.y - mid.y) * scale
    }
  }

  getAllEntities() {
    return [
      ...this.lines.values(),
      ...this.circles.values(),
      ...this.arcs.values(),
    ]
  }

  getAllConstraints() {
    return [...this.constraints.values()]
  }

  getConstraintsForEntity(entityId) {
    return this.getAllConstraints().filter(c => 
      c.entities.some(e => e.id === entityId)
    )
  }

  getConstraintStatus() {
    const constraints = this.getAllConstraints()
    return {
      total: constraints.length,
      satisfied: constraints.filter(c => c.satisfied).length,
      unsatisfied: constraints.filter(c => !c.satisfied).length,
      disabled: constraints.filter(c => !c.enabled).length,
    }
  }

  clear() {
    this.points.clear()
    this.lines.clear()
    this.circles.clear()
    this.arcs.clear()
    this.constraints.clear()
  }
}

// Create singleton instance
export const solver = new ConstraintSolver()
