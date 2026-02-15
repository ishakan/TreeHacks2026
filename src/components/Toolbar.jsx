import { useState } from 'react'
import { useShapes } from '../context/ShapeContext'
import { useFeatureTree } from '../context/FeatureTreeContext'
import { useSketch, SketchTool } from '../context/SketchContext'
import ImportButton from './ImportButton'
import ToolbarIcon from './ui/ToolbarIcon'
import { createPrimitiveFeature } from '../services/primitiveTools'

const shapePresets = [
  { type: 'box', label: 'Box', icon: 'box' },
  { type: 'cylinder', label: 'Cylinder', icon: 'cylinder' },
  { type: 'sphere', label: 'Sphere', icon: 'sphere' },
  { type: 'cone', label: 'Cone', icon: 'cone' },
]

export default function Toolbar({ activeTool, onToolSelect }) {
  const { isReady, clearShapes } = useShapes()
  const { addFeature, features } = useFeatureTree()
  const { 
    isSketchMode, 
    activeTool: sketchTool, 
    setActiveTool: setSketchTool,
    enterSketchMode, 
    exitSketchMode,
    clearSketch,
    canExtrude,
    extrudeSketch,
  } = useSketch()
  
  const [extrudeLength, setExtrudeLength] = useState('1')
  
  const handleExtrude = () => {
    const length = parseFloat(extrudeLength)
    if (!isNaN(length) && length > 0) {
      extrudeSketch(length)
    }
  }

  const handleAddShape = (preset) => {
    if (!isReady) return
    createPrimitiveFeature({
      type: preset.type,
      features,
      addFeature,
    })
  }

  // Sketch mode toolbar
  if (isSketchMode) {
    return (
      <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center px-4 gap-2">
        {/* Sketch Mode Label */}
        <span className="text-yellow-400 text-sm font-bold mr-2 inline-flex items-center gap-1.5">
          <ToolbarIcon name="sketch" size={16} />
          SKETCH MODE
        </span>
        
        {/* Divider */}
        <div className="w-px h-6 bg-gray-600 mx-2" />
        
        {/* Sketch Tools */}
        <button
          onClick={() => setSketchTool(SketchTool.SELECT)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5
            ${sketchTool === SketchTool.SELECT ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
          <ToolbarIcon name="select" />
          Select
        </button>
        <button
          onClick={() => setSketchTool(SketchTool.LINE)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5
            ${sketchTool === SketchTool.LINE ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
          <ToolbarIcon name="line" />
          Line
        </button>
        <button
          onClick={() => setSketchTool(SketchTool.CIRCLE)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5
            ${sketchTool === SketchTool.CIRCLE ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
        >
          <ToolbarIcon name="circle" />
          Circle
        </button>
        
        {/* Divider */}
        <div className="w-px h-6 bg-gray-600 mx-2" />
        
        {/* Clear Sketch */}
        <button
          onClick={clearSketch}
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-orange-700 text-white hover:bg-orange-600 transition-all inline-flex items-center gap-1.5"
        >
          <ToolbarIcon name="clear" />
          Clear Sketch
        </button>
        
        {/* Divider */}
        <div className="w-px h-6 bg-gray-600 mx-2" />
        
        {/* Extrude Controls */}
        <span className="text-gray-400 text-sm font-medium">Extrude:</span>
        <input
          type="number"
          value={extrudeLength}
          onChange={(e) => setExtrudeLength(e.target.value)}
          placeholder="Length"
          className="w-20 px-2 py-1 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={handleExtrude}
          disabled={!canExtrude}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5
            ${canExtrude
              ? 'bg-purple-600 text-white hover:bg-purple-500'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
        >
          <ToolbarIcon name="extrude" />
          Extrude
        </button>
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Exit Sketch Mode */}
        <button
          onClick={exitSketchMode}
          className="px-4 py-1.5 rounded-md text-sm font-medium bg-green-700 text-white hover:bg-green-600 transition-all inline-flex items-center gap-1.5"
        >
          <ToolbarIcon name="finish" />
          ✓ Finish Sketch
        </button>
      </div>
    )
  }

  // Normal 3D mode toolbar
  return (
    <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center px-4 gap-2">
      {/* Sketch Button */}
      <button
        onClick={enterSketchMode}
        className="px-3 py-1.5 rounded-md text-sm font-medium bg-yellow-600 text-white hover:bg-yellow-500 transition-all flex items-center gap-1.5"
      >
        <ToolbarIcon name="sketch" />
        New Sketch
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-600 mx-2" />

      {/* Shape Creation */}
      <span className="text-gray-400 text-sm font-medium mr-2">Add Shape:</span>
      {shapePresets.map((preset) => (
        <button
          key={preset.type}
          onClick={() => handleAddShape(preset)}
          disabled={!isReady}
          className={`
            px-3 py-1.5 rounded-md text-sm font-medium transition-all
            flex items-center gap-1.5
            ${isReady
              ? 'bg-green-700 text-white hover:bg-green-600'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          <ToolbarIcon name={preset.icon} />
          {preset.label}
        </button>
      ))}

      {/* Divider */}
      <div className="w-px h-6 bg-gray-600 mx-2" />

      {/* Clear */}
      <button
        onClick={clearShapes}
        className="px-3 py-1.5 rounded-md text-sm font-medium bg-red-700 text-white hover:bg-red-600 transition-all inline-flex items-center gap-1.5"
      >
        <ToolbarIcon name="clear" />
        Clear All
      </button>

      {/* Divider */}
      <div className="w-px h-6 bg-gray-600 mx-2" />

      {/* Import Button */}
      <ImportButton />
    </div>
  )
}
