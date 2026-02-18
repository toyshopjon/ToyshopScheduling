import { useMemo, useState } from "react";

const UNSCHEDULED_DAY = "Unscheduled";
const TIME_OPTIONS = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"];
const INT_EXT_OPTIONS = ["INT", "EXT", "INT/EXT"];

function createStripId(prefix = "scene") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPageEighths(totalEighths) {
  const safeTotal = Number.isFinite(totalEighths) ? Math.max(0, totalEighths) : 0;
  const whole = Math.floor(safeTotal / 8);
  const eighths = safeTotal % 8;
  return `${whole} ${eighths}/8`;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDayTotalEighths(strips = []) {
  return strips.reduce((total, strip) => total + (Number.isFinite(strip.pageEighths) ? strip.pageEighths : 0), 0);
}

function getStripStyle(strip, colorMode) {
  if (colorMode === "none") {
    return {};
  }

  const time = String(strip.timeOfDay || "").toUpperCase();
  const intExt = String(strip.intExt || "").toUpperCase();

  if (colorMode === "dayNight") {
    if (time === "NIGHT") {
      return { backgroundColor: "#3352a1", color: "#ffffff", borderColor: "#22366f" };
    }
    if (["DAWN", "DUSK", "SUNRISE", "SUNSET"].includes(time)) {
      return { backgroundColor: "#e17de8", color: "#202020", borderColor: "#b95cc0" };
    }
    return { backgroundColor: "#efe655", color: "#111111", borderColor: "#b8ad1f" };
  }

  if (colorMode === "intExt") {
    if (intExt === "EXT") {
      return { backgroundColor: "#1b9b53", color: "#ffffff", borderColor: "#0f6737" };
    }
    if (intExt === "INT/EXT") {
      return { backgroundColor: "#a1632f", color: "#ffffff", borderColor: "#77451f" };
    }
    return { backgroundColor: "#d8dde7", color: "#1a1a1a", borderColor: "#aeb7ca" };
  }

  return {};
}

function toDraft(strip, day) {
  const totalEighths = Number.isFinite(strip?.pageEighths) ? strip.pageEighths : 1;
  return {
    id: strip?.id ?? null,
    sourceDay: day || UNSCHEDULED_DAY,
    sceneNumber: String(strip?.sceneNumber ?? ""),
    heading: strip?.heading ?? "",
    location: strip?.location ?? "",
    cast: (strip?.cast ?? []).join(", "),
    props: (strip?.props ?? []).join(", "),
    wardrobe: (strip?.wardrobe ?? []).join(", "),
    scriptText: strip?.scriptText ?? "",
    notes: strip?.notes ?? "",
    day: day || UNSCHEDULED_DAY,
    needsReview: Boolean(strip?.needsReview),
    intExt: strip?.intExt || "INT",
    timeOfDay: strip?.timeOfDay || "DAY",
    pageWhole: String(Math.floor(totalEighths / 8)),
    pageEighths: String(totalEighths % 8),
  };
}

export function Stripboard({ days, setDays, stripsByDay, setStripsByDay }) {
  const [dragged, setDragged] = useState(null);
  const [selectedStripIds, setSelectedStripIds] = useState(new Set());
  const [colorMode, setColorMode] = useState("dayNight");
  const [editorTarget, setEditorTarget] = useState(null);
  const [draft, setDraft] = useState(toDraft(null, UNSCHEDULED_DAY));

  const stripCount = useMemo(
    () => Object.values(stripsByDay).reduce((count, dayStrips) => count + dayStrips.length, 0),
    [stripsByDay]
  );

  const shootingDays = useMemo(() => days.filter((day) => day !== UNSCHEDULED_DAY), [days]);

  function onDrop(targetDay) {
    if (!dragged) {
      return;
    }

    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      const source = (next[dragged.day] ?? []).find((strip) => strip.id === dragged.id);
      if (!source) {
        return prev;
      }

      next[dragged.day] = (next[dragged.day] ?? []).filter((strip) => strip.id !== dragged.id);
      next[targetDay] = [...(next[targetDay] ?? []), source];
      return next;
    });

    if (editorTarget?.id === dragged.id) {
      setEditorTarget({ id: dragged.id, day: targetDay });
      setDraft((prev) => ({ ...prev, sourceDay: targetDay, day: targetDay }));
    }

    setDragged(null);
  }

  function toggleSelect(stripId) {
    setSelectedStripIds((prev) => {
      const next = new Set(prev);
      if (next.has(stripId)) {
        next.delete(stripId);
      } else {
        next.add(stripId);
      }
      return next;
    });
  }

  function bulkMove(targetDay) {
    if (!selectedStripIds.size) {
      return;
    }

    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      const moving = [];

      for (const day of days) {
        next[day] = (next[day] ?? []).filter((strip) => {
          if (selectedStripIds.has(strip.id)) {
            moving.push(strip);
            return false;
          }
          return true;
        });
      }

      next[targetDay] = [...(next[targetDay] ?? []), ...moving];
      return next;
    });

    setSelectedStripIds(new Set());
  }

  function addDay() {
    const nextDayName = `Day ${shootingDays.length + 1}`;

    setDays((prev) => {
      if (prev.includes(nextDayName)) {
        return prev;
      }
      return [UNSCHEDULED_DAY, ...prev.filter((day) => day !== UNSCHEDULED_DAY), nextDayName];
    });

    setStripsByDay((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, nextDayName)) {
        return prev;
      }
      return { ...prev, [nextDayName]: [] };
    });
  }

  function selectStrip(strip, day) {
    setEditorTarget({ id: strip.id, day });
    setDraft(toDraft(strip, day));
  }

  function resetForNew() {
    setEditorTarget(null);
    setDraft(toDraft(null, UNSCHEDULED_DAY));
  }

  function buildStripFromDraft() {
    const heading = draft.heading.trim();
    const location = draft.location.trim();
    if (!heading || !location) {
      return null;
    }

    const numericSceneNumber = Number.parseInt(draft.sceneNumber, 10);
    const sceneNumber = Number.isNaN(numericSceneNumber) ? stripCount + 1 : numericSceneNumber;
    const whole = Math.max(0, Number.parseInt(draft.pageWhole, 10) || 0);
    const eighths = Math.min(7, Math.max(0, Number.parseInt(draft.pageEighths, 10) || 0));

    return {
      id: draft.id || createStripId("scene"),
      sceneNumber,
      heading,
      location,
      cast: parseList(draft.cast),
      props: parseList(draft.props),
      wardrobe: parseList(draft.wardrobe),
      scriptText: draft.scriptText,
      notes: draft.notes,
      needsReview: draft.needsReview,
      intExt: draft.intExt,
      timeOfDay: draft.timeOfDay,
      pageEighths: whole * 8 + eighths,
    };
  }

  function saveNewScene() {
    const strip = buildStripFromDraft();
    if (!strip) {
      return;
    }

    const targetDay = days.includes(draft.day) ? draft.day : UNSCHEDULED_DAY;
    strip.id = createStripId("manual");

    setStripsByDay((prev) => ({
      ...prev,
      [targetDay]: [...(prev[targetDay] ?? []), strip],
    }));

    setEditorTarget({ id: strip.id, day: targetDay });
    setDraft(toDraft(strip, targetDay));
  }

  function updateScene() {
    if (!editorTarget?.id) {
      return;
    }

    const strip = buildStripFromDraft();
    if (!strip) {
      return;
    }

    const destinationDay = days.includes(draft.day) ? draft.day : editorTarget.day;
    strip.id = editorTarget.id;

    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      for (const day of Object.keys(next)) {
        next[day] = next[day].filter((item) => item.id !== editorTarget.id);
      }
      next[destinationDay] = [...(next[destinationDay] ?? []), strip];
      return next;
    });

    setEditorTarget({ id: strip.id, day: destinationDay });
    setDraft(toDraft(strip, destinationDay));
  }

  function duplicateScene() {
    const strip = buildStripFromDraft();
    if (!strip) {
      return;
    }

    const targetDay = days.includes(draft.day) ? draft.day : UNSCHEDULED_DAY;
    strip.id = createStripId("dup");

    setStripsByDay((prev) => ({
      ...prev,
      [targetDay]: [...(prev[targetDay] ?? []), strip],
    }));

    setEditorTarget({ id: strip.id, day: targetDay });
    setDraft(toDraft(strip, targetDay));
  }

  function renderStrip(strip, day) {
    const selected = selectedStripIds.has(strip.id);
    const stripStyle = getStripStyle(strip, colorMode);

    return (
      <article
        key={strip.id}
        className={`strip ${selected ? "selected" : ""} ${editorTarget?.id === strip.id ? "editing" : ""}`}
        draggable
        style={stripStyle}
        onDragStart={() => setDragged({ id: strip.id, day })}
        onClick={() => selectStrip(strip, day)}
      >
        <label onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => toggleSelect(strip.id)}
            onClick={(event) => event.stopPropagation()}
          />{" "}
          Select
        </label>
        <h4>Scene {strip.sceneNumber}</h4>
        <p className="strip-meta">{formatPageEighths(strip.pageEighths)} pgs | {strip.intExt} | {strip.timeOfDay}</p>
        <p>{strip.heading}</p>
        <p><strong>Set:</strong> {strip.location}</p>
        <p><strong>Cast:</strong> {(strip.cast ?? []).length ? strip.cast.join(", ") : "Unresolved"}</p>
        {strip.needsReview ? <span className="flag">Needs Review</span> : null}
      </article>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <span>Total strips: {stripCount}</span>
        <span>Selected: {selectedStripIds.size}</span>
        <label className="inline-control">
          Color Mode
          <select value={colorMode} onChange={(event) => setColorMode(event.target.value)}>
            <option value="dayNight">Day/Night</option>
            <option value="intExt">INT/EXT</option>
            <option value="none">None</option>
          </select>
        </label>
        <button type="button" className="add-day-button" onClick={addDay}>Add Day</button>
        {days.map((day) => (
          <button key={day} type="button" onClick={() => bulkMove(day)}>
            Move Selected to {day}
          </button>
        ))}
      </div>

      <section className="scene-editor">
        <h3>Scene Workbench</h3>
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="editor-actions">
            <button type="button" onClick={updateScene} disabled={!editorTarget}>Update</button>
            <button type="button" onClick={saveNewScene}>New</button>
            <button type="button" onClick={duplicateScene}>Duplicate</button>
            <button type="button" onClick={resetForNew}>Clear</button>
          </div>
          <div className="editor-row-primary">
            <label className="field-scene-number">
              Scene Number
              <input type="text" value={draft.sceneNumber} onChange={(event) => setDraft((prev) => ({ ...prev, sceneNumber: event.target.value }))} />
            </label>
            <label className="field-int-ext">
              INT/EXT
              <select value={draft.intExt} onChange={(event) => setDraft((prev) => ({ ...prev, intExt: event.target.value }))}>
                {INT_EXT_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="field-time-of-day">
              Time of Day
              <select value={draft.timeOfDay} onChange={(event) => setDraft((prev) => ({ ...prev, timeOfDay: event.target.value }))}>
                {TIME_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="field-heading">
              Heading
              <input type="text" value={draft.heading} onChange={(event) => setDraft((prev) => ({ ...prev, heading: event.target.value }))} />
            </label>
          </div>
          <div className="editor-row-secondary">
            <label>
              Location (Set)
              <input type="text" value={draft.location} onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))} />
            </label>
            <div className="editor-grid-pages">
              <label>
                Whole Pages
                <input type="number" min="0" value={draft.pageWhole} onChange={(event) => setDraft((prev) => ({ ...prev, pageWhole: event.target.value }))} />
              </label>
              <label>
                8ths
                <select value={draft.pageEighths} onChange={(event) => setDraft((prev) => ({ ...prev, pageEighths: event.target.value }))}>
                  {Array.from({ length: 8 }, (_, index) => (
                    <option key={index} value={String(index)}>{index}/8</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Scheduled Day
              <select value={draft.day} onChange={(event) => setDraft((prev) => ({ ...prev, day: event.target.value }))}>
                {days.map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="editor-row-secondary">
            <label>
              Cast (comma separated)
              <input type="text" value={draft.cast} onChange={(event) => setDraft((prev) => ({ ...prev, cast: event.target.value }))} />
            </label>
            <label>
              Props (comma separated)
              <input type="text" value={draft.props} onChange={(event) => setDraft((prev) => ({ ...prev, props: event.target.value }))} />
            </label>
            <label>
              Wardrobe (comma separated)
              <input type="text" value={draft.wardrobe} onChange={(event) => setDraft((prev) => ({ ...prev, wardrobe: event.target.value }))} />
            </label>
          </div>
          <label>
            Script Text
            <textarea className="script-text-area" rows={4} value={draft.scriptText} onChange={(event) => setDraft((prev) => ({ ...prev, scriptText: event.target.value }))} />
          </label>
          <label>
            Notes
            <textarea value={draft.notes} onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))} />
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={draft.needsReview} onChange={(event) => setDraft((prev) => ({ ...prev, needsReview: event.target.checked }))} />
            Needs Review
          </label>
        </form>
      </section>

      <div className="stripboard-layout">
        <div className="board-shell">
          <section className="column unscheduled-column" onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(UNSCHEDULED_DAY)}>
            <h3>{UNSCHEDULED_DAY} <span className="day-total">{formatPageEighths(getDayTotalEighths(stripsByDay[UNSCHEDULED_DAY] ?? []))} pages</span></h3>
            {(stripsByDay[UNSCHEDULED_DAY] ?? []).map((strip) => renderStrip(strip, UNSCHEDULED_DAY))}
          </section>

          <div className="shooting-days-stack">
            {shootingDays.map((day) => {
              const dayStrips = stripsByDay[day] ?? [];
              return (
                <section key={day} className="column shooting-day-column" onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(day)}>
                  <h3>{day} <span className="day-total">{formatPageEighths(getDayTotalEighths(dayStrips))} pages</span></h3>
                  {dayStrips.map((strip) => renderStrip(strip, day))}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
