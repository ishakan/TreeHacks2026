import { useRef, useState } from 'react'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024

export default function ImageUpload({ file, preview, disabled, onFileSelect, onRemove }) {
  const inputRef = useRef(null)
  const [dragover, setDragover] = useState(false)

  const processFile = (f) => {
    if (!ACCEPTED.includes(f.type)) {
      alert('Please upload a JPEG, PNG, or WebP image.')
      return
    }
    if (f.size > MAX_SIZE) {
      alert('File too large (max 10 MB).')
      return
    }
    const url = URL.createObjectURL(f)
    onFileSelect(f, url)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragover(false)
    if (disabled) return
    const f = e.dataTransfer.files[0]
    if (f) processFile(f)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    if (!disabled) setDragover(true)
  }

  const handleClick = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleChange = (e) => {
    const f = e.target.files[0]
    if (f) processFile(f)
    e.target.value = ''
  }

  const handleRemove = (e) => {
    e.stopPropagation()
    if (preview) URL.revokeObjectURL(preview)
    onRemove()
  }

  return (
    <div
      className={`upload-zone ${dragover ? 'dragover' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragover(false)}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        style={{ display: 'none' }}
      />

      {preview ? (
        <div className="upload-preview">
          <img src={preview} alt="Preview" />
          {!disabled && (
            <button className="remove-btn" onClick={handleRemove}>
              ×
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="upload-icon">+</div>
          <p>
            Drag & drop or <strong>click to upload</strong>
          </p>
          <p>JPEG, PNG, or WebP (max 10 MB)</p>
        </>
      )}
    </div>
  )
}
