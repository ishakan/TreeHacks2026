/**
 * Snapping Service for 2D Sketch Mode
 * Provides intelligent snapping to geometric features
 * Supports: endpoints, midpoints, intersections, tangent points, grid, angles
 */

const LOG_PREFIX = '[SnappingService]'

/**
 * Snap types
 */
export const SnapType = {
  NONE: 'none',
  ENDPOINT: 'endpoint',
  MIDPOINT: 'midpoint',
  CENTER: 'center',
  INTERSECTION: 'intersection',
  PERPENDICULAR: 'perpendicular',
  TANGENT: 'tangent',
  NEAREST: 'nearest',
  GRID: 'grid',
  ANGLE: 'angle',
  HORIZONTAL: 'horizontal',
  VERTICAL: 'vertical',
}

/**
 * Snap result object
 */
export class SnapResult {
  constructor(type, point, sourceEntity = null, secondEntity = null) {
    this.type = type
    this.point = point // { x, y }
    this.sourceEntity = sourceEntity
    this.secondEntity = secondEntity // For intersections
    this.distance = 0
  }
}

/**
 * Snapping Service
 */
export class SnappingService {
  constructor() {
    // Snap tolerances
    this.snapRadius = 15 // Pixels
    this.gridSize = 10
    this.angleSnap = 15 // Degrees (snap to 15° increments)
    
    // Enable/disable snap types
    this.snapTypes = {
      [SnapType.ENDPOINT]: true,
      [SnapType.MIDPOINT]: true,
      [SnapType.CENTER]: true,
      [SnapType.INTERSECTION]: true,
      [SnapType.PERPENDICULAR]: true,
      [SnapType.TANGENT]: true,
      [SnapType.NEAREST]: true,
      [SnapType.GRID]: true,
      [SnapType.ANGLE]: true,
      [SnapType.HORIZONTAL]: true,
      [SnapType.VERTICAL]: true,
    }
    
    // Priority order (lower = higher priority)
    this.snapPriority = [
      SnapType.ENDPOINT,
      SnapType.CENTER,
      SnapType.INTERSECTION,
      SnapType.MIDPOINT,
      SnapType.PERPENDICULAR,
      SnapType.TANGENT,
      SnapType.ANGLE,
      SnapType.HORIZONTAL,
      SnapType.VERTICAL,
      SnapType.NEAREST,
      SnapType.GRID,
    ]
  }

  /**
   * Find best snap point for given cursor position
   * @param {number} x - Cursor X in sketch coordinates
   * @param {number} y - Cursor Y in sketch coordinates
   * @param {Array} entities - All sketch entities
   * @param {Object} options - Additional options (referencePoint for angle snap, etc.)
   * @returns {SnapResult|null}
   */
  findSnap(x, y, entities, options = {}) {
    const candidates = []
    
    // Collect all snap candidates
    if (this.snapTypes[SnapType.ENDPOINT]) {
      candidates.push(...this.findEndpointSnaps(x, y, entities))
    }
    if (this.snapTypes[SnapType.CENTER]) {
      candidates.push(...this.findCenterSnaps(x, y, entities))
    }
    if (this.snapTypes[SnapType.MIDPOINT]) {
      candidates.push(...this.findMidpointSnaps(x, y, entities))
    }
    if (this.snapTypes[SnapType.INTERSECTION]) {
      candidates.push(...this.findIntersectionSnaps(x, y, entities))
    }
    if (this.snapTypes[SnapType.PERPENDICULAR] && options.referencePoint) {
      candidates.push(...this.findPerpendicularSnaps(x, y, entities, options.referencePoint))
    }
    if (this.snapTypes[SnapType.TANGENT] && options.referencePoint) {
      candidates.push(...this.findTangentSnaps(x, y, entities, options.referencePoint))
    }
    if ((this.snapTypes[SnapType.HORIZONTAL] || this.snapTypes[SnapType.VERTICAL]) && options.referencePoint) {
      candidates.push(...this.findOrthogonalSnaps(x, y, options.referencePoint))
    }
    if (this.snapTypes[SnapType.ANGLE] && options.referencePoint) {
      candidates.push(...this.findAngleSnaps(x, y, options.referencePoint))
    }
    if (this.snapTypes[SnapType.NEAREST]) {
      candidates.push(...this.findNearestSnaps(x, y, entities))
    }
    if (this.snapTypes[SnapType.GRID]) {
      candidates.push(this.findGridSnap(x, y))
    }

    // Filter by snap radius and sort by priority then distance
    const validCandidates = candidates
      .filter(c => c && c.distance <= this.snapRadius)
      .sort((a, b) => {
        const priorityA = this.snapPriority.indexOf(a.type)
        const priorityB = this.snapPriority.indexOf(b.type)
        if (priorityA !== priorityB) return priorityA - priorityB
        return a.distance - b.distance
      })

    return validCandidates[0] || null
  }

