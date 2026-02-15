import { createContext, useContext, useState, useCallback, useRef } from 'react'
import {
  extractTopologyWithPersistentIds,
  rematchTopology,
} from '../services/topologyNamingService'

const FeatureHistoryContext = createContext(null)
const LOG_PREFIX = '[FeatureHistory]'

/**
 * Feature History Provider
 * 
 * Manages the history of features and their topology, enabling:
 * - Persistent ID tracking across model regenerations
 * - Feature tree management
 * - Reference resolution (finding current topology from old persistent IDs)
 */
export function FeatureHistoryProvider({ children }) {
  // Feature tree: ordered list of features
  const [features, setFeatures] = useState([])
  
  // Persistent ID registry: persistentId -> current descriptor
  const [persistentIdRegistry, setPersistentIdRegistry] = useState(new Map())
  
  // Reference mappings: old persistentId -> { newId, confidence }
  const [referenceMappings, setReferenceMappings] = useState(new Map())
  
  // History of topology snapshots for undo/comparison
  const historyRef = useRef([])
  
  // Debug mode flag
  const [debugMode, setDebugMode] = useState(false)

  /**
   * Register a new feature and its topology
   * @param {string} featureId - Unique feature ID
   * @param {string} featureType - Type of feature (box, cylinder, extrusion, etc.)
   * @param {string} featureName - Display name
   * @param {Object} params - Feature parameters
   * @param {TopoDS_Shape} shape - The OCCT shape
   * @returns {Object} - { feature, persistentIds }
   */
  const registerFeature = useCallback((featureId, featureType, featureName, params, shape) => {
    console.log(`${LOG_PREFIX} Registering feature: ${featureId} (${featureType})`)
    
    // Extract topology with persistent IDs
    const topology = extractTopologyWithPersistentIds(shape, featureId, featureType)
    
    // Create feature record
    const feature = {
      id: featureId,
      type: featureType,
      name: featureName,
      params,
      timestamp: Date.now(),
      topology: {
        faceCount: topology.faces.size,
        edgeCount: topology.edges.size,
        vertexCount: topology.vertices.size,
      },
    }
    
    // Update feature list
    setFeatures(prev => [...prev, feature])
    
    // Update persistent ID registry
    setPersistentIdRegistry(prev => {
      const newRegistry = new Map(prev)
      topology.faces.forEach((desc, id) => newRegistry.set(id, desc))
      topology.edges.forEach((desc, id) => newRegistry.set(id, desc))
      topology.vertices.forEach((desc, id) => newRegistry.set(id, desc))
      return newRegistry
    })
    
    // Store in history
    historyRef.current.push({
      featureId,
      timestamp: Date.now(),
      topology,
    })
    
    console.log(`${LOG_PREFIX} Registered ${topology.faces.size} faces, ${topology.edges.size} edges, ${topology.vertices.size} vertices`)
    
    return {
      feature,
      persistentIds: {
        faces: [...topology.faces.keys()],
        edges: [...topology.edges.keys()],
        vertices: [...topology.vertices.keys()],
      },
    }
  }, [])

  /**
   * Update feature after regeneration and re-match topology
   * @param {string} featureId - Feature ID being updated
   * @param {Object} newParams - New parameters
   * @param {TopoDS_Shape} newShape - New shape after regeneration
   * @returns {Object} - { updatedMappings, brokenReferences }
   */
  const regenerateFeature = useCallback((featureId, newParams, newShape) => {
    console.log(`${LOG_PREFIX} Regenerating feature: ${featureId}`)
    
    // Find feature
    const featureIndex = features.findIndex(f => f.id === featureId)
    if (featureIndex === -1) {
      console.warn(`${LOG_PREFIX} Feature not found: ${featureId}`)
      return { updatedMappings: new Map(), brokenReferences: [] }
    }
    
    const feature = features[featureIndex]
    
    // Get old topology from registry (filter by feature ID)
    const oldTopology = new Map()
    persistentIdRegistry.forEach((desc, id) => {
      if (desc.generation?.featureId === featureId) {
        oldTopology.set(id, desc)
      }
    })
    
    // Extract new topology
    const newTopology = extractTopologyWithPersistentIds(newShape, featureId, feature.type)
    
    // Combine all new topology into single map
    const newCombined = new Map()
    newTopology.faces.forEach((desc, id) => newCombined.set(id, desc))
    newTopology.edges.forEach((desc, id) => newCombined.set(id, desc))
    newTopology.vertices.forEach((desc, id) => newCombined.set(id, desc))
    
    // Re-match old to new
    const matches = rematchTopology(oldTopology, newCombined, 0.5)
    
    // Track broken references
    const brokenReferences = []
    matches.forEach((match, oldId) => {
      if (!match) {
        brokenReferences.push(oldId)
      }
    })
    
    // Update registry
    setPersistentIdRegistry(prev => {
      const newRegistry = new Map(prev)
      
      // Remove old entries for this feature
      oldTopology.forEach((_, id) => newRegistry.delete(id))
      
      // Add new entries
      newCombined.forEach((desc, id) => newRegistry.set(id, desc))
      
      return newRegistry
    })
    
    // Update reference mappings
    setReferenceMappings(prev => {
      const newMappings = new Map(prev)
      matches.forEach((match, oldId) => {
        if (match) {
          newMappings.set(oldId, match)
        }
      })
      return newMappings
    })
    
    // Update feature record
    setFeatures(prev => prev.map((f, i) => 
      i === featureIndex 
        ? {
            ...f,
            params: newParams,
            timestamp: Date.now(),
            topology: {
              faceCount: newTopology.faces.size,
              edgeCount: newTopology.edges.size,
              vertexCount: newTopology.vertices.size,
            },
          }
        : f
    ))
    
    console.log(`${LOG_PREFIX} Regeneration complete: ${brokenReferences.length} broken references`)
    
    return {
      updatedMappings: matches,
      brokenReferences,
    }
  }, [features, persistentIdRegistry])

  /**
   * Resolve a persistent ID to current topology
   * Follows reference chain if the original was remapped
   * @param {string} persistentId - The persistent ID to resolve
   * @returns {Object|null} - Current descriptor or null if broken
   */
  const resolveReference = useCallback((persistentId) => {
    // Check direct registry first
    if (persistentIdRegistry.has(persistentId)) {
      return persistentIdRegistry.get(persistentId)
    }
    
    // Check if it was remapped
    const mapping = referenceMappings.get(persistentId)
    if (mapping?.newId) {
      return persistentIdRegistry.get(mapping.newId) || null
    }
    
    return null
  }, [persistentIdRegistry, referenceMappings])

  /**
   * Get all persistent IDs for a shape
   * @param {string} shapeId - The shape ID from ShapeContext
   * @returns {Object} - { faces: [], edges: [], vertices: [] }
   */
  const getPersistentIdsForShape = useCallback((shapeId) => {
    const result = { faces: [], edges: [], vertices: [] }
    
    persistentIdRegistry.forEach((desc, id) => {
      if (desc.generation?.featureId === shapeId || id.startsWith(shapeId)) {
        if (desc.type === 'face') result.faces.push({ id, ...desc })
        else if (desc.type === 'edge') result.edges.push({ id, ...desc })
        else if (desc.type === 'vertex') result.vertices.push({ id, ...desc })
      }
    })
    
    return result
  }, [persistentIdRegistry])

  /**
   * Get descriptor for a persistent ID
   * @param {string} persistentId - The persistent ID
   * @returns {Object|null} - Descriptor or null
   */
  const getDescriptor = useCallback((persistentId) => {
    return persistentIdRegistry.get(persistentId) || null
  }, [persistentIdRegistry])

  /**
   * Remove a feature and its topology
   * @param {string} featureId - Feature to remove
   */
  const removeFeature = useCallback((featureId) => {
    console.log(`${LOG_PREFIX} Removing feature: ${featureId}`)
    
    setFeatures(prev => prev.filter(f => f.id !== featureId))
    
    setPersistentIdRegistry(prev => {
      const newRegistry = new Map(prev)
      prev.forEach((desc, id) => {
        if (desc.generation?.featureId === featureId) {
          newRegistry.delete(id)
        }
      })
      return newRegistry
    })
  }, [])

  /**
   * Clear all feature history
   */
  const clearHistory = useCallback(() => {
    console.log(`${LOG_PREFIX} Clearing all history`)
    setFeatures([])
    setPersistentIdRegistry(new Map())
    setReferenceMappings(new Map())
    historyRef.current = []
  }, [])

  /**
   * Get feature by ID
   * @param {string} featureId - Feature ID
   * @returns {Object|null} - Feature or null
   */
  const getFeature = useCallback((featureId) => {
    return features.find(f => f.id === featureId) || null
  }, [features])

  const value = {
    features,
    persistentIdRegistry,
    referenceMappings,
    debugMode,
    setDebugMode,
    registerFeature,
    regenerateFeature,
    resolveReference,
    getPersistentIdsForShape,
    getDescriptor,
    removeFeature,
    clearHistory,
    getFeature,
  }

  return (
    <FeatureHistoryContext.Provider value={value}>
      {children}
    </FeatureHistoryContext.Provider>
  )
}

export function useFeatureHistory() {
  const context = useContext(FeatureHistoryContext)
  if (!context) {
    throw new Error('useFeatureHistory must be used within a FeatureHistoryProvider')
  }
  return context
}
