from fastapi import APIRouter, File, HTTPException, UploadFile

from app.services.parser import ScriptParser

router = APIRouter()
parser = ScriptParser()


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