  /**
   * Find endpoint snaps (line endpoints, arc endpoints)
   */
  findEndpointSnaps(x, y, entities) {
    const snaps = []
    
    for (const entity of entities) {
      if (entity.type === 'line') {
        // P1
        const d1 = this.distance(x, y, entity.p1.x, entity.p1.y)
        snaps.push(new SnapResult(SnapType.ENDPOINT, { x: entity.p1.x, y: entity.p1.y }, entity))
        snaps[snaps.length - 1].distance = d1
        
        // P2
        const d2 = this.distance(x, y, entity.p2.x, entity.p2.y)
        snaps.push(new SnapResult(SnapType.ENDPOINT, { x: entity.p2.x, y: entity.p2.y }, entity))
        snaps[snaps.length - 1].distance = d2
      }
      else if (entity.type === 'arc') {
        const startPt = entity.startPoint
        const endPt = entity.endPoint
        
        const d1 = this.distance(x, y, startPt.x, startPt.y)
        snaps.push(new SnapResult(SnapType.ENDPOINT, startPt, entity))
        snaps[snaps.length - 1].distance = d1
        
        const d2 = this.distance(x, y, endPt.x, endPt.y)
        snaps.push(new SnapResult(SnapType.ENDPOINT, endPt, entity))
        snaps[snaps.length - 1].distance = d2
      }
    }
    
    return snaps
  }

  /**
   * Find center snaps (circle centers, arc centers)
   */
  findCenterSnaps(x, y, entities) {
    const snaps = []
    
    for (const entity of entities) {
      if (entity.type === 'circle' || entity.type === 'arc') {
        const d = this.distance(x, y, entity.center.x, entity.center.y)
        snaps.push(new SnapResult(SnapType.CENTER, { x: entity.center.x, y: entity.center.y }, entity))
        snaps[snaps.length - 1].distance = d
      }
    }
    
    return snaps
  }

  /**
   * Find midpoint snaps
   */
  findMidpointSnaps(x, y, entities) {
    const snaps = []
    
    for (const entity of entities) {
      if (entity.type === 'line') {
        const mid = entity.midpoint
        const d = this.distance(x, y, mid.x, mid.y)
        snaps.push(new SnapResult(SnapType.MIDPOINT, mid, entity))
        snaps[snaps.length - 1].distance = d
      }
    }
    
    return snaps
  }

