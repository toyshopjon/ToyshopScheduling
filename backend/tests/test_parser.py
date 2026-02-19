from app.services.parser import ScriptParser


def test_split_into_scenes_detects_headings_and_cast() -> None:
    parser = ScriptParser()
    text = """
INT. TOY SHOP - DAY
JON
We need to move fast.

EXT. STREET - NIGHT
A car speeds by.
"""

    scenes = parser._split_into_scenes(text)

    assert len(scenes) == 2
    assert scenes[0].location == "TOY SHOP"
    assert scenes[0].cast == ["JON"]
    assert scenes[0].needs_review is False
    assert scenes[0].scene_text.startswith("INT. TOY SHOP - DAY")
    assert "JON" in scenes[0].scene_text
    assert scenes[1].needs_review is True


def test_scene_text_preserves_internal_line_breaks() -> None:
    parser = ScriptParser()
    text = """
INT. KITCHEN - DAY
JON

He opens the fridge.
"""

    scenes = parser._split_into_scenes(text)

    assert len(scenes) == 1
    assert "JON\n\nHe opens the fridge." in scenes[0].scene_text


def test_scene_text_preserves_tabs_and_spacing() -> None:
    parser = ScriptParser()
    text = "INT. OFFICE - DAY\n\tJON\n    He checks notes.\n"

    scenes = parser._split_into_scenes(text)

    assert len(scenes) == 1
    assert scenes[0].scene_text == "INT. OFFICE - DAY\n\tJON\n    He checks notes."


def test_character_cue_with_colon_and_hyphen_is_detected() -> None:
    parser = ScriptParser()
    text = """
INT. BAR - NIGHT
BAR-GOER:
Designated driver?
"""
    scenes = parser._split_into_scenes(text)

    assert len(scenes) == 1
    assert "BAR-GOER" in scenes[0].cast


def test_all_caps_intro_in_action_line_is_added_to_scene_cast() -> None:
    parser = ScriptParser()
    text = """
INT. BAR - NIGHT
Ripley scans the room as BAR-GOER (30s) leans in.
"""
    scenes = parser._split_into_scenes(text)

    assert len(scenes) == 1
    assert "BAR-GOER" in scenes[0].cast


def test_second_pass_adds_speaking_character_mentions_in_other_scenes() -> None:
    parser = ScriptParser()
    text = """
INT. BRIDGE - NIGHT
RIPLEY
We should leave.

EXT. STREET - DAY
The crowd parts as RIPLEY walks through the rain.
"""
    scenes = parser._split_into_scenes(text)

    assert len(scenes) == 2
    assert "RIPLEY" in scenes[0].cast
    assert "RIPLEY" in scenes[1].cast
