import { useMemo } from 'react'
import { useSelection } from '../../context/SelectionContext'
import { useUIState } from '../../context/UIStateContext'

export default function StatusBar() {
  const { selectedBodies, selectedFaces, selectedEdges, selectedVertices } = useSelection()
  const { selectionSummary } = useUIState()

  const selectionText = useMemo(() => {
    const faceCount = Array.from(selectedFaces.values()).reduce((sum, set) => sum + set.size, 0)
    const edgeCount = Array.from(selectedEdges.values()).reduce((sum, set) => sum + set.size, 0)
    const vertexCount = Array.from(selectedVertices.values()).reduce((sum, set) => sum + set.size, 0)

    const chunks = []
    if (selectedBodies.length > 0) chunks.push(`${selectedBodies.length} body`)
    if (faceCount > 0) chunks.push(`${faceCount} face`)
    if (edgeCount > 0) chunks.push(`${edgeCount} edge`)
    if (vertexCount > 0) chunks.push(`${vertexCount} vertex`)
    if (chunks.length === 0) return 'No active selection'
    return chunks.join(', ')
  }, [selectedBodies, selectedFaces, selectedEdges, selectedVertices])

  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-3 rounded border border-slate-300 bg-white/95 px-3 py-1 text-xs text-slate-600 shadow-sm">
      <span>{selectionText}</span>
      <span className="text-slate-400">• {selectionSummary}</span>
      <span className="text-slate-400">Press Esc to cancel</span>
      <span className="text-slate-400">Hold Shift to multi-select</span>
    </div>
  )
}
