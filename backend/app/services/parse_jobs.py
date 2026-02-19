import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.services.parser import ScriptParser


@dataclass
class ParseJob:
    id: str
    filename: str
    status: str = "queued"  # queued | processing | completed | failed
    progress: int = 0
    message: str = "Queued"
    error: str = ""
    result: dict[str, Any] | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ParseJobStore:
    def __init__(self, max_workers: int = 2) -> None:
        self._jobs: dict[str, ParseJob] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    def create(self, filename: str) -> ParseJob:
        job = ParseJob(id=uuid.uuid4().hex, filename=filename)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> ParseJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for key, value in kwargs.items():
                setattr(job, key, value)
            job.updated_at = datetime.now(timezone.utc).isoformat()

    def start(self, parser: ScriptParser, payload: bytes, filename: str, alias_map: dict[str, str] | None = None) -> ParseJob:
        job = self.create(filename)

        def run() -> None:
            self.update(job.id, status="processing", progress=1, message="Starting parse...")

            def on_progress(percent: int, message: str) -> None:
                clamped = max(0, min(100, int(percent)))
                with self._lock:
                    existing = self._jobs.get(job.id)
                    if not existing:
                        return
                    if clamped < existing.progress:
                        clamped = existing.progress
                    existing.progress = clamped
                    existing.message = message
                    existing.updated_at = datetime.now(timezone.utc).isoformat()

            try:
                result = parser.parse_pdf(payload, progress_callback=on_progress, alias_map=alias_map or {})
                self.update(
                    job.id,
                    status="completed",
                    progress=100,
                    message="Parsing complete.",
                    result=result,
                    error="",
                )
            except Exception as exc:  # noqa: BLE001
                self.update(
                    job.id,
                    status="failed",
                    message="Parsing failed.",
                    error=str(exc),
                )

        self._executor.submit(run)
        return job


parse_jobs = ParseJobStore()


def serialize_job(job: ParseJob) -> dict[str, Any]:
    return {
        "job_id": job.id,
        "filename": job.filename,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "result": job.result,
    }
