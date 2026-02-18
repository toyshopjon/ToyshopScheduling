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
    assert scenes[1].needs_review is True
