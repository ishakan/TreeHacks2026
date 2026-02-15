/**
 * Parametric Feature System
 * 
 * Implements an Onshape-style feature tree where each feature:
 * - Has a type, parameters, and references (selected topology IDs)
 * - Has a compute() method that takes input shape and returns output shape
 * - Can be suppressed, reordered, and rolled back to
 */

import {
  getOCCT,
  isOCCTReady,
  makeBox,
  makeCylinder,
  makeSphere,
  makeCone,
  isWireClosed,
  shapeToGeometry,
} from './occtService'
import { remapSelectionReference } from './selectionRef'
import * as THREE from 'three'

const LOG_PREFIX = '[FeatureSystem]'

function buildIndexedEdges(oc, shape) {
  const edges = new Map()
  let index = 0
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (edgeExplorer.More()) {
    edges.set(`edge-${index}`, oc.TopoDS.Edge_1(edgeExplorer.Current()))
    index += 1
    edgeExplorer.Next()
  }
  return edges
}

function collectEdgeLengths(oc, shape) {
  const lengths = []
  const edgeExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (edgeExplorer.More()) {
    try {
      const edge = oc.TopoDS.Edge_1(edgeExplorer.Current())
      const props = new oc.GProp_GProps_1()
      oc.BRepGProp.LinearProperties_1(edge, props, false)
      const length = props.Mass()
      if (Number.isFinite(length) && length > 0) {
        lengths.push(length)
      }
    } catch (err) {
      // Ignore pathological edges for sizing heuristics.
    }
    edgeExplorer.Next()
  }

  return lengths
}

function validateOutputShape(oc, shape, label) {
  if (!shape || (typeof shape.IsNull === 'function' && shape.IsNull())) {
    throw new Error(`${label} failed: empty output shape`)
  }

  try {
    const analyzer = new oc.BRepCheck_Analyzer(shape, false)
    if (typeof analyzer.IsValid === 'function' && !analyzer.IsValid()) {
      throw new Error(`${label} failed: resulting shape is invalid`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('invalid')) {
      throw err
    }
  }
}

function resolveTopologyReferences(references, expectedKind, topologyMap) {
  if (!Array.isArray(references) || references.length === 0) {
    return { resolved: [], missing: [] }
  }

  const resolved = []
  const missing = []

  for (const ref of references) {
    if (!ref) continue
    if (typeof ref === 'string') {
      resolved.push({ ref: { kind: expectedKind }, topologyId: ref, confidence: 1 })
      continue
    }
    if (ref.edgeId && expectedKind === 'EDGE') {
      resolved.push({ ref, topologyId: ref.edgeId, confidence: 1 })
      continue
    }
    if (ref.faceId && expectedKind === 'FACE') {
      resolved.push({ ref, topologyId: ref.faceId, confidence: 1 })
      continue
    }
    if (ref.kind !== expectedKind) continue
    const match = remapSelectionReference(ref, topologyMap)
    if (match?.matched) {
      resolved.push({
        ref,
        topologyId: match.matched,
        confidence: match.confidence,
      })
      continue
    }
    missing.push({
      ref,
      reason: match?.reason || 'unresolved-reference',
      confidence: match?.confidence || 0,
    })
  }

  return { resolved, missing }
}

// Feature status enum
export const FeatureStatus = {
  OK: 'ok',
  ERROR: 'error',
  SUPPRESSED: 'suppressed',
  PENDING: 'pending',
  NEEDS_REPAIR: 'needs_repair',
}

/**
 * Base Feature class
 * All features extend this class and implement compute()
 */
export class Feature {
  constructor(id, type, name, params = {}, references = []) {
    this.id = id
    this.type = type
    this.name = name
    this.params = params
    this.references = references // Array of persistent topology IDs
    this.status = FeatureStatus.PENDING
    this.error = null
    this.suppressed = false
    this.needsRepair = []
    this.timestamp = Date.now()
    
    // Computed result cache
    this._outputShape = null
    this._outputGeometry = null
    this._outputTopologyMap = null
  }

  /**
   * Compute the feature output
   * @param {TopoDS_Shape|null} inputShape - Input shape from previous feature (null for first feature)
   * @param {Object} context - Computation context with reference resolver
   * @returns {Object} - { shape, geometry, topologyMap } or throws Error
   */
  compute(inputShape, context) {
    throw new Error('compute() must be implemented by subclass')
  }

  /**
   * Validate parameters before compute
   * @returns {Object} - { valid: boolean, errors: string[] }
   */
  validate() {
    return { valid: true, errors: [] }
  }

  /**
   * Get parameter definition for UI
   * @returns {Array} - Parameter definitions
   */
  static getParameterDefinitions() {
    return []
  }

  /**
   * Serialize feature for storage
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      params: this.params,
      references: this.references,
      suppressed: this.suppressed,
      timestamp: this.timestamp,
    }
  }

  /**
   * Create feature from JSON
   */
  static fromJSON(json) {
    const FeatureClass = FeatureRegistry.get(json.type)
    if (!FeatureClass) {
      throw new Error(`Unknown feature type: ${json.type}`)
    }
    const feature = new FeatureClass(json.id, json.name, json.params, json.references)
    feature.suppressed = json.suppressed || false
    feature.timestamp = json.timestamp || Date.now()
    return feature
  }
}

/**
 * Feature Registry
 * Maps feature type strings to Feature classes
 */
export const FeatureRegistry = {
  _registry: new Map(),

  register(type, FeatureClass) {
    this._registry.set(type, FeatureClass)
  },

  get(type) {
    return this._registry.get(type)
  },

  getAll() {
    return [...this._registry.entries()]
  },

  getTypes() {
    return [...this._registry.keys()]
  },
}

// ============================================================
// PRIMITIVE FEATURES
// ============================================================

/**
 * Box Feature - Creates a box primitive
 */
export class BoxFeature extends Feature {
  constructor(id, name = 'Box', params = {}, references = []) {
    super(id, 'box', name, {
      width: params.width ?? 1,
      height: params.height ?? 1,
      depth: params.depth ?? 1,
      positionX: params.positionX ?? 0,
      positionY: params.positionY ?? 0,
      positionZ: params.positionZ ?? 0,
    }, references)
  }

  validate() {
    const errors = []
    if (this.params.width <= 0) errors.push('Width must be positive')
    if (this.params.height <= 0) errors.push('Height must be positive')
    if (this.params.depth <= 0) errors.push('Depth must be positive')
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    const { width, height, depth, positionX, positionY, positionZ } = this.params
    
    console.log(`${LOG_PREFIX} BoxFeature.compute() - ${width}x${height}x${depth}`)
    
    const oc = getOCCT()
    
    // Create box at origin
    let shape = makeBox(width, height, depth)
    
    // Apply position transform if needed
    if (positionX !== 0 || positionY !== 0 || positionZ !== 0) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(positionX, positionY, positionZ))
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    
    // If there's an input shape, fuse with it
    if (inputShape) {
      const fuse = new oc.BRepAlgoAPI_Fuse_1()
      const listArgs = new oc.TopTools_ListOfShape_1()
      listArgs.Append_1(inputShape)
      fuse.SetArguments(listArgs)
      const listTools = new oc.TopTools_ListOfShape_1()
      listTools.Append_1(shape)
      fuse.SetTools(listTools)
      fuse.Build()
      if (!fuse.IsDone()) {
        throw new Error('Boolean fuse operation failed')
      }
      shape = fuse.Shape()
    }
    
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'width', label: 'Width', type: 'number', default: 1, min: 0.001 },
      { name: 'height', label: 'Height', type: 'number', default: 1, min: 0.001 },
      { name: 'depth', label: 'Depth', type: 'number', default: 1, min: 0.001 },
      { name: 'positionX', label: 'Position X', type: 'number', default: 0 },
      { name: 'positionY', label: 'Position Y', type: 'number', default: 0 },
      { name: 'positionZ', label: 'Position Z', type: 'number', default: 0 },
    ]
  }
}

