/**
 * OCCT Operations Wrapper with Diagnostics
 *
 * Wraps all OCCT operations with:
 * - Try/catch error handling
 * - Shape validation (BRepCheck_Analyzer)
 * - Detailed error messages
 * - Debug information collection
 * - Automatic meshing with controlled deflection
 *
 * This prevents silent failures and provides actionable error messages.
 */

import { getOCCT, isOCCTReady, shapeToGeometry } from './occtService'

export interface OCCTOperationResult {
  ok: boolean
  shape?: any
  geometry?: any
  topologyMap?: any
  error?: string
  debug?: {
    operation: string
    params?: any
    validationErrors?: string[]
    shapeType?: string
    isSolid?: boolean
    isValid?: boolean
  }
}

/**
 * Run an OCCT operation with full diagnostics
 * @param opName - Operation name for logging
 * @param fn - Function that returns a shape
 * @returns Result with shape or error
 */
export function runOCCTOp(
  opName: string,
  fn: () => any,
  params?: any
): OCCTOperationResult {
  if (!isOCCTReady()) {
    return {
      ok: false,
      error: 'OCCT not ready',
      debug: { operation: opName, params },
    }
  }

  const oc = getOCCT()

  try {
    console.log(`[OCCTOps] ${opName} - start`, params)

    // Run the operation
    const shape = fn()

    // Validate the result
    const validation = validateShape(shape)

    if (!validation.isValid) {
      console.error(`[OCCTOps] ${opName} - validation failed:`, validation.errors)
      return {
        ok: false,
        error: `${opName} produced invalid shape: ${validation.errors.join(', ')}`,
        debug: {
          operation: opName,
          params,
          validationErrors: validation.errors,
          shapeType: getShapeTypeName(shape),
          isSolid: isSolid(shape),
          isValid: false,
        },
      }
    }

    // Mesh the shape
    let geometry, topologyMap
    try {
      const meshResult = shapeToGeometry(shape)
      geometry = meshResult.geometry
      topologyMap = meshResult.topologyMap
    } catch (meshError: any) {
      console.error(`[OCCTOps] ${opName} - meshing failed:`, meshError)
      return {
        ok: false,
        error: `${opName} succeeded but meshing failed: ${meshError.message}`,
        debug: {
          operation: opName,
          params,
          validationErrors: [`Meshing error: ${meshError.message}`],
          shapeType: getShapeTypeName(shape),
          isSolid: isSolid(shape),
          isValid: true,
        },
      }
    }

    console.log(`[OCCTOps] ${opName} - success`, {
      shapeType: getShapeTypeName(shape),
      vertexCount: geometry?.attributes?.position?.count || 0,
    })

    return {
      ok: true,
      shape,
      geometry,
      topologyMap,
      debug: {
        operation: opName,
        params,
        shapeType: getShapeTypeName(shape),
        isSolid: isSolid(shape),
        isValid: true,
      },
    }
  } catch (error: any) {
    console.error(`[OCCTOps] ${opName} - exception:`, error)
    return {
      ok: false,
      error: `${opName} failed: ${error.message || error}`,
      debug: {
        operation: opName,
        params,
        validationErrors: [error.message || String(error)],
      },
    }
  }
}

/**
 * Validate a TopoDS_Shape
 * @param shape - OCCT shape to validate
 * @returns Validation result
 */