  /**
   * Find intersection snaps between entities
   */
  findIntersectionSnaps(x, y, entities) {
    const snaps = []
    
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const e1 = entities[i]
        const e2 = entities[j]
        
        const intersections = this.findIntersections(e1, e2)
        for (const pt of intersections) {
          const d = this.distance(x, y, pt.x, pt.y)
          const snap = new SnapResult(SnapType.INTERSECTION, pt, e1, e2)
          snap.distance = d
          snaps.push(snap)
        }
      }
    }
    
    return snaps
  }

  /**
   * Find intersection points between two entities
   */
  findIntersections(e1, e2) {
    // Line-Line intersection
    if (e1.type === 'line' && e2.type === 'line') {
      return this.lineLineIntersection(e1, e2)
    }
    
    // Line-Circle intersection
    if (e1.type === 'line' && e2.type === 'circle') {
      return this.lineCircleIntersection(e1, e2)
    }
    if (e1.type === 'circle' && e2.type === 'line') {
      return this.lineCircleIntersection(e2, e1)
    }
    
    // Circle-Circle intersection
    if (e1.type === 'circle' && e2.type === 'circle') {
      return this.circleCircleIntersection(e1, e2)
    }
    
    return []
  }

  /**
   * Line-Line intersection
   */
  lineLineIntersection(l1, l2) {
    const x1 = l1.p1.x, y1 = l1.p1.y, x2 = l1.p2.x, y2 = l1.p2.y
    const x3 = l2.p1.x, y3 = l2.p1.y, x4 = l2.p2.x, y4 = l2.p2.y
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if (Math.abs(denom) < 0.0001) return [] // Parallel
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom
    
    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return [{
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1)
      }]
    }
    
    return []
  }

  /**
   * Line-Circle intersection
   */
  lineCircleIntersection(line, circle) {
    const dx = line.p2.x - line.p1.x
    const dy = line.p2.y - line.p1.y
    const fx = line.p1.x - circle.center.x
    const fy = line.p1.y - circle.center.y
    
    const a = dx * dx + dy * dy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - circle.radius * circle.radius
    
    const discriminant = b * b - 4 * a * c
    if (discriminant < 0) return []
    
    const intersections = []
    const sqrtDisc = Math.sqrt(discriminant)
    
    const t1 = (-b - sqrtDisc) / (2 * a)
    if (t1 >= 0 && t1 <= 1) {
      intersections.push({
        x: line.p1.x + t1 * dx,
        y: line.p1.y + t1 * dy
      })
    }
    
    const t2 = (-b + sqrtDisc) / (2 * a)
    if (t2 >= 0 && t2 <= 1 && Math.abs(t1 - t2) > 0.0001) {
      intersections.push({
        x: line.p1.x + t2 * dx,
        y: line.p1.y + t2 * dy
      })
    }
    
    return intersections
  }

  /**
   * Circle-Circle intersection
   */
  circleCircleIntersection(c1, c2) {
    const dx = c2.center.x - c1.center.x
    const dy = c2.center.y - c1.center.y
    const d = Math.sqrt(dx * dx + dy * dy)
    
    // No intersection
    if (d > c1.radius + c2.radius) return []
    if (d < Math.abs(c1.radius - c2.radius)) return []
    if (d === 0 && c1.radius === c2.radius) return []
    
    const a = (c1.radius * c1.radius - c2.radius * c2.radius + d * d) / (2 * d)
    const h = Math.sqrt(c1.radius * c1.radius - a * a)
    
    const px = c1.center.x + a * dx / d
    const py = c1.center.y + a * dy / d
    
    return [
      { x: px + h * dy / d, y: py - h * dx / d },
      { x: px - h * dy / d, y: py + h * dx / d }
    ]
  }

  /**
   * Find perpendicular snaps from reference point to lines
   */
  findPerpendicularSnaps(x, y, entities, refPoint) {
    const snaps = []
    
    for (const entity of entities) {
      if (entity.type === 'line') {
        // Find point on line where perpendicular from refPoint intersects
        const t = entity.projectPoint(refPoint.x, refPoint.y)
        if (t >= 0 && t <= 1) {
          const pt = entity.pointAt(t)
          const d = this.distance(x, y, pt.x, pt.y)
          const snap = new SnapResult(SnapType.PERPENDICULAR, pt, entity)
          snap.distance = d
          snaps.push(snap)
        }
      }
    }
    
    return snaps
  }

  /**
   * Find tangent snaps from reference point to circles
   */
  findTangentSnaps(x, y, entities, refPoint) {
    const snaps = []
    
    for (const entity of entities) {
      if (entity.type === 'circle') {
        const tangentPoints = entity.tangentPointsFrom(refPoint.x, refPoint.y)
        for (const pt of tangentPoints) {
          const d = this.distance(x, y, pt.x, pt.y)
          const snap = new SnapResult(SnapType.TANGENT, pt, entity)
          snap.distance = d
          snaps.push(snap)
        }
      }
    }
    
    return snaps
  }

  /**
   * Find horizontal/vertical alignment snaps
   */
  findOrthogonalSnaps(x, y, refPoint) {
    const snaps = []
    
    // Horizontal alignment
    if (this.snapTypes[SnapType.HORIZONTAL]) {
      const hDist = Math.abs(y - refPoint.y)
      if (hDist <= this.snapRadius) {
        const snap = new SnapResult(SnapType.HORIZONTAL, { x, y: refPoint.y })
        snap.distance = hDist
        snaps.push(snap)
      }
    }
    
    // Vertical alignment
    if (this.snapTypes[SnapType.VERTICAL]) {
      const vDist = Math.abs(x - refPoint.x)
      if (vDist <= this.snapRadius) {
        const snap = new SnapResult(SnapType.VERTICAL, { x: refPoint.x, y })
        snap.distance = vDist
        snaps.push(snap)
      }
    }
    
    return snaps
  }

  /**
   * Find angle-constrained snaps (multiples of angleSnap degrees)
   */
  findAngleSnaps(x, y, refPoint) {
    const snaps = []
    const dx = x - refPoint.x
    const dy = y - refPoint.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    
    if (dist < 1) return snaps
    
    const angle = Math.atan2(dy, dx)
    const angleDeg = angle * 180 / Math.PI
    const snapAngleDeg = Math.round(angleDeg / this.angleSnap) * this.angleSnap
    const snapAngle = snapAngleDeg * Math.PI / 180
    
    const snapPt = {
      x: refPoint.x + dist * Math.cos(snapAngle),
      y: refPoint.y + dist * Math.sin(snapAngle)
    }
    
    const d = this.distance(x, y, snapPt.x, snapPt.y)
    const snap = new SnapResult(SnapType.ANGLE, snapPt)
    snap.distance = d
    snaps.push(snap)
    
    return snaps
  }

  /**
   * Find nearest point on entities
   */
  findNearestSnaps(x, y, entities) {
    const snaps = []
    
    for (const entity of entities) {
      if (entity.type === 'line') {
        const t = Math.max(0, Math.min(1, entity.projectPoint(x, y)))
        const pt = entity.pointAt(t)
        const d = this.distance(x, y, pt.x, pt.y)
        const snap = new SnapResult(SnapType.NEAREST, pt, entity)
        snap.distance = d
        snaps.push(snap)
      }
      else if (entity.type === 'circle') {
        const angle = Math.atan2(y - entity.center.y, x - entity.center.x)
        const pt = entity.pointAt(angle)
        const d = this.distance(x, y, pt.x, pt.y)
        const snap = new SnapResult(SnapType.NEAREST, pt, entity)
        snap.distance = d
        snaps.push(snap)
      }
    }
    
    return snaps
  }

  /**
   * Find grid snap
   */
  findGridSnap(x, y) {
    const snapX = Math.round(x / this.gridSize) * this.gridSize
    const snapY = Math.round(y / this.gridSize) * this.gridSize
    const d = this.distance(x, y, snapX, snapY)
    
    const snap = new SnapResult(SnapType.GRID, { x: snapX, y: snapY })
    snap.distance = d
    return snap
  }

  /**
   * Calculate distance between two points
   */
  distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  }

  /**
   * Enable/disable a snap type
   */
  setSnapType(type, enabled) {
    this.snapTypes[type] = enabled
  }

  /**
   * Set snap radius
   */
  setSnapRadius(radius) {
    this.snapRadius = radius
  }

  /**
   * Set grid size
   */
  setGridSize(size) {
    this.gridSize = size
  }

  /**
   * Set angle snap increment
   */
  setAngleSnap(degrees) {
    this.angleSnap = degrees
  }

  /**
   * Get snap indicator properties for visualization
   */
  getSnapIndicator(snapResult) {
    if (!snapResult) return null
    
    const indicators = {
      [SnapType.ENDPOINT]: { symbol: '○', color: '#00ff00', size: 8 },
      [SnapType.MIDPOINT]: { symbol: '△', color: '#00ffff', size: 8 },
      [SnapType.CENTER]: { symbol: '⊕', color: '#ff00ff', size: 8 },
      [SnapType.INTERSECTION]: { symbol: '×', color: '#ffff00', size: 10 },
      [SnapType.PERPENDICULAR]: { symbol: '⊥', color: '#ff8800', size: 10 },
      [SnapType.TANGENT]: { symbol: '◯', color: '#8800ff', size: 8 },
      [SnapType.NEAREST]: { symbol: '◊', color: '#00ff88', size: 6 },
      [SnapType.GRID]: { symbol: '+', color: '#888888', size: 6 },
      [SnapType.ANGLE]: { symbol: '∠', color: '#ff0088', size: 8 },
      [SnapType.HORIZONTAL]: { symbol: '—', color: '#00aaff', size: 10 },
      [SnapType.VERTICAL]: { symbol: '|', color: '#00aaff', size: 10 },
    }
    
    return indicators[snapResult.type] || { symbol: '•', color: '#ffffff', size: 6 }
  }
}

// Create singleton instance
export const snappingService = new SnappingService()
