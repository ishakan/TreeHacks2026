/**
 * ImportedObjects - Renders imported STL/GLB assets in the R3F scene
 *
 * Features:
 * - Renders each imported asset with its transform
 * - Handles visibility toggling
 * - Supports selection and hover states
 * - Updates when assets change
 */

import { useEffect } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSelection } from '../context/SelectionContext'
import * as THREE from 'three'

const HOVER_COLOR = new THREE.Color(0x88ccff)
const SELECTED_COLOR = new THREE.Color(0xffaa00)

function ImportedObjectMesh({ body }) {
  const { getObject } = useWorkspace()
  const { hoveredItem, selectedBodies } = useSelection()

  const objectRefId = body.mesh?.objectRefId || `obj-${body.id}`
  const object = getObject(objectRefId)

  useEffect(() => {
    if (!object) return

    // Apply transform from workspace body
    const { position, rotation, scale } = body.transform
    object.position.set(...position)
    object.rotation.set(...rotation)
    object.scale.set(...scale)
    object.updateWorldMatrix(true, true)
  }, [body.transform, object])

  useEffect(() => {
    if (!object) return

    // Apply hover/selection highlight
    const isHovered = hoveredItem?.bodyId === body.id
    const isSelected = selectedBodies.includes(body.id)

    object.traverse((child) => {
      if (child.isMesh && child.material) {
        // Store original emissive if not already stored
        if (!child.userData.originalEmissive) {
          child.userData.originalEmissive = child.material.emissive?.clone() || new THREE.Color(0x000000)
          child.userData.originalEmissiveIntensity = child.material.emissiveIntensity || 0
        }

        child.userData.bodyId = body.id
        child.userData.bodyKind = 'mesh'
        child.userData.selectable = true

        if (isSelected) {
          child.material.emissive = SELECTED_COLOR
          child.material.emissiveIntensity = 0.35
        } else if (isHovered) {
          child.material.emissive = HOVER_COLOR
          child.material.emissiveIntensity = 0.3
        } else {
          child.material.emissive = child.userData.originalEmissive
          child.material.emissiveIntensity = child.userData.originalEmissiveIntensity
        }
      }
    })
  }, [hoveredItem, selectedBodies, body.id, object])

  if (!object || !body.visible) {
    return null
  }

  object.userData.bodyId = body.id
  object.userData.bodyKind = 'mesh'
  object.userData.selectable = true
  return <primitive object={object} />
}

export default function ImportedObjects() {
  const { bodies } = useWorkspace()

  // Filter to only ready assets
  const readyBodies = bodies.filter((body) => (
    body.status === 'ready' &&
    (body.kind === 'mesh' || body.id.startsWith('brep-'))
  ))

  return (
    <>
      {readyBodies.map((body) => (
        <ImportedObjectMesh key={body.id} body={body} />
      ))}
    </>
  )
}