export function validateShape(shape: any): {
  isValid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  if (!shape) {
    errors.push('Shape is null or undefined')
    return { isValid: false, errors, warnings }
  }

  const oc = getOCCT()

  try {
    // Check if shape is null
    if (shape.IsNull()) {
      errors.push('Shape.IsNull() returned true')
      return { isValid: false, errors, warnings }
    }

    // Check shape type
    const shapeType = shape.ShapeType()
    if (
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_COMPOUND ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_COMPSOLID ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_SOLID ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_SHELL ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_FACE ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_WIRE ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_EDGE ||
      shapeType === oc.TopAbs_ShapeEnum.TopAbs_VERTEX
    ) {
      // Valid shape type
    } else {
      warnings.push(`Unknown shape type: ${shapeType}`)
    }

    // Run BRepCheck_Analyzer
    try {
      const analyzer = new oc.BRepCheck_Analyzer(shape, false)
      if (!analyzer.IsValid()) {
        errors.push('BRepCheck_Analyzer reports invalid shape')
        // Try to get more details if possible
      } else {
        // Shape is valid
      }
    } catch (analyzerError: any) {
      warnings.push(`BRepCheck_Analyzer failed: ${analyzerError.message}`)
      // Some shapes may not support analysis, continue
    }
  } catch (error: any) {
    errors.push(`Validation exception: ${error.message}`)
    return { isValid: false, errors, warnings }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Get human-readable shape type name
 */
export function getShapeTypeName(shape: any): string {
  if (!shape || shape.IsNull()) return 'NULL'

  const oc = getOCCT()
  const shapeType = shape.ShapeType()

  switch (shapeType) {
    case oc.TopAbs_ShapeEnum.TopAbs_COMPOUND:
      return 'COMPOUND'
    case oc.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
      return 'COMPSOLID'
    case oc.TopAbs_ShapeEnum.TopAbs_SOLID:
      return 'SOLID'
    case oc.TopAbs_ShapeEnum.TopAbs_SHELL:
      return 'SHELL'
    case oc.TopAbs_ShapeEnum.TopAbs_FACE:
      return 'FACE'
    case oc.TopAbs_ShapeEnum.TopAbs_WIRE:
      return 'WIRE'
    case oc.TopAbs_ShapeEnum.TopAbs_EDGE:
      return 'EDGE'
    case oc.TopAbs_ShapeEnum.TopAbs_VERTEX:
      return 'VERTEX'
    default:
      return `UNKNOWN(${shapeType})`
  }
}

/**
 * Check if shape is a solid
 */
export function isSolid(shape: any): boolean {
  if (!shape || shape.IsNull()) return false
  const oc = getOCCT()
  return shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_SOLID
}

/**
 * Check if shape is a compound
 */
export function isCompound(shape: any): boolean {
  if (!shape || shape.IsNull()) return false
  const oc = getOCCT()
  return shape.ShapeType() === oc.TopAbs_ShapeEnum.TopAbs_COMPOUND
}

/**
 * Convert compound to solid if it contains a single solid
 */
export function normalizeToSolid(shape: any): any {
  if (!shape || shape.IsNull()) return shape
  if (isSolid(shape)) return shape

  const oc = getOCCT()

  if (isCompound(shape)) {
    // Try to extract single solid from compound
    const explorer = new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum.TopAbs_SOLID,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE
    )

    if (explorer.More()) {
      const solid = oc.TopoDS.Solid_1(explorer.Current())
      explorer.Next()

      // Check if there's only one solid
      if (!explorer.More()) {
        console.log('[OCCTOps] Normalized compound to single solid')
        return solid
      }
    }
  }

  // Can't normalize, return original
  return shape
}

/**
 * Fuse operation with diagnostics
 */
export function fuseOp(shape1: any, shape2: any, fuzzyValue: number = 1e-6): OCCTOperationResult {
  return runOCCTOp(
    'Fuse',
    () => {
      const oc = getOCCT()
      // Create fuse operation
      const fuse = new oc.BRepAlgoAPI_Fuse_1()

      // Set arguments (shape1 is the object)
      const listArgs = new oc.TopTools_ListOfShape_1()
      listArgs.Append_1(shape1)
      fuse.SetArguments(listArgs)

      // Set tools (shape2 is the tool)
      const listTools = new oc.TopTools_ListOfShape_1()
      listTools.Append_1(shape2)
      fuse.SetTools(listTools)

      // Perform the operation
      fuse.Build()

      if (!fuse.IsDone()) {
        throw new Error('BRepAlgoAPI_Fuse.IsDone() returned false')
      }
      return fuse.Shape()
    },
    { fuzzyValue }
  )
}

/**
 * Cut operation with diagnostics
 */
export function cutOp(shape1: any, shape2: any, fuzzyValue: number = 1e-6): OCCTOperationResult {
  return runOCCTOp(
    'Cut',
    () => {
      const oc = getOCCT()
      // Create cut operation
      const cut = new oc.BRepAlgoAPI_Cut_1()

      // Set arguments (shape1 is the object)
      const listArgs = new oc.TopTools_ListOfShape_1()
      listArgs.Append_1(shape1)
      cut.SetArguments(listArgs)

      // Set tools (shape2 is the tool)
      const listTools = new oc.TopTools_ListOfShape_1()
      listTools.Append_1(shape2)
      cut.SetTools(listTools)

      // Perform the operation
      cut.Build()

      if (!cut.IsDone()) {
        throw new Error('BRepAlgoAPI_Cut.IsDone() returned false')
      }
      return cut.Shape()
    },
    { fuzzyValue }
  )
}

/**
 * Common (intersection) operation with diagnostics
 */
export function commonOp(shape1: any, shape2: any, fuzzyValue: number = 1e-6): OCCTOperationResult {
  return runOCCTOp(
    'Common',
    () => {
      const oc = getOCCT()
      // Create common operation
      const common = new oc.BRepAlgoAPI_Common_1()

      // Set arguments (shape1 is the object)
      const listArgs = new oc.TopTools_ListOfShape_1()
      listArgs.Append_1(shape1)
      common.SetArguments(listArgs)

      // Set tools (shape2 is the tool)
      const listTools = new oc.TopTools_ListOfShape_1()
      listTools.Append_1(shape2)
      common.SetTools(listTools)

      // Perform the operation
      common.Build()

      if (!common.IsDone()) {
        throw new Error('BRepAlgoAPI_Common.IsDone() returned false')
      }
      return common.Shape()
    },
    { fuzzyValue }
  )
}

/**
 * Fillet operation with diagnostics
 */
export function filletOp(shape: any, edges: any[], radius: number): OCCTOperationResult {
  return runOCCTOp(
    'Fillet',
    () => {
      const oc = getOCCT()
      const fillet = new oc.BRepFilletAPI_MakeFillet(
        shape,
        oc.ChFi3d_FilletShape.ChFi3d_Rational
      )

      let addedCount = 0
      for (const edge of edges) {
        try {
          fillet.Add_2(radius, edge)
          addedCount++
        } catch (e) {
          console.warn('[OCCTOps] Fillet - could not add edge:', e)
        }
      }

      if (addedCount === 0) {
        throw new Error('No edges could be filleted')
      }

      const result = fillet.Shape()
      if (result.IsNull()) {
        throw new Error('Fillet.Shape() returned null')
      }

      return result
    },
    { radius, edgeCount: edges.length }
  )
}

/**
 * Chamfer operation with diagnostics
 */
export function chamferOp(
  shape: any,
  edges: any[],
  distance: number,
  distance2?: number
): OCCTOperationResult {
  return runOCCTOp(
    'Chamfer',
    () => {
      const oc = getOCCT()
      const chamfer = new oc.BRepFilletAPI_MakeChamfer(shape)

      let addedCount = 0
      for (const edge of edges) {
        try {
          if (distance2 !== undefined) {
            // Two-distance chamfer
            chamfer.Add_3(distance, distance2, edge)
          } else {
            // Equal distance chamfer
            chamfer.Add_2(distance, edge)
          }
          addedCount++
        } catch (e) {
          console.warn('[OCCTOps] Chamfer - could not add edge:', e)
        }
      }

      if (addedCount === 0) {
        throw new Error('No edges could be chamfered')
      }

      const result = chamfer.Shape()
      if (result.IsNull()) {
        throw new Error('Chamfer.Shape() returned null')
      }

      return result
    },
    { distance, distance2, edgeCount: edges.length }
  )
}

/**
 * Shell (hollow) operation with diagnostics
 */
export function shellOp(shape: any, facesToRemove: any[], thickness: number): OCCTOperationResult {
  return runOCCTOp(
    'Shell',
    () => {
      const oc = getOCCT()

      // Create list of faces to remove
      const facesMap = new oc.TopTools_ListOfShape_1()
      for (const face of facesToRemove) {
        facesMap.Append_1(face)
      }

      const offset = new oc.BRepOffsetAPI_MakeThickSolid()
      offset.MakeThickSolidByJoin(
        shape,
        facesMap,
        thickness,
        1e-6, // tolerance
        oc.BRepOffset_Mode.BRepOffset_Skin, // mode
        false, // intersection
        false, // self intersection
        oc.GeomAbs_JoinType.GeomAbs_Arc, // join type
        false // remove internal edges
      )

      if (!offset.IsDone()) {
        throw new Error('BRepOffsetAPI_MakeThickSolid.IsDone() returned false')
      }

      const result = offset.Shape()
      if (result.IsNull()) {
        throw new Error('Shell.Shape() returned null')
      }

      return result
    },
    { thickness, faceCount: facesToRemove.length }
  )
}

/**
 * Mirror operation with diagnostics
 */
export function mirrorOp(shape: any, plane: { origin: [number, number, number], normal: [number, number, number] }): OCCTOperationResult {
  return runOCCTOp(
    'Mirror',
    () => {
      const oc = getOCCT()

      const trsf = new oc.gp_Trsf_1()
      const pln = new oc.gp_Pln_3(
        new oc.gp_Pnt_3(plane.origin[0], plane.origin[1], plane.origin[2]),
        new oc.gp_Dir_4(plane.normal[0], plane.normal[1], plane.normal[2])
      )
      trsf.SetMirror_2(pln)

      const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true)
      const result = transform.Shape()

      if (result.IsNull()) {
        throw new Error('Mirror transform returned null')
      }

      return result
    },
    { plane }
  )
}

/**
 * Collect all edges from a shape
 */
export function collectEdges(shape: any): any[] {
  const oc = getOCCT()
  const edges: any[] = []

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (explorer.More()) {
    const edge = oc.TopoDS.Edge_1(explorer.Current())
    edges.push(edge)
    explorer.Next()
  }

  return edges
}

/**
 * Collect all faces from a shape
 */
export function collectFaces(shape: any): any[] {
  const oc = getOCCT()
  const faces: any[] = []

  const explorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE
  )

  while (explorer.More()) {
    const face = oc.TopoDS.Face_1(explorer.Current())
    faces.push(face)
    explorer.Next()
  }

  return faces
}
