import { useEffect, useMemo, useState } from "react";

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

function parsePageCountToEighths(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const mixedMatch = raw.match(/^(\d+)\s+([0-7])\s*\/\s*8$/);
  if (mixedMatch) {
    return Number.parseInt(mixedMatch[1], 10) * 8 + Number.parseInt(mixedMatch[2], 10);
  }

  const fractionMatch = raw.match(/^([0-7])\s*\/\s*8$/);
  if (fractionMatch) {
    return Number.parseInt(fractionMatch[1], 10);
  }

  const wholeMatch = raw.match(/^(\d+)$/);
  if (wholeMatch) {
    return Number.parseInt(wholeMatch[1], 10) * 8;
  }

  const decimal = Number.parseFloat(raw);
  if (!Number.isNaN(decimal) && decimal >= 0) {
    return Math.round(decimal * 8);
  }

  return null;
}

function estimateVisualPageEighths(scriptText) {
  const text = String(scriptText || "");
  if (!text.trim()) {
    return 1;
  }
  const lineCount = text.split("\n").length;
  const eighths = Math.round((lineCount / 55) * 8);
  return Math.max(1, eighths);
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addValueToCommaList(source, value) {
  const candidate = String(value || "").trim();
  if (!candidate) {
    return source;
  }
  const existing = parseList(source);
  if (existing.some((item) => item.toUpperCase() === candidate.toUpperCase())) {
    return existing.join(", ");
  }
  return [...existing, candidate].join(", ");
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
    pageCount: formatPageEighths(totalEighths),
  };
}

