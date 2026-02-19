from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services.parser import ScriptParser
from app.services.test_data_store import (
    export_review_jsonl,
    get_review_metrics,
    list_projects,
    list_schedules,
    list_scenes,
    list_aliases,
    replace_scenes,
    save_review_feedback,
    seed_demo_data,
)

router = APIRouter()
parser = ScriptParser()


class ScenePayload(BaseModel):
    scene_number: int
    heading: str
    location: str = ""
    int_ext: str = "INT"
    time_of_day: str = "DAY"
    page_eighths: int = 1
    cast_csv: str = ""
    props_csv: str = ""
    wardrobe_csv: str = ""
    sets_csv: str = ""
    notes: str = ""
    script_text: str = ""
    source_order: int = 0


class SaveScenesPayload(BaseModel):
    scenes: list[ScenePayload] = Field(default_factory=list)


class ReviewFeedbackPayload(BaseModel):
    scene_number: int
    heading: str = ""
    script_text: str = ""
    predicted_cast_csv: str = ""
    corrected_cast_csv: str = ""
    predicted_location: str = ""
    corrected_location: str = ""
    predicted_props_csv: str = ""
    corrected_props_csv: str = ""
    predicted_wardrobe_csv: str = ""
    corrected_wardrobe_csv: str = ""
    predicted_sets_csv: str = ""
    corrected_sets_csv: str = ""
    manual_split: bool = False
    split_parent_scene_number: int = 0
    split_parent_heading: str = ""
    split_selected_text: str = ""


@router.post("/scripts/parse")
async def parse_script(file: UploadFile = File(...)) -> dict:
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF uploads are supported.")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    result = parser.parse_pdf(payload)
    return {
        "filename": filename,
        "scene_count": len(result["scenes"]),
        "needs_review_count": result["needs_review_count"],
        "scenes": result["scenes"],
    }


@router.post("/dev/seed-test-data")
def seed_test_data() -> dict:
    return seed_demo_data()


@router.get("/dev/projects")
def get_projects() -> dict:
    return {"projects": list_projects()}


@router.get("/dev/schedules")
def get_schedules(project_id: int | None = None) -> dict:
    return {"schedules": list_schedules(project_id)}


@router.get("/dev/schedules/{schedule_id}/scenes")
def get_scenes(schedule_id: int) -> dict:
    return {"scenes": list_scenes(schedule_id)}


@router.put("/dev/schedules/{schedule_id}/scenes")
def save_scenes(schedule_id: int, payload: SaveScenesPayload) -> dict[str, Any]:
    try:
        result = replace_scenes(
            schedule_id,
            [scene.model_dump() for scene in payload.scenes],
        )
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return result


@router.post("/dev/review/feedback")
def save_feedback(payload: ReviewFeedbackPayload) -> dict[str, Any]:
    return save_review_feedback(payload.model_dump())


@router.get("/dev/review/aliases")
def get_aliases(element_type: str | None = None) -> dict:
    return {"aliases": list_aliases(element_type)}


@router.get("/dev/review/metrics")
def review_metrics() -> dict:
    return get_review_metrics()


@router.get("/dev/review/export-jsonl")
def export_jsonl() -> dict:
    return {"jsonl": export_review_jsonl()}
