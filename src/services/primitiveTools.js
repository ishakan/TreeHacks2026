const PRIMITIVE_CONFIG = {
  box: {
    label: 'Box',
    defaults: { width: 1, height: 1, depth: 1 },
  },
  cylinder: {
    label: 'Cylinder',
    defaults: { radius: 0.5, height: 1 },
  },
  cone: {
    label: 'Cone',
    defaults: { radius1: 0.5, radius2: 0, height: 1 },
  },
  sphere: {
    label: 'Sphere',
    defaults: { radius: 0.5 },
  },
}

export function isPrimitiveFeatureType(type) {
  return Object.prototype.hasOwnProperty.call(PRIMITIVE_CONFIG, type)
}

export function getPrimitiveDefaults(type) {
  return PRIMITIVE_CONFIG[type]?.defaults || {}
}

export function getPrimitiveLabel(type) {
  return PRIMITIVE_CONFIG[type]?.label || type
}

export function getNextPrimitiveName(type, features = []) {
  const label = getPrimitiveLabel(type)
  const count = features.filter((feature) => feature.type === type).length + 1
  return `${label} ${count}`
}

export function createPrimitiveFeature({
  type,
  features,
  addFeature,
}) {
  if (!isPrimitiveFeatureType(type)) {
    return null
  }

  const name = getNextPrimitiveName(type, features)
  return addFeature(type, name, getPrimitiveDefaults(type), [])
}
