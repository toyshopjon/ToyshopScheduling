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
ALL_CAPS_TOKEN_PATTERN = re.compile(
    r"\b[A-Z][A-Z0-9'’\-]+(?:\s+[A-Z][A-Z0-9'’\-]+){0,2}\b"
)
TRAILING_PAREN_PATTERN = re.compile(r"\s*\([^)]*\)\s*$")
STOP_CHARACTER_TOKENS = {
    "INT",
    "EXT",
    "INT/EXT",
    "EXT/INT",
    "DAY",
    "NIGHT",
    "DAWN",
    "DUSK",
    "MORNING",
    "EVENING",
    "SUNRISE",
    "SUNSET",
    "CUT TO",
    "FADE IN",
    "FADE OUT",
    "TEXT CARD",
}


@dataclass
class Scene:
    number: int
    heading: str
    location: str
    time_of_day: str
    cast: list[str]
    scene_text: str
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
        lines = text.splitlines()
        scenes: list[Scene] = []

        active_heading = ""
        active_location = ""
        active_time = ""
        speaking_cast: set[str] = set()
        scene_lines: list[str] = []
        all_speaking_characters: set[str] = set()

        for raw_line in lines:
            stripped_line = raw_line.strip()
            heading_match = SCENE_HEADING_PATTERN.match(stripped_line)
            if heading_match:
                if active_heading:
                    scenes.append(
                        self._make_scene(
                            len(scenes) + 1,
                            active_heading,
                            active_location,
                            active_time,
                            speaking_cast,
                            scene_lines,
                        )
                    )
                active_heading = stripped_line
                active_location = heading_match.group("location").strip().upper()
                active_time = heading_match.group("time").strip().upper()
                speaking_cast = set()
                scene_lines = [raw_line]
                continue

            if active_heading:
                scene_lines.append(raw_line)
                cue_name = self._extract_character_cue(stripped_line)
                if cue_name:
                    speaking_cast.add(cue_name)
                    all_speaking_characters.add(cue_name)

        if active_heading:
            scenes.append(
                self._make_scene(
                    len(scenes) + 1,
                    active_heading,
                    active_location,
                    active_time,
                    speaking_cast,
                    scene_lines,
                )
            )

        return [self._augment_scene_cast(scene, all_speaking_characters) for scene in scenes]

    def _extract_character_cue(self, stripped_line: str) -> str | None:
        if not stripped_line:
            return None

        line = stripped_line.rstrip(":").strip()
        if not line:
            return None

        # Character cues are all caps and may include parentheticals like "(O.S.)".
        if not re.fullmatch(r"[A-Z0-9 .'\-()]+", line):
            return None

        line = TRAILING_PAREN_PATTERN.sub("", line).strip()
        line = re.sub(r"\s+", " ", line)
        if not line or line in STOP_CHARACTER_TOKENS:
            return None

        return line

    def _extract_intro_mentions(self, raw_line: str) -> set[str]:
        stripped = raw_line.strip()
        if not stripped:
            return set()

        # If the full line is uppercase, it is often a cue or heading; skip intro extraction.
        if stripped == stripped.upper():
            return set()

        mentions: set[str] = set()
        for match in ALL_CAPS_TOKEN_PATTERN.finditer(stripped):
            token = re.sub(r"\s+", " ", match.group(0).strip())
            token = token.strip(".,;:!?")
            token = TRAILING_PAREN_PATTERN.sub("", token).strip()
            if not token or token in STOP_CHARACTER_TOKENS:
                continue
            mentions.add(token)
        return mentions

    def _find_speaking_mentions(self, raw_line: str, speaking_characters: set[str]) -> set[str]:
        if not speaking_characters:
            return set()
        upper_line = raw_line.upper()
        found: set[str] = set()
        for name in speaking_characters:
            pattern = rf"(?<![A-Z0-9]){re.escape(name)}(?![A-Z0-9])"
            if re.search(pattern, upper_line):
                found.add(name)
        return found

    def _augment_scene_cast(self, scene: Scene, speaking_characters: set[str]) -> Scene:
        cast = set(scene.cast)
        for raw_line in scene.scene_text.split("\n"):
            stripped_line = raw_line.strip()
            heading_match = SCENE_HEADING_PATTERN.match(stripped_line)
            if heading_match:
                continue
            cast.update(self._extract_intro_mentions(raw_line))
            cast.update(self._find_speaking_mentions(raw_line, speaking_characters))

        updated_cast = sorted(cast)
        confidence = 0.95 if updated_cast else 0.78
        needs_review = not updated_cast
        return Scene(
            number=scene.number,
            heading=scene.heading,
            location=scene.location,
            time_of_day=scene.time_of_day,
            cast=updated_cast,
            scene_text=scene.scene_text,
            confidence=confidence,
            needs_review=needs_review,
        )

    def _make_scene(
        self,
        number: int,
        heading: str,
        location: str,
        time_of_day: str,
        cast: set[str],
        scene_lines: list[str],
    ) -> Scene:
        sorted_cast = sorted(cast)
        confidence = 0.95 if sorted_cast else 0.78
        needs_review = not sorted_cast
        scene_text = "\n".join(scene_lines)
        return Scene(
            number=number,
            heading=heading,
            location=location,
            time_of_day=time_of_day,
            cast=sorted_cast,
            scene_text=scene_text,
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
            "scene_text": scene.scene_text,
            "confidence": scene.confidence,
            "needs_review": scene.needs_review,
        }
