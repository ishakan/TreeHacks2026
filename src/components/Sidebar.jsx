import { useShapes } from '../context/ShapeContext'

function ShapeIcon({ type }) {
  const icons = {
    box: '📦',
    cylinder: '🛢️',
    sphere: '🔮',
    cone: '🔺',
    origin: '📍',
  }
  return <span className="mr-2">{icons[type] || '📄'}</span>
}

export default function Sidebar() {
  const { shapes, selectedShapeId, setSelectedShapeId, removeShape, isLoading } = useShapes()

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-white font-semibold text-sm uppercase tracking-wide">
          Feature Tree
        </h2>
      </div>
      
      {/* Loading State */}
      {isLoading && (
        <div className="p-4 text-center text-gray-400 text-sm">
          Initializing OCCT...
        </div>
      )}

      {/* Origin (always shown) */}
      <div className="p-2 border-b border-gray-700">
        <div className="flex items-center px-3 py-2 text-sm text-gray-400">
          <ShapeIcon type="origin" />
          Origin
        </div>
      </div>
      
      {/* Shape List */}
      <div className="flex-1 overflow-y-auto p-2">
        {shapes.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-4">
            No shapes yet. Add one from the toolbar.
          </p>
        ) : (
          shapes.map((shape) => (
            <div
              key={shape.id}
              onClick={() => setSelectedShapeId(shape.id)}
              className={`
                flex items-center justify-between px-3 py-2 rounded-md cursor-pointer
                text-sm transition-colors group
                ${selectedShapeId === shape.id 
                  ? 'bg-blue-600 text-white' 
                  : 'text-gray-300 hover:bg-gray-700'
                }
              `}
            >
              <div className="flex items-center">
                <ShapeIcon type={shape.type} />
                {shape.name}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeShape(shape.id)
                }}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
      
      {/* Footer */}
      <div className="p-3 border-t border-gray-700">
        <p className="text-gray-500 text-xs">
          {shapes.length} shape{shapes.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  )
}
