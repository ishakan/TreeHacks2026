import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import {
  Feature,
  FeatureStatus,
  FeatureRegistry,
  createFeature,
} from '../services/featureSystem'
import { isOCCTReady } from '../services/occtService'

const FeatureTreeContext = createContext(null)
const LOG_PREFIX = '[FeatureTree]'

// Helper to update boot tracker
function bootMark(key, ok, error) {
  if (typeof window !== 'undefined' && window.__BOOT) {
    window.__BOOT.mark(key, ok, error);
  }
}

/**
 * Feature Tree Provider
 * 
 * Manages the parametric feature tree with:
 * - Ordered list of features
 * - Regeneration pipeline (replay features in order)
 * - Rollback state (view intermediate results)
 * - Suppression (skip features during regen)
 * - Reordering (drag/drop)
 * - Error tracking and diagnostics
 */
export function FeatureTreeProvider({ children }) {
  // Ordered list of features
  const [features, setFeatures] = useState([])
  
  // Rollback position: index of the last feature to compute
  // -1 = show all features, 0 = show only first, etc.
  const [rollbackIndex, setRollbackIndex] = useState(-1)
  
  // Current computed result
  const [currentResult, setCurrentResult] = useState(null) // { shape, geometry, topologyMap }
  
  // Intermediate results for each feature (for rollback preview)
  const intermediateResultsRef = useRef(new Map()) // featureId -> result
  
  // Is regeneration in progress?
  const [isRegenerating, setIsRegenerating] = useState(false)
  
  // Rebuild errors
  const [rebuildErrors, setRebuildErrors] = useState([]) // [{ featureId, message }]
  
  // Selected feature for editing
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)

  // Mark context as ready on mount (no longer tracked in boot overlay)

  /**
   * Add a new feature to the tree
   * @param {string} type - Feature type
   * @param {string} name - Feature name  
   * @param {Object} params - Feature parameters
   * @param {Array} references - Topology references
   * @param {number} insertIndex - Where to insert (-1 = end)
   * @returns {Feature} - The created feature
   */
  const addFeature = useCallback((type, name, params = {}, references = [], insertIndex = -1) => {
    console.log(`${LOG_PREFIX} addFeature: ${type} "${name}"`)
    
    const feature = createFeature(type, name, params, references)
    
    setFeatures(prev => {
      const newFeatures = [...prev]
      if (insertIndex === -1 || insertIndex >= newFeatures.length) {
        newFeatures.push(feature)
      } else {
        newFeatures.splice(insertIndex, 0, feature)
      }
      return newFeatures
    })
    
    // Auto-select the new feature
    setSelectedFeatureId(feature.id)
    
    return feature
  }, [])

  /**
   * Remove a feature from the tree
   * @param {string} featureId - Feature to remove
   */
  const removeFeature = useCallback((featureId) => {
    console.log(`${LOG_PREFIX} removeFeature: ${featureId}`)
    
    setFeatures(prev => prev.filter(f => f.id !== featureId))
    
    if (selectedFeatureId === featureId) {
      setSelectedFeatureId(null)
    }
    
    intermediateResultsRef.current.delete(featureId)
  }, [selectedFeatureId])

  /**
   * Update feature parameters
   * @param {string} featureId - Feature to update
   * @param {Object} newParams - New parameter values
   */
  const updateFeatureParams = useCallback((featureId, newParams) => {
    console.log(`${LOG_PREFIX} updateFeatureParams: ${featureId}`, newParams)
    
    setFeatures(prev => prev.map(f => {
      if (f.id === featureId) {
        f.params = { ...f.params, ...newParams }
        f.status = FeatureStatus.PENDING
      }
      return f
    }))
  }, [])

  /**
   * Toggle feature suppression
   * @param {string} featureId - Feature to toggle
   */
  const toggleSuppression = useCallback((featureId) => {
    console.log(`${LOG_PREFIX} toggleSuppression: ${featureId}`)
    
    setFeatures(prev => prev.map(f => {
      if (f.id === featureId) {
        f.suppressed = !f.suppressed
        f.status = f.suppressed ? FeatureStatus.SUPPRESSED : FeatureStatus.PENDING
      }
      return f
    }))
  }, [])

  /**
   * Reorder features (move feature to new index)
   * @param {number} fromIndex - Current index
   * @param {number} toIndex - Target index
   */
  const reorderFeatures = useCallback((fromIndex, toIndex) => {
    console.log(`${LOG_PREFIX} reorderFeatures: ${fromIndex} -> ${toIndex}`)
    
    setFeatures(prev => {
      const newFeatures = [...prev]
      const [removed] = newFeatures.splice(fromIndex, 1)
      newFeatures.splice(toIndex, 0, removed)
      return newFeatures
    })
  }, [])

  /**
   * Set rollback position
   * @param {number} index - Feature index to roll back to (-1 = all features)
   */
  const rollbackTo = useCallback((index) => {
    console.log(`${LOG_PREFIX} rollbackTo: ${index}`)
    setRollbackIndex(index)
  }, [])

  /**
   * Regenerate the feature tree
   * Computes each feature in order, storing intermediate results
   */
  const regenerate = useCallback(async () => {
    if (!isOCCTReady()) {
      console.warn(`${LOG_PREFIX} OCCT not ready, skipping regeneration`)
      return
    }
    
    console.log(`${LOG_PREFIX} ========== REGENERATION START ==========`)
    setIsRegenerating(true)
    setRebuildErrors([])
    
    const errors = []
    let currentShape = null
    const intermediates = new Map()
    
    // Determine how many features to compute
    const computeCount = rollbackIndex === -1 
      ? features.length 
      : Math.min(rollbackIndex + 1, features.length)
    
    // Compute each feature in order
    for (let i = 0; i < features.length; i++) {
      const feature = features[i]
      
      // Skip suppressed features
      if (feature.suppressed) {
        feature.status = FeatureStatus.SUPPRESSED
        console.log(`${LOG_PREFIX}   [${i}] ${feature.name} - SUPPRESSED`)
        continue
      }
      
      // Stop at rollback position
      if (i >= computeCount) {
        console.log(`${LOG_PREFIX}   [${i}] ${feature.name} - ROLLED BACK`)
        break
      }
      
      // Validate feature
      const validation = feature.validate()
      if (!validation.valid) {
        feature.status = FeatureStatus.ERROR
        feature.error = validation.errors.join(', ')
        errors.push({ featureId: feature.id, message: feature.error })
        console.log(`${LOG_PREFIX}   [${i}] ${feature.name} - VALIDATION ERROR: ${feature.error}`)
        continue
      }
      
      // Compute feature
      try {
        console.log(`${LOG_PREFIX}   [${i}] ${feature.name} - computing...`)
        const result = feature.compute(currentShape, {
          // Context for reference resolution
          resolveReference: (refId) => {
            // TODO: Implement reference resolution
            return null
          },
        })
        
        currentShape = result.shape
        feature._outputShape = result.shape
        feature._outputGeometry = result.geometry
        feature._outputTopologyMap = result.topologyMap
        feature.status = FeatureStatus.OK
        feature.error = null
        
        // Store intermediate result
        intermediates.set(feature.id, {
          shape: result.shape,
          geometry: result.geometry,
          topologyMap: result.topologyMap,
        })
        
        console.log(`${LOG_PREFIX}   [${i}] ${feature.name} - OK`)
        
      } catch (err) {
        console.error(`${LOG_PREFIX}   [${i}] ${feature.name} - ERROR:`, err)
        feature.status = FeatureStatus.ERROR
        feature.error = err.message
        errors.push({ featureId: feature.id, message: err.message })
        
        // Continue with last good shape
        // (Could also choose to stop here)
      }
    }
    
    // Store results
    intermediateResultsRef.current = intermediates
    setRebuildErrors(errors)
    
    // Get final result (last computed feature or last intermediate at rollback)
    let finalResult = null
    if (rollbackIndex === -1) {
      // Use last non-suppressed feature result
      for (let i = features.length - 1; i >= 0; i--) {
        const feat = features[i]
        if (!feat.suppressed && intermediates.has(feat.id)) {
          finalResult = intermediates.get(feat.id)
          break
        }
      }
    } else {
      // Use rollback feature result
      const rollbackFeature = features[rollbackIndex]
      if (rollbackFeature && intermediates.has(rollbackFeature.id)) {
        finalResult = intermediates.get(rollbackFeature.id)
      }
    }
    
    setCurrentResult(finalResult)
    setIsRegenerating(false)
    
    console.log(`${LOG_PREFIX} ========== REGENERATION COMPLETE ==========`)
    console.log(`${LOG_PREFIX} Errors: ${errors.length}, Result: ${finalResult ? 'OK' : 'NONE'}`)
    
    return { errors, result: finalResult }
  }, [features, rollbackIndex])

  // Auto-regenerate when features change
  useEffect(() => {
    if (features.length > 0) {
      regenerate()
    } else {
      setCurrentResult(null)
      intermediateResultsRef.current.clear()
    }
  }, [features, rollbackIndex])

  /**
   * Get intermediate result for a feature (for preview)
   * @param {string} featureId - Feature ID
   * @returns {Object|null} - Result or null
   */
  const getIntermediateResult = useCallback((featureId) => {
    return intermediateResultsRef.current.get(featureId) || null
  }, [])

  /**
   * Get feature by ID
   * @param {string} featureId - Feature ID
   * @returns {Feature|null} - Feature or null
   */
  const getFeature = useCallback((featureId) => {
    return features.find(f => f.id === featureId) || null
  }, [features])

  /**
   * Get feature index
   * @param {string} featureId - Feature ID
   * @returns {number} - Index or -1
   */
  const getFeatureIndex = useCallback((featureId) => {
    return features.findIndex(f => f.id === featureId)
  }, [features])

  /**
   * Get available feature types
   * @returns {Array} - [{ type, label, FeatureClass }]
   */
  const getAvailableFeatureTypes = useCallback(() => {
    return FeatureRegistry.getAll().map(([type, FeatureClass]) => ({
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      FeatureClass,
      paramDefs: FeatureClass.getParameterDefinitions(),
    }))
  }, [])

  /**
   * Clear all features
   */
  const clearFeatures = useCallback(() => {
    console.log(`${LOG_PREFIX} clearFeatures`)
    setFeatures([])
    setCurrentResult(null)
    setRollbackIndex(-1)
    setSelectedFeatureId(null)
    setRebuildErrors([])
    intermediateResultsRef.current.clear()
  }, [])

  /**
   * Rename a feature
   * @param {string} featureId - Feature ID
   * @param {string} newName - New name
   */
  const renameFeature = useCallback((featureId, newName) => {
    setFeatures(prev => prev.map(f => {
      if (f.id === featureId) {
        f.name = newName
      }
      return f
    }))
  }, [])

  const value = {
    features,
    currentResult,
    rollbackIndex,
    isRegenerating,
    rebuildErrors,
    selectedFeatureId,
    setSelectedFeatureId,
    addFeature,
    removeFeature,
    updateFeatureParams,
    toggleSuppression,
    reorderFeatures,
    rollbackTo,
    regenerate,
    getIntermediateResult,
    getFeature,
    getFeatureIndex,
    getAvailableFeatureTypes,
    clearFeatures,
    renameFeature,
  }

  return (
    <FeatureTreeContext.Provider value={value}>
      {children}
    </FeatureTreeContext.Provider>
  )
}

export function useFeatureTree() {
  const context = useContext(FeatureTreeContext)
  if (!context) {
    throw new Error('useFeatureTree must be used within a FeatureTreeProvider')
  }
  return context
}
