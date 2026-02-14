# TRELLIS.2 Image-to-3D Web App

Upload an image, generate a 3D mesh via TRELLIS on Replicate cloud GPUs, and view/slice it in-browser. Built for TreeHacks '26.

## Setup

**Prerequisites:** Python 3.10+, Node.js 18+, [Replicate](https://replicate.com) API key

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install
```

Create a `.env` in the project root:

```
REPLICATE_API_TOKEN=your_key_here
```

## Running

```bash
# Terminal 1 — Backend (port 8000)
source .venv/bin/activate && python server.py

# Terminal 2 — Frontend (port 3000)
cd frontend && npm run dev
```

Open **http://localhost:3000**

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/upload` | Upload image (JPEG/PNG/WebP, max 10 MB). Saves to `uploads/`. Query: `resolution` (256–2048, default 512). Returns `{job_id}` |
| `GET` | `/api/progress/{job_id}` | SSE stream of job progress (`status`, `progress`, `message`, `error`) |
| `GET` | `/api/download/{job_id}` | Download generated GLB for a completed job |
| `GET` | `/api/models` | List all generated GLB files (newest first) |
| `GET` | `/api/models/{filename}` | Serve a specific GLB file |
| `GET` | `/api/uploads` | List all saved upload images (newest first) |
| `GET` | `/api/uploads/{filename}` | Serve a specific uploaded image |

## Architecture

- **Backend:** FastAPI — image upload, Replicate HTTP API, SSE progress, GLB serving
- **Frontend:** React 18 + Vite + Three.js — upload UI, real-time progress, 3D viewer with stencil-capped clipping planes
- **3D Generation:** Replicate `firtoz/trellis` on NVIDIA A100 GPUs

## Project Structure

```
├── server.py               # FastAPI backend
├── requirements.txt        # Python deps
├── .env                    # Replicate API key
├── uploads/                # Saved upload images
├── outputs/                # Generated GLB files
└── frontend/
    ├── vite.config.js      # Proxy /api → :8000
    └── src/
        ├── App.jsx         # Main orchestrator + SSE
        └── components/
            ├── STLSliceViewer.jsx   # Three.js viewer + clipping
            ├── ImageUpload.jsx      # Drag-drop upload
            └── ControlPanel.jsx     # Slice sliders + toggles
```
