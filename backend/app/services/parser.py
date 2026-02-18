import io
import re
from dataclasses import dataclass

from pypdf import PdfReader

SCENE_HEADING_PATTERN = re.compile(
    r"^(?P<prefix>INT\.?|EXT\.?|INT/EXT\.?|EXT/INT\.?)\s+"
    r"(?P<location>.+?)"
    r"\s*[-–]\s*"
    r"(?P<time>DAY|NIGHT|DAWN|DUSK|MORNING|EVENING)\s*$",
    re.IGNORECASE,
)

CHARACTER_CUE_PATTERN = re.compile(r"^[A-Z][A-Z0-9 .'-]{1,40}$")


@dataclass
class Scene:
    number: int
    heading: str
    location: str
    time_of_day: str
    cast: list[str]
    confidence: float
    needs_review: bool


class ScriptParser:
    def parse_pdf(self, payload: bytes) -> dict:
        text = self._extract_text(payload)
        scenes = self._split_into_scenes(text)
        serialized = [self._serialize(scene) for scene in scenes]
        return {
            "scenes": serialized,
            "needs_review_count": sum(1 for scene in scenes if scene.needs_review),
        }

    def _extract_text(self, payload: bytes) -> str:
        reader = PdfReader(io.BytesIO(payload))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages)

    def _split_into_scenes(self, text: str) -> list[Scene]:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        scenes: list[Scene] = []

        active_heading = ""
        active_location = ""
        active_time = ""
        cast: set[str] = set()

        for line in lines:
            heading_match = SCENE_HEADING_PATTERN.match(line)
            if heading_match:
                if active_heading:
                    scenes.append(self._make_scene(len(scenes) + 1, active_heading, active_location, active_time, cast))
                active_heading = line
                active_location = heading_match.group("location").strip().upper()
                active_time = heading_match.group("time").strip().upper()
                cast = set()
                continue

            if active_heading and CHARACTER_CUE_PATTERN.match(line):
                cast.add(line.strip())

        if active_heading:
            scenes.append(self._make_scene(len(scenes) + 1, active_heading, active_location, active_time, cast))

        return scenes

    def _make_scene(
        self,
        number: int,
        heading: str,
        location: str,
        time_of_day: str,
        cast: set[str],
    ) -> Scene:
        confidence = 0.95 if cast else 0.78
        needs_review = not cast
        return Scene(
            number=number,
            heading=heading,
            location=location,
            time_of_day=time_of_day,
            cast=sorted(cast),
            confidence=confidence,
            needs_review=needs_review,
        )

    def _serialize(self, scene: Scene) -> dict:
        return {
            "scene_number": scene.number,
            "heading": scene.heading,
            "location": scene.location,
            "time_of_day": scene.time_of_day,
            "cast": scene.cast,
            "confidence": scene.confidence,
            "needs_review": scene.needs_review,
        }
