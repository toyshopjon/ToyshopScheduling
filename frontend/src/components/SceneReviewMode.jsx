import { useEffect, useMemo, useRef, useState } from "react";

const TIME_OPTIONS = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"];
const INT_EXT_OPTIONS = ["INT", "EXT", "INT/EXT"];
const ELEMENT_TYPES = ["cast", "background", "location", "props", "wardrobe", "sets"];

function uniqueValues(values) {
  const seen = new Set();
  const next = [];
  for (const raw of values || []) {
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

  return parts.join(" - ").replace(/^[\s.\-:;]+/, "").trim() || fallback;
}

function deriveHeadingFromSelectedText(selectedText, fallbackHeading) {
  const lines = String(selectedText || "").split("\n");
  const firstNonEmpty = lines.find((line) => line.trim());
  if (!firstNonEmpty) return fallbackHeading;
  const candidate = firstNonEmpty.replace(/\s+$/, "");
  if (/^(INT|EXT|INT\/EXT|EXT\/INT)\.?\s+/i.test(candidate)) return candidate;
  return fallbackHeading;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSelection(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sceneElementTokens(scene) {
  const suppressed = {
    cast: new Set((scene?.suppressed?.cast || []).map((item) => normalizeName(item))),
    background: new Set((scene?.suppressed?.background || []).map((item) => normalizeName(item))),
    location: new Set((scene?.suppressed?.location || []).map((item) => normalizeName(item))),
    props: new Set((scene?.suppressed?.props || []).map((item) => normalizeName(item))),
    wardrobe: new Set((scene?.suppressed?.wardrobe || []).map((item) => normalizeName(item))),
    sets: new Set((scene?.suppressed?.sets || []).map((item) => normalizeName(item))),
  };
  const filterSuppressed = (type, items) =>
    uniqueValues(items).filter((item) => !suppressed[type].has(normalizeName(item)));

  const byType = {
    cast: filterSuppressed("cast", [...(scene?.predicted?.cast || []), ...(scene?.corrected?.cast || [])]),
    background: filterSuppressed("background", [...(scene?.predicted?.background || []), ...(scene?.corrected?.background || [])]),
    props: filterSuppressed("props", [...(scene?.predicted?.props || []), ...(scene?.corrected?.props || [])]),
    wardrobe: filterSuppressed("wardrobe", [...(scene?.predicted?.wardrobe || []), ...(scene?.corrected?.wardrobe || [])]),
    sets: filterSuppressed("sets", [...(scene?.predicted?.sets || []), ...(scene?.corrected?.sets || [])]),
    location: filterSuppressed("location", [scene?.predicted?.location || "", scene?.corrected?.location || ""]),
  };
  return byType;
}

function buildLineSegments(text, tokenMap) {
  const lineText = String(text || "");
  if (!lineText) return [{ kind: "plain", text: "" }];

  const matches = [];
  for (const type of ELEMENT_TYPES) {
    const tokens = (tokenMap[type] || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    for (const token of tokens) {
      const pattern = new RegExp(`(?<![A-Z0-9])${escapeRegExp(token)}(?![A-Z0-9])`, "gi");
      let hit = pattern.exec(lineText);
      while (hit) {
        matches.push({
          type,
          token,
          start: hit.index,
          end: hit.index + hit[0].length,
          text: hit[0],
          len: hit[0].length,
        });
        hit = pattern.exec(lineText);
      }
    }
  }

  if (!matches.length) return [{ kind: "plain", text: lineText }];

  matches.sort((a, b) => (a.start - b.start) || (b.len - a.len));
  const accepted = [];
  let cursor = 0;
  for (const candidate of matches) {
    if (candidate.start < cursor) continue;
    accepted.push(candidate);
    cursor = candidate.end;
  }

  if (!accepted.length) return [{ kind: "plain", text: lineText }];

  const segments = [];
  let index = 0;
  for (const match of accepted) {
    if (match.start > index) segments.push({ kind: "plain", text: lineText.slice(index, match.start) });
    segments.push({
      kind: "element",
      text: lineText.slice(match.start, match.end),
      type: match.type,
      token: match.token,
    });
    index = match.end;
  }
  if (index < lineText.length) segments.push({ kind: "plain", text: lineText.slice(index) });
  return segments;
}

function asReviewScene(scene, index) {
  const safeScene = scene && typeof scene === "object" ? scene : {};
  const predictedCast = uniqueValues(Array.isArray(safeScene.cast) ? safeScene.cast : []);
  return {
    scene_number: safeScene.scene_number,
    heading: safeScene.heading || `SCENE ${index + 1}`,
    location: safeScene.location || "",
    int_ext: safeScene.int_ext || inferIntExtFromHeading(safeScene.heading, "INT"),
    time_of_day: safeScene.time_of_day || "DAY",
    script_text: safeScene.scene_text || "",
    line_items: Array.isArray(safeScene.line_items) ? safeScene.line_items : [],
    predicted: {
      cast: predictedCast,
      background: [],
      location: safeScene.location || "",
      props: [],
      wardrobe: [],
      sets: [],
    },
    corrected: {
      cast: predictedCast,
      background: Array.isArray(safeScene.background) ? safeScene.background : [],
      location: safeScene.location || "",
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
    suppressed: {
      cast: [],
      background: [],
      location: [],
      props: [],
      wardrobe: [],
      sets: [],
    },
  };
}

function normalizeReviewScene(scene, index) {
  const base = asReviewScene(scene, index);
  const source = scene && typeof scene === "object" ? scene : {};
  return {
    ...base,
    ...source,
    predicted: {
      ...base.predicted,
      ...(source.predicted || {}),
      cast: uniqueValues([...(source.predicted?.cast || base.predicted.cast || [])]),
      background: uniqueValues([...(source.predicted?.background || base.predicted.background || [])]),
      props: uniqueValues([...(source.predicted?.props || base.predicted.props || [])]),
      wardrobe: uniqueValues([...(source.predicted?.wardrobe || base.predicted.wardrobe || [])]),
      sets: uniqueValues([...(source.predicted?.sets || base.predicted.sets || [])]),
    },
    corrected: {
      ...base.corrected,
      ...(source.corrected || {}),
      cast: uniqueValues([...(source.corrected?.cast || base.corrected.cast || [])]),
      background: uniqueValues([...(source.corrected?.background || base.corrected.background || [])]),
      props: uniqueValues([...(source.corrected?.props || base.corrected.props || [])]),
      wardrobe: uniqueValues([...(source.corrected?.wardrobe || base.corrected.wardrobe || [])]),
      sets: uniqueValues([...(source.corrected?.sets || base.corrected.sets || [])]),
      notes: String(source.corrected?.notes ?? base.corrected.notes ?? ""),
    },
    suppressed: {
      ...base.suppressed,
      ...(source.suppressed || {}),
      cast: uniqueValues([...(source.suppressed?.cast || [])]),
      background: uniqueValues([...(source.suppressed?.background || [])]),
      location: uniqueValues([...(source.suppressed?.location || [])]),
      props: uniqueValues([...(source.suppressed?.props || [])]),
      wardrobe: uniqueValues([...(source.suppressed?.wardrobe || [])]),
      sets: uniqueValues([...(source.suppressed?.sets || [])]),
    },
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
  const [scenes, setScenes] = useState(() =>
    Array.from(parsedScenes || [])
      .filter((scene) => scene && typeof scene === "object")
      .map((scene, sceneIndex) => normalizeReviewScene(scene, sceneIndex))
  );
  const [index, setIndex] = useState(0);
  const [splitError, setSplitError] = useState("");
  const [inputs, setInputs] = useState({ cast: "", background: "", location: "", props: "", wardrobe: "", sets: "" });
  const scriptTextRef = useRef(null);
  const lineMapperRef = useRef(null);
  const [selectionPreview, setSelectionPreview] = useState("");
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, text: "" });

  const current = normalizeReviewScene(scenes[index], index);

  function renumberFromIndex(nextScenes, startIndex, startNumber) {
    const safeStart = Math.max(0, Number.parseInt(String(startNumber), 10) || 1);
    return nextScenes.map((scene, sceneIndex) => {
      if (sceneIndex < startIndex) return scene;
      return { ...scene, scene_number: safeStart + (sceneIndex - startIndex) };
    });
  }

  const knownElements = useMemo(() => {
    const cast = new Set();
    const background = new Set();
    const locations = new Set();
    const props = new Set();
    const wardrobe = new Set();
    const sets = new Set();

    for (let i = 0; i <= index; i += 1) {
      const scene = normalizeReviewScene(scenes[i], i);
      for (const name of scene.corrected.cast || []) cast.add(name);
      for (const item of scene.corrected.background || []) background.add(item);
      if (scene.corrected.location) locations.add(scene.corrected.location);
      for (const item of scene.corrected.props || []) props.add(item);
      for (const item of scene.corrected.wardrobe || []) wardrobe.add(item);
      for (const item of scene.corrected.sets || []) sets.add(item);
    }

    return {
      cast: Array.from(cast).sort((a, b) => a.localeCompare(b)),
      background: Array.from(background).sort((a, b) => a.localeCompare(b)),
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

  const castPredictedOnly = useMemo(() => {
    const predicted = new Set((current.predicted.cast || []).map((item) => item.toUpperCase()));
    const corrected = new Set((current.corrected.cast || []).map((item) => item.toUpperCase()));
    return (current.predicted.cast || []).filter((item) => !corrected.has(item.toUpperCase()));
  }, [current.corrected.cast, current.predicted.cast]);

  const castMissed = useMemo(() => {
    const predicted = new Set((current.predicted.cast || []).map((item) => item.toUpperCase()));
    return (current.corrected.cast || []).filter((item) => !predicted.has(item.toUpperCase()));
  }, [current.corrected.cast, current.predicted.cast]);

  const locationMismatch = useMemo(() => {
    const predicted = String(current.predicted.location || "").trim();
    const corrected = String(current.corrected.location || "").trim();
    if (!predicted && !corrected) return false;
    return predicted.toUpperCase() !== corrected.toUpperCase();
  }, [current.corrected.location, current.predicted.location]);
  const parserElementMap = useMemo(() => sceneElementTokens(current), [current]);

  function updateCurrent(updater) {
    setScenes((prev) => {
      const next = [...prev];
      const currentScene = next[index];
      next[index] = updater(currentScene);
      return next;
    });
  }

  function updateCurrentSceneNumber(value) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    setScenes((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], scene_number: parsed };
      return renumberFromIndex(next, index, parsed);
    });
  }

  function addToken(field, value) {
    const candidate = String(value || "").trim();
    if (!candidate) return;
    const target = normalizeName(candidate);
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        [field]: uniqueValues([...(scene.corrected[field] || []), candidate]),
      },
      suppressed: {
        ...scene.suppressed,
        [field]: (scene.suppressed?.[field] || []).filter((item) => normalizeName(item) !== target),
      },
    }));
    setInputs((prev) => ({ ...prev, [field]: "" }));
  }

  function removeToken(field, value) {
    const target = String(value || "").trim().toUpperCase();
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        [field]: (scene.corrected[field] || []).filter((item) => String(item || "").trim().toUpperCase() !== target),
      },
    }));
  }

  function removeElementValue(type, value) {
    if (type === "location") {
      const target = String(value || "").trim().toUpperCase();
      if (!target) return;
      updateCurrent((scene) => {
        const currentLocation = String(scene.corrected.location || "").trim().toUpperCase();
        return {
          ...scene,
          corrected: {
            ...scene.corrected,
            location: currentLocation === target ? "" : scene.corrected.location,
          },
          suppressed: {
            ...scene.suppressed,
            location: uniqueValues([...(scene.suppressed?.location || []), value]),
          },
        };
      });
      return;
    }
    const target = normalizeName(value);
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        [type]: (scene.corrected[type] || []).filter((item) => normalizeName(item) !== target),
      },
      suppressed: {
        ...scene.suppressed,
        [type]: uniqueValues([...(scene.suppressed?.[type] || []), value]),
      },
    }));
  }

  function addLocation(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return;
    const target = normalizeName(candidate);
    updateCurrent((scene) => ({
      ...scene,
      corrected: {
        ...scene.corrected,
        location: candidate.replace(/^[\s.\-:;]+/, ""),
      },
      suppressed: {
        ...scene.suppressed,
        location: (scene.suppressed?.location || []).filter((item) => normalizeName(item) !== target),
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
      const renumbered = renumberFromIndex(next, index, Number(next[index].scene_number) || 1);
      return renumbered.map((scene, sceneIndex) => ({ ...scene, source_order: sceneIndex }));
    });

    setSplitError("");
  }

  function applyHeadingUpdate(heading) {
    updateCurrent((scene) => ({
      ...scene,
      heading,
      int_ext: inferIntExtFromHeading(heading, scene.int_ext || "INT"),
      time_of_day: inferTimeFromHeading(heading, scene.time_of_day || "DAY"),
      corrected: {
        ...scene.corrected,
        location: inferLocationFromHeading(heading, scene.corrected.location || scene.location || ""),
      },
    }));
  }

  async function saveFeedbackFor(scene) {
    const safeScene = normalizeReviewScene(scene, index);
    await onSaveFeedback?.({
      scene_number: Number(safeScene.scene_number) || 0,
      heading: safeScene.heading,
      script_text: safeScene.script_text,
      predicted_cast_csv: toCsv(safeScene.predicted.cast),
      corrected_cast_csv: toCsv(safeScene.corrected.cast),
      predicted_background_csv: toCsv(safeScene.predicted.background),
      corrected_background_csv: toCsv(safeScene.corrected.background),
      predicted_location: safeScene.predicted.location,
      corrected_location: safeScene.corrected.location,
      predicted_props_csv: toCsv(safeScene.predicted.props),
      corrected_props_csv: toCsv(safeScene.corrected.props),
      predicted_wardrobe_csv: toCsv(safeScene.predicted.wardrobe),
      corrected_wardrobe_csv: toCsv(safeScene.corrected.wardrobe),
      predicted_sets_csv: toCsv(safeScene.predicted.sets),
      corrected_sets_csv: toCsv(safeScene.corrected.sets),
      manual_split: Boolean(safeScene.manual_split),
      split_parent_scene_number: Number(safeScene.split_parent_scene_number) || 0,
      split_parent_heading: safeScene.split_parent_heading || "",
      split_selected_text: safeScene.split_selected_text || "",
    });
  }

  function applyAdaptiveCarryForward(nextIndex) {
    setScenes((prev) => {
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const target = normalizeReviewScene(next[nextIndex], nextIndex);
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
    clearSelectionAndContext();
    setIndex(nextIndex);
  }

  async function goPrev() {
    await saveFeedbackFor(scenes[index]);
    clearSelectionAndContext();
    setIndex((prev) => Math.max(0, prev - 1));
  }

  async function finishReview() {
    await saveFeedbackFor(scenes[index]);
    onComplete(
      scenes.map((scene, sceneIndex) => {
        const safeScene = normalizeReviewScene(scene, sceneIndex);
        return {
          scene_number: Number(safeScene.scene_number) || 0,
          heading: safeScene.heading,
          location: safeScene.corrected.location,
          int_ext: safeScene.int_ext,
          time_of_day: safeScene.time_of_day,
          cast: safeScene.corrected.cast,
          background: safeScene.corrected.background,
          props: safeScene.corrected.props,
          wardrobe: safeScene.corrected.wardrobe,
          sets: safeScene.corrected.sets,
          notes: safeScene.corrected.notes,
          scene_text: safeScene.script_text,
          source_order: safeScene.source_order,
        };
      })
    );
  }

  function getSelectionFromLineMapper() {
    const root = lineMapperRef.current;
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0) return "";
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return "";
    return normalizeSelection(selection.toString());
  }

  function captureSelectionPreview() {
    setSelectionPreview(getSelectionFromLineMapper());
  }

  function openElementTypeMenu(event, explicitText = "") {
    const candidate = normalizeSelection(explicitText || getSelectionFromLineMapper());
    if (!candidate) return;
    event.preventDefault();
    setSelectionPreview(candidate);
    setContextMenu({ open: true, x: event.clientX, y: event.clientY, text: candidate });
  }

  function addFromContextMenu(type) {
    const candidate = normalizeSelection(contextMenu.text || selectionPreview);
    if (!candidate) return;
    if (type === "location") {
      addLocation(candidate);
    } else {
      addToken(type, candidate);
    }
    window.getSelection?.().removeAllRanges();
    setSelectionPreview("");
    setContextMenu({ open: false, x: 0, y: 0, text: "" });
  }

  function closeContextMenu() {
    setContextMenu((prev) => (prev.open ? { open: false, x: 0, y: 0, text: "" } : prev));
  }

  useEffect(() => {
    if (!contextMenu.open) return undefined;
    function onGlobalClose() {
      closeContextMenu();
    }
    window.addEventListener("click", onGlobalClose);
    window.addEventListener("scroll", onGlobalClose, true);
    window.addEventListener("resize", onGlobalClose);
    return () => {
      window.removeEventListener("click", onGlobalClose);
      window.removeEventListener("scroll", onGlobalClose, true);
      window.removeEventListener("resize", onGlobalClose);
    };
  }, [contextMenu.open]);

  function clearSelectionAndContext() {
    setSelectionPreview("");
    closeContextMenu();
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
            type="number"
            min={1}
            value={String(current.scene_number ?? "")}
            onChange={(event) => updateCurrentSceneNumber(event.target.value)}
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
            onChange={(event) => applyHeadingUpdate(event.target.value)}
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

        <ChipListEditor
          title="Background"
          values={current.corrected.background}
          suggestions={knownElements.background}
          inputValue={inputs.background}
          onInputChange={(value) => setInputs((prev) => ({ ...prev, background: value }))}
          onAdd={(value) => addToken("background", value)}
          onRemove={(value) => removeToken("background", value)}
          placeholder="Add background"
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

      <div className="review-line-items">
        <h4>Line Classification + Element Mapper</h4>
        <div className="review-annotate-controls">
          <span className="review-selection-preview">
            {selectionPreview
              ? `Selection: "${selectionPreview}" (right-click to choose element type)`
              : "Select text, then right-click to choose element type."}
          </span>
        </div>
        <div className="review-annotate-legend">
          <span className="legend-chip legend-cast">Cast</span>
          <span className="legend-chip legend-background">Background</span>
          <span className="legend-chip legend-location">Location</span>
          <span className="legend-chip legend-props">Props</span>
          <span className="legend-chip legend-wardrobe">Wardrobe</span>
          <span className="legend-chip legend-sets">Sets</span>
          <span className="legend-hint">Click a colored token to remove it from that element list.</span>
        </div>
        {!current.line_items.length ? (
          <p>No line tagging available for this scene.</p>
        ) : (
          <div
            ref={lineMapperRef}
            className="review-line-list"
            onMouseUp={captureSelectionPreview}
            onKeyUp={captureSelectionPreview}
            onContextMenu={(event) => openElementTypeMenu(event)}
          >
            {current.line_items.map((item, lineIndex) => {
              const segments = buildLineSegments(item.text || "", parserElementMap);
              return (
                <div key={`${current.scene_number}-${lineIndex}`} className="review-line-row">
                  <span className={`review-line-type review-type-${item.type || "action"}`}>{item.type || "action"}</span>
                  <div className="review-line-text">
                    {segments.map((segment, segmentIndex) => {
                      if (segment.kind === "plain") {
                        return <span key={`plain-${lineIndex}-${segmentIndex}`}>{segment.text}</span>;
                      }
                      return (
                        <button
                          key={`token-${lineIndex}-${segmentIndex}`}
                          type="button"
                          className={`review-line-token review-token-${segment.type}`}
                          title={`Remove ${segment.text} from ${segment.type}`}
                          onClick={() => removeElementValue(segment.type, segment.token)}
                          onContextMenu={(event) => openElementTypeMenu(event, segment.text)}
                        >
                          {segment.text}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {contextMenu.open ? (
          <div
            className="review-context-menu"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="review-context-title">{contextMenu.text}</div>
            {ELEMENT_TYPES.map((type) => (
              <button key={type} type="button" onClick={() => addFromContextMenu(type)}>
                Add as {type === "location" ? "Location" : type}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="review-hint">
        <p><strong>Predicted cast:</strong> {toCsv(current.predicted.cast) || "None"}</p>
        <p>Select text in the script below, then click <strong>Create Scene From Selection</strong> to split a missed scene.</p>
      </div>

      <div className="review-mistakes">
        <p><strong>Likely wrong (predicted only):</strong> {castPredictedOnly.join(", ") || "None"}</p>
        <p><strong>Likely missed (in corrected, not predicted):</strong> {castMissed.join(", ") || "None"}</p>
        <p><strong>Location mismatch:</strong> {locationMismatch ? `${current.predicted.location || "None"} -> ${current.corrected.location || "None"}` : "No"}</p>
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
