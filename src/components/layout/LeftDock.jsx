import { useEffect, useMemo, useState } from 'react'
import { useUIState } from '../../context/UIStateContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useSketch } from '../../context/SketchContext'
import { useFeatureTree } from '../../context/FeatureTreeContext'
import FeatureTree from '../FeatureTree'
import ImportsPanel from '../ImportsPanel'

const TABS = [
  { id: 'features', label: 'Features', icon: 'F' },
  { id: 'parts', label: 'Parts', icon: 'P' },
  { id: 'sketches', label: 'Sketches', icon: 'S' },
  { id: 'imports', label: 'Imports', icon: 'I' },
]

function PartsPanel() {
  const { bodies, activeBodyId, selectBody, setBodyVisibility, renameBody } = useWorkspace()
  const [editingId, setEditingId] = useState(null)
  const [value, setValue] = useState('')

  return (
    <div className="space-y-1 p-2">
      {bodies.length === 0 && <div className="px-2 py-3 text-xs text-slate-500">No bodies</div>}
      {bodies.map((body) => (
        <div
          key={body.id}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${activeBodyId === body.id ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'}`}
          onClick={() => selectBody(body.id)}
        >
          <button
            title={body.visible ? 'Hide' : 'Show'}
            onClick={(e) => {
              e.stopPropagation()
              setBodyVisibility(body.id, !body.visible)
            }}
            className="rounded border border-slate-300 px-1 text-[10px]"
          >
            {body.visible ? '👁' : '🚫'}
          </button>
          <input type="color" title="Color" className="h-4 w-4 rounded border border-slate-300" defaultValue="#7c8a9a" onClick={(e) => e.stopPropagation()} readOnly />
          {editingId === body.id ? (
            <input
              className="flex-1 rounded border border-slate-300 px-1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => {
                if (value.trim()) renameBody(body.id, value.trim())
                setEditingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (value.trim()) renameBody(body.id, value.trim())
                  setEditingId(null)
                }
              }}
              autoFocus
            />
          ) : (
            <button
              className="flex-1 truncate text-left"
              onDoubleClick={() => {
                setEditingId(body.id)
                setValue(body.name)
              }}
            >
              {body.name}
            </button>
          )}
          <span className="rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">{body.kind}</span>
        </div>
      ))}
    </div>
  )
}

