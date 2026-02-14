import { useState, useEffect, useRef, useCallback } from 'react'
import ImageUpload from './components/ImageUpload'
import STLSliceViewer from './components/STLSliceViewer'
import ControlPanel from './components/ControlPanel'

export default function App() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [resolution, setResolution] = useState(512)
  const [jobId, setJobId] = useState(null)
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(null)
  const [stlUrl, setStlUrl] = useState(null)
  const [boundingBox, setBoundingBox] = useState(null)
  const [pastModels, setPastModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')

  // Clipping state
  const [clipEnabled, setClipEnabled] = useState({ x: false, y: false, z: false })
  const [clipValues, setClipValues] = useState({ x: 0, y: 0, z: 0 })
  const [wireframe, setWireframe] = useState(false)
  const [darkBg, setDarkBg] = useState(true)

  const viewerRef = useRef(null)
  const eventSourceRef = useRef(null)

  // Fetch past models on mount and after generation completes
  const fetchModels = useCallback(() => {
    fetch('/api/models')
      .then(r => r.json())
      .then(setPastModels)
      .catch(() => {})
  }, [])

  useEffect(() => { fetchModels() }, [fetchModels])

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [])

  // Connect SSE when jobId is set
  useEffect(() => {
    if (!jobId) return

    const es = new EventSource(`/api/progress/${jobId}`)
    eventSourceRef.current = es

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      setProgress(data.progress)
      setMessage(data.message)

      if (data.status === 'completed') {
        setStatus('completed')
        fetch(`/api/download/${jobId}`)
          .then(r => r.blob())
          .then(blob => {
            const url = URL.createObjectURL(blob)
            setStlUrl(prev => {
              if (prev) URL.revokeObjectURL(prev)
              return url
            })
            setSelectedModel('')
            fetchModels()
          })
          .catch(() => {
            setError('Failed to download model')
            setStatus('failed')
          })
        es.close()
      } else if (data.status === 'failed') {
        setStatus('failed')
        setError(data.error || 'Generation failed')
        es.close()
      }
    })

    es.onerror = () => {
      es.close()
      if (status === 'processing') {
        setError('Connection lost')
        setStatus('failed')
      }
    }

    return () => es.close()
  }, [jobId])

  const handleGenerate = async () => {
    if (!file) return

    setStatus('uploading')
    setError(null)
    setProgress(0)
    setMessage('Uploading...')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/upload?resolution=${resolution}`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        let msg = 'Upload failed'
        try { const data = await res.json(); msg = data.detail || msg } catch {}
        throw new Error(msg)
      }
      const data = await res.json()
      setJobId(data.job_id)
      setStatus('processing')
      setMessage('Processing...')
    } catch (err) {
      setError(err.message)
      setStatus('failed')
    }
  }

  const handleLoadModel = async (filename) => {
    if (!filename) return
    setSelectedModel(filename)
    setError(null)

    try {
      const res = await fetch(`/api/models/${filename}`)
      if (!res.ok) throw new Error('Failed to load model')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      setStlUrl(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })
      setStatus('completed')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleBoundingBox = useCallback((bb) => {
    setBoundingBox(bb)
    setClipValues({
      x: (bb.min.x + bb.max.x) / 2,
      y: (bb.min.y + bb.max.y) / 2,
      z: (bb.min.z + bb.max.z) / 2,
    })
  }, [])

  const handleResetCamera = () => {
    if (viewerRef.current?.resetCamera) viewerRef.current.resetCamera()
  }

  const handleDownload = () => {
    if (!stlUrl) return
    const a = document.createElement('a')
    a.href = stlUrl
    a.download = selectedModel || `model-${jobId?.slice(0, 8) || 'export'}.glb`
    a.click()
  }

  const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  const isProcessing = status === 'uploading' || status === 'processing'

  return (
    <div className="app">
      <div className="left-panel">
        <h1>
          TRELLIS.2
          <span>Image to 3D Mesh</span>
        </h1>

        <ImageUpload
          file={file}
          preview={preview}
          disabled={isProcessing}
          onFileSelect={(f, p) => { setFile(f); setPreview(p) }}
          onRemove={() => { setFile(null); setPreview(null) }}
        />

        <div>
          <div className="section-label">Resolution</div>
          <div className="resolution-group">
            {[512, 1024, 1536].map(r => (
              <button
                key={r}
                className={resolution === r ? 'active' : ''}
                onClick={() => setResolution(r)}
                disabled={isProcessing}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <button
          className="btn btn-primary"
          onClick={handleGenerate}
          disabled={!file || isProcessing}
        >
          {isProcessing ? (
            <><span className="spinner" />Generating...</>
          ) : (
            'Generate 3D Model'
          )}
        </button>

        {(status === 'processing' || status === 'uploading') && (
          <div className="progress-container">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-message">{message}</div>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        {pastModels.length > 0 && (
          <div>
            <div className="section-label">Past Models</div>
            <div className="model-list">
              {pastModels.map((m) => (
                <button
                  key={m.filename}
                  className={`model-item ${selectedModel === m.filename ? 'active' : ''}`}
                  onClick={() => handleLoadModel(m.filename)}
                  disabled={isProcessing}
                >
                  <span className="model-name">{m.filename.replace('.glb', '').slice(0, 8)}</span>
                  <span className="model-meta">{formatSize(m.size)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {stlUrl && (
          <>
            <div className="separator" />
            <ControlPanel
              clipEnabled={clipEnabled}
              clipValues={clipValues}
              boundingBox={boundingBox}
              wireframe={wireframe}
              darkBg={darkBg}
              onClipEnabledChange={setClipEnabled}
              onClipValuesChange={setClipValues}
              onWireframeChange={setWireframe}
              onDarkBgChange={setDarkBg}
              onResetCamera={handleResetCamera}
            />
            <button className="btn btn-secondary" onClick={handleDownload}>
              Download GLB
            </button>
          </>
        )}
      </div>

      <div className="right-panel">
        {stlUrl ? (
          <STLSliceViewer
            ref={viewerRef}
            stlUrl={stlUrl}
            clipEnabled={clipEnabled}
            clipValues={clipValues}
            wireframe={wireframe}
            darkBg={darkBg}
            onBoundingBox={handleBoundingBox}
          />
        ) : (
          <div className="viewer-placeholder">
            {isProcessing ? 'Generating model...' : 'Upload an image to get started'}
          </div>
        )}
      </div>
    </div>
  )
}