/**
 * Cylinder Feature - Creates a cylinder primitive
 */
export class CylinderFeature extends Feature {
  constructor(id, name = 'Cylinder', params = {}, references = []) {
    super(id, 'cylinder', name, {
      radius: params.radius ?? 0.5,
      height: params.height ?? 1,
      positionX: params.positionX ?? 0,
      positionY: params.positionY ?? 0,
      positionZ: params.positionZ ?? 0,
    }, references)
  }

  validate() {
    const errors = []
    if (this.params.radius <= 0) errors.push('Radius must be positive')
    if (this.params.height <= 0) errors.push('Height must be positive')
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    const { radius, height, positionX, positionY, positionZ } = this.params
    
    console.log(`${LOG_PREFIX} CylinderFeature.compute() - r=${radius}, h=${height}`)
    
    const oc = getOCCT()
    
    let shape = makeCylinder(radius, height)
    
    if (positionX !== 0 || positionY !== 0 || positionZ !== 0) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(positionX, positionY, positionZ))
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    
    if (inputShape) {
      const fuse = new oc.BRepAlgoAPI_Fuse_2(inputShape, shape)
      if (!fuse.IsDone()) {
        throw new Error('Boolean fuse operation failed')
      }
      shape = fuse.Shape()
    }
    
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'radius', label: 'Radius', type: 'number', default: 0.5, min: 0.001 },
      { name: 'height', label: 'Height', type: 'number', default: 1, min: 0.001 },
      { name: 'positionX', label: 'Position X', type: 'number', default: 0 },
      { name: 'positionY', label: 'Position Y', type: 'number', default: 0 },
      { name: 'positionZ', label: 'Position Z', type: 'number', default: 0 },
    ]
  }
}