function SketchesPanel() {
  const {
    entities,
    isSketchMode,
    enterSketchMode,
    sketches,
    selectedSketchId,
    activeSketchId,
    selectSketch,
    editSketch,
    renameSketch,
    setSketchVisibility,
    deleteSketch,
    getSketchById,
    getExtrudableProfileForSketch,
  } = useSketch()
  const { addFeature, features } = useFeatureTree()
  const [editingId, setEditingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [extrudeLength, setExtrudeLength] = useState('10')
  const [extrudeOperation, setExtrudeOperation] = useState('new')

  const grouped = useMemo(() => {
    const lines = entities.filter((e) => e.type === 'line').length
    const circles = entities.filter((e) => e.type === 'circle').length
    const arcs = entities.filter((e) => e.type === 'arc').length
    return { lines, circles, arcs }
  }, [entities])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__DEBUG_SKETCH__) {
      console.log('[SketchesPanel] sketches list length', sketches.length)
    }
  }, [sketches.length])

  return (
    <div className="p-2 text-xs text-slate-700">
      <button onClick={() => enterSketchMode()} className="mb-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-left hover:bg-slate-50">
        {isSketchMode ? 'Sketch mode active' : 'New Sketch'}
      </button>
      <div className="mb-2 rounded border border-slate-200 bg-white p-2">
        <div className="font-medium text-slate-600">Sketch Entities</div>
        <div className="mt-1 text-slate-500">Lines: {grouped.lines}</div>
        <div className="text-slate-500">Circles: {grouped.circles}</div>
        <div className="text-slate-500">Arcs: {grouped.arcs}</div>
      </div>
      <div className="space-y-1">
        {sketches.length === 0 && (
          <div className="rounded border border-slate-200 bg-white px-2 py-2 text-slate-500">No saved sketches</div>
        )}
        {sketches.map((sketch) => {
          const isSelected = selectedSketchId === sketch.id
          const isEditing = activeSketchId === sketch.id && isSketchMode
          const planeLabel = sketch?.plane?.label || sketch?.plane?.id || 'Custom'
          return (
            <div
              key={sketch.id}
              className={`rounded border px-2 py-1 ${isSelected ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'}`}
              onClick={() => selectSketch(sketch.id)}
            >
              <div className="flex items-center gap-1">
                <button
                  title={sketch.visible ? 'Hide sketch' : 'Show sketch'}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSketchVisibility(sketch.id, !sketch.visible)
                  }}
                  className="rounded border border-slate-300 px-1 text-[10px]"
                >
                  {sketch.visible ? '👁' : '🚫'}
                </button>
                {editingId === sketch.id ? (
                  <input
                    className="flex-1 rounded border border-slate-300 px-1"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => {
                      renameSketch(sketch.id, renameValue)
                      setEditingId(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        renameSketch(sketch.id, renameValue)
                        setEditingId(null)
                      }
                      if (event.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <button
                    className="flex-1 truncate text-left font-medium"
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setEditingId(sketch.id)
                      setRenameValue(sketch.name)
                    }}
                  >
                    {sketch.name}
                  </button>
                )}
                <span className="rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">{isEditing ? 'editing' : sketch.status || 'ready'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>Plane: {planeLabel}</span>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded border border-slate-300 px-1 hover:bg-slate-50"
                    onClick={(event) => {
                      event.stopPropagation()
                      editSketch(sketch.id)
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="rounded border border-rose-300 px-1 text-rose-600 hover:bg-rose-50"
                    onClick={(event) => {
                      event.stopPropagation()
                      deleteSketch(sketch.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-2 rounded border border-slate-200 bg-white p-2">
        <div className="mb-1 font-medium text-slate-600">Extrude Selected Sketch</div>
        <div className="grid grid-cols-2 gap-1">
          <input
            value={extrudeLength}
            onChange={(event) => setExtrudeLength(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
            type="number"
            min="0.001"
            step="0.1"
            placeholder="Length"
          />
          <select
            value={extrudeOperation}
            onChange={(event) => setExtrudeOperation(event.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="new">New</option>
            <option value="add">Add</option>
            <option value="cut">Cut</option>
            <option value="intersect">Intersect</option>
          </select>
        </div>
        <button
          className="mt-2 w-full rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
          onClick={() => {
            if (!selectedSketchId) {
              alert('Select a sketch first.')
              return
            }
            const parsedLength = Number.parseFloat(extrudeLength)
            if (!Number.isFinite(parsedLength) || parsedLength <= 0) {
              alert('Extrude length must be positive.')
              return
            }
            const profileResult = getExtrudableProfileForSketch(selectedSketchId)
            if (!profileResult.ok) {
              alert(profileResult.error || 'Profile not closed. Create a closed loop before extruding.')
              return
            }
            const sketch = getSketchById(selectedSketchId) || profileResult.sketch
            const extrudeCount = features.filter((entry) => entry.type === 'extrude').length + 1
            addFeature('extrude', `Extrude ${extrudeCount}`, {
              sketchId: selectedSketchId,
              sketchName: sketch?.name || selectedSketchId,
              plane: sketch?.plane || null,
              profile: profileResult.profile,
              wireKey: profileResult.wireKey || null,
              regionId: profileResult.wireKey || null,
              length: parsedLength,
              direction: 'normal',
              operation: extrudeOperation,
              targetBodyId: null,
            }, [])
          }}
        >
          Apply Extrude Feature
        </button>
      </div>
    </div>
  )
}

export default function LeftDock() {
  const { leftCollapsed, setLeftCollapsed, leftTab, setLeftTab } = useUIState()

  const content = (
    <>
      {leftTab === 'features' && <FeatureTree />}
      {leftTab === 'parts' && <PartsPanel />}
      {leftTab === 'sketches' && <SketchesPanel />}
      {leftTab === 'imports' && <ImportsPanel />}
    </>
  )

  if (leftCollapsed) {
    return (
      <aside className="flex w-11 flex-col border-r border-slate-300 bg-slate-100">
        <button title="Expand left dock" onClick={() => setLeftCollapsed(false)} className="m-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs">›</button>
        <div className="mt-2 flex flex-1 flex-col gap-1 px-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              title={tab.label}
              onClick={() => {
                setLeftTab(tab.id)
                setLeftCollapsed(false)
              }}
              className="rounded border border-slate-300 bg-white py-1 text-[10px] text-slate-600 hover:bg-slate-50"
            >
              {tab.icon}
            </button>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className="flex w-[280px] flex-col border-r border-slate-300 bg-slate-50">
      <div className="flex items-center border-b border-slate-300 bg-slate-100 px-1 py-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setLeftTab(tab.id)}
            className={`rounded px-2 py-1 text-xs ${leftTab === tab.id ? 'bg-white font-medium text-slate-700 border border-slate-300' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {tab.label}
          </button>
        ))}
        <button title="Collapse" onClick={() => setLeftCollapsed(true)} className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs">‹</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </aside>
  )
}
