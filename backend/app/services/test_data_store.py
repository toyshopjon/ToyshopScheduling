import sqlite3
import json
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "dev_data.sqlite"


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS schedules (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              project_id INTEGER NOT NULL,
              name TEXT NOT NULL,
              FOREIGN KEY(project_id) REFERENCES projects(id)
            );

            CREATE TABLE IF NOT EXISTS scenes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              schedule_id INTEGER NOT NULL,
              scene_number INTEGER NOT NULL,
              heading TEXT NOT NULL,
              location TEXT,
              int_ext TEXT,
              time_of_day TEXT,
              page_eighths INTEGER DEFAULT 1,
              cast_csv TEXT DEFAULT '',
              props_csv TEXT DEFAULT '',
              wardrobe_csv TEXT DEFAULT '',
              sets_csv TEXT DEFAULT '',
              notes TEXT DEFAULT '',
              script_text TEXT DEFAULT '',
              source_order INTEGER DEFAULT 0,
              FOREIGN KEY(schedule_id) REFERENCES schedules(id)
            );

            CREATE TABLE IF NOT EXISTS review_feedback (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              scene_number INTEGER NOT NULL,
              heading TEXT NOT NULL,
              script_text TEXT DEFAULT '',
              predicted_cast_csv TEXT DEFAULT '',
              corrected_cast_csv TEXT DEFAULT '',
              predicted_location TEXT DEFAULT '',
              corrected_location TEXT DEFAULT '',
              predicted_props_csv TEXT DEFAULT '',
              corrected_props_csv TEXT DEFAULT '',
              predicted_wardrobe_csv TEXT DEFAULT '',
              corrected_wardrobe_csv TEXT DEFAULT '',
              predicted_sets_csv TEXT DEFAULT '',
              corrected_sets_csv TEXT DEFAULT '',
              manual_split INTEGER DEFAULT 0,
              split_parent_scene_number INTEGER DEFAULT 0,
              split_parent_heading TEXT DEFAULT '',
              split_selected_text TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS element_aliases (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              element_type TEXT NOT NULL,
              alias TEXT NOT NULL,
              canonical TEXT NOT NULL,
              source TEXT DEFAULT 'review',
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(element_type, alias)
            );
            """
        )
        _ensure_column(conn, "scenes", "sets_csv", "TEXT DEFAULT ''")
        _ensure_column(conn, "review_feedback", "predicted_sets_csv", "TEXT DEFAULT ''")
        _ensure_column(conn, "review_feedback", "corrected_sets_csv", "TEXT DEFAULT ''")
        _ensure_column(conn, "review_feedback", "manual_split", "INTEGER DEFAULT 0")
        _ensure_column(conn, "review_feedback", "split_parent_scene_number", "INTEGER DEFAULT 0")
        _ensure_column(conn, "review_feedback", "split_parent_heading", "TEXT DEFAULT ''")
        _ensure_column(conn, "review_feedback", "split_selected_text", "TEXT DEFAULT ''")


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
    names = {row["name"] for row in columns}
    if column in names:
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def clear_all() -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM scenes")
        conn.execute("DELETE FROM review_feedback")
        conn.execute("DELETE FROM element_aliases")
        conn.execute("DELETE FROM schedules")
        conn.execute("DELETE FROM projects")


def seed_demo_data() -> dict:
    clear_all()

    with get_conn() as conn:
        project_id = conn.execute("INSERT INTO projects(name) VALUES (?)", ("Demo Feature",)).lastrowid
        schedule_id = conn.execute(
            "INSERT INTO schedules(project_id, name) VALUES (?, ?)",
            (project_id, "Schedule A"),
        ).lastrowid

        demo_scenes = [
            (
                schedule_id,
                1,
                "INT. NOSTROMO BRIDGE - NIGHT",
                "NOSTROMO BRIDGE",
                "INT",
                "NIGHT",
                3,
                "RIPLEY,DALLAS,LAMBERT",
                "MOTION TRACKER,TERMINAL",
                "FLIGHT SUIT",
                "NOSTROMO BRIDGE",
                "Initial bridge setup",
                "INT. NOSTROMO BRIDGE - NIGHT\n\tRIPLEY checks the displays.\n    DALLAS leans over the terminal.",
                1,
            ),
            (
                schedule_id,
                2,
                "EXT. PLANET SURFACE - DAY",
                "PLANET SURFACE",
                "EXT",
                "DAY",
                5,
                "RIPLEY,KANE",
                "ROVER,HELMET",
                "SPACESUIT",
                "PLANET SURFACE",
                "Dust storm scene",
                "EXT. PLANET SURFACE - DAY\n\tThe rover crawls forward.\n    Wind blasts the crew.",
                2,
            ),
        ]

        conn.executemany(
            """
            INSERT INTO scenes(
              schedule_id, scene_number, heading, location, int_ext, time_of_day,
              page_eighths, cast_csv, props_csv, wardrobe_csv, sets_csv, notes, script_text, source_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            demo_scenes,
        )

    return {
        "project_id": project_id,
        "schedule_id": schedule_id,
        "seeded_scenes": len(demo_scenes),
        "db_path": str(DB_PATH),
    }


def list_projects() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name FROM projects ORDER BY id").fetchall()
        return [dict(row) for row in rows]


def list_schedules(project_id: int | None = None) -> list[dict]:
    with get_conn() as conn:
        if project_id is None:
            rows = conn.execute("SELECT id, project_id, name FROM schedules ORDER BY id").fetchall()
        else:
            rows = conn.execute(
                "SELECT id, project_id, name FROM schedules WHERE project_id = ? ORDER BY id",
                (project_id,),
            ).fetchall()
        return [dict(row) for row in rows]


def list_scenes(schedule_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id, schedule_id, scene_number, heading, location, int_ext, time_of_day,
                   page_eighths, cast_csv, props_csv, wardrobe_csv, sets_csv, notes, script_text, source_order
            FROM scenes
            WHERE schedule_id = ?
            ORDER BY source_order, scene_number, id
            """,
            (schedule_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def replace_scenes(schedule_id: int, scenes: list[dict]) -> dict:
    with get_conn() as conn:
        schedule_row = conn.execute(
            "SELECT id FROM schedules WHERE id = ?",
            (schedule_id,),
        ).fetchone()
        if not schedule_row:
            raise ValueError(f"Schedule {schedule_id} not found.")

        conn.execute("DELETE FROM scenes WHERE schedule_id = ?", (schedule_id,))

        payload = []
        for index, scene in enumerate(scenes):
            payload.append(
                (
                    schedule_id,
                    int(scene.get("scene_number", index + 1)),
                    scene.get("heading", ""),
                    scene.get("location", ""),
                    scene.get("int_ext", "INT"),
                    scene.get("time_of_day", "DAY"),
                    int(scene.get("page_eighths", 1)),
                    scene.get("cast_csv", ""),
                    scene.get("props_csv", ""),
                    scene.get("wardrobe_csv", ""),
                    scene.get("sets_csv", ""),
                    scene.get("notes", ""),
                    scene.get("script_text", ""),
                    int(scene.get("source_order", index)),
                )
            )

        conn.executemany(
            """
            INSERT INTO scenes(
              schedule_id, scene_number, heading, location, int_ext, time_of_day,
              page_eighths, cast_csv, props_csv, wardrobe_csv, sets_csv, notes, script_text, source_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            payload,
        )

        return {"schedule_id": schedule_id, "saved_scenes": len(payload)}


def _split_csv(value: str) -> set[str]:
    return {
        token.strip()
        for token in str(value or "").split(",")
        if token.strip()
    }


def _upsert_aliases(conn: sqlite3.Connection, element_type: str, corrected_csv: str) -> int:
    values = sorted(_split_csv(corrected_csv))
    saved = 0
    for token in values:
        conn.execute(
            """
            INSERT INTO element_aliases(element_type, alias, canonical, source)
            VALUES (?, ?, ?, 'review')
            ON CONFLICT(element_type, alias)
            DO UPDATE SET canonical = excluded.canonical
            """,
            (element_type, token.upper(), token),
        )
        saved += 1
    return saved


def save_review_feedback(entry: dict) -> dict:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO review_feedback(
              scene_number, heading, script_text,
              predicted_cast_csv, corrected_cast_csv,
              predicted_location, corrected_location,
              predicted_props_csv, corrected_props_csv,
              predicted_wardrobe_csv, corrected_wardrobe_csv,
              predicted_sets_csv, corrected_sets_csv,
              manual_split, split_parent_scene_number, split_parent_heading, split_selected_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(entry.get("scene_number", 0)),
                entry.get("heading", ""),
                entry.get("script_text", ""),
                entry.get("predicted_cast_csv", ""),
                entry.get("corrected_cast_csv", ""),
                entry.get("predicted_location", ""),
                entry.get("corrected_location", ""),
                entry.get("predicted_props_csv", ""),
                entry.get("corrected_props_csv", ""),
                entry.get("predicted_wardrobe_csv", ""),
                entry.get("corrected_wardrobe_csv", ""),
                entry.get("predicted_sets_csv", ""),
                entry.get("corrected_sets_csv", ""),
                1 if entry.get("manual_split", False) else 0,
                int(entry.get("split_parent_scene_number", 0)),
                entry.get("split_parent_heading", ""),
                entry.get("split_selected_text", ""),
            ),
        )

        aliases_saved = 0
        aliases_saved += _upsert_aliases(conn, "cast", entry.get("corrected_cast_csv", ""))
        aliases_saved += _upsert_aliases(conn, "props", entry.get("corrected_props_csv", ""))
        aliases_saved += _upsert_aliases(conn, "wardrobe", entry.get("corrected_wardrobe_csv", ""))
        aliases_saved += _upsert_aliases(conn, "sets", entry.get("corrected_sets_csv", ""))
        aliases_saved += _upsert_aliases(conn, "location", entry.get("corrected_location", ""))

    return {"saved": True, "aliases_saved": aliases_saved}


def list_aliases(element_type: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if element_type:
            rows = conn.execute(
                "SELECT element_type, alias, canonical, source, created_at FROM element_aliases WHERE element_type = ? ORDER BY canonical",
                (element_type,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT element_type, alias, canonical, source, created_at FROM element_aliases ORDER BY element_type, canonical",
            ).fetchall()
        return [dict(row) for row in rows]


def get_review_metrics() -> dict:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
              predicted_cast_csv, corrected_cast_csv,
              predicted_location, corrected_location,
              predicted_props_csv, corrected_props_csv,
              predicted_wardrobe_csv, corrected_wardrobe_csv,
              predicted_sets_csv, corrected_sets_csv
            FROM review_feedback
            """
        ).fetchall()

    cast_tp = cast_fp = cast_fn = 0
    props_tp = props_fp = props_fn = 0
    wardrobe_tp = wardrobe_fp = wardrobe_fn = 0
    sets_tp = sets_fp = sets_fn = 0
    location_exact = 0
    location_total = 0

    for row in rows:
        predicted_cast = _split_csv(row["predicted_cast_csv"])
        corrected_cast = _split_csv(row["corrected_cast_csv"])
        cast_tp += len(predicted_cast & corrected_cast)
        cast_fp += len(predicted_cast - corrected_cast)
        cast_fn += len(corrected_cast - predicted_cast)

        predicted_props = _split_csv(row["predicted_props_csv"])
        corrected_props = _split_csv(row["corrected_props_csv"])
        props_tp += len(predicted_props & corrected_props)
        props_fp += len(predicted_props - corrected_props)
        props_fn += len(corrected_props - predicted_props)

        predicted_wardrobe = _split_csv(row["predicted_wardrobe_csv"])
        corrected_wardrobe = _split_csv(row["corrected_wardrobe_csv"])
        wardrobe_tp += len(predicted_wardrobe & corrected_wardrobe)
        wardrobe_fp += len(predicted_wardrobe - corrected_wardrobe)
        wardrobe_fn += len(corrected_wardrobe - predicted_wardrobe)

        predicted_sets = _split_csv(row["predicted_sets_csv"])
        corrected_sets = _split_csv(row["corrected_sets_csv"])
        sets_tp += len(predicted_sets & corrected_sets)
        sets_fp += len(predicted_sets - corrected_sets)
        sets_fn += len(corrected_sets - predicted_sets)

        location_total += 1
        if str(row["predicted_location"]).strip().upper() == str(row["corrected_location"]).strip().upper():
            location_exact += 1

    def _prf(tp: int, fp: int, fn: int) -> dict:
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        return {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4)}

    return {
        "review_count": len(rows),
        "cast": _prf(cast_tp, cast_fp, cast_fn),
        "props": _prf(props_tp, props_fp, props_fn),
        "wardrobe": _prf(wardrobe_tp, wardrobe_fp, wardrobe_fn),
        "sets": _prf(sets_tp, sets_fp, sets_fn),
        "location": {
            "exact_match_rate": round(location_exact / location_total, 4) if location_total else 0.0,
            "total": location_total,
        },
    }


def export_review_jsonl() -> str:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT
              scene_number, heading, script_text,
              predicted_cast_csv, corrected_cast_csv,
              predicted_location, corrected_location,
              predicted_props_csv, corrected_props_csv,
              predicted_wardrobe_csv, corrected_wardrobe_csv,
              predicted_sets_csv, corrected_sets_csv,
              manual_split, split_parent_scene_number, split_parent_heading, split_selected_text
            FROM review_feedback
            ORDER BY id
            """
        ).fetchall()

    lines: list[str] = []
    for row in rows:
        item = {
            "scene_number": row["scene_number"],
            "heading": row["heading"],
            "script_text": row["script_text"],
            "predicted": {
                "cast": sorted(_split_csv(row["predicted_cast_csv"])),
                "location": row["predicted_location"],
                "props": sorted(_split_csv(row["predicted_props_csv"])),
                "wardrobe": sorted(_split_csv(row["predicted_wardrobe_csv"])),
                "sets": sorted(_split_csv(row["predicted_sets_csv"])),
            },
            "corrected": {
                "cast": sorted(_split_csv(row["corrected_cast_csv"])),
                "location": row["corrected_location"],
                "props": sorted(_split_csv(row["corrected_props_csv"])),
                "wardrobe": sorted(_split_csv(row["corrected_wardrobe_csv"])),
                "sets": sorted(_split_csv(row["corrected_sets_csv"])),
            },
            "manual_split": bool(row["manual_split"]),
            "split_parent_scene_number": row["split_parent_scene_number"],
            "split_parent_heading": row["split_parent_heading"],
            "split_selected_text": row["split_selected_text"],
        }
        lines.append(json.dumps(item, ensure_ascii=False))
    return "\n".join(lines)
