/**
 * Imports Context - Manages imported STL/GLB assets
 *
 * Handles:
 * - Imported asset metadata and transforms
 * - Asset selection
 * - Runtime registry for THREE.Object3D refs
 * - Asset lifecycle (add, update, remove)
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ImportsContext = createContext(null)

export const AssetStatus = {
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
}

export const AssetType = {
  STL: 'stl',
  GLB: 'glb',
  GLTF: 'gltf',
}

/**
 * Imports Provider
 */
export function ImportsProvider({ children }) {
  const [assets, setAssets] = useState([]) // Array of ImportedAsset metadata
  const [selectedAssetId, setSelectedAssetId] = useState(null)

  // Runtime registry: assetId -> THREE.Object3D ref
  // Do NOT put heavy objects in serializable state
  const objectRegistry = useRef(new Map())

  /**
   * Add a new imported asset
   */
  const addAsset = useCallback((asset) => {
    console.log('[Imports] Adding asset:', asset.name)
    setAssets(prev => [...prev, asset])
  }, [])

  /**
   * Update asset status
   */
  const updateAssetStatus = useCallback((assetId, status, error = null) => {
    setAssets(prev => prev.map(a =>
      a.id === assetId ? { ...a, status, error } : a
    ))
  }, [])

  /**
   * Update asset transform
   */
  const updateAssetTransform = useCallback((assetId, transform) => {
    setAssets(prev => prev.map(a =>
      a.id === assetId ? { ...a, transform: { ...a.transform, ...transform } } : a
    ))
  }, [])

  /**
   * Toggle asset visibility
   */
  const toggleAssetVisibility = useCallback((assetId) => {
    setAssets(prev => prev.map(a =>
      a.id === assetId ? { ...a, visible: !a.visible } : a
    ))

    // Also update the runtime object
    const obj = objectRegistry.current.get(assetId)
    if (obj) {
      obj.visible = !obj.visible
    }
  }, [])

  /**
   * Rename asset
   */
  const renameAsset = useCallback((assetId, newName) => {
    setAssets(prev => prev.map(a =>
      a.id === assetId ? { ...a, name: newName } : a
    ))
  }, [])

  /**
   * Remove asset
   */
  const removeAsset = useCallback((assetId) => {
    console.log('[Imports] Removing asset:', assetId)

    // Remove from state
    setAssets(prev => prev.filter(a => a.id !== assetId))

    // Remove from registry (cleanup happens in component)
    objectRegistry.current.delete(assetId)

    // Deselect if selected
    if (selectedAssetId === assetId) {
      setSelectedAssetId(null)
    }
  }, [selectedAssetId])

  /**
   * Select asset
   */
  const selectAsset = useCallback((assetId) => {
    setSelectedAssetId(assetId)
  }, [])

  /**
   * Register runtime object
   */
  const registerObject = useCallback((assetId, object) => {
    objectRegistry.current.set(assetId, object)
  }, [])

  /**
   * Get runtime object
   */
  const getObject = useCallback((assetId) => {
    return objectRegistry.current.get(assetId)
  }, [])

  /**
   * Get asset by ID
   */
  const getAsset = useCallback((assetId) => {
    return assets.find(a => a.id === assetId)
  }, [assets])

  /**
   * Get selected asset
   */
  const getSelectedAsset = useCallback(() => {
    return assets.find(a => a.id === selectedAssetId)
  }, [assets, selectedAssetId])

  const value = {
    assets,
    selectedAssetId,
    addAsset,
    updateAssetStatus,
    updateAssetTransform,
    toggleAssetVisibility,
    renameAsset,
    removeAsset,
    selectAsset,
    registerObject,
    getObject,
    getAsset,
    getSelectedAsset,
  }

  return (
    <ImportsContext.Provider value={value}>
      {children}
    </ImportsContext.Provider>
  )
}

export function useImports() {
  const context = useContext(ImportsContext)
  if (!context) {
    throw new Error('useImports must be used within ImportsProvider')
  }
  return context
}

/**
 * Create a new ImportedAsset metadata object
 */
export function createImportedAsset(file, type) {
  return {
    id: `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
    type,
    source: {
      filename: file.name,
      sizeBytes: file.size,
    },
    objectUrl: null,
    bbox: null,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    visible: true,
    createdAt: Date.now(),
    stats: null,
    materials: null,
    status: AssetStatus.LOADING,
    error: null,
  }
}
