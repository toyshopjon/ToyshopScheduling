import io
import re
from dataclasses import dataclass
from typing import Callable

import pdfplumber
from pypdf import PdfReader

SCENE_HEADING_PATTERN = re.compile(
    r"^(?P<prefix>INT\.?|EXT\.?|INT/EXT\.?|EXT/INT\.?)\s+"
    r"(?P<location>.+?)"
    r"\s*[-–]\s*"
    r"(?P<time>DAY|NIGHT|DAWN|DUSK|MORNING|EVENING)\s*$",
    re.IGNORECASE,
)
SCENE_PREFIX_PATTERN = re.compile(
    r"^(?P<prefix>INT\.?|EXT\.?|INT\s*/\s*EXT\.?|EXT\s*/\s*INT\.?)\b",
    re.IGNORECASE,
)
PAGE_NUMBER_PATTERN = re.compile(
    r"^(?:"
    r"\(?\d{1,4}[A-Z]?\)?"
    r"|PAGE\s+\d{1,4}[A-Z]?"
    r"|-\s*\d{1,4}[A-Z]?\s*-"
    r"|\d{1,4}[A-Z]?\s*/\s*\d{1,4}[A-Z]?"
    r")\.?$",
    re.IGNORECASE,
)

CHARACTER_CUE_PATTERN = re.compile(r"^[A-Z][A-Z0-9 .'-]{1,40}$")
ALL_CAPS_TOKEN_PATTERN = re.compile(
    r"\b[A-Z][A-Z0-9'’\-]+(?:\s+[A-Z][A-Z0-9'’\-]+){0,2}\b"
)
TRAILING_PAREN_PATTERN = re.compile(r"\s*\([^)]*\)\s*$")
INLINE_PAREN_PATTERN = re.compile(r"\([^)]*\)")
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
NOISE_CHARACTER_TOKENS = {
    "I",
    "I'",
    "I’",
    "I'M",
    "I’M",
    "I'LL",
    "I’LL",
    "I'D",
    "I’D",
    "I'VE",
    "I’VE",
}


@dataclass
class Scene:
    number: int
    heading: str
    location: str
    time_of_day: str
    cast: list[str]
    scene_text: str
    line_items: list[dict[str, str]]
    confidence: float
    needs_review: bool


