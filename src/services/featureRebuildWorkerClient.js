import * as THREE from 'three'

let worker = null
let sequence = 0
const pending = new Map()

function ensureWorker() {
  if (worker) return worker

  worker = new Worker(new URL('../workers/featureRebuildWorker.js', import.meta.url), {
    type: 'module',
  })

  worker.onmessage = (event) => {
    const message = event.data
    if (!message || !message.jobId) return
    const handlers = pending.get(message.jobId)
    if (!handlers) return
    pending.delete(message.jobId)

    if (message.type === 'rebuild-error') {
      handlers.reject(new Error(message.message || 'Feature rebuild failed'))
      return
    }

    handlers.resolve(message)
  }

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Feature rebuild worker crashed')
    pending.forEach((handlers) => handlers.reject(error))
    pending.clear()
    worker?.terminate()
    worker = null
  }

  return worker
}

function buildGeometry(payload) {
  const geometry = new THREE.BufferGeometry()
  const position = payload?.geometry?.position ? new Float32Array(payload.geometry.position) : new Float32Array(0)
  const normal = payload?.geometry?.normal ? new Float32Array(payload.geometry.normal) : null
  const indexBuffer = payload?.geometry?.index

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  if (normal && normal.length > 0) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  } else {
    geometry.computeVertexNormals()
  }
  if (indexBuffer) {
    const index = new Uint32Array(indexBuffer)
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
  }
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function buildTopologyMap(topologyPayload) {
  return {
    faces: new Map(topologyPayload?.faces || []),
    triangleToFace: topologyPayload?.triangleToFace || [],
    edges: new Map(topologyPayload?.edges || []),
    vertices: new Map(topologyPayload?.vertices || []),
  }
}

export function deserializeWorkerResult(resultPayload) {
  if (!resultPayload) return null
  return {
    shape: null,
    geometry: buildGeometry(resultPayload),
    topologyMap: buildTopologyMap(resultPayload.topologyMap),
  }
}

export function serializeFeatureForWorker(feature) {
  return {
    id: feature.id,
    type: feature.type,
    name: feature.name,
    params: feature.params,
    references: feature.references,
    suppressed: feature.suppressed,
    timestamp: feature.timestamp,
  }
}

export function rebuildFeaturesInWorker({ features, trigger }) {
  const activeWorker = ensureWorker()
  const jobId = `rebuild-${Date.now()}-${sequence++}`

  const promise = new Promise((resolve, reject) => {
    pending.set(jobId, { resolve, reject })
  })

  activeWorker.postMessage({
    type: 'rebuild',
    jobId,
    trigger,
    features,
  })

  return { jobId, promise }
}

export function terminateRebuildWorker() {
  if (!worker) return
  pending.forEach((handlers) => handlers.reject(new Error('Feature rebuild worker terminated')))
  pending.clear()
  worker.terminate()
  worker = null
}
