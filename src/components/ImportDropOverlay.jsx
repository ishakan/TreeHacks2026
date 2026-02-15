/**
 * ImportDropOverlay - Drag-and-drop overlay for importing files
 *
 * Features:
 * - Shows drop zone when files are dragged over viewport
 * - Validates file types before processing
 * - Triggers import process
 */

import { useState, useRef } from 'react'
import { useImports, createImportedAsset, AssetStatus, AssetType } from '../context/ImportsContext'
import { importSTL } from '../importers/importSTL'
import { importGLB } from '../importers/importGLB'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
const ALLOWED_EXTENSIONS = ['.stl', '.glb', '.gltf']

export default function ImportDropOverlay() {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const { addAsset, updateAssetStatus, registerObject } = useImports()

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounter.current = 0

    const files = Array.from(e.dataTransfer.files || [])

    for (const file of files) {
      await handleFile(file)
    }
  }

  const handleFile = async (file) => {
    console.log('[ImportDrop] Processing file:', file.name)

    // Validate extension
    const extension = `.${file.name.split('.').pop().toLowerCase()}`
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      alert(`Unsupported file type: ${extension}\nSupported: ${ALLOWED_EXTENSIONS.join(', ')}`)
      return
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      alert(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB\nMaximum: ${MAX_FILE_SIZE / 1024 / 1024}MB`)
      return
    }

    // Determine type
    const type = extension === '.stl' ? AssetType.STL : AssetType.GLB

    // Create asset metadata
    const asset = createImportedAsset(file, type)
    addAsset(asset)

    // Import based on type
    try {
      if (type === AssetType.STL) {
        const result = await importSTL(file, {
          units: 'mm',
          autoCenter: true,
          computeNormals: true,
          weldVertices: false,
        })

        // Update asset with results
        asset.bbox = result.bbox
        asset.stats = result.stats
        asset.status = AssetStatus.READY

        // Register object
        registerObject(asset.id, result.object)

        updateAssetStatus(asset.id, AssetStatus.READY)

        console.log('[ImportDrop] STL loaded successfully:', asset.name, result)
      } else {
        const result = await importGLB(file, {
          units: 'm',
          autoCenter: true,
          keepMaterials: true,
          convertToSingleMesh: false,
        })

        // Update asset with results
        asset.bbox = result.bbox
        asset.stats = result.stats
        asset.materials = result.materials
        asset.status = AssetStatus.READY

        // Register object
        registerObject(asset.id, result.object)

        updateAssetStatus(asset.id, AssetStatus.READY)

        console.log('[ImportDrop] GLB loaded successfully:', asset.name, result)
      }
    } catch (error) {
      console.error('[ImportDrop] Failed to load file:', error)
      updateAssetStatus(asset.id, AssetStatus.ERROR, error.message)
    }
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`absolute inset-0 pointer-events-auto transition-opacity ${
        isDragging ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/20 border-4 border-blue-500 border-dashed rounded-lg flex items-center justify-center">
          <div className="bg-white/90 px-6 py-4 rounded-lg shadow-lg">
            <div className="text-2xl font-bold text-gray-800 mb-2">
              📥 Drop files to import
            </div>
            <div className="text-sm text-gray-600">
              Supported: STL, GLB, GLTF
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
