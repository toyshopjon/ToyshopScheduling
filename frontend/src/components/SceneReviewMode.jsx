import { useMemo, useRef, useState } from "react";

const TIME_OPTIONS = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"];
const INT_EXT_OPTIONS = ["INT", "EXT", "INT/EXT"];

function uniqueValues(values) {
  const seen = new Set();
  const next = [];
  for (const raw of values) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
  }
  return next;
}

function toCsv(values) {
  return uniqueValues(Array.isArray(values) ? values : []).join(",");
}

function normalizeName(value) {
  return String(value || "").trim().toUpperCase();
}

function containsName(scriptText, name) {
  const escaped = name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^A-Z0-9])${escaped}(?=$|[^A-Z0-9])`, "i");
  return pattern.test(String(scriptText || "").toUpperCase());
}

function inferTimeFromHeading(heading, fallback = "DAY") {
  const normalized = String(heading || "").toUpperCase();
  return TIME_OPTIONS.find((option) => normalized.includes(option)) || fallback;
}

function inferIntExtFromHeading(heading, fallback = "INT") {
  const normalized = String(heading || "").toUpperCase();
  if (normalized.includes("INT/EXT") || normalized.includes("EXT/INT")) return "INT/EXT";
  if (normalized.includes("EXT.")) return "EXT";
  if (normalized.includes("INT.")) return "INT";
  return fallback;
}

function inferLocationFromHeading(heading, fallback = "") {
  const normalized = String(heading || "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;

  let body = normalized;
  if (/^INT\/EXT\.?\s+/i.test(body) || /^EXT\/INT\.?\s+/i.test(body)) {
    body = body.replace(/^\w+\/\w+\.?\s+/i, "");
  } else if (/^(INT|EXT)\.?\s+/i.test(body)) {
    body = body.replace(/^(INT|EXT)\.?\s+/i, "");
  }

  const parts = body.split(" - ");
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim().toUpperCase();
    const timeTokens = new Set(["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"]);
    if (timeTokens.has(last)) {
      parts.pop();
    }
  }

  return parts.join(" - ").trim() || fallback;
}

function deriveHeadingFromSelectedText(selectedText, fallbackHeading) {
  const lines = String(selectedText || "").split("\n");
  const firstNonEmpty = lines.find((line) => line.trim());
  if (!firstNonEmpty) return fallbackHeading;
  const candidate = firstNonEmpty.replace(/\s+$/, "");
  if (/^(INT|EXT|INT\/EXT|EXT\/INT)\.?\s+/i.test(candidate)) return candidate;
  return fallbackHeading;
}

function asReviewScene(scene, index) {
  const predictedCast = uniqueValues(Array.isArray(scene.cast) ? scene.cast : []);
  return {
    scene_number: scene.scene_number,
    heading: scene.heading,
    location: scene.location || "",
    int_ext: scene.int_ext || inferIntExtFromHeading(scene.heading, "INT"),
    time_of_day: scene.time_of_day || "DAY",
    script_text: scene.scene_text || "",
    predicted: {
      cast: predictedCast,
      location: scene.location || "",
      props: [],
      wardrobe: [],
      sets: [],
    },
    corrected: {
      cast: predictedCast,
      location: scene.location || "",
      props: [],
      wardrobe: [],
      sets: [],
      notes: "",
    },
    source_order: index,
    manual_split: false,
    split_parent_scene_number: 0,
    split_parent_heading: "",
    split_selected_text: "",
  };
}

function ChipListEditor({ title, values, onAdd, onRemove, suggestions = [], inputValue, onInputChange, placeholder }) {
  return (
    <div className="chip-editor">
      <div className="chip-editor-header">{title}</div>
      <div className="chip-list">
        {values.map((value) => (
          <button key={value} type="button" className="chip" onClick={() => onRemove(value)}>
            {value} <span className="chip-x">x</span>
          </button>
        ))}
        {!values.length ? <span className="chip-empty">None</span> : null}
      </div>
      <div className="chip-controls">
        <input
          type="text"
          list={`${title}-suggestions`}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={placeholder}
        />
        <button type="button" onClick={() => onAdd(inputValue)}>Add</button>
      </div>
      <datalist id={`${title}-suggestions`}>
        {suggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </div>
  );
}

export function SceneReviewMode({ parsedScenes, onComplete, onCancel, onSaveFeedback }) {
  const [scenes, setScenes] = useState(() => parsedScenes.map((scene, index) => asReviewScene(scene, index)));
  const [index, setIndex] = useState(0);
  const [splitError, setSplitError] = useState("");
  const [inputs, setInputs] = useState({ cast: "", location: "", props: "", wardrobe: "", sets: "" });
  const scriptTextRef = useRef(null);

  const current = scenes[index];

  const knownElements = useMemo(() => {
    const cast = new Set();
    const locations = new Set();
    const props = new Set();
    const wardrobe = new Set();
    const sets = new Set();

    for (let i = 0; i <= index; i += 1) {
      for (const name of scenes[i].corrected.cast) cast.add(name);
      if (scenes[i].corrected.location) locations.add(scenes[i].corrected.location);
      for (const item of scenes[i].corrected.props) props.add(item);
      for (const item of scenes[i].corrected.wardrobe) wardrobe.add(item);
      for (const item of scenes[i].corrected.sets) sets.add(item);
    }

    return {
      cast: Array.from(cast).sort((a, b) => a.localeCompare(b)),
      locations: Array.from(locations).sort((a, b) => a.localeCompare(b)),
      props: Array.from(props).sort((a, b) => a.localeCompare(b)),
      wardrobe: Array.from(wardrobe).sort((a, b) => a.localeCompare(b)),
      sets: Array.from(sets).sort((a, b) => a.localeCompare(b)),
    };
  }, [scenes, index]);

  if (!current) {
    return (
      <section className="panel">
        <h3>Scene Review Mode</h3>
        <p>No parsed scenes available.</p>
      </section>
    );
  }

  function updateCurrent(updater) {
    setScenes((prev) => {
      const next = [...prev];
      const currentScene = next[index];
      next[index] = updater(currentScene);
      return next;
    });
  }

  function addToken(field, value) {
    const candidate = String(value || "").trim();
    if (!candidate) return;
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        [field]: uniqueValues([...(scene.corrected[field] || []), candidate]),
      },
    }));
    setInputs((prev) => ({ ...prev, [field]: "" }));
  }

  function removeToken(field, value) {
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        [field]: (scene.corrected[field] || []).filter((item) => item !== value),
      },
    }));
  }

  function addLocation(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return;
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        location: candidate,
      },
    }));
    setInputs((prev) => ({ ...prev, location: "" }));
  }

  function clearLocation() {
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        location: "",
      },
    }));
  }

  function createSceneFromSelection() {
    const target = scriptTextRef.current;
    if (!target) return;

    const fullText = String(current.script_text || "");
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;

    if (end <= start) {
      setSplitError("Highlight scene text first, then click Create Scene From Selection.");
      return;
    }

    const selectedText = fullText.slice(start, end);
    if (!selectedText.trim()) {
      setSplitError("Selection is empty. Select at least one non-blank line.");
      return;
    }

    const remainingText = `${fullText.slice(0, start)}${fullText.slice(end)}`;
    const nextHeading = deriveHeadingFromSelectedText(selectedText, `${current.heading} (Split)`);
    const nextLocation = inferLocationFromHeading(nextHeading, current.corrected.location || current.location || "");
    const nextTimeOfDay = inferTimeFromHeading(nextHeading, current.time_of_day || "DAY");
    const nextIntExt = inferIntExtFromHeading(nextHeading, current.int_ext || "INT");
    const castCandidates = uniqueValues([...current.corrected.cast, ...knownElements.cast]).filter((name) =>
      containsName(selectedText, name)
    );

    const splitScene = {
      ...asReviewScene(
        {
          scene_number: current.scene_number,
          heading: nextHeading,
          location: nextLocation,
          int_ext: nextIntExt,
          time_of_day: nextTimeOfDay,
          scene_text: selectedText,
          cast: castCandidates,
        },
        index + 1
      ),
      manual_split: true,
      split_parent_scene_number: Number(current.scene_number) || 0,
      split_parent_heading: current.heading,
      split_selected_text: selectedText,
    };

    setScenes((prev) => {
      const next = [...prev];
      const updatedCurrent = {
        ...next[index],
        script_text: remainingText,
      };
      next[index] = updatedCurrent;
      next.splice(index + 1, 0, splitScene);
      return next.map((scene, sceneIndex) => ({ ...scene, source_order: sceneIndex }));
    });

    setSplitError("");
  }

  async function saveFeedbackFor(scene) {
    await onSaveFeedback?.({
      scene_number: Number(scene.scene_number) || 0,
      heading: scene.heading,
      script_text: scene.script_text,
      predicted_cast_csv: toCsv(scene.predicted.cast),
      corrected_cast_csv: toCsv(scene.corrected.cast),
      predicted_location: scene.predicted.location,
      corrected_location: scene.corrected.location,
      predicted_props_csv: toCsv(scene.predicted.props),
      corrected_props_csv: toCsv(scene.corrected.props),
      predicted_wardrobe_csv: toCsv(scene.predicted.wardrobe),
      corrected_wardrobe_csv: toCsv(scene.corrected.wardrobe),
      predicted_sets_csv: toCsv(scene.predicted.sets),
      corrected_sets_csv: toCsv(scene.corrected.sets),
      manual_split: Boolean(scene.manual_split),
      split_parent_scene_number: Number(scene.split_parent_scene_number) || 0,
      split_parent_heading: scene.split_parent_heading || "",
      split_selected_text: scene.split_selected_text || "",
    });
  }

  function applyAdaptiveCarryForward(nextIndex) {
    setScenes((prev) => {
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const target = next[nextIndex];
      const existing = new Set(target.corrected.cast.map(normalizeName));

      for (const candidate of knownElements.cast) {
        const upper = normalizeName(candidate);
        if (!upper || existing.has(upper)) continue;
        if (containsName(target.script_text, upper)) {
          target.corrected.cast = [...target.corrected.cast, candidate];
          existing.add(upper);
        }
      }

      next[nextIndex] = { ...target, corrected: { ...target.corrected, cast: uniqueValues(target.corrected.cast) } };
      return next;
    });
  }

  async function goNext() {
    await saveFeedbackFor(scenes[index]);
    const nextIndex = Math.min(scenes.length - 1, index + 1);
    applyAdaptiveCarryForward(nextIndex);
    setIndex(nextIndex);
  }

  async function goPrev() {
    await saveFeedbackFor(scenes[index]);
    setIndex((prev) => Math.max(0, prev - 1));
  }

  async function finishReview() {
    await saveFeedbackFor(scenes[index]);
    onComplete(
      scenes.map((scene) => ({
        scene_number: Number(scene.scene_number) || 0,
        heading: scene.heading,
        location: scene.corrected.location,
        int_ext: scene.int_ext,
        time_of_day: scene.time_of_day,
        cast: scene.corrected.cast,
        props: scene.corrected.props,
        wardrobe: scene.corrected.wardrobe,
        sets: scene.corrected.sets,
        notes: scene.corrected.notes,
        scene_text: scene.script_text,
        source_order: scene.source_order,
      }))
    );
  }

  return (
    <section className="panel">
      <h3>Scene Review Mode</h3>
      <p>
        Scene {index + 1} of {scenes.length}: <strong>{current.heading}</strong>
      </p>
      <div className="review-actions">
        <button type="button" onClick={goPrev} disabled={index === 0}>Prev</button>
        <button type="button" onClick={goNext} disabled={index === scenes.length - 1}>Next</button>
        <button type="button" onClick={createSceneFromSelection}>Create Scene From Selection</button>
        <button type="button" onClick={finishReview}>Apply Reviewed Script</button>
        <button type="button" onClick={onCancel}>Cancel Review</button>
      </div>

      {splitError ? <p className="error">{splitError}</p> : null}

      <div className="editor-row-primary review-row-primary">
        <label className="field-scene-number">
          Scene Number
          <input
            type="text"
            value={String(current.scene_number ?? "")}
            onChange={(event) => updateCurrent((scene) => ({ ...scene, scene_number: event.target.value }))}
          />
        </label>
        <label className="field-int-ext">
          INT/EXT
          <select
            value={current.int_ext || "INT"}
            onChange={(event) => updateCurrent((scene) => ({ ...scene, int_ext: event.target.value }))}
          >
            {INT_EXT_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="field-time-of-day">
          Time of Day
          <select
            value={current.time_of_day || "DAY"}
            onChange={(event) => updateCurrent((scene) => ({ ...scene, time_of_day: event.target.value }))}
          >
            {TIME_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="field-heading">
          Heading
          <input
            type="text"
            value={current.heading || ""}
            onChange={(event) => updateCurrent((scene) => ({ ...scene, heading: event.target.value }))}
          />
        </label>
      </div>

      <div className="chip-grid">
        <ChipListEditor
          title="Cast"
          values={current.corrected.cast}
          suggestions={knownElements.cast}
          inputValue={inputs.cast}
          onInputChange={(value) => setInputs((prev) => ({ ...prev, cast: value }))}
          onAdd={(value) => addToken("cast", value)}
          onRemove={(value) => removeToken("cast", value)}
          placeholder="Add cast"
        />

        <div className="chip-editor">
          <div className="chip-editor-header">Location</div>
          <div className="chip-list">
            {current.corrected.location ? (
              <button type="button" className="chip" onClick={clearLocation}>
                {current.corrected.location} <span className="chip-x">x</span>
              </button>
            ) : (
              <span className="chip-empty">None</span>
            )}
          </div>
          <div className="chip-controls">
            <input
              type="text"
              list="review-location-suggestions"
              value={inputs.location}
              onChange={(event) => setInputs((prev) => ({ ...prev, location: event.target.value }))}
              placeholder="Set location"
            />
            <button type="button" onClick={() => addLocation(inputs.location)}>Set</button>
          </div>
          <datalist id="review-location-suggestions">
            {knownElements.locations.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </div>

        <ChipListEditor
          title="Props"
          values={current.corrected.props}
          suggestions={knownElements.props}
          inputValue={inputs.props}
          onInputChange={(value) => setInputs((prev) => ({ ...prev, props: value }))}
          onAdd={(value) => addToken("props", value)}
          onRemove={(value) => removeToken("props", value)}
          placeholder="Add prop"
        />

        <ChipListEditor
          title="Wardrobe"
          values={current.corrected.wardrobe}
          suggestions={knownElements.wardrobe}
          inputValue={inputs.wardrobe}
          onInputChange={(value) => setInputs((prev) => ({ ...prev, wardrobe: value }))}
          onAdd={(value) => addToken("wardrobe", value)}
          onRemove={(value) => removeToken("wardrobe", value)}
          placeholder="Add wardrobe"
        />

        <ChipListEditor
          title="Sets"
          values={current.corrected.sets}
          suggestions={knownElements.sets}
          inputValue={inputs.sets}
          onInputChange={(value) => setInputs((prev) => ({ ...prev, sets: value }))}
          onAdd={(value) => addToken("sets", value)}
          onRemove={(value) => removeToken("sets", value)}
          placeholder="Add set"
        />
      </div>

      <label>
        Notes
        <input
          type="text"
          value={current.corrected.notes}
          onChange={(event) => updateCurrent((scene) => ({
            ...scene,
            corrected: { ...scene.corrected, notes: event.target.value },
          }))}
        />
      </label>

      <div className="review-hint">
        <p><strong>Predicted cast:</strong> {toCsv(current.predicted.cast) || "None"}</p>
        <p>Select text in the script below, then click <strong>Create Scene From Selection</strong> to split a missed scene.</p>
      </div>

      <textarea
        ref={scriptTextRef}
        className="script-text-area review-script-text"
        rows={14}
        value={current.script_text}
        onChange={(event) => updateCurrent((scene) => ({ ...scene, script_text: event.target.value }))}
      />
    </section>
  );
}
