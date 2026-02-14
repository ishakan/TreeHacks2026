const AXES = [
  { key: 'x', label: 'X', cssClass: 'axis-x' },
  { key: 'y', label: 'Y', cssClass: 'axis-y' },
  { key: 'z', label: 'Z', cssClass: 'axis-z' },
]

export default function ControlPanel({
  clipEnabled,
  clipValues,
  boundingBox,
  wireframe,
  darkBg,
  onClipEnabledChange,
  onClipValuesChange,
  onWireframeChange,
  onDarkBgChange,
  onResetCamera,
}) {
  const toggleAxis = (axis) => {
    onClipEnabledChange({ ...clipEnabled, [axis]: !clipEnabled[axis] })
  }

  const setAxisValue = (axis, val) => {
    onClipValuesChange({ ...clipValues, [axis]: parseFloat(val) })
  }

  const getRange = (axis) => {
    if (!boundingBox) return { min: -1, max: 1 }
    return { min: boundingBox.min[axis], max: boundingBox.max[axis] }
  }

  return (
    <div className="control-panel">
      <div className="section-label">Cross-Section Slicing</div>

      <div className="control-group">
        {AXES.map(({ key, label, cssClass }) => {
          const range = getRange(key)
          return (
            <div key={key}>
              <div className="control-row">
                <input
                  type="checkbox"
                  checked={clipEnabled[key]}
                  onChange={() => toggleAxis(key)}
                />
                <label>
                  <span className={`axis-indicator ${cssClass}`} />
                  {label}
                </label>
                <input
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={(range.max - range.min) / 200}
                  value={clipValues[key]}
                  onChange={(e) => setAxisValue(key, e.target.value)}
                  disabled={!clipEnabled[key]}
                />
                <span className="value">{clipValues[key].toFixed(2)}</span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="separator" />
      <div className="section-label">Display</div>

      <div className="control-group">
        <div className="toggle-row">
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(e) => onWireframeChange(e.target.checked)}
          />
          <span>Wireframe</span>
        </div>
        <div className="toggle-row">
          <input
            type="checkbox"
            checked={darkBg}
            onChange={(e) => onDarkBgChange(e.target.checked)}
          />
          <span>Dark background</span>
        </div>
      </div>

      <button className="btn btn-secondary" onClick={onResetCamera}>
        Reset Camera
      </button>
    </div>
  )
}