/**
 * Cone Feature - Creates a cone primitive
 */
export class ConeFeature extends Feature {
  constructor(id, name = 'Cone', params = {}, references = []) {
    super(id, 'cone', name, {
      radius1: params.radius1 ?? 0.5,
      radius2: params.radius2 ?? 0,
      height: params.height ?? 1,
      positionX: params.positionX ?? 0,
      positionY: params.positionY ?? 0,
      positionZ: params.positionZ ?? 0,
    }, references)
  }

  validate() {
    const errors = []
    if (this.params.radius1 < 0) errors.push('Bottom radius must be non-negative')
    if (this.params.radius2 < 0) errors.push('Top radius must be non-negative')
    if (this.params.radius1 === 0 && this.params.radius2 === 0) {
      errors.push('At least one radius must be positive')
    }
    if (this.params.height <= 0) errors.push('Height must be positive')
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    const { radius1, radius2, height, positionX, positionY, positionZ } = this.params

    console.log(`${LOG_PREFIX} ConeFeature.compute() - r1=${radius1}, r2=${radius2}, h=${height}`)

    const oc = getOCCT()

    let shape = makeCone(radius1, radius2, height)

    if (positionX !== 0 || positionY !== 0 || positionZ !== 0) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(positionX, positionY, positionZ))
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }

    if (inputShape) {
      const fuse = new oc.BRepAlgoAPI_Fuse_2(inputShape, shape)
      if (!fuse.IsDone()) {
        throw new Error('Boolean fuse operation failed')
      }
      shape = fuse.Shape()
    }

    const { geometry, topologyMap } = shapeToGeometry(shape)

    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'radius1', label: 'Bottom Radius', type: 'number', default: 0.5, min: 0 },
      { name: 'radius2', label: 'Top Radius', type: 'number', default: 0, min: 0 },
      { name: 'height', label: 'Height', type: 'number', default: 1, min: 0.001 },
      { name: 'positionX', label: 'Position X', type: 'number', default: 0 },
      { name: 'positionY', label: 'Position Y', type: 'number', default: 0 },
      { name: 'positionZ', label: 'Position Z', type: 'number', default: 0 },
    ]
  }
}

/**
 * Sphere Feature - Creates a sphere primitive
 */
export class SphereFeature extends Feature {
  constructor(id, name = 'Sphere', params = {}, references = []) {
    super(id, 'sphere', name, {
      radius: params.radius ?? 0.5,
      positionX: params.positionX ?? 0,
      positionY: params.positionY ?? 0,
      positionZ: params.positionZ ?? 0,
    }, references)
  }

  validate() {
    const errors = []
    if (this.params.radius <= 0) errors.push('Radius must be positive')
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    const { radius, positionX, positionY, positionZ } = this.params
    
    console.log(`${LOG_PREFIX} SphereFeature.compute() - r=${radius}`)
    
    const oc = getOCCT()
    
    let shape = makeSphere(radius)
    
    if (positionX !== 0 || positionY !== 0 || positionZ !== 0) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(positionX, positionY, positionZ))
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    
    if (inputShape) {
      const fuse = new oc.BRepAlgoAPI_Fuse_2(inputShape, shape)
      if (!fuse.IsDone()) {
        throw new Error('Boolean fuse operation failed')
      }
      shape = fuse.Shape()
    }
    
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'radius', label: 'Radius', type: 'number', default: 0.5, min: 0.001 },
      { name: 'positionX', label: 'Position X', type: 'number', default: 0 },
      { name: 'positionY', label: 'Position Y', type: 'number', default: 0 },
      { name: 'positionZ', label: 'Position Z', type: 'number', default: 0 },
    ]
  }
}

// ============================================================
// BOOLEAN FEATURES
// ============================================================

/**
 * Boolean Fuse Feature - Combines shapes with union
 */
export class FuseFeature extends Feature {
  constructor(id, name = 'Fuse', params = {}, references = []) {
    super(id, 'fuse', name, {
      toolType: params.toolType ?? 'box',
      toolParams: params.toolParams ?? { width: 1, height: 1, depth: 1 },
    }, references)
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Fuse requires an input shape')
    }
    
    const { toolType, toolParams } = this.params
    const oc = getOCCT()
    
    // Create tool shape
    let toolShape
    switch (toolType) {
      case 'box':
        toolShape = makeBox(toolParams.width || 1, toolParams.height || 1, toolParams.depth || 1)
        break
      case 'cylinder':
        toolShape = makeCylinder(toolParams.radius || 0.5, toolParams.height || 1)
        break
      case 'sphere':
        toolShape = makeSphere(toolParams.radius || 0.5)
        break
      default:
        throw new Error(`Unknown tool type: ${toolType}`)
    }
    