class ScriptParser:
    def parse_pdf(
        self,
        payload: bytes,
        progress_callback: Callable[[int, str], None] | None = None,
        alias_map: dict[str, str] | None = None,
    ) -> dict:
        if progress_callback:
            progress_callback(0, "Opening PDF...")
        text = self._extract_text(payload, progress_callback)
        scenes = self._split_into_scenes(text, progress_callback, alias_map or {})
        serialized = [self._serialize(scene) for scene in scenes]
        if progress_callback:
            progress_callback(100, "Serialization complete.")
        return {
            "scenes": serialized,
            "needs_review_count": sum(1 for scene in scenes if scene.needs_review),
        }

    def _extract_text(
        self,
        payload: bytes,
        progress_callback: Callable[[int, str], None] | None = None,
    ) -> str:
        # pdfplumber/pdfminer layout extraction preserves screenplay whitespace
        # more reliably than pypdf for indents, spacing, and line structure.
        try:
            with pdfplumber.open(io.BytesIO(payload)) as pdf:
                page_count = len(pdf.pages)
                pages: list[str] = []
                for page_index, page in enumerate(pdf.pages, start=1):
                    page_text = page.extract_text(layout=True) or ""
                    pages.append(page_text)
                    if progress_callback and page_count:
                        progress = int((page_index / page_count) * 65)
                        progress_callback(progress, f"Reading PDF pages ({page_index}/{page_count})...")
                return "\n".join(pages)
        except Exception:
            # Fallback keeps parser resilient if pdfplumber fails on a file.
            reader = PdfReader(io.BytesIO(payload))
            page_count = len(reader.pages)
            pages = []
            for page_index, page in enumerate(reader.pages, start=1):
                pages.append(page.extract_text() or "")
                if progress_callback and page_count:
                    progress = int((page_index / page_count) * 65)
                    progress_callback(progress, f"Reading PDF pages ({page_index}/{page_count})...")
            return "\n".join(pages)

    def _split_into_scenes(
        self,
        text: str,
        progress_callback: Callable[[int, str], None] | None = None,
        alias_map: dict[str, str] | None = None,
    ) -> list[Scene]:
        alias_map = alias_map or {}
        lines = text.splitlines()
        scenes: list[Scene] = []

        active_heading = ""
        active_location = ""
        active_time = ""
        speaking_cast: set[str] = set()
        scene_lines: list[str] = []
        all_speaking_characters: set[str] = set()

        total_lines = max(1, len(lines))
        last_line_progress = -1
        for line_index, raw_line in enumerate(lines, start=1):
            stripped_line = raw_line.strip()
            if self._is_page_number_line(stripped_line):
                if progress_callback:
                    line_progress = 65 + int((line_index / total_lines) * 25)
                    if line_progress != last_line_progress:
                        progress_callback(
                            line_progress,
                            f"Scanning script lines ({line_index}/{total_lines})...",
                        )
                        last_line_progress = line_progress
                continue

            if self._is_scene_heading_line(stripped_line):
                location, time_of_day = self._extract_heading_fields(stripped_line)
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
                active_location = location
                active_time = time_of_day
                speaking_cast = set()
                scene_lines = [raw_line]
            elif active_heading:
                scene_lines.append(raw_line)
                cue_name = self._extract_character_cue(stripped_line)
                if cue_name:
                    canonical = self._canonicalize_alias(cue_name, alias_map)
                    if canonical:
                        speaking_cast.add(canonical)
                        all_speaking_characters.add(canonical)
            if progress_callback:
                line_progress = 65 + int((line_index / total_lines) * 25)
                if line_progress != last_line_progress:
                    progress_callback(
                        line_progress,
                        f"Scanning script lines ({line_index}/{total_lines})...",
                    )
                    last_line_progress = line_progress

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

        augmented_scenes: list[Scene] = []
        total_scenes = max(1, len(scenes))
        for scene_index, scene in enumerate(scenes, start=1):
            augmented_scenes.append(self._augment_scene_cast(scene, all_speaking_characters, alias_map))
            if progress_callback:
                progress = 90 + int((scene_index / total_scenes) * 9)
                progress_callback(progress, f"Resolving cast and elements ({scene_index}/{total_scenes})...")
        return augmented_scenes

    def _extract_character_cue(self, stripped_line: str) -> str | None:
        if not stripped_line:
            return None

        if self._is_page_number_line(stripped_line):
            return None

        line = stripped_line.rstrip(":").strip()
        if not line:
            return None

        # Character cues are all caps and may include parentheticals like "(O.S.)".
        if not re.fullmatch(r"[A-Z0-9 .'\-()]+", line):
            return None

        if not any(char.isalpha() for char in line):
            return None

        line = TRAILING_PAREN_PATTERN.sub("", line).strip()
        line = re.sub(r"\s+", " ", line)
        if not line or self._is_noise_character_token(line):
            return None

        return line

    def _extract_intro_mentions(self, raw_line: str, alias_map: dict[str, str]) -> set[str]:
        stripped = raw_line.strip()
        if not stripped:
            return set()

        # If the full line is uppercase, it is often a cue or heading; skip intro extraction.
        if stripped == stripped.upper():
            return set()

        # Ignore descriptor text inside parentheses (e.g., "JOE (MAN, 60S)")
        # so generic descriptors do not become cast elements.
        sanitized = INLINE_PAREN_PATTERN.sub(" ", stripped)
        mentions: set[str] = set()
        for match in ALL_CAPS_TOKEN_PATTERN.finditer(sanitized):
            token = re.sub(r"\s+", " ", match.group(0).strip())
            token = token.strip(".,;:!?")
            token = TRAILING_PAREN_PATTERN.sub("", token).strip()
            if not token or self._is_noise_character_token(token):
                continue
            canonical = self._canonicalize_alias(token, alias_map)
            if canonical:
                mentions.add(canonical)
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

    def _augment_scene_cast(self, scene: Scene, speaking_characters: set[str], alias_map: dict[str, str]) -> Scene:
        cast = set(scene.cast)
        raw_lines = scene.scene_text.split("\n")
        line_items = scene.line_items if scene.line_items else self._classify_scene_lines(raw_lines)
        for idx, raw_line in enumerate(raw_lines):
            line_type = line_items[idx]["type"] if idx < len(line_items) and line_items[idx].get("type") else "action"
            stripped_line = raw_line.strip()
            if self._is_scene_heading_line(stripped_line):
                continue
            # Rule: dialogue-only mentions do not add cast. We only infer
            # additional cast from action lines (plus explicit character cues).
            if line_type == "action":
                cast.update(self._extract_intro_mentions(raw_line, alias_map))
                cast.update(self._find_speaking_mentions(raw_line, speaking_characters))
                cast.update(self._find_alias_mentions(raw_line, alias_map))

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
            line_items=scene.line_items,
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
        line_items = self._classify_scene_lines(scene_lines)
        return Scene(
            number=number,
            heading=heading,
            location=location,
            time_of_day=time_of_day,
            cast=sorted_cast,
            scene_text=scene_text,
            line_items=line_items,
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
            "line_items": scene.line_items,
            "confidence": scene.confidence,
            "needs_review": scene.needs_review,
        }

    def _canonicalize_alias(self, token: str, alias_map: dict[str, str]) -> str:
        key = str(token or "").strip().upper()
        if not key:
            return ""
        mapped = str(alias_map.get(key) or token).strip()
        if mapped.upper() == "__IGNORE__":
            return ""
        return mapped

    def _find_alias_mentions(self, raw_line: str, alias_map: dict[str, str]) -> set[str]:
        if not alias_map:
            return set()
        upper_line = str(raw_line or "").upper()
        found: set[str] = set()
        for alias, canonical in alias_map.items():
            pattern = rf"(?<![A-Z0-9]){re.escape(alias)}(?![A-Z0-9])"
            if re.search(pattern, upper_line):
                value = str(canonical or "").strip()
                if value and value.upper() != "__IGNORE__":
                    found.add(value)
        return found

    def _is_page_number_line(self, stripped_line: str) -> bool:
        if not stripped_line:
            return False
        return bool(PAGE_NUMBER_PATTERN.fullmatch(stripped_line))

    def _is_scene_heading_line(self, stripped_line: str) -> bool:
        if not stripped_line:
            return False
        if not SCENE_PREFIX_PATTERN.match(stripped_line):
            return False
        # Rule: headings that begin with INT/EXT and are all-caps.
        has_letter = any(char.isalpha() for char in stripped_line)
        return has_letter and stripped_line == stripped_line.upper()

    def _extract_heading_fields(self, heading: str) -> tuple[str, str]:
        exact_match = SCENE_HEADING_PATTERN.match(heading)
        if exact_match:
            return (
                self._clean_location_text(exact_match.group("location")),
                exact_match.group("time").strip().upper(),
            )

        prefix_match = SCENE_PREFIX_PATTERN.match(heading)
        if not prefix_match:
            return "", "DAY"

        body = heading[prefix_match.end():].strip()
        time_tokens = {"DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"}
        location = body
        time_of_day = "DAY"

        parts = [part.strip() for part in body.split("-")]
        if parts:
            tail = parts[-1].upper()
            if tail in time_tokens:
                time_of_day = tail
                parts = parts[:-1]
                location = " - ".join(part for part in parts if part)

        return self._clean_location_text(location), time_of_day

    def _clean_location_text(self, value: str) -> str:
        cleaned = re.sub(r"^[\s.\-:;]+", "", str(value or ""))
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned.upper()

    def _classify_scene_lines(self, scene_lines: list[str]) -> list[dict[str, str]]:
        line_items: list[dict[str, str]] = []
        state = "action"
        dialogue_line_budget = 0

        for raw_line in scene_lines:
            stripped = raw_line.strip()
            line_type = "action"

            if not stripped:
                line_type = "blank"
                state = "action"
                dialogue_line_budget = 0
            elif self._is_scene_heading_line(stripped):
                line_type = "heading"
                state = "action"
                dialogue_line_budget = 0
            elif self._extract_character_cue(stripped):
                line_type = "character_cue"
                state = "cue"
                dialogue_line_budget = 4
            elif stripped.startswith("(") and stripped.endswith(")") and state in {"cue", "dialogue"}:
                line_type = "parenthetical"
                state = "dialogue"
            elif state in {"cue", "dialogue"} and dialogue_line_budget > 0:
                if stripped == stripped.upper() and len(stripped.split()) <= 4 and stripped.endswith(":"):
                    line_type = "character_cue"
                    state = "cue"
                    dialogue_line_budget = 4
                else:
                    line_type = "dialogue"
                    state = "dialogue"
                    dialogue_line_budget -= 1
            else:
                line_type = "action"
                state = "action"
                dialogue_line_budget = 0

            line_items.append({"type": line_type, "text": raw_line})

        return line_items

    def _is_noise_character_token(self, token: str) -> bool:
        normalized = str(token or "").strip().upper()
        if not normalized:
            return True
        if normalized in STOP_CHARACTER_TOKENS:
            return True
        if normalized in NOISE_CHARACTER_TOKENS:
            return True
        # OCR often breaks contractions into a dangling apostrophe fragment ("I'").
        if normalized.endswith("'") or normalized.endswith("’"):
            return True
        # Keep real apostrophe names like O'BRIEN, but reject tiny fragments like D' or I'.
        if ("'" in normalized or "’" in normalized) and len(normalized.replace("'", "").replace("’", "")) < 3:
            return True
        return False
