export default function LoadingScreen({ message = 'Initializing CAD Kernel...' }) {
  return (
    <div className="fixed inset-0 bg-gray-900 flex flex-col items-center justify-center z-50">
      {/* Animated Logo/Spinner */}
      <div className="relative mb-8">
        <div className="w-20 h-20 border-4 border-gray-700 rounded-full" />
        <div className="absolute inset-0 w-20 h-20 border-4 border-transparent border-t-blue-500 rounded-full animate-spin" />
        <div className="absolute inset-2 w-16 h-16 border-4 border-transparent border-t-blue-400 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
      </div>
      
      {/* Loading Text */}
      <h2 className="text-white text-xl font-semibold mb-2">{message}</h2>
      <p className="text-gray-400 text-sm">Loading WebAssembly module...</p>
      
      {/* Progress dots animation */}
      <div className="flex gap-1 mt-4">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}