    // Apply transform to tool
    if (toolParams.positionX || toolParams.positionY || toolParams.positionZ) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(
        toolParams.positionX || 0,
        toolParams.positionY || 0,
        toolParams.positionZ || 0
      ))
      const transform = new oc.BRepBuilderAPI_Transform_2(toolShape, trsf, true)
      toolShape = transform.Shape()
    }
    
    // Perform fuse
    const fuse = new oc.BRepAlgoAPI_Fuse_3(inputShape, toolShape, new oc.Message_ProgressRange_1())
    if (!fuse.IsDone()) {
      throw new Error('Fuse operation failed')
    }
    
    const shape = fuse.Shape()
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }
}

/**
 * Boolean Cut Feature - Subtracts tool from input
 */
export class CutFeature extends Feature {
  constructor(id, name = 'Cut', params = {}, references = []) {
    super(id, 'cut', name, {
      toolType: params.toolType ?? 'box',
      toolParams: params.toolParams ?? { width: 0.5, height: 2, depth: 0.5, positionX: 0.25, positionY: -0.5, positionZ: 0.25 },
    }, references)
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Cut requires an input shape')
    }
    
    const { toolType, toolParams } = this.params
    const oc = getOCCT()
    
    // Create tool shape
    let toolShape
    switch (toolType) {
      case 'box':
        toolShape = makeBox(toolParams.width || 1, toolParams.height || 1, toolParams.depth || 1)
        break
      case 'cylinder':
        toolShape = makeCylinder(toolParams.radius || 0.5, toolParams.height || 1)
        break
      case 'sphere':
        toolShape = makeSphere(toolParams.radius || 0.5)
        break
      default:
        throw new Error(`Unknown tool type: ${toolType}`)
    }
    
    // Apply transform to tool
    if (toolParams.positionX || toolParams.positionY || toolParams.positionZ) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(
        toolParams.positionX || 0,
        toolParams.positionY || 0,
        toolParams.positionZ || 0
      ))
      const transform = new oc.BRepBuilderAPI_Transform_2(toolShape, trsf, true)
      toolShape = transform.Shape()
    }
    
    // Perform cut
    const cut = new oc.BRepAlgoAPI_Cut_1()
    const listArgs = new oc.TopTools_ListOfShape_1()
    listArgs.Append_1(inputShape)
    cut.SetArguments(listArgs)
    const listTools = new oc.TopTools_ListOfShape_1()
    listTools.Append_1(toolShape)
    cut.SetTools(listTools)
    cut.Build()
    if (!cut.IsDone()) {
      throw new Error('Cut operation failed')
    }

    const shape = cut.Shape()
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'toolType', label: 'Tool Type', type: 'select', options: ['box', 'cylinder', 'sphere'], default: 'box' },
    ]
  }
}

/**
 * Boolean Common Feature - Intersects shapes
 */
export class CommonFeature extends Feature {
  constructor(id, name = 'Common', params = {}, references = []) {
    super(id, 'common', name, {
      toolType: params.toolType ?? 'box',
      toolParams: params.toolParams ?? { width: 1, height: 1, depth: 1 },
    }, references)
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Common requires an input shape')
    }
    
    const { toolType, toolParams } = this.params
    const oc = getOCCT()
    
    let toolShape
    switch (toolType) {
      case 'box':
        toolShape = makeBox(toolParams.width || 1, toolParams.height || 1, toolParams.depth || 1)
        break
      case 'cylinder':
        toolShape = makeCylinder(toolParams.radius || 0.5, toolParams.height || 1)
        break
      default:
        throw new Error(`Unknown tool type: ${toolType}`)
    }
    
    if (toolParams.positionX || toolParams.positionY || toolParams.positionZ) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(
        toolParams.positionX || 0,
        toolParams.positionY || 0,
        toolParams.positionZ || 0
      ))
      const transform = new oc.BRepBuilderAPI_Transform_2(toolShape, trsf, true)
      toolShape = transform.Shape()
    }
    
    const common = new oc.BRepAlgoAPI_Common_1()
    const listArgs = new oc.TopTools_ListOfShape_1()
    listArgs.Append_1(inputShape)
    common.SetArguments(listArgs)
    const listTools = new oc.TopTools_ListOfShape_1()
    listTools.Append_1(toolShape)
    common.SetTools(listTools)
    common.Build()
    if (!common.IsDone()) {
      throw new Error('Common operation failed')
    }

    const shape = common.Shape()
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }
}

// ============================================================
// MODIFICATION FEATURES
// ============================================================

/**
 * Fillet Feature - Rounds edges
 */
export class FilletFeature extends Feature {
  constructor(id, name = 'Fillet', params = {}, references = []) {
    super(id, 'fillet', name, {
      radius: params.radius ?? 0.1,
      allEdges: params.allEdges ?? true,
    }, references)
  }

