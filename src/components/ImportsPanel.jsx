/**
 * Imports Panel - Shows list of imported STL/GLB assets
 *
 * Features:
 * - List view with icons
 * - Rename, show/hide, delete
 * - Select on click
 * - Stats display
 */

import { useState } from 'react'
import { useWorkspace } from '../context/WorkspaceContext'
import { useSelection } from '../context/SelectionContext'

export default function ImportsPanel() {
  const {
    bodies,
    activeBodyId,
    selectBody,
    setBodyVisibility,
    renameBody,
    removeBody,
    convertMeshBodyToSolid,
  } = useWorkspace()
  const { selectBody: selectBodyInSelection } = useSelection()

  const assets = bodies.filter((body) => body.kind === 'mesh')

  if (assets.length === 0) {
    return (
      <div className="h-full flex flex-col bg-gray-800 border-t border-gray-700">
        <div className="px-3 py-2 border-b border-gray-700">
          <h3 className="text-sm font-medium text-white">Imported Assets</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-sm text-gray-500 text-center">
            No imported assets.
            <br />
            Click "Import" to load STL/GLB files.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-800 border-t border-gray-700">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">Imported Assets</h3>
        <span className="text-xs text-gray-400">{assets.length} asset{assets.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Asset List */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-1">
          {assets.map((asset) => (
            <AssetItem
              key={asset.id}
              asset={asset}
              isSelected={asset.id === activeBodyId}
              onSelect={() => {
                selectBody(asset.id)
                selectBodyInSelection(asset.id, false)
              }}
              onToggleVisibility={() => setBodyVisibility(asset.id, !asset.visible)}
              onRename={(newName) => renameBody(asset.id, newName)}
              onRemove={() => removeBody(asset.id)}
              onConvertToSolid={() => {
                const result = convertMeshBodyToSolid(asset.id)
                if (!result.ok) {
                  alert(`Conversion failed: ${result.error}`)
                } else if (result.warning) {
                  alert(`Conversion succeeded. Warning: ${result.warning}`)
                }
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function AssetItem({ asset, isSelected, onSelect, onToggleVisibility, onRename, onRemove, onConvertToSolid }) {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(asset.name)
  const [showContextMenu, setShowContextMenu] = useState(false)

  const handleRename = () => {
    if (editName.trim() && editName !== asset.name) {
      onRename(editName.trim())
    }
    setIsEditing(false)
  }

  const getTypeIcon = () => {
    switch (asset.mesh?.sourceType) {
      case 'stl': return '📦'
      case 'glb': return '🎨'
      case 'gltf': return '🎨'
      default: return '📄'
    }
  }

  const getStatusIcon = () => {
    switch (asset.status) {
      case 'loading':
        return <span className="text-yellow-400 animate-pulse">⏳</span>
      case 'error':
        return <span className="text-red-400">❌</span>
      case 'ready':
        return <span className="text-green-400">✓</span>
      default:
        return null
    }
  }

  return (
    <div
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        setShowContextMenu(!showContextMenu)
      }}
      className={`
        group relative px-2 py-1.5 mx-1 rounded cursor-pointer transition-all
        ${isSelected ? 'bg-blue-600/30 border border-blue-500' : 'hover:bg-gray-700 border border-transparent'}
        ${!asset.visible ? 'opacity-50' : ''}
      `}
    >
      <div className="flex items-center gap-2">
        {/* Status icon */}
        <span className="text-xs">{getStatusIcon()}</span>

        {/* Type icon */}
        <span className="text-sm">{getTypeIcon()}</span>

        {/* Name */}
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') {
                setEditName(asset.name)
                setIsEditing(false)
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 px-1 py-0.5 text-xs bg-gray-900 text-white rounded border border-blue-500 focus:outline-none"
            autoFocus
          />
        ) : (
          <span className="flex-1 text-sm truncate text-gray-200">
            {asset.name}
          </span>
        )}

        {/* Quick actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleVisibility()
            }}
            className="p-0.5 text-xs hover:bg-gray-600 rounded"
            title={asset.visible ? 'Hide' : 'Show'}
          >
            {asset.visible ? '👁️' : '🚫'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
            }}
            className="p-0.5 text-xs hover:bg-gray-600 rounded"
            title="Rename"
          >
            ✏️
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="p-0.5 text-xs hover:bg-red-600 rounded text-red-400"
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Stats */}
      {asset.mesh?.stats && asset.status === 'ready' && (
        <div className="mt-1 text-xs text-gray-500 pl-6">
          {asset.mesh.stats.meshes > 0 && `${asset.mesh.stats.meshes} mesh${asset.mesh.stats.meshes !== 1 ? 'es' : ''}, `}
          {asset.mesh.stats.triangles > 0 && `${asset.mesh.stats.triangles.toLocaleString()} tris`}
        </div>
      )}

      {/* Error message */}
      {asset.error && (
        <div className="mt-1 text-xs text-red-400 pl-6">
          ⚠️ {asset.error}
        </div>
      )}

      {/* Context menu */}
      {showContextMenu && (
        <div
          className="absolute left-full top-0 ml-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50"
          onMouseLeave={() => setShowContextMenu(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsEditing(true)
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
          >
            Rename
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onConvertToSolid()
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
          >
            Convert Mesh to Solid
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleVisibility()
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700"
          >
            {asset.visible ? 'Hide' : 'Show'}
          </button>
          <hr className="border-gray-600" />
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
              setShowContextMenu(false)
            }}
            className="block w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-gray-700"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
