import { useRef, useState } from 'react'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 10 * 1024 * 1024
const MAX_IMAGES = 10

export default function ImageUpload({ files, previews, disabled, onFilesSelect, onRemove }) {
  const inputRef = useRef(null)
  const [dragover, setDragover] = useState(false)

  const processFiles = (fileList) => {
    const incoming = Array.from(fileList)
    const validFiles = []
    const validUrls = []

    for (const f of incoming) {
      if (!ACCEPTED.includes(f.type)) {
        alert('Please upload a JPEG, PNG, or WebP image.')
        continue
      }
      if (f.size > MAX_SIZE) {
        alert('File too large (max 10 MB).')
        continue
      }
      validFiles.push(f)
      validUrls.push(URL.createObjectURL(f))
    }

    if (validFiles.length === 0) return

    const newFiles = [...files, ...validFiles].slice(0, MAX_IMAGES)
    const newPreviews = [...previews, ...validUrls].slice(0, MAX_IMAGES)

    // Revoke URLs for any extras that got cut off
    const kept = newFiles.length - files.length
    for (let i = kept; i < validUrls.length; i++) {
      URL.revokeObjectURL(validUrls[i])
    }

    onFilesSelect(newFiles, newPreviews)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragover(false)
    if (disabled) return
    processFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    if (!disabled) setDragover(true)
  }

  const handleClick = () => {
    if (!disabled) inputRef.current?.click()
  }

  const handleChange = (e) => {
    processFiles(e.target.files)
    e.target.value = ''
  }

  const handleRemove = (e, index) => {
    e.stopPropagation()
    if (previews[index]) URL.revokeObjectURL(previews[index])
    onRemove(index)
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
        multiple
        onChange={handleChange}
        style={{ display: 'none' }}
      />

      {previews.length > 0 ? (
        <div className="upload-previews" onClick={(e) => e.stopPropagation()}>
          {previews.map((url, i) => (
            <div key={i} className="upload-preview-thumb">
              <img src={url} alt={`Preview ${i + 1}`} />
              {!disabled && (
                <button className="remove-btn" onClick={(e) => handleRemove(e, i)}>
                  ×
                </button>
              )}
            </div>
          ))}
          {previews.length < MAX_IMAGES && !disabled && (
            <div className="upload-add-more" onClick={handleClick}>
              <span>+</span>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="upload-icon">+</div>
          <p>
            Drag & drop or <strong>click to upload</strong>
          </p>
          <p>JPEG, PNG, or WebP (max 10 MB, up to {MAX_IMAGES} images)</p>
        </>
      )}
    </div>
  )
}