  validate() {
    const errors = []
    if (this.params.radius <= 0) errors.push('Fillet radius must be positive')
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Fillet requires an input shape')
    }
    
    const { radius, allEdges } = this.params
    const oc = getOCCT()
    
    console.log(`${LOG_PREFIX} FilletFeature.compute() - radius=${radius}`)
    
    const edgeLengths = collectEdgeLengths(oc, inputShape)
    const minEdgeLength = edgeLengths.length > 0 ? Math.min(...edgeLengths) : null
    if (minEdgeLength && radius >= minEdgeLength * 0.49) {
      throw new Error(
        `Fillet radius ${radius.toFixed(4)} is too large for the smallest edge (${minEdgeLength.toFixed(4)}).`
      )
    }

    const fillet = new oc.BRepFilletAPI_MakeFillet(inputShape, oc.ChFi3d_FilletShape.ChFi3d_Rational)

    let addedEdges = 0
    const needsRepair = []
    if (allEdges) {
      // Apply fillet to all edges
      const edgeExplorer = new oc.TopExp_Explorer_2(
        inputShape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
      
      while (edgeExplorer.More()) {
        const edge = oc.TopoDS.Edge_1(edgeExplorer.Current())
        try {
          fillet.Add_2(radius, edge)
          addedEdges += 1
        } catch (e) {
          // Some edges may not be fillettable
        }
        edgeExplorer.Next()
      }
    } else {
      const { resolved, missing } = resolveTopologyReferences(
        this.references,
        'EDGE',
        context?.inputTopologyMap
      )
      const referencedEdgeIds = resolved.map((entry) => entry.topologyId)
      needsRepair.push(...missing)
      const indexedEdges = buildIndexedEdges(oc, inputShape)

      for (const edgeId of referencedEdgeIds) {
        const edge = indexedEdges.get(edgeId)
        if (!edge) continue
        try {
          fillet.Add_2(radius, edge)
          addedEdges += 1
        } catch (e) {
          // Skip unfilletable edges.
        }
      }
    }

    if (addedEdges === 0) {
      const error = new Error('Fillet requires at least one valid edge selection.')
      error.code = 'NEEDS_REPAIR'
      error.needsRepair = needsRepair
      throw error
    }

    try {
      if (typeof fillet.Build === 'function') {
        fillet.Build()
      }
      if (typeof fillet.IsDone === 'function' && !fillet.IsDone()) {
        throw new Error('OCCT fillet build failed')
      }

      const shape = fillet.Shape()
      validateOutputShape(oc, shape, 'Fillet')
      const { geometry, topologyMap } = shapeToGeometry(shape)
      return { shape, geometry, topologyMap, needsRepair }
    } catch (e) {
      throw new Error(`Fillet failed: ${e.message}`)
    }
  }

  static getParameterDefinitions() {
    return [
      { name: 'radius', label: 'Radius', type: 'number', default: 0.1, min: 0.001 },
      { name: 'allEdges', label: 'All Edges', type: 'boolean', default: true },
    ]
  }
}

/**
 * Chamfer Feature - Bevels edges
 */
export class ChamferFeature extends Feature {
  constructor(id, name = 'Chamfer', params = {}, references = []) {
    super(id, 'chamfer', name, {
      distance: params.distance ?? 0.1,
      allEdges: params.allEdges ?? true,
    }, references)
  }

  validate() {
    const errors = []
    if (this.params.distance <= 0) errors.push('Chamfer distance must be positive')
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Chamfer requires an input shape')
    }
    
    const { distance, allEdges } = this.params
    const oc = getOCCT()
    
    console.log(`${LOG_PREFIX} ChamferFeature.compute() - distance=${distance}`)
    
    const edgeLengths = collectEdgeLengths(oc, inputShape)
    const minEdgeLength = edgeLengths.length > 0 ? Math.min(...edgeLengths) : null
    if (minEdgeLength && distance >= minEdgeLength * 0.49) {
      throw new Error(
        `Chamfer distance ${distance.toFixed(4)} is too large for the smallest edge (${minEdgeLength.toFixed(4)}).`
      )
    }

    const chamfer = new oc.BRepFilletAPI_MakeChamfer(inputShape)

    let addedEdges = 0
    const needsRepair = []
    if (allEdges) {
      const edgeExplorer = new oc.TopExp_Explorer_2(
        inputShape,
        oc.TopAbs_ShapeEnum.TopAbs_EDGE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE
      )
      
      while (edgeExplorer.More()) {
        const edge = oc.TopoDS.Edge_1(edgeExplorer.Current())
        try {
          chamfer.Add_2(distance, edge)
          addedEdges += 1
        } catch (e) {
          // Some edges may not be chamferable
        }
        edgeExplorer.Next()
      }
    } else {
      const { resolved, missing } = resolveTopologyReferences(
        this.references,
        'EDGE',
        context?.inputTopologyMap
      )
      const referencedEdgeIds = resolved.map((entry) => entry.topologyId)
      needsRepair.push(...missing)
      const indexedEdges = buildIndexedEdges(oc, inputShape)

      for (const edgeId of referencedEdgeIds) {
        const edge = indexedEdges.get(edgeId)
        if (!edge) continue
        try {
          chamfer.Add_2(distance, edge)
          addedEdges += 1
        } catch (e) {
          // Skip unchamferable edges.
        }
      }
    }

