/**
 * Dispose Three.js Object3D and all its children recursively
 * Cleans up geometries, materials, and textures to prevent memory leaks
 */

import * as THREE from 'three'

export function disposeObject3D(object: THREE.Object3D): void {
  if (!object) return

  // Traverse and dispose children first
  object.traverse((child: any) => {
    // Dispose geometry
    if (child.geometry) {
      child.geometry.dispose()
    }

    // Dispose materials
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material: THREE.Material) => disposeMaterial(material))
      } else {
        disposeMaterial(child.material)
      }
    }

    // Dispose any user data that might hold resources
    if (child.dispose && typeof child.dispose === 'function') {
      child.dispose()
    }
  })

  // Remove from parent
  if (object.parent) {
    object.parent.remove(object)
  }

  // Clear children
  while (object.children.length > 0) {
    object.remove(object.children[0])
  }
}

function disposeMaterial(material: THREE.Material): void {
  // Dispose textures
  const materialWithMaps = material as any
  Object.keys(materialWithMaps).forEach((key) => {
    const value = materialWithMaps[key]
    if (value && value.isTexture) {
      value.dispose()
    }
  })

  // Dispose material itself
  material.dispose()
}
