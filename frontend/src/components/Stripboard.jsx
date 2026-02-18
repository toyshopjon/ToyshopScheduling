import { useEffect, useMemo, useState } from "react";

const UNSCHEDULED_DAY = "Unscheduled";

export function Stripboard({ days, setDays, stripsByDay, setStripsByDay }) {
  const [dragged, setDragged] = useState(null);
  const [selectedStripIds, setSelectedStripIds] = useState(new Set());
  const [editorTarget, setEditorTarget] = useState(null);
  const [editorDraft, setEditorDraft] = useState(null);
  const [manualScene, setManualScene] = useState({
    sceneNumber: "",
    heading: "",
    location: "",
    cast: "",
    day: UNSCHEDULED_DAY,
    needsReview: false,
  });

  const stripCount = useMemo(
    () => Object.values(stripsByDay).reduce((count, dayStrips) => count + dayStrips.length, 0),
    [stripsByDay]
  );
  const activeStrip = useMemo(() => {
    if (!editorTarget) {
      return null;
    }
    return (stripsByDay[editorTarget.day] ?? []).find((strip) => strip.id === editorTarget.id) ?? null;
  }, [editorTarget, stripsByDay]);

  useEffect(() => {
    if (!activeStrip) {
      setEditorDraft(null);
      return;
    }

    setEditorDraft({
      sceneNumber: String(activeStrip.sceneNumber ?? ""),
      heading: activeStrip.heading ?? "",
      location: activeStrip.location ?? "",
      cast: (activeStrip.cast ?? []).join(", "),
      day: editorTarget.day,
      needsReview: Boolean(activeStrip.needsReview),
    });
  }, [activeStrip, editorTarget]);

  function parseCast(rawCast) {
    return rawCast
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean);
  }

  function onDrop(targetDay) {
    if (!dragged) {
      return;
    }

    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      const source = next[dragged.day].find((strip) => strip.id === dragged.id);
      if (!source) {
        return prev;
      }

      next[dragged.day] = next[dragged.day].filter((strip) => strip.id !== dragged.id);
      next[targetDay].push(source);
      return next;
    });

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
        const dayStrips = next[day] ?? [];
        next[day] = dayStrips.filter((strip) => {
          if (selectedStripIds.has(strip.id)) {
            moving.push(strip);
            return false;
          }
          return true;
        });
      }

      next[targetDay].push(...moving);
      return next;
    });

    setSelectedStripIds(new Set());
  }

  function addDay() {
    const scheduledDays = days.filter((day) => day !== UNSCHEDULED_DAY);
    const nextDayName = `Day ${scheduledDays.length + 1}`;

    setDays((prev) => {
      if (prev.includes(nextDayName)) {
        return prev;
      }

      const withoutUnscheduled = prev.filter((day) => day !== UNSCHEDULED_DAY);
      return [...withoutUnscheduled, nextDayName, UNSCHEDULED_DAY];
    });

    setStripsByDay((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, nextDayName)) {
        return prev;
      }
      return { ...prev, [nextDayName]: [] };
    });
  }

  function addManualScene(event) {
    event.preventDefault();

    const heading = manualScene.heading.trim();
    const location = manualScene.location.trim();
    if (!heading || !location) {
      return;
    }

    const cast = parseCast(manualScene.cast);
    const fallbackSceneNumber = stripCount + 1;
    const numericSceneNumber = Number.parseInt(manualScene.sceneNumber, 10);
    const sceneNumber = Number.isNaN(numericSceneNumber) ? fallbackSceneNumber : numericSceneNumber;
    const nextDay = days.includes(manualScene.day) ? manualScene.day : UNSCHEDULED_DAY;

    const newStrip = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sceneNumber,
      heading,
      location,
      cast,
      needsReview: manualScene.needsReview,
    };

    setStripsByDay((prev) => ({
      ...prev,
      [nextDay]: [...(prev[nextDay] ?? []), newStrip],
    }));

    setManualScene({
      sceneNumber: "",
      heading: "",
      location: "",
      cast: "",
      day: nextDay,
      needsReview: false,
    });
  }

  function saveSceneEdits(event) {
    event.preventDefault();
    if (!editorTarget || !editorDraft) {
      return;
    }

    const heading = editorDraft.heading.trim();
    const location = editorDraft.location.trim();
    if (!heading || !location) {
      return;
    }

    const cast = parseCast(editorDraft.cast);
    const numericSceneNumber = Number.parseInt(editorDraft.sceneNumber, 10);
    const hasValidSceneNumber = !Number.isNaN(numericSceneNumber);
    const destinationDay = days.includes(editorDraft.day) ? editorDraft.day : editorTarget.day;

    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      let stripToUpdate = null;
      let currentDay = editorTarget.day;

      for (const day of Object.keys(next)) {
        const found = next[day].find((strip) => strip.id === editorTarget.id);
        if (found) {
          stripToUpdate = found;
          currentDay = day;
          break;
        }
      }

      if (!stripToUpdate) {
        return prev;
      }

      next[currentDay] = next[currentDay].filter((strip) => strip.id !== editorTarget.id);
      next[destinationDay].push({
        ...stripToUpdate,
        sceneNumber: hasValidSceneNumber ? numericSceneNumber : stripToUpdate.sceneNumber,
        heading,
        location,
        cast,
        needsReview: editorDraft.needsReview,
      });

      return next;
    });

    setEditorTarget({ id: editorTarget.id, day: destinationDay });
  }

  return (
    <div>
      <div className="toolbar">
        <span>Total strips: {stripCount}</span>
        <span>Selected: {selectedStripIds.size}</span>
        <button type="button" className="add-day-button" onClick={addDay}>
          Add Day
        </button>
        {days.map((day) => (
          <button key={day} type="button" onClick={() => bulkMove(day)}>
            Move Selected to {day}
          </button>
        ))}
      </div>

      <form className="manual-scene-form" onSubmit={addManualScene}>
        <h3>Manual Scene Entry</h3>
        <input
          type="text"
          placeholder="Scene Number"
          value={manualScene.sceneNumber}
          onChange={(event) => setManualScene((prev) => ({ ...prev, sceneNumber: event.target.value }))}
        />
        <input
          type="text"
          placeholder="Heading (required)"
          value={manualScene.heading}
          onChange={(event) => setManualScene((prev) => ({ ...prev, heading: event.target.value }))}
        />
        <input
          type="text"
          placeholder="Location (required)"
          value={manualScene.location}
          onChange={(event) => setManualScene((prev) => ({ ...prev, location: event.target.value }))}
        />
        <input
          type="text"
          placeholder="Cast (comma separated)"
          value={manualScene.cast}
          onChange={(event) => setManualScene((prev) => ({ ...prev, cast: event.target.value }))}
        />
        <select
          value={manualScene.day}
          onChange={(event) => setManualScene((prev) => ({ ...prev, day: event.target.value }))}
        >
          {days.map((day) => (
            <option key={day} value={day}>
              {day}
            </option>
          ))}
        </select>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={manualScene.needsReview}
            onChange={(event) => setManualScene((prev) => ({ ...prev, needsReview: event.target.checked }))}
          />
          Needs Review
        </label>
        <button type="submit">Add Scene</button>
      </form>

      <div className="stripboard-layout">
        <div className="board">
        {days.map((day) => (
          <section
            key={day}
            className="column"
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => onDrop(day)}
          >
            <h3>{day}</h3>
            {(stripsByDay[day] ?? []).map((strip) => {
              const selected = selectedStripIds.has(strip.id);
              return (
                <article
                  key={strip.id}
                  className={`strip ${selected ? "selected" : ""} ${editorTarget?.id === strip.id ? "editing" : ""}`}
                  draggable
                  onDragStart={() => setDragged({ id: strip.id, day })}
                  onClick={() => setEditorTarget({ id: strip.id, day })}
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
                  <p>{strip.heading}</p>
                  <p><strong>Location:</strong> {strip.location}</p>
                  <p><strong>Cast:</strong> {strip.cast.length ? strip.cast.join(", ") : "Unresolved"}</p>
                  {strip.needsReview ? <span className="flag">Needs Review</span> : null}
                </article>
              );
            })}
          </section>
        ))}
        </div>

        <aside className="scene-editor">
          <h3>Scene Editor</h3>
          {!editorDraft ? (
            <p>Select a scene strip to review and edit details.</p>
          ) : (
            <form onSubmit={saveSceneEdits}>
              <label>
                Scene Number
                <input
                  type="text"
                  value={editorDraft.sceneNumber}
                  onChange={(event) => setEditorDraft((prev) => ({ ...prev, sceneNumber: event.target.value }))}
                />
              </label>
              <label>
                Heading
                <input
                  type="text"
                  value={editorDraft.heading}
                  onChange={(event) => setEditorDraft((prev) => ({ ...prev, heading: event.target.value }))}
                />
              </label>
              <label>
                Location
                <input
                  type="text"
                  value={editorDraft.location}
                  onChange={(event) => setEditorDraft((prev) => ({ ...prev, location: event.target.value }))}
                />
              </label>
              <label>
                Cast (comma separated)
                <input
                  type="text"
                  value={editorDraft.cast}
                  onChange={(event) => setEditorDraft((prev) => ({ ...prev, cast: event.target.value }))}
                />
              </label>
              <label>
                Scheduled Day
                <select
                  value={editorDraft.day}
                  onChange={(event) => setEditorDraft((prev) => ({ ...prev, day: event.target.value }))}
                >
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={editorDraft.needsReview}
                  onChange={(event) => setEditorDraft((prev) => ({ ...prev, needsReview: event.target.checked }))}
                />
                Needs Review
              </label>
              <div className="editor-actions">
                <button type="submit">Save Scene</button>
                <button type="button" onClick={() => setEditorTarget(null)}>
                  Close
                </button>
              </div>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
