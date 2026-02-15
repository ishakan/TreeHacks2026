/**
 * Compute statistics for imported 3D objects
 */

import * as THREE from 'three'

export interface ObjectStats {
  vertices: number
  triangles: number
  meshes: number
}

export function computeObjectStats(object: THREE.Object3D): ObjectStats {
  let vertices = 0
  let triangles = 0
  let meshes = 0

  object.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      meshes++

      const geometry = child.geometry as THREE.BufferGeometry

      // Count vertices
      const positionAttr = geometry.getAttribute('position')
      if (positionAttr) {
        vertices += positionAttr.count
      }

      // Count triangles
      const index = geometry.getIndex()
      if (index) {
        triangles += index.count / 3
      } else if (positionAttr) {
        triangles += positionAttr.count / 3
      }
    }
  })

  return {
    vertices: Math.floor(vertices),
    triangles: Math.floor(triangles),
    meshes,
  }
}

export function computeMaterialsCount(object: THREE.Object3D): number {
  const materials = new Set<THREE.Material>()

  object.traverse((child: any) => {
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((mat: THREE.Material) => materials.add(mat))
      } else {
        materials.add(child.material)
      }
    }
  })

  return materials.size
}

export function computeBoundingBox(object: THREE.Object3D): THREE.Box3 {
  const bbox = new THREE.Box3()
  bbox.setFromObject(object)
  return bbox
}

export function centerObject(object: THREE.Object3D): void {
  const bbox = computeBoundingBox(object)
  const center = bbox.getCenter(new THREE.Vector3())
  object.position.sub(center)
}

export function scaleToUnits(object: THREE.Object3D, sourceUnits: string, targetUnits: string = 'mm'): void {
  const unitsToMeters: Record<string, number> = {
    mm: 0.001,
    cm: 0.01,
    m: 1,
  }

  const sourceScale = unitsToMeters[sourceUnits] || 1
  const targetScale = unitsToMeters[targetUnits] || 0.001 // Default to mm

  const scaleFactor = sourceScale / targetScale
  object.scale.multiplyScalar(scaleFactor)
}
