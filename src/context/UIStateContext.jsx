import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const UIStateContext = createContext(null)

const STORAGE_KEY = 'cad-ui-state-v1'

function loadInitial() {
  if (typeof window === 'undefined') {
    return {
      docName: 'Untitled Document',
      leftCollapsed: false,
      rightCollapsed: false,
      leftTab: 'features',
      rightTab: 'properties',
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('no-state')
    const parsed = JSON.parse(raw)
    return {
      docName: parsed.docName || 'Untitled Document',
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
      leftTab: parsed.leftTab || 'features',
      rightTab: parsed.rightTab || 'properties',
    }
  } catch {
    const compactScreen = window.innerWidth < 1280
    return {
      docName: 'Untitled Document',
      leftCollapsed: false,
      rightCollapsed: compactScreen,
      leftTab: 'features',
      rightTab: 'properties',
    }
  }
}

export function UIStateProvider({ children }) {
  const initial = useMemo(() => loadInitial(), [])

  const [docName, setDocName] = useState(initial.docName)
  const [leftCollapsed, setLeftCollapsed] = useState(initial.leftCollapsed)
  const [rightCollapsed, setRightCollapsed] = useState(initial.rightCollapsed)
  const [leftTab, setLeftTab] = useState(initial.leftTab)
  const [rightTab, setRightTab] = useState(initial.rightTab)

  const [currentTool, setCurrentTool] = useState(null)
  const [toolParams, setToolParams] = useState({
    extrude: { distance: 10, draft: 0, merge: true, livePreview: true },
    revolve: { angle: 360, axis: 'Z', livePreview: true },
    fillet: { radius: 1.5, livePreview: true },
    chamfer: { distance: 1, angle: 45, livePreview: true },
    shell: { thickness: 2, livePreview: true },
    draft: { angle: 2, pullDirection: 'Z', livePreview: true },
    boolean: { mode: 'cut', keepTools: false, livePreview: true },
  })

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [selectionSummary, setSelectionSummary] = useState('No selection')
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [redoAvailable, setRedoAvailable] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const payload = {
      docName,
      leftCollapsed,
      rightCollapsed,
      leftTab,
      rightTab,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }, [docName, leftCollapsed, rightCollapsed, leftTab, rightTab])

  const activateTool = useCallback((toolId) => {
    setCurrentTool(toolId)
    setRightCollapsed(false)
    setRightTab('tool')
  }, [])

  const clearTool = useCallback(() => {
    setCurrentTool(null)
  }, [])

  const updateToolParam = useCallback((toolId, key, value) => {
    setToolParams((prev) => ({
      ...prev,
      [toolId]: {
        ...(prev[toolId] || {}),
        [key]: value,
      },
    }))
  }, [])

  const value = useMemo(() => ({
    docName,
    setDocName,
    leftCollapsed,
    setLeftCollapsed,
    rightCollapsed,
    setRightCollapsed,
    leftTab,
    setLeftTab,
    rightTab,
    setRightTab,
    currentTool,
    activateTool,
    clearTool,
    toolParams,
    updateToolParam,
    commandPaletteOpen,
    setCommandPaletteOpen,
    selectionSummary,
    setSelectionSummary,
    undoAvailable,
    redoAvailable,
    setUndoAvailable,
    setRedoAvailable,
  }), [
    docName,
    leftCollapsed,
    rightCollapsed,
    leftTab,
    rightTab,
    currentTool,
    activateTool,
    clearTool,
    toolParams,
    updateToolParam,
    commandPaletteOpen,
    selectionSummary,
    undoAvailable,
    redoAvailable,
  ])

  return <UIStateContext.Provider value={value}>{children}</UIStateContext.Provider>
}

export function useUIState() {
  const ctx = useContext(UIStateContext)
  if (!ctx) {
    throw new Error('useUIState must be used within UIStateProvider')
  }
  return ctx
}
