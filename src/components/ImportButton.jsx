/**
 * Import Button - Allows user to import STL/GLB files
 *
 * Features:
 * - File picker dialog
 * - Validates file types and size
 * - Triggers import process
 */

import { useRef } from 'react'
import { useImports, createImportedAsset, AssetStatus, AssetType } from '../context/ImportsContext'
import { importSTL } from '../importers/importSTL'
import { importGLB } from '../importers/importGLB'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
const ALLOWED_EXTENSIONS = ['.stl', '.glb', '.gltf']

export default function ImportButton() {
  const fileInputRef = useRef(null)
  const { addAsset, updateAssetStatus, registerObject } = useImports()

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files || [])

    for (const file of files) {
      await handleFile(file)
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleFile = async (file) => {
    console.log('[Import] Processing file:', file.name)

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

        console.log('[Import] STL loaded successfully:', asset.name, result)
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

        console.log('[Import] GLB loaded successfully:', asset.name, result)
      }
    } catch (error) {
      console.error('[Import] Failed to load file:', error)
      updateAssetStatus(asset.id, AssetStatus.ERROR, error.message)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors"
        title="Import STL/GLB files"
      >
        📥 Import
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".stl,.glb,.gltf"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  )
}
