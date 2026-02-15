export default function ErrorScreen({ error, onRetry }) {
  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center z-50 p-8">
      {/* Error Icon */}
      <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      
      {/* Error Title */}
      <h2 className="text-white text-2xl font-bold mb-2">Compatibility Error</h2>
      <p className="text-gray-400 text-center max-w-md mb-4">
        Failed to initialize the CAD kernel. This may be due to browser compatibility issues.
      </p>
      
      {/* Error Details */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 max-w-lg w-full mb-6">
        <p className="text-red-400 text-sm font-mono break-words">{error}</p>
      </div>
      
      {/* Suggestions */}
      <div className="text-gray-400 text-sm mb-6">
        <p className="mb-2">Please try the following:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>Use a modern browser (Chrome, Firefox, Edge)</li>
          <li>Ensure WebAssembly is enabled</li>
          <li>Disable browser extensions that may block WASM</li>
          <li>Check the browser console for more details</li>
        </ul>
      </div>
      
      {/* Retry Button */}
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-medium"
        >
          Retry
        </button>
      )}
    </div>
  )
}