    if (addedEdges === 0) {
      const error = new Error('Chamfer requires at least one valid edge selection.')
      error.code = 'NEEDS_REPAIR'
      error.needsRepair = needsRepair
      throw error
    }

    try {
      if (typeof chamfer.Build === 'function') {
        chamfer.Build()
      }
      if (typeof chamfer.IsDone === 'function' && !chamfer.IsDone()) {
        throw new Error('OCCT chamfer build failed')
      }

      const shape = chamfer.Shape()
      validateOutputShape(oc, shape, 'Chamfer')
      const { geometry, topologyMap } = shapeToGeometry(shape)
      return { shape, geometry, topologyMap, needsRepair }
    } catch (e) {
      throw new Error(`Chamfer failed: ${e.message}`)
    }
  }

  static getParameterDefinitions() {
    return [
      { name: 'distance', label: 'Distance', type: 'number', default: 0.1, min: 0.001 },
      { name: 'allEdges', label: 'All Edges', type: 'boolean', default: true },
    ]
  }
}

// ============================================================
// TRANSFORM FEATURES  
// ============================================================

/**
 * Transform Feature - Translates, rotates, or scales
 */
export class TransformFeature extends Feature {
  constructor(id, name = 'Transform', params = {}, references = []) {
    super(id, 'transform', name, {
      bodyId: params.bodyId ?? null,
      translateX: params.translateX ?? 0,
      translateY: params.translateY ?? 0,
      translateZ: params.translateZ ?? 0,
      rotateX: params.rotateX ?? 0, // degrees
      rotateY: params.rotateY ?? 0,
      rotateZ: params.rotateZ ?? 0,
      scaleX: params.scaleX ?? params.scale ?? 1,
      scaleY: params.scaleY ?? params.scale ?? 1,
      scaleZ: params.scaleZ ?? params.scale ?? 1,
    }, references)
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Transform requires an input shape')
    }
    
    const {
      translateX,
      translateY,
      translateZ,
      rotateX,
      rotateY,
      rotateZ,
      scaleX,
      scaleY,
      scaleZ,
    } = this.params
    const oc = getOCCT()
    
    let shape = inputShape
    
    // Apply translation
    if (translateX !== 0 || translateY !== 0 || translateZ !== 0) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetTranslation_1(new oc.gp_Vec_4(translateX, translateY, translateZ))
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    
    // Apply rotation (around origin)
    if (rotateX !== 0) {
      const trsf = new oc.gp_Trsf_1()
      const axis = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(1, 0, 0))
      trsf.SetRotation_1(axis, rotateX * Math.PI / 180)
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    if (rotateY !== 0) {
      const trsf = new oc.gp_Trsf_1()
      const axis = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 1, 0))
      trsf.SetRotation_1(axis, rotateY * Math.PI / 180)
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    if (rotateZ !== 0) {
      const trsf = new oc.gp_Trsf_1()
      const axis = new oc.gp_Ax1_2(new oc.gp_Pnt_1(), new oc.gp_Dir_4(0, 0, 1))
      trsf.SetRotation_1(axis, rotateZ * Math.PI / 180)
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    
    // Apply scale (non-uniform if supported by binding)
    if ((scaleX !== 1 || scaleY !== 1 || scaleZ !== 1) && scaleX > 0 && scaleY > 0 && scaleZ > 0) {
      const trsf = new oc.gp_Trsf_1()
      if (typeof trsf.SetValues === 'function') {
        trsf.SetValues(
          scaleX, 0, 0, 0,
          0, scaleY, 0, 0,
          0, 0, scaleZ, 0
        )
      } else {
        const uniform = (scaleX + scaleY + scaleZ) / 3
        trsf.SetScaleFactor(uniform)
      }
      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      shape = transform.Shape()
    }
    
    const { geometry, topologyMap } = shapeToGeometry(shape)
    
    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'translateX', label: 'Translate X', type: 'number', default: 0 },
      { name: 'translateY', label: 'Translate Y', type: 'number', default: 0 },
      { name: 'translateZ', label: 'Translate Z', type: 'number', default: 0 },
      { name: 'rotateX', label: 'Rotate X (deg)', type: 'number', default: 0 },
      { name: 'rotateY', label: 'Rotate Y (deg)', type: 'number', default: 0 },
      { name: 'rotateZ', label: 'Rotate Z (deg)', type: 'number', default: 0 },
      { name: 'scaleX', label: 'Scale X', type: 'number', default: 1, min: 0.001 },
      { name: 'scaleY', label: 'Scale Y', type: 'number', default: 1, min: 0.001 },
      { name: 'scaleZ', label: 'Scale Z', type: 'number', default: 1, min: 0.001 },
    ]
  }
}

