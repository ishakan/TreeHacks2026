/**
 * Import Button - Allows user to import STL/GLB files
 *
 * Features:
 * - File picker dialog
 * - Validates file types and size
 * - Triggers import process
 */

import { useRef } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { importSTL } from '../importers/importSTL'
import { importGLB } from '../importers/importGLB'
import ToolbarIcon from './ui/ToolbarIcon'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
const ALLOWED_EXTENSIONS = ['.stl', '.glb', '.gltf']

export default function ImportButton() {
  const fileInputRef = useRef(null)
  const { addMeshBody } = useWorkspace()

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

    const sourceType = extension === '.stl' ? 'stl' : 'glb'

    // Import based on type
    try {
      if (sourceType === 'stl') {
        const result = await importSTL(file, {
          units: 'mm',
          autoCenter: true,
          computeNormals: true,
          weldVertices: false,
        })

        addMeshBody({
          name: file.name.replace(/\.[^/.]+$/, ''),
          mesh: {
            sourceType,
            stats: result.stats,
          },
          object3D: result.object,
          status: 'ready',
          visible: true,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        })

        console.log('[Import] STL loaded successfully:', file.name, result)
      } else {
        const result = await importGLB(file, {
          units: 'm',
          autoCenter: true,
          keepMaterials: true,
          convertToSingleMesh: false,
        })

        addMeshBody({
          name: file.name.replace(/\.[^/.]+$/, ''),
          mesh: {
            sourceType,
            stats: result.stats,
          },
          object3D: result.object,
          status: 'ready',
          visible: true,
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        })

        console.log('[Import] GLB loaded successfully:', file.name, result)
      }
    } catch (error) {
      console.error('[Import] Failed to load file:', error)
      alert(`Import failed for ${file.name}: ${error?.message || error}`)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 transition-colors inline-flex items-center gap-1.5"
        title="Import STL/GLB files"
      >
        <ToolbarIcon name="import" />
        Import
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
