/**
 * ImportedObjects - Renders imported STL/GLB assets in the R3F scene
 *
 * Features:
 * - Renders each imported asset with its transform
 * - Handles visibility toggling
 * - Supports selection and hover states
 * - Updates when assets change
 */

import { useEffect, useRef } from 'react'
import { useImports } from '../context/ImportsContext'
import { useSelection } from '../context/SelectionContext'
import * as THREE from 'three'

const HOVER_COLOR = new THREE.Color(0x88ccff)
const SELECTED_COLOR = new THREE.Color(0xffaa00)

function ImportedObjectMesh({ asset }) {
  const groupRef = useRef()
  const { getObject } = useImports()
  const { hoveredItem } = useSelection()

  const object = getObject(asset.id)

  useEffect(() => {
    if (!object || !groupRef.current) return

    // Apply transform from asset
    const { position, rotation, scale } = asset.transform
    groupRef.current.position.set(...position)
    groupRef.current.rotation.set(...rotation)
    groupRef.current.scale.set(...scale)
  }, [asset.transform, object])

  useEffect(() => {
    if (!object) return

    // Apply hover/selection highlight
    const isHovered = hoveredItem?.importId === asset.id

    object.traverse((child) => {
      if (child.isMesh && child.material) {
        // Store original emissive if not already stored
        if (!child.userData.originalEmissive) {
          child.userData.originalEmissive = child.material.emissive?.clone() || new THREE.Color(0x000000)
          child.userData.originalEmissiveIntensity = child.material.emissiveIntensity || 0
        }

        if (isHovered) {
          child.material.emissive = HOVER_COLOR
          child.material.emissiveIntensity = 0.3
        } else {
          child.material.emissive = child.userData.originalEmissive
          child.material.emissiveIntensity = child.userData.originalEmissiveIntensity
        }
      }
    })
  }, [hoveredItem, asset.id, object])

  if (!object || !asset.visible) {
    return null
  }

  return (
    <group ref={groupRef} userData={{ importId: asset.id }}>
      <primitive object={object} />
    </group>
  )
}

export default function ImportedObjects() {
  const { assets } = useImports()

  // Filter to only ready assets
  const readyAssets = assets.filter(asset => asset.status === 'ready')

  return (
    <>
      {readyAssets.map(asset => (
        <ImportedObjectMesh key={asset.id} asset={asset} />
      ))}
    </>
  )
}
