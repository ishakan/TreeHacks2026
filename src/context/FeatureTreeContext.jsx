import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import {
  FeatureStatus,
  FeatureRegistry,
  createFeature,
} from '../services/featureSystem'
import { isOCCTReady } from '../services/occtService'
import {
  deserializeWorkerResult,
  rebuildFeaturesInWorker,
  serializeFeatureForWorker,
  terminateRebuildWorker,
} from '../services/featureRebuildWorkerClient'
import { transformToFeatureParams } from '../services/transformFeatureUtils'

const FeatureTreeContext = createContext(null)
const LOG_PREFIX = '[FeatureTree]'

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
  
  // Is regeneration in progress?
  const [isRegenerating, setIsRegenerating] = useState(false)
  
  // Rebuild errors
  const [rebuildErrors, setRebuildErrors] = useState([]) // [{ featureId, message }]
  
  // Selected feature for editing
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [lastRebuildProfile, setLastRebuildProfile] = useState(null)

  const rebuildDirtyRef = useRef(false)
  const rebuildTimerRef = useRef(null)
  const rebuildRunningRef = useRef(false)
  const rebuildSeqRef = useRef(0)
  const pendingTriggerRef = useRef('initial')
  const mutationTriggerRef = useRef('initial')
  const latestStateRef = useRef({ features: [], rollbackIndex: -1 })
  const intermediatesRef = useRef(new Map()) // featureId -> serialized worker payload
  const hydratedIntermediatesRef = useRef(new Map()) // featureId -> hydrated result

  // Mark context as ready on mount (no longer tracked in boot overlay)
  useEffect(() => {
    latestStateRef.current = { features, rollbackIndex }
  }, [features, rollbackIndex])

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
    mutationTriggerRef.current = `add:${type}`
    
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
    mutationTriggerRef.current = `remove:${featureId}`
    
    if (selectedFeatureId === featureId) {
      setSelectedFeatureId(null)
    }
    
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
        return {
          ...f,
          params: { ...f.params, ...newParams },
          status: FeatureStatus.PENDING,
        }
      }
      return f
    }))
    mutationTriggerRef.current = `params:${featureId}`
  }, [])

  /**
   * Toggle feature suppression
   * @param {string} featureId - Feature to toggle
   */
  const toggleSuppression = useCallback((featureId) => {
    console.log(`${LOG_PREFIX} toggleSuppression: ${featureId}`)
    
    setFeatures(prev => prev.map(f => {
      if (f.id === featureId) {
        const nextSuppressed = !f.suppressed
        return {
          ...f,
          suppressed: nextSuppressed,
          status: nextSuppressed ? FeatureStatus.SUPPRESSED : FeatureStatus.PENDING,
        }
      }
      return f
    }))
    mutationTriggerRef.current = `suppression:${featureId}`
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
    mutationTriggerRef.current = `reorder:${fromIndex}->${toIndex}`
  }, [])

  /**
   * Set rollback position
   * @param {number} index - Feature index to roll back to (-1 = all features)
   */
  const rollbackTo = useCallback((index) => {
    console.log(`${LOG_PREFIX} rollbackTo: ${index}`)
    setRollbackIndex(index)
  }, [])

  const getHydratedResult = useCallback((featureId) => {
    if (!featureId) return null
    if (hydratedIntermediatesRef.current.has(featureId)) {
      return hydratedIntermediatesRef.current.get(featureId)
    }
    const serialized = intermediatesRef.current.get(featureId)
    if (!serialized) return null
    const hydrated = deserializeWorkerResult(serialized)
    hydratedIntermediatesRef.current.set(featureId, hydrated)
    return hydrated
  }, [])

  const selectResultForRollback = useCallback((nextRollbackIndex, nextFeatures) => {
    if (!nextFeatures || nextFeatures.length === 0) {
      setCurrentResult(null)
      return
    }

    if (nextRollbackIndex === -1) {
      setCurrentResult(getHydratedResult('__final__'))
      return
    }

    const targetFeature = nextFeatures[nextRollbackIndex]
    if (!targetFeature) {
      setCurrentResult(getHydratedResult('__final__'))
      return
    }

    setCurrentResult(getHydratedResult(targetFeature.id))
  }, [getHydratedResult])

  /**
   * Regenerate the feature tree
   * Computes each feature in order, storing intermediate results
   */
  const regenerate = useCallback(async (trigger = 'manual') => {
    if (!isOCCTReady()) {
      console.warn(`${LOG_PREFIX} OCCT not ready, skipping regeneration`)
      return
    }
    const { features: nextFeatures, rollbackIndex: nextRollbackIndex } = latestStateRef.current
    const token = ++rebuildSeqRef.current
    const serializedFeatures = nextFeatures.map(serializeFeatureForWorker)

    rebuildRunningRef.current = true
    setIsRegenerating(true)
    setRebuildErrors([])

    const start = performance.now()
    const { promise } = rebuildFeaturesInWorker({
      features: serializedFeatures,
      trigger,
    })

    try {
      const response = await promise
      if (token !== rebuildSeqRef.current) {
        return null
      }

      const statusesById = new Map(response.statuses.map((entry) => [entry.id, entry]))
      setFeatures((prev) => prev.map((feature) => {
        const status = statusesById.get(feature.id)
        if (!status) return feature
        return {
          ...feature,
          status: status.status,
          error: status.error || null,
          needsRepair: status.needsRepair || [],
        }
      }))

      const serializedMap = new Map()
      for (const entry of response.intermediates || []) {
        serializedMap.set(entry.featureId, entry.result)
      }
      if (response.finalResult) {
        serializedMap.set('__final__', response.finalResult)
      }
      intermediatesRef.current = serializedMap
      hydratedIntermediatesRef.current = new Map()
      setRebuildErrors(response.errors || [])
      selectResultForRollback(nextRollbackIndex, nextFeatures)

      const durationMs = performance.now() - start
      const profile = {
        trigger,
        featureCount: nextFeatures.length,
        durationMs,
      }
      setLastRebuildProfile(profile)
      console.log(
        `${LOG_PREFIX} rebuild ${trigger} | features=${profile.featureCount} | ${profile.durationMs.toFixed(1)}ms`
      )
      return { errors: response.errors || [], result: getHydratedResult('__final__'), profile }
    } catch (error) {
      if (token !== rebuildSeqRef.current) {
        return null
      }
      const message = error instanceof Error ? error.message : String(error)
      setRebuildErrors([{ featureId: 'rebuild', message }])
      setCurrentResult(null)
      return { errors: [{ featureId: 'rebuild', message }], result: null }
    } finally {
      if (token === rebuildSeqRef.current) {
        rebuildRunningRef.current = false
        setIsRegenerating(false)
      }
      if (rebuildDirtyRef.current) {
        rebuildDirtyRef.current = false
        regenerate(pendingTriggerRef.current || 'queued')
      }
    }
  }, [selectResultForRollback])

  const requestRebuild = useCallback((trigger) => {
    pendingTriggerRef.current = trigger
    rebuildDirtyRef.current = true
    if (rebuildTimerRef.current) {
      clearTimeout(rebuildTimerRef.current)
      rebuildTimerRef.current = null
    }

    rebuildTimerRef.current = setTimeout(() => {
      rebuildTimerRef.current = null
      if (!rebuildDirtyRef.current || rebuildRunningRef.current) return
      rebuildDirtyRef.current = false
      regenerate(trigger)
    }, 50)
  }, [regenerate])

  useEffect(() => {
    if (features.length === 0) {
      setCurrentResult(null)
      setRebuildErrors([])
      intermediatesRef.current.clear()
      hydratedIntermediatesRef.current.clear()
      return
    }

    const trigger = mutationTriggerRef.current || 'features-change'
    if (!trigger.startsWith('metadata:')) {
      requestRebuild(trigger)
    }
    mutationTriggerRef.current = null
  }, [features, requestRebuild])

  useEffect(() => {
    selectResultForRollback(rollbackIndex, features)
  }, [rollbackIndex, features, selectResultForRollback])

  useEffect(() => () => {
    if (rebuildTimerRef.current) {
      clearTimeout(rebuildTimerRef.current)
      rebuildTimerRef.current = null
    }
    terminateRebuildWorker()
  }, [])

  /**
   * Get intermediate result for a feature (for preview)
   * @param {string} featureId - Feature ID
   * @returns {Object|null} - Result or null
   */
  const getIntermediateResult = useCallback((featureId) => {
    return getHydratedResult(featureId)
  }, [getHydratedResult])

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
    intermediatesRef.current.clear()
    hydratedIntermediatesRef.current.clear()
    mutationTriggerRef.current = 'clear'
  }, [])

  /**
   * Rename a feature
   * @param {string} featureId - Feature ID
   * @param {string} newName - New name
   */
  const renameFeature = useCallback((featureId, newName) => {
    setFeatures(prev => prev.map(f => {
      if (f.id === featureId) {
        return { ...f, name: newName }
      }
      return f
    }))
    mutationTriggerRef.current = `metadata:rename:${featureId}`
  }, [])

  const upsertTransformFeatureForBody = useCallback((bodyId, bodyName, transform, preferredFeatureId = null) => {
    const nextParams = transformToFeatureParams(transform, bodyId)
    let featureId = null

    setFeatures((prev) => {
      const next = [...prev]
      let targetIndex = -1

      if (preferredFeatureId) {
        targetIndex = next.findIndex((entry) => entry.id === preferredFeatureId && entry.type === 'transform')
      }
      if (targetIndex < 0) {
        targetIndex = next.findIndex((entry) => entry.type === 'transform' && entry.params?.bodyId === bodyId)
      }

      if (targetIndex >= 0) {
        const target = next[targetIndex]
        featureId = target.id
        next[targetIndex] = {
          ...target,
          params: {
            ...target.params,
            ...nextParams,
          },
          status: FeatureStatus.PENDING,
          error: null,
          suppressed: false,
        }
      } else {
        const created = createFeature(
          'transform',
          `${bodyName || 'Body'} Transform`,
          nextParams,
          []
        )
        featureId = created.id
        next.push(created)
      }

      return next
    })

    mutationTriggerRef.current = `params:transform:${bodyId}`
    if (featureId) {
      setSelectedFeatureId(featureId)
    }
    return featureId
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
    upsertTransformFeatureForBody,
    lastRebuildProfile,
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
