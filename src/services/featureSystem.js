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
  shapeToGeometry,
} from './occtService'

const LOG_PREFIX = '[FeatureSystem]'

// Feature status enum
export const FeatureStatus = {
  OK: 'ok',
  ERROR: 'error',
  SUPPRESSED: 'suppressed',
  PENDING: 'pending',
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
    
    const fillet = new oc.BRepFilletAPI_MakeFillet(inputShape, oc.ChFi3d_FilletShape.ChFi3d_Rational)
    
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
        } catch (e) {
          // Some edges may not be fillettable
        }
        edgeExplorer.Next()
      }
    } else {
      // Apply only to referenced edges
      // TODO: Resolve references to actual edges
    }
    
    try {
      const shape = fillet.Shape()
      const { geometry, topologyMap } = shapeToGeometry(shape)
      return { shape, geometry, topologyMap }
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
    
    const chamfer = new oc.BRepFilletAPI_MakeChamfer(inputShape)
    
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
        } catch (e) {
          // Some edges may not be chamferable
        }
        edgeExplorer.Next()
      }
    }
    
    try {
      const shape = chamfer.Shape()
      const { geometry, topologyMap } = shapeToGeometry(shape)
      return { shape, geometry, topologyMap }
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
      translateX: params.translateX ?? 0,
      translateY: params.translateY ?? 0,
      translateZ: params.translateZ ?? 0,
      rotateX: params.rotateX ?? 0, // degrees
      rotateY: params.rotateY ?? 0,
      rotateZ: params.rotateZ ?? 0,
      scale: params.scale ?? 1,
    }, references)
  }

  compute(inputShape, context) {
    if (!inputShape) {
      throw new Error('Transform requires an input shape')
    }
    
    const { translateX, translateY, translateZ, rotateX, rotateY, rotateZ, scale } = this.params
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
    
    // Apply scale
    if (scale !== 1 && scale > 0) {
      const trsf = new oc.gp_Trsf_1()
      trsf.SetScaleFactor(scale)
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
      { name: 'scale', label: 'Scale', type: 'number', default: 1, min: 0.001 },
    ]
  }
}

// ============================================================
// REGISTER ALL FEATURES
// ============================================================

FeatureRegistry.register('box', BoxFeature)
FeatureRegistry.register('cylinder', CylinderFeature)
FeatureRegistry.register('sphere', SphereFeature)
FeatureRegistry.register('fuse', FuseFeature)
FeatureRegistry.register('cut', CutFeature)
FeatureRegistry.register('common', CommonFeature)
FeatureRegistry.register('fillet', FilletFeature)
FeatureRegistry.register('chamfer', ChamferFeature)
FeatureRegistry.register('transform', TransformFeature)

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
