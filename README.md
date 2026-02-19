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
- `POST /dev/seed-test-data` (create shared local demo data in `backend/dev_data.sqlite`)
- `GET /dev/projects`
- `GET /dev/schedules?project_id=<id>`
- `GET /dev/schedules/<schedule_id>/scenes`
- `PUT /dev/schedules/<schedule_id>/scenes` (save edited scenes back to SQLite)
- `POST /dev/review/feedback` (store parser-vs-corrected scene feedback)
- `GET /dev/review/aliases` (known learned elements/aliases)
- `GET /dev/review/metrics` (precision/recall style summary from feedback)
- `GET /dev/review/export-jsonl` (training dataset export)

## Frontend quickstart

```bash
cd frontend
npm install
npm run dev
```

Frontend expects backend at `http://localhost:8000`.

## One-command startup

Run from repo root:

```bash
./toyssched
```

This script:
- creates backend `.venv` if missing
- installs backend/frontend deps if needed
- starts backend + frontend together
- auto-selects free ports if defaults are taken
- wires frontend to backend automatically

## Current capabilities

- Upload screenplay PDF and parse scene headers
- Detect basic cast cues from uppercase character lines
- Mark scenes with missing cast as `needs_review`
- Display parsed scenes as strips in a 3-column board
- Drag and drop strips between days
- Multi-select strips and bulk move
- Shared local SQLite test dataset for debugging import/formatting issues

## Shared test-data workflow

1. Start backend (`uvicorn app.main:app --reload --port 8000` or `8001`).
2. In frontend `File` menu:
   - `Seed Test Data` (optional, first setup)
   - `Load Test Data`
   - Edit scenes in UI
   - `Save Active Schedule to DB`
3. Re-run `Load Test Data` to verify persisted edits.

## Scene Review Mode

- Import/update script now opens `Review` mode.
- Review scenes sequentially (`Prev` / `Next`), correct elements, and apply.
- Feedback is saved per scene to `/dev/review/feedback`.
- Learned elements are suggested on subsequent scenes in the same review run.

## Recommended next implementation steps

1. Replace parser heuristics with richer screenplay rules + alias resolution
2. Add actor availability and location grouping optimizer pass
3. Add multi-view stripboard modes (day/location/cast)
4. Add export generator for production-style stripboard PDFs and CSV templates
