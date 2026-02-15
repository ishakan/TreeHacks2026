import { initOCCT } from '../services/occtService'
import { Feature, FeatureStatus } from '../services/featureSystem'

const WORKER_LOG_PREFIX = '[FeatureRebuildWorker]'

function serializeTopologyMap(topologyMap) {
  if (!topologyMap) {
    return {
      faces: [],
      triangleToFace: [],
      edges: [],
      vertices: [],
    }
  }

  return {
    faces: Array.from(topologyMap.faces?.entries?.() || []),
    triangleToFace: Array.isArray(topologyMap.triangleToFace) ? topologyMap.triangleToFace : [],
    edges: Array.from(topologyMap.edges?.entries?.() || []),
    vertices: Array.from(topologyMap.vertices?.entries?.() || []),
  }
}

function serializeGeometryResult(result) {
  const geometry = result.geometry
  const position = geometry.getAttribute('position')?.array || new Float32Array(0)
  const normal = geometry.getAttribute('normal')?.array || new Float32Array(0)
  const index = geometry.getIndex()?.array || null

  const positionCopy = new Float32Array(position)
  const normalCopy = new Float32Array(normal)
  const indexCopy = index ? new Uint32Array(index) : null

  const payload = {
    geometry: {
      position: positionCopy.buffer,
      normal: normalCopy.buffer,
      index: indexCopy ? indexCopy.buffer : null,
      indexType: indexCopy ? 'uint32' : null,
    },
    topologyMap: serializeTopologyMap(result.topologyMap),
  }

  const transferList = [positionCopy.buffer, normalCopy.buffer]
  if (indexCopy) {
    transferList.push(indexCopy.buffer)
  }

  return { payload, transferList }
}

async function runRebuildJob(job) {
  await initOCCT()

  const features = Array.isArray(job.features) ? job.features : []
  const errors = []
  const statuses = []
  const intermediates = []
  const transferList = []
  let currentShape = null
  let currentTopologyMap = null
  let finalResult = null

  for (let i = 0; i < features.length; i += 1) {
    const featureJson = features[i]
    const feature = Feature.fromJSON(featureJson)
    feature.suppressed = Boolean(featureJson.suppressed)

    if (feature.suppressed) {
      statuses.push({
        id: feature.id,
        status: FeatureStatus.SUPPRESSED,
        error: null,
      })
      continue
    }

    const validation = feature.validate()
    if (!validation.valid) {
      const message = validation.errors.join(', ')
      statuses.push({
        id: feature.id,
        status: FeatureStatus.ERROR,
        error: message,
      })
      errors.push({ featureId: feature.id, message })
      continue
    }

    try {
      const computed = feature.compute(currentShape, {
        resolveReference: () => null,
        inputTopologyMap: currentTopologyMap,
      })
      currentShape = computed.shape
      currentTopologyMap = computed.topologyMap || currentTopologyMap

      const { payload, transferList: geometryTransfers } = serializeGeometryResult(computed)
      transferList.push(...geometryTransfers)
      intermediates.push({
        featureId: feature.id,
        result: payload,
      })
      finalResult = payload

      statuses.push({
        id: feature.id,
        status: (computed.needsRepair && computed.needsRepair.length > 0)
          ? FeatureStatus.NEEDS_REPAIR
          : FeatureStatus.OK,
        error: null,
        needsRepair: computed.needsRepair || [],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const needsRepair = (err && typeof err === 'object' && 'needsRepair' in err)
        ? (err.needsRepair || [])
        : []
      statuses.push({
        id: feature.id,
        status: err?.code === 'NEEDS_REPAIR' ? FeatureStatus.NEEDS_REPAIR : FeatureStatus.ERROR,
        error: message,
        needsRepair,
      })
      errors.push({
        featureId: feature.id,
        message,
        needsRepair,
      })
    }
  }

  return {
    errors,
    statuses,
    finalResult,
    intermediates,
    transferList,
  }
}

self.onmessage = async (event) => {
  const message = event.data
  if (!message || message.type !== 'rebuild') return

  const start = performance.now()
  const { jobId, trigger } = message

  try {
    const rebuilt = await runRebuildJob(message)
    const durationMs = performance.now() - start
    self.postMessage({
      type: 'rebuild-result',
      jobId,
      durationMs,
      trigger,
      featureCount: Array.isArray(message.features) ? message.features.length : 0,
      errors: rebuilt.errors,
      statuses: rebuilt.statuses,
      finalResult: rebuilt.finalResult,
      intermediates: rebuilt.intermediates,
    }, rebuilt.transferList)
  } catch (err) {
    const durationMs = performance.now() - start
    self.postMessage({
      type: 'rebuild-error',
      jobId,
      durationMs,
      trigger,
      message: err instanceof Error ? err.message : String(err),
    })
    // Keep worker alive after failures for future jobs.
    // eslint-disable-next-line no-console
    console.error(`${WORKER_LOG_PREFIX} rebuild failed`, err)
  }
}