/**
 * Extrude Feature - Creates a prism from a sketch profile
 */
export class ExtrudeFeature extends Feature {
  constructor(id, name = 'Extrude', params = {}, references = []) {
    super(id, 'extrude', name, {
      sketchId: params.sketchId ?? null,
      wireKey: params.wireKey ?? null,
      regionId: params.regionId ?? null,
      plane: params.plane ?? null,
      profile: params.profile ?? null,
      length: params.length ?? 10,
      direction: params.direction ?? 'normal', // normal | reverse
      operation: params.operation ?? 'new', // new | add | cut | intersect
      targetBodyId: params.targetBodyId ?? null,
    }, references)
  }

  validate() {
    const errors = []
    const length = Number(this.params.length)
    if (!Number.isFinite(length) || Math.abs(length) <= 1e-6) {
      errors.push('Extrude length must be non-zero')
    }
    if (!this.params.profile || !this.params.profile.type) {
      errors.push('Extrude requires a closed sketch profile')
    }
    const operation = this.params.operation
    if (!['new', 'add', 'cut', 'intersect'].includes(operation)) {
      errors.push('Extrude operation must be New, Add, Cut, or Intersect')
    }
    return { valid: errors.length === 0, errors }
  }

  compute(inputShape, context) {
    const oc = getOCCT()
    const operation = this.params.operation || 'new'
    const sign = this.params.direction === 'reverse' ? -1 : 1
    const length = Number(this.params.length) * sign

    const plane = this.params.plane || {}
    const originArr = Array.isArray(plane.origin) ? plane.origin : [0, 0, 0]
    const normalArr = Array.isArray(plane.normal) ? plane.normal : [0, 0, 1]
    const xAxisArr = Array.isArray(plane.xAxis) ? plane.xAxis : [1, 0, 0]
    const yAxisArr = Array.isArray(plane.yAxis) ? plane.yAxis : [0, 1, 0]

    const origin = {
      x: Number(originArr[0]) || 0,
      y: Number(originArr[1]) || 0,
      z: Number(originArr[2]) || 0,
    }
    const normal = new THREE.Vector3(
      Number(normalArr[0]) || 0,
      Number(normalArr[1]) || 0,
      Number(normalArr[2]) || 1
    )
    if (normal.lengthSq() < 1e-9) {
      throw new Error('Sketch plane normal is invalid')
    }
    normal.normalize()

    const xAxis = new THREE.Vector3(
      Number(xAxisArr[0]) || 1,
      Number(xAxisArr[1]) || 0,
      Number(xAxisArr[2]) || 0
    )
    if (xAxis.lengthSq() < 1e-9 || Math.abs(xAxis.dot(normal)) > 0.999) {
      xAxis.copy(Math.abs(normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1).cross(normal) : new THREE.Vector3(0, 1, 0).cross(normal))
    }
    xAxis.normalize()

    const yAxis = new THREE.Vector3(
      Number(yAxisArr[0]) || 0,
      Number(yAxisArr[1]) || 1,
      Number(yAxisArr[2]) || 0
    )
    if (yAxis.lengthSq() < 1e-9 || Math.abs(yAxis.dot(normal)) > 0.999) {
      yAxis.copy(new THREE.Vector3().crossVectors(normal, xAxis))
    }
    yAxis.normalize()

    const toWorld = (u, v) => ({
      x: origin.x + xAxis.x * (Number(u) || 0) + yAxis.x * (Number(v) || 0),
      y: origin.y + xAxis.y * (Number(u) || 0) + yAxis.y * (Number(v) || 0),
      z: origin.z + xAxis.z * (Number(u) || 0) + yAxis.z * (Number(v) || 0),
    })

    const profile = this.params.profile
    const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1()

    if (profile?.type === 'circle') {
      const centerUv = profile.center || [0, 0]
      const radius = Number(profile.radius)
      if (!Number.isFinite(radius) || radius <= 1e-9) {
        throw new Error('Profile not closed: invalid circle radius')
      }
      const center3 = toWorld(centerUv[0], centerUv[1])
      const center = new oc.gp_Pnt_3(center3.x, center3.y, center3.z)
      const dir = new oc.gp_Dir_4(normal.x, normal.y, normal.z)
      const axis = new oc.gp_Ax2_3(center, dir)
      const circle = new oc.gp_Circ_2(axis, radius)
      const edge = new oc.BRepBuilderAPI_MakeEdge_8(circle).Edge()
      wireBuilder.Add_1(edge)
    } else if (profile?.type === 'polyline') {
      const points = Array.isArray(profile.points) ? profile.points : []
      if (points.length < 3) {
        throw new Error('Profile not closed: at least 3 points are required')
      }
      for (let i = 0; i < points.length; i += 1) {
        const current = points[i]
        const next = points[(i + 1) % points.length]
        const a = toWorld(current[0], current[1])
        const b = toWorld(next[0], next[1])
        const p1 = new oc.gp_Pnt_3(a.x, a.y, a.z)
        const p2 = new oc.gp_Pnt_3(b.x, b.y, b.z)
        const edgeMaker = new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)
        if (!edgeMaker.IsDone()) {
          throw new Error('Profile not closed: failed to build one or more edges')
        }
        wireBuilder.Add_1(edgeMaker.Edge())
      }
    } else {
      throw new Error('Extrude requires a valid sketch profile')
    }

