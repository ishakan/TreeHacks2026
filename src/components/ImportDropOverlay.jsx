/**
 * ImportDropOverlay - Drag-and-drop overlay for importing files
 *
 * Features:
 * - Shows drop zone when files are dragged over viewport
 * - Validates file types before processing
 * - Triggers import process
 */

import { useState, useRef } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { importSTL } from '../importers/importSTL'
import { importGLB } from '../importers/importGLB'

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
const ALLOWED_EXTENSIONS = ['.stl', '.glb', '.gltf']

export default function ImportDropOverlay() {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)
  const { addMeshBody } = useWorkspace()

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
          mesh: { sourceType, stats: result.stats },
          object3D: result.object,
          status: 'ready',
          visible: true,
        })
        console.log('[ImportDrop] STL loaded successfully:', file.name, result)
      } else {
        const result = await importGLB(file, {
          units: 'm',
          autoCenter: true,
          keepMaterials: true,
          convertToSingleMesh: false,
        })

        addMeshBody({
          name: file.name.replace(/\.[^/.]+$/, ''),
          mesh: { sourceType, stats: result.stats },
          object3D: result.object,
          status: 'ready',
          visible: true,
        })
        console.log('[ImportDrop] GLB loaded successfully:', file.name, result)
      }
    } catch (error) {
      console.error('[ImportDrop] Failed to load file:', error)
      alert(`Import failed for ${file.name}: ${error?.message || error}`)
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
