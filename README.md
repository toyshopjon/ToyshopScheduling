# Toyshop Scheduling

MVP scaffold for a screenplay breakdown and scheduling app.

## Project structure

- `backend/`: FastAPI API for PDF upload and scene parsing
- `frontend/`: React + Vite stripboard UI shell with drag/drop and bulk move

## Backend quickstart

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API endpoints:
- `GET /health`
- `POST /scripts/parse` (multipart form field: `file`)

## Frontend quickstart

```bash
cd frontend
npm install
npm run dev
```

Frontend expects backend at `http://localhost:8000`.

## Current capabilities

- Upload screenplay PDF and parse scene headers
- Detect basic cast cues from uppercase character lines
- Mark scenes with missing cast as `needs_review`
- Display parsed scenes as strips in a 3-column board
- Drag and drop strips between days
- Multi-select strips and bulk move

## Recommended next implementation steps

1. Replace parser heuristics with richer screenplay rules + alias resolution
2. Add actor availability and location grouping optimizer pass
3. Add multi-view stripboard modes (day/location/cast)
4. Add export generator for production-style stripboard PDFs and CSV templates