    if (!wireBuilder.IsDone()) {
      throw new Error('Profile not closed: wire construction failed')
    }

    const wire = wireBuilder.Wire()
    if (!isWireClosed(wire)) {
      throw new Error('Profile is not closed. Connect endpoints or close the loop before extruding.')
    }

    const faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true)
    if (!faceMaker.IsDone()) {
      throw new Error('Profile not closed: face could not be created')
    }
    const face = faceMaker.Face()

    const extrusionVec = new oc.gp_Vec_4(normal.x * length, normal.y * length, normal.z * length)
    const prism = new oc.BRepPrimAPI_MakePrism_1(face, extrusionVec, false, true)
    if (!prism.IsDone()) {
      throw new Error('Extrude failed while creating prism')
    }
    const prismShape = prism.Shape()
    validateOutputShape(oc, prismShape, 'Extrude')

    let shape = prismShape
    if (operation === 'new' || operation === 'add') {
      if (inputShape) {
        const fuse = new oc.BRepAlgoAPI_Fuse_2(inputShape, prismShape)
        shape = fuse.Shape()
      }
    } else {
      if (!inputShape) {
        throw new Error(`${operation === 'cut' ? 'Cut' : 'Intersect'} requires an existing target body`)
      }
      if (operation === 'cut') {
        const cut = new oc.BRepAlgoAPI_Cut_1()
        const args = new oc.TopTools_ListOfShape_1()
        args.Append_1(inputShape)
        cut.SetArguments(args)
        const tools = new oc.TopTools_ListOfShape_1()
        tools.Append_1(prismShape)
        cut.SetTools(tools)
        cut.Build()
        if (!cut.IsDone()) throw new Error('Extrude cut operation failed')
        shape = cut.Shape()
      } else if (operation === 'intersect') {
        const common = new oc.BRepAlgoAPI_Common_1()
        const args = new oc.TopTools_ListOfShape_1()
        args.Append_1(inputShape)
        common.SetArguments(args)
        const tools = new oc.TopTools_ListOfShape_1()
        tools.Append_1(prismShape)
        common.SetTools(tools)
        common.Build()
        if (!common.IsDone()) throw new Error('Extrude intersect operation failed')
        shape = common.Shape()
      }
    }

    validateOutputShape(oc, shape, 'Extrude')
    const { geometry, topologyMap } = shapeToGeometry(shape)
    return { shape, geometry, topologyMap }
  }

  static getParameterDefinitions() {
    return [
      { name: 'length', label: 'Length', type: 'number', default: 10, min: 0.001 },
      { name: 'direction', label: 'Direction', type: 'select', options: ['normal', 'reverse'], default: 'normal' },
      { name: 'operation', label: 'Operation', type: 'select', options: ['new', 'add', 'cut', 'intersect'], default: 'new' },
    ]
  }
}

// ============================================================
// REGISTER ALL FEATURES
// ============================================================

FeatureRegistry.register('box', BoxFeature)
FeatureRegistry.register('cylinder', CylinderFeature)
FeatureRegistry.register('cone', ConeFeature)
FeatureRegistry.register('sphere', SphereFeature)
FeatureRegistry.register('fuse', FuseFeature)
FeatureRegistry.register('cut', CutFeature)
FeatureRegistry.register('common', CommonFeature)
FeatureRegistry.register('fillet', FilletFeature)
FeatureRegistry.register('chamfer', ChamferFeature)
FeatureRegistry.register('transform', TransformFeature)
FeatureRegistry.register('extrude', ExtrudeFeature)

/**
 * Create a new feature instance
 * @param {string} type - Feature type
 * @param {string} name - Feature name
 * @param {Object} params - Feature parameters
 * @param {Array} references - Topology references
 * @returns {Feature} - New feature instance
 */
export function createFeature(type, name, params = {}, references = []) {
  const FeatureClass = FeatureRegistry.get(type)
  if (!FeatureClass) {
    throw new Error(`Unknown feature type: ${type}`)
  }
  
  const id = `feature-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  return new FeatureClass(id, name, params, references)
}
