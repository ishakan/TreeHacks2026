/**
 * GLB/GLTF Importer
 *
 * Loads .glb/.gltf files using THREE.GLTFLoader
 * Supports materials, textures, animations, and hierarchies
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { computeObjectStats, computeMaterialsCount, computeBoundingBox, centerObject, scaleToUnits } from '../utils/computeStats'

export interface ImportGLBOptions {
  units?: 'mm' | 'cm' | 'm'
  autoCenter?: boolean
  keepMaterials?: boolean
  convertToSingleMesh?: boolean
}

export interface ImportGLBResult {
  object: THREE.Object3D
  stats: {
    vertices: number
    triangles: number
    meshes: number
  }
  materials: {
    count: number
  }
  bbox: {
    min: [number, number, number]
    max: [number, number, number]
  }
  animations?: THREE.AnimationClip[]
}

export async function importGLB(
  file: File,
  options: ImportGLBOptions = {}
): Promise<ImportGLBResult> {
  const {
    units = 'm', // GLB typically uses meters
    autoCenter = true,
    keepMaterials = true,
    convertToSingleMesh = false,
  } = options

  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()
    const objectUrl = URL.createObjectURL(file)

    loader.load(
      objectUrl,
      (gltf) => {
        try {
          // Clean up object URL
          URL.revokeObjectURL(objectUrl)

          let object = gltf.scene

          // Traverse and set shadow properties
          object.traverse((child: any) => {
            if (child.isMesh) {
              child.castShadow = true
              child.receiveShadow = true

              // If not keeping materials, replace with default
              if (!keepMaterials) {
                child.material = new THREE.MeshStandardMaterial({
                  color: 0x888888,
                  metalness: 0.1,
                  roughness: 0.5,
                })
              }
            }
          })

          // Optionally convert to single mesh
          if (convertToSingleMesh) {
            const geometries: THREE.BufferGeometry[] = []
            const materials: THREE.Material[] = []

            object.traverse((child: any) => {
              if (child.isMesh && child.geometry) {
                const geom = child.geometry.clone()
                geom.applyMatrix4(child.matrixWorld)
                geometries.push(geom)
                materials.push(child.material)
              }
            })

            if (geometries.length > 0) {
              const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, true)
              const mergedMesh = new THREE.Mesh(
                mergedGeometry,
                materials[0] || new THREE.MeshStandardMaterial()
              )
              mergedMesh.castShadow = true
              mergedMesh.receiveShadow = true

              object = new THREE.Group()
              object.add(mergedMesh)
            }
          }

          // Create container group
          const group = new THREE.Group()
          group.add(object)

          // Apply units scaling
          if (units !== 'mm') {
            scaleToUnits(group, units, 'mm')
          }

          // Auto-center
          if (autoCenter) {
            centerObject(group)
          }

          // Compute stats
          const stats = computeObjectStats(group)
          const materialsCount = computeMaterialsCount(group)

          // Compute bounding box
          const bbox = computeBoundingBox(group)

          resolve({
            object: group,
            stats,
            materials: {
              count: materialsCount,
            },
            bbox: {
              min: [bbox.min.x, bbox.min.y, bbox.min.z],
              max: [bbox.max.x, bbox.max.y, bbox.max.z],
            },
            animations: gltf.animations,
          })
        } catch (error) {
          URL.revokeObjectURL(objectUrl)
          reject(error)
        }
      },
      (progress) => {
        // Progress callback
        if (progress.total > 0) {
          const percent = (progress.loaded / progress.total) * 100
          console.log(`[GLB Import] ${Math.round(percent)}%`)
        }
      },
      (error) => {
        URL.revokeObjectURL(objectUrl)
        reject(error)
      }
    )
  })
}