export function Stripboard({
  days,
  setDays,
  stripsByDay,
  setStripsByDay,
  showElementsView = true,
  reportView = "stripboard",
  showWorkbench = true,
}) {
  const [dragged, setDragged] = useState(null);
  const [selectedStripIds, setSelectedStripIds] = useState(new Set());
  const [colorMode, setColorMode] = useState("dayNight");
  const [editorTarget, setEditorTarget] = useState(null);
  const [draft, setDraft] = useState(toDraft(null, UNSCHEDULED_DAY));
  const [entityType, setEntityType] = useState("cast");
  const [selectedEntity, setSelectedEntity] = useState("");
  const [quickAddValue, setQuickAddValue] = useState({ cast: "", props: "", wardrobe: "" });

  const stripCount = useMemo(
    () => Object.values(stripsByDay).reduce((count, dayStrips) => count + dayStrips.length, 0),
    [stripsByDay]
  );

  const shootingDays = useMemo(() => days.filter((day) => day !== UNSCHEDULED_DAY), [days]);
  const allSceneRefs = useMemo(() => {
    const refs = [];
    for (const day of days) {
      for (const strip of stripsByDay[day] ?? []) {
        refs.push({ day, strip });
      }
    }
    return refs;
  }, [days, stripsByDay]);

  const entityIndex = useMemo(() => {
    const maps = {
      cast: new Map(),
      location: new Map(),
      props: new Map(),
      wardrobe: new Map(),
    };

    for (const ref of allSceneRefs) {
      const pushToMap = (type, rawValue) => {
        const value = String(rawValue || "").trim();
        if (!value) {
          return;
        }
        if (!maps[type].has(value)) {
          maps[type].set(value, []);
        }
        maps[type].get(value).push(ref);
      };

      for (const castValue of ref.strip.cast ?? []) {
        pushToMap("cast", castValue);
      }
      pushToMap("location", ref.strip.location);
      for (const propValue of ref.strip.props ?? []) {
        pushToMap("props", propValue);
      }
      for (const wardrobeValue of ref.strip.wardrobe ?? []) {
        pushToMap("wardrobe", wardrobeValue);
      }
    }

    return maps;
  }, [allSceneRefs]);

  const entityList = useMemo(() => {
    return Array.from(entityIndex[entityType].entries())
      .map(([value, refs]) => ({ value, count: refs.length }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [entityIndex, entityType]);

  const currentEntityScenes = useMemo(() => {
    if (!selectedEntity) {
      return [];
    }
    return entityIndex[entityType].get(selectedEntity) ?? [];
  }, [entityIndex, entityType, selectedEntity]);

  const castSuggestions = useMemo(() => Array.from(entityIndex.cast.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const locationSuggestions = useMemo(() => Array.from(entityIndex.location.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const propsSuggestions = useMemo(() => Array.from(entityIndex.props.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const wardrobeSuggestions = useMemo(
    () => Array.from(entityIndex.wardrobe.keys()).sort((a, b) => a.localeCompare(b)),
    [entityIndex]
  );

  useEffect(() => {
    if (!entityList.length) {
      setSelectedEntity("");
      return;
    }
    if (!entityList.some((item) => item.value === selectedEntity)) {
      setSelectedEntity(entityList[0].value);
    }
  }, [entityList, selectedEntity]);

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
    const parsedPageEighths = parsePageCountToEighths(draft.pageCount);
    const pageEighths = parsedPageEighths ?? estimateVisualPageEighths(draft.scriptText);

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
      pageEighths,
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

  function addQuickSuggestion(field) {
    const value = quickAddValue[field];
    if (!value) {
      return;
    }
    setDraft((prev) => ({ ...prev, [field]: addValueToCommaList(prev[field], value) }));
    setQuickAddValue((prev) => ({ ...prev, [field]: "" }));
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

      {showWorkbench ? (
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
              <input
                type="text"
                list="location-suggestions"
                value={draft.location}
                onChange={(event) => setDraft((prev) => ({ ...prev, location: event.target.value }))}
              />
            </label>
            <label className="field-page-count">
              Page Count
              <input
                type="text"
                value={draft.pageCount}
                placeholder="e.g. 2 3/8"
                onChange={(event) => setDraft((prev) => ({ ...prev, pageCount: event.target.value }))}
              />
            </label>
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
            <label className="inline-suggest">
              Cast Suggestions
              <div className="suggest-add">
                <input
                  type="text"
                  list="cast-suggestions"
                  value={quickAddValue.cast}
                  onChange={(event) => setQuickAddValue((prev) => ({ ...prev, cast: event.target.value }))}
                />
                <button type="button" onClick={() => addQuickSuggestion("cast")}>Add</button>
              </div>
            </label>
            <label>
              Props (comma separated)
              <input type="text" value={draft.props} onChange={(event) => setDraft((prev) => ({ ...prev, props: event.target.value }))} />
            </label>
          </div>
          <div className="editor-row-secondary">
            <label className="inline-suggest">
              Props Suggestions
              <div className="suggest-add">
                <input
                  type="text"
                  list="props-suggestions"
                  value={quickAddValue.props}
                  onChange={(event) => setQuickAddValue((prev) => ({ ...prev, props: event.target.value }))}
                />
                <button type="button" onClick={() => addQuickSuggestion("props")}>Add</button>
              </div>
            </label>
            <label>
              Wardrobe (comma separated)
              <input type="text" value={draft.wardrobe} onChange={(event) => setDraft((prev) => ({ ...prev, wardrobe: event.target.value }))} />
            </label>
            <label className="inline-suggest">
              Wardrobe Suggestions
              <div className="suggest-add">
                <input
                  type="text"
                  list="wardrobe-suggestions"
                  value={quickAddValue.wardrobe}
                  onChange={(event) => setQuickAddValue((prev) => ({ ...prev, wardrobe: event.target.value }))}
                />
                <button type="button" onClick={() => addQuickSuggestion("wardrobe")}>Add</button>
              </div>
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
          <datalist id="cast-suggestions">
            {castSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <datalist id="location-suggestions">
            {locationSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <datalist id="props-suggestions">
            {propsSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <datalist id="wardrobe-suggestions">
            {wardrobeSuggestions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </form>
      </section>
      ) : null}

      {showElementsView ? (
        <section className="entity-browser">
          <h3>Elements View</h3>
          <div className="entity-controls">
            <label>
              Browse
              <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
                <option value="cast">Cast</option>
                <option value="location">Location</option>
                <option value="props">Props</option>
                <option value="wardrobe">Wardrobe</option>
              </select>
            </label>
          </div>
          <div className="entity-layout">
            <div className="entity-list">
              {entityList.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={selectedEntity === item.value ? "entity-item active" : "entity-item"}
                  onClick={() => setSelectedEntity(item.value)}
                >
                  <span>{item.value}</span>
                  <span>{item.count}</span>
                </button>
              ))}
            </div>
            <div className="entity-scenes">
              <h4>{selectedEntity || "Select an item"}</h4>
              {currentEntityScenes.map(({ day, strip }) => (
                <button key={`${selectedEntity}-${strip.id}`} type="button" className="entity-scene-item" onClick={() => selectStrip(strip, day)}>
                  Scene {strip.sceneNumber} | {day} | {strip.heading}
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {reportView === "stripboard" ? (
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
      ) : null}
    </div>
  );
}
