const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

export function transformToFeatureParams(transform, bodyId = null) {
  return {
    bodyId: bodyId || null,
    translateX: transform.position[0],
    translateY: transform.position[1],
    translateZ: transform.position[2],
    rotateX: transform.rotation[0] * RAD_TO_DEG,
    rotateY: transform.rotation[1] * RAD_TO_DEG,
    rotateZ: transform.rotation[2] * RAD_TO_DEG,
    scaleX: transform.scale[0],
    scaleY: transform.scale[1],
    scaleZ: transform.scale[2],
  }
}

export function featureParamsToTransform(params) {
  return {
    position: [
      params?.translateX ?? 0,
      params?.translateY ?? 0,
      params?.translateZ ?? 0,
    ],
    rotation: [
      (params?.rotateX ?? 0) * DEG_TO_RAD,
      (params?.rotateY ?? 0) * DEG_TO_RAD,
      (params?.rotateZ ?? 0) * DEG_TO_RAD,
    ],
    scale: [
      params?.scaleX ?? params?.scale ?? 1,
      params?.scaleY ?? params?.scale ?? 1,
      params?.scaleZ ?? params?.scale ?? 1,
    ],
  }
}

export function isTransformFeatureForBody(feature, bodyId) {
  if (!feature || feature.type !== 'transform' || !bodyId) return false
  return feature.params?.bodyId === bodyId
}
