/**
 * STL Importer
 *
 * Loads .stl files using THREE.STLLoader
 * Computes normals, creates materials, and normalizes geometry
 */

import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { computeObjectStats, computeBoundingBox, centerObject, scaleToUnits } from '../utils/computeStats'

export interface ImportSTLOptions {
  units?: 'mm' | 'cm' | 'm'
  autoCenter?: boolean
  computeNormals?: boolean
  weldVertices?: boolean
  materialColor?: number
}

export interface ImportSTLResult {
  object: THREE.Object3D
  stats: {
    vertices: number
    triangles: number
    meshes: number
  }
  bbox: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

export async function importSTL(
  file: File,
  options: ImportSTLOptions = {}
): Promise<ImportSTLResult> {
  const {
    units = 'mm',
    autoCenter = true,
    computeNormals = true,
    weldVertices = false,
    materialColor = 0x888888,
  } = options

  return new Promise((resolve, reject) => {
    const loader = new STLLoader()
    const objectUrl = URL.createObjectURL(file)

    loader.load(
      objectUrl,
      (geometry) => {
        try {
          // Clean up object URL
          URL.revokeObjectURL(objectUrl)

          // Compute normals if needed
          if (computeNormals || !geometry.hasAttribute('normal')) {
            geometry.computeVertexNormals()
          }

          // Optionally weld vertices (merge duplicate vertices)
          if (weldVertices) {
            geometry = BufferGeometryUtils.mergeVertices(geometry)
            if (computeNormals) {
              geometry.computeVertexNormals()
            }
          }

          // Create material
          const material = new THREE.MeshStandardMaterial({
            color: materialColor,
            metalness: 0.1,
            roughness: 0.5,
            side: THREE.DoubleSide,
          })

          // Create mesh
          const mesh = new THREE.Mesh(geometry, material)
          mesh.castShadow = true
          mesh.receiveShadow = true

          // Create container group
          const group = new THREE.Group()
          group.add(mesh)

          // Apply units scaling
          if (units !== 'm') {
            scaleToUnits(group, units, 'mm')
          }

          // Auto-center
          if (autoCenter) {
            centerObject(group)
          }

          // Compute stats
          const stats = computeObjectStats(group)

          // Compute bounding box
          const bbox = computeBoundingBox(group)

          resolve({
            object: group,
            stats,
            bbox: {
              min: [bbox.min.x, bbox.min.y, bbox.min.z],
              max: [bbox.max.x, bbox.max.y, bbox.max.z],
            },
          })
        } catch (error) {
          URL.revokeObjectURL(objectUrl)
          reject(error)
        }
      },
      (progress) => {
        // Progress callback (not currently used)
        const percent = (progress.loaded / progress.total) * 100
        console.log(`[STL Import] ${Math.round(percent)}%`)
      },
      (error) => {
        URL.revokeObjectURL(objectUrl)
        reject(error)
      }
    )
  })
}
