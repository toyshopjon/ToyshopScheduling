import { Fragment, useEffect, useMemo, useRef, useState } from "react";

const UNSCHEDULED_DAY = "Unscheduled";
const TIME_OPTIONS = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"];
const INT_EXT_OPTIONS = ["INT", "EXT", "INT/EXT"];
const DEFAULT_LAYOUT = {
  fieldOrder: ["sceneNumber", "intExt", "timeOfDay", "location", "cast", "background", "pageCount", "estTime"],
  rowHeight: 30,
  colorMode: "dayNight",
  paneSplitPercent: 33,
  columnWidths: {
    sceneNumber: 90,
    intExt: 70,
    timeOfDay: 110,
    heading: 300,
    location: 220,
    cast: 260,
    background: 220,
    pageCount: 90,
    estTime: 90,
  },
};
const FIELD_DEFS = {
  sceneNumber: { label: "Scene", value: (strip) => String(strip.sceneNumber ?? "") },
  intExt: { label: "I/E", value: (strip) => strip.intExt || "" },
  timeOfDay: { label: "Time", value: (strip) => strip.timeOfDay || "" },
  heading: { label: "Heading", value: (strip) => strip.heading || "" },
  location: { label: "Location", value: (strip) => strip.location || "" },
  cast: { label: "Cast", value: (strip) => (strip.cast ?? []).join(", ") },
  background: { label: "Background", value: (strip) => (strip.background ?? []).join(", ") },
  pageCount: { label: "Pages", value: (strip) => formatPageEighths(strip.pageEighths) },
  estTime: { label: "Est", value: (strip) => formatMinutes(strip.estTimeMinutes) },
};

const WORKBENCH_ELEMENT_TYPES = ["cast", "background", "location", "props", "wardrobe", "sets"];

function normalizeName(value) {
  return String(value || "").trim().toUpperCase();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSelection(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classifySceneLines(scriptText) {
  const lines = String(scriptText || "").split("\n");
  const items = [];
  let prevType = "blank";
  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const trimmed = line.trim();
    let type = "action";
    if (!trimmed) type = "blank";
    else if (/^(INT|EXT|INT\/EXT|EXT\/INT)\.?\s+[A-Z0-9'"().\-/: ]+$/i.test(trimmed) && trimmed === trimmed.toUpperCase()) type = "heading";
    else if (/^\([^)]+\)$/.test(trimmed)) type = "parenthetical";
    else if (/^[A-Z][A-Z0-9' .\-()]+$/.test(trimmed) && trimmed.length <= 36) type = "character_cue";
    else if (prevType === "character_cue" || prevType === "parenthetical") type = "dialogue";
    items.push({ type, text: line });
    prevType = type;
  }
  return items;
}

function workbenchTokenMap(draft) {
  return {
    cast: uniqueValues(draft.cast || []),
    background: uniqueValues(draft.background || []),
    props: uniqueValues(draft.props || []),
    wardrobe: uniqueValues(draft.wardrobe || []),
    sets: uniqueValues(draft.sets || []),
    location: uniqueValues([draft.location || ""]),
  };
}

function buildLineSegments(text, tokenMap) {
  const lineText = String(text || "");
  if (!lineText) return [{ kind: "plain", text: "" }];
  const matches = [];
  for (const type of WORKBENCH_ELEMENT_TYPES) {
    const tokens = (tokenMap[type] || []).map((v) => String(v || "").trim()).filter(Boolean).sort((a, b) => b.length - a.length);
    for (const token of tokens) {
      const pattern = new RegExp(`(?<![A-Z0-9])${escapeRegExp(token)}(?![A-Z0-9])`, "gi");
      let hit = pattern.exec(lineText);
      while (hit) {
        matches.push({ type, token, start: hit.index, end: hit.index + hit[0].length, len: hit[0].length });
        hit = pattern.exec(lineText);
      }
    }
  }
  if (!matches.length) return [{ kind: "plain", text: lineText }];
  matches.sort((a, b) => (a.start - b.start) || (b.len - a.len));
  const accepted = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue;
    accepted.push(m);
    cursor = m.end;
  }
  const out = [];
  let idx = 0;
  for (const m of accepted) {
    if (m.start > idx) out.push({ kind: "plain", text: lineText.slice(idx, m.start) });
    out.push({ kind: "element", text: lineText.slice(m.start, m.end), type: m.type, token: m.token });
    idx = m.end;
  }
  if (idx < lineText.length) out.push({ kind: "plain", text: lineText.slice(idx) });
  return out;
}
function createStripId(prefix = "scene") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatPageEighths(totalEighths) {
  const safeTotal = Number.isFinite(totalEighths) ? Math.max(0, totalEighths) : 0;
  const whole = Math.floor(safeTotal / 8);
  const eighths = safeTotal % 8;
  return `${whole} ${eighths}/8`;
}

function formatMinutes(totalMinutes) {
  const safeTotal = Number.isFinite(totalMinutes) ? Math.max(0, totalMinutes) : 0;
  const hours = Math.floor(safeTotal / 60);
  const minutes = safeTotal % 60;
  if (!hours) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function parsePageCountToEighths(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const mixedMatch = raw.match(/^(\d+)\s+([0-7])\s*\/\s*8$/);
  if (mixedMatch) return Number.parseInt(mixedMatch[1], 10) * 8 + Number.parseInt(mixedMatch[2], 10);
  const fractionMatch = raw.match(/^([0-7])\s*\/\s*8$/);
  if (fractionMatch) return Number.parseInt(fractionMatch[1], 10);
  const wholeMatch = raw.match(/^(\d+)$/);
  if (wholeMatch) return Number.parseInt(wholeMatch[1], 10) * 8;
  const decimal = Number.parseFloat(raw);
  if (!Number.isNaN(decimal) && decimal >= 0) return Math.round(decimal * 8);
  return null;
}

function estimateVisualPageEighths(scriptText) {
  const text = String(scriptText || "");
  if (!text.trim()) return 1;
  const lineCount = text.split("\n").length;
  const eighths = Math.round((lineCount / 55) * 8);
  return Math.max(1, eighths);
}

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

function getDayTotalEighths(strips = []) {
  return strips.reduce((total, strip) => total + (Number.isFinite(strip.pageEighths) ? strip.pageEighths : 0), 0);
}

function getDayTotalMinutes(strips = []) {
  return strips.reduce((total, strip) => total + (Number.isFinite(strip.estTimeMinutes) ? strip.estTimeMinutes : 0), 0);
}

function formatConflictMinutes(totalMinutes) {
  const safe = Math.max(0, Number.isFinite(totalMinutes) ? totalMinutes : 0);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function getDayConflicts(day, strips = []) {
  const conflicts = [];
  const duplicateSceneNumbers = new Set();
  const seenSceneNumbers = new Set();
  const castMinutes = new Map();
  const uniqueLocations = new Set();
  let unresolvedCount = 0;

  for (const strip of strips) {
    const sceneNumber = String(strip.sceneNumber ?? "").trim();
    if (sceneNumber) {
      if (seenSceneNumbers.has(sceneNumber)) duplicateSceneNumbers.add(sceneNumber);
      seenSceneNumbers.add(sceneNumber);
    }

    const location = String(strip.location || "").trim().toUpperCase();
    if (location) uniqueLocations.add(location);

    if (strip.needsReview) unresolvedCount += 1;

    const sceneMinutes = Number.isFinite(strip.estTimeMinutes) ? Math.max(0, strip.estTimeMinutes) : 0;
    const castList = uniqueValues(strip.cast || []);
    for (const castName of castList) {
      castMinutes.set(castName, (castMinutes.get(castName) || 0) + sceneMinutes);
    }
  }

  if (duplicateSceneNumbers.size) {
    conflicts.push({
      severity: "high",
      code: "duplicate_scene",
      title: `Duplicate scene numbers: ${Array.from(duplicateSceneNumbers).join(", ")}`,
    });
  }

  if (uniqueLocations.size > 3) {
    conflicts.push({
      severity: "medium",
      code: "moves",
      title: `High company moves (${uniqueLocations.size} scenes)`,
    });
  }

  if (unresolvedCount > 0) {
    conflicts.push({
      severity: "medium",
      code: "needs_review",
      title: `${unresolvedCount} scene${unresolvedCount === 1 ? "" : "s"} still need review`,
    });
  }

  const overworkedCast = Array.from(castMinutes.entries())
    .filter(([, minutes]) => minutes > 600)
    .sort((a, b) => b[1] - a[1]);
  if (overworkedCast.length) {
    const preview = overworkedCast.slice(0, 2).map(([name, minutes]) => `${name} (${formatConflictMinutes(minutes)})`).join(", ");
    conflicts.push({
      severity: "high",
      code: "cast_load",
      title: `Cast over 10h: ${preview}${overworkedCast.length > 2 ? ` +${overworkedCast.length - 2}` : ""}`,
    });
  }

  return conflicts.map((entry) => ({ ...entry, day }));
}

function getStripStyle(strip, colorMode) {
  if (colorMode === "none") return {};
  const time = String(strip.timeOfDay || "").toUpperCase();
  const intExt = String(strip.intExt || "").toUpperCase();

  if (colorMode === "dayNight") {
    if (time === "NIGHT") return { backgroundColor: "#3352a1", color: "#ffffff" };
    if (["DAWN", "DUSK", "SUNRISE", "SUNSET"].includes(time)) {
      return { backgroundColor: "#e17de8", color: "#202020" };
    }
    return { backgroundColor: "#efe655", color: "#111111" };
  }

  if (colorMode === "intExt") {
    if (intExt === "EXT") return { backgroundColor: "#1b9b53", color: "#ffffff" };
    if (intExt === "INT/EXT") return { backgroundColor: "#a1632f", color: "#ffffff" };
    return { backgroundColor: "#d8dde7", color: "#1a1a1a" };
  }

  return {};
}

function parseHeadingFields(heading, fallback = {}) {
  const raw = String(heading || "");
  const normalized = raw.trim();
  const match = normalized.match(/^(INT\/EXT|EXT\/INT|INT|EXT)\.?\s*(.*)$/i);
  if (!match) {
    return {
      intExt: fallback.intExt || "INT",
      location: fallback.location || "",
      timeOfDay: fallback.timeOfDay || "DAY",
    };
  }

  const prefix = match[1].toUpperCase();
  const body = String(match[2] || "").trim();
  const tokens = body.split(/\s*-\s*/).map((part) => part.trim()).filter(Boolean);
  let timeOfDay = fallback.timeOfDay || "DAY";
  if (tokens.length) {
    const tail = tokens[tokens.length - 1].toUpperCase();
    if (TIME_OPTIONS.includes(tail)) {
      timeOfDay = tail;
      tokens.pop();
    }
  }
  const location = tokens.join(" - ").replace(/^[\s.\-:;]+/, "").trim();
  return {
    intExt: prefix === "EXT/INT" ? "INT/EXT" : prefix,
    location: location || (fallback.location || ""),
    timeOfDay,
  };
}

function buildHeadingFromParts(intExt, location, timeOfDay) {
  const ie = String(intExt || "INT").trim().toUpperCase();
  const loc = String(location || "").trim();
  const tod = String(timeOfDay || "").trim().toUpperCase();
  if (!loc) return "";
  return `${ie}. ${loc}${tod ? ` - ${tod}` : ""}`;
}

function toDraft(strip, day) {
  const totalEighths = Number.isFinite(strip?.pageEighths) ? strip.pageEighths : 1;
  return {
    id: strip?.id ?? null,
    sourceDay: day || UNSCHEDULED_DAY,
    sceneNumber: String(strip?.sceneNumber ?? ""),
    heading: strip?.heading ?? "",
    location: strip?.location ?? "",
    cast: uniqueValues(strip?.cast ?? []),
    background: uniqueValues(strip?.background ?? []),
    props: uniqueValues(strip?.props ?? []),
    wardrobe: uniqueValues(strip?.wardrobe ?? []),
    sets: uniqueValues(strip?.sets ?? []),
    scriptText: strip?.scriptText ?? "",
    notes: strip?.notes ?? "",
    day: day || UNSCHEDULED_DAY,
    needsReview: Boolean(strip?.needsReview),
    intExt: strip?.intExt || "INT",
    timeOfDay: strip?.timeOfDay || "DAY",
    pageCount: formatPageEighths(totalEighths),
    estTimeMinutes: String(Number.isFinite(strip?.estTimeMinutes) ? Math.max(0, strip.estTimeMinutes) : 0),
  };
}

function ChipListEditor({ title, values, suggestions, inputValue, onInputChange, onAdd, onRemove, placeholder }) {
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
          list={`${title}-suggestions-main`}
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={placeholder}
        />
        <button type="button" onClick={() => onAdd(inputValue)}>Add</button>
      </div>
      <datalist id={`${title}-suggestions-main`}>
        {suggestions.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </div>
  );
}

function normalizeLayoutConfig(layoutConfig) {
  const fieldOrder = Array.isArray(layoutConfig?.fieldOrder) ? layoutConfig.fieldOrder.filter((field) => FIELD_DEFS[field]) : DEFAULT_LAYOUT.fieldOrder;
  return {
    fieldOrder: fieldOrder.length ? fieldOrder : DEFAULT_LAYOUT.fieldOrder,
    rowHeight: Number.isFinite(layoutConfig?.rowHeight) ? Math.max(22, Math.min(84, layoutConfig.rowHeight)) : DEFAULT_LAYOUT.rowHeight,
    colorMode: ["dayNight", "intExt", "none"].includes(layoutConfig?.colorMode) ? layoutConfig.colorMode : DEFAULT_LAYOUT.colorMode,
    paneSplitPercent: Number.isFinite(layoutConfig?.paneSplitPercent) ? Math.max(20, Math.min(80, layoutConfig.paneSplitPercent)) : DEFAULT_LAYOUT.paneSplitPercent,
    columnWidths: {
      ...DEFAULT_LAYOUT.columnWidths,
      ...(layoutConfig?.columnWidths && typeof layoutConfig.columnWidths === "object" ? layoutConfig.columnWidths : {}),
    },
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
  layoutConfig,
  onSaveLayoutConfig,
  castOrder = [],
  castNumbersLocked = false,
  onReturnToStripView,
}) {
  const [draggedStrip, setDraggedStrip] = useState(null);
  const [colorMode, setColorMode] = useState(normalizeLayoutConfig(layoutConfig).colorMode);
  const [rowHeight, setRowHeight] = useState(normalizeLayoutConfig(layoutConfig).rowHeight);
  const [fieldOrder, setFieldOrder] = useState(normalizeLayoutConfig(layoutConfig).fieldOrder);
  const [paneSplitPercent, setPaneSplitPercent] = useState(normalizeLayoutConfig(layoutConfig).paneSplitPercent);
  const [columnWidths, setColumnWidths] = useState(normalizeLayoutConfig(layoutConfig).columnWidths);
  const [dragFieldKey, setDragFieldKey] = useState(null);
  const [showWorkbenchPanel, setShowWorkbenchPanel] = useState(false);
  const [showUnscheduledPanel, setShowUnscheduledPanel] = useState(true);
  const [unscheduledSortKey, setUnscheduledSortKey] = useState("sceneNumber");
  const [unscheduledSortDir, setUnscheduledSortDir] = useState("asc");
  const [selectedStripIds, setSelectedStripIds] = useState([]);
  const [lastSelectedRow, setLastSelectedRow] = useState({ day: "", id: "" });
  const [dropPreview, setDropPreview] = useState(null);
  const [draggedDay, setDraggedDay] = useState("");
  const [editorTarget, setEditorTarget] = useState(null);
  const [draft, setDraft] = useState(toDraft(null, UNSCHEDULED_DAY));
  const [entityType, setEntityType] = useState("cast");
  const [selectedEntity, setSelectedEntity] = useState("");
  const [chipInputs, setChipInputs] = useState({ cast: "", background: "", props: "", wardrobe: "", sets: "", location: "" });
  const [workbenchSelection, setWorkbenchSelection] = useState("");
  const [workbenchMenu, setWorkbenchMenu] = useState({ open: false, x: 0, y: 0, text: "" });
  const resizeRef = useRef(null);
  const paneResizeRef = useRef(false);
  const splitContainerRef = useRef(null);
  const workbenchLineRef = useRef(null);

  const stripCount = useMemo(() => Object.values(stripsByDay).reduce((count, dayStrips) => count + dayStrips.length, 0), [stripsByDay]);
  const shootingDays = useMemo(() => days.filter((day) => day !== UNSCHEDULED_DAY), [days]);
  const castNumberLookup = useMemo(() => {
    const byKey = new Map();
    const ordered = [];
    for (const name of castOrder || []) {
      const key = normalizeName(name);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, ordered.length + 1);
      ordered.push(name);
    }
    for (const strips of Object.values(stripsByDay || {})) {
      for (const strip of strips || []) {
        for (const raw of strip.cast || []) {
          const key = normalizeName(raw);
          if (!key || byKey.has(key)) continue;
          byKey.set(key, ordered.length + 1);
          ordered.push(raw);
        }
      }
    }
    return byKey;
  }, [castOrder, stripsByDay]);

  useEffect(() => {
    const normalized = normalizeLayoutConfig(layoutConfig);
    setColorMode(normalized.colorMode);
    setRowHeight(normalized.rowHeight);
    setFieldOrder(normalized.fieldOrder);
    setPaneSplitPercent(normalized.paneSplitPercent);
    setColumnWidths(normalized.columnWidths);
  }, [layoutConfig]);

  useEffect(() => {
    if (showWorkbench) setShowWorkbenchPanel(false);
  }, [showWorkbench]);

  useEffect(() => {
    if (!workbenchMenu.open) return undefined;
    function closeMenu() {
      setWorkbenchMenu((prev) => (prev.open ? { open: false, x: 0, y: 0, text: "" } : prev));
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [workbenchMenu.open]);

  const allSceneRefs = useMemo(() => {
    const refs = [];
    for (const day of days) {
      for (const strip of stripsByDay[day] ?? []) refs.push({ day, strip });
    }
    return refs;
  }, [days, stripsByDay]);

  const entityIndex = useMemo(() => {
    const maps = { cast: new Map(), background: new Map(), location: new Map(), props: new Map(), wardrobe: new Map(), sets: new Map() };
    const push = (type, raw) => {
      const value = String(raw || "").trim();
      if (!value) return;
      if (!maps[type].has(value)) maps[type].set(value, []);
      maps[type].get(value).push(1);
    };

    for (const ref of allSceneRefs) {
      for (const v of ref.strip.cast ?? []) push("cast", v);
      for (const v of ref.strip.background ?? []) push("background", v);
      push("location", ref.strip.location);
      for (const v of ref.strip.props ?? []) push("props", v);
      for (const v of ref.strip.wardrobe ?? []) push("wardrobe", v);
      for (const v of ref.strip.sets ?? []) push("sets", v);
    }
    return maps;
  }, [allSceneRefs]);

  const entityList = useMemo(
    () => Array.from(entityIndex[entityType].entries()).map(([value, refs]) => ({ value, count: refs.length })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    [entityIndex, entityType]
  );

  const currentEntityScenes = useMemo(() => {
    if (!selectedEntity) return [];
    const out = [];
    for (const ref of allSceneRefs) {
      const pool = entityType === "location" ? [ref.strip.location] : (ref.strip[entityType] ?? []);
      if (pool.some((item) => String(item || "").trim() === selectedEntity)) out.push(ref);
    }
    return out;
  }, [allSceneRefs, entityType, selectedEntity]);

  const castSuggestions = useMemo(() => Array.from(entityIndex.cast.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const backgroundSuggestions = useMemo(() => Array.from(entityIndex.background.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const locationSuggestions = useMemo(() => Array.from(entityIndex.location.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const propsSuggestions = useMemo(() => Array.from(entityIndex.props.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const wardrobeSuggestions = useMemo(() => Array.from(entityIndex.wardrobe.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);
  const setsSuggestions = useMemo(() => Array.from(entityIndex.sets.keys()).sort((a, b) => a.localeCompare(b)), [entityIndex]);

  useEffect(() => {
    if (!entityList.length) {
      setSelectedEntity("");
      return;
    }
    if (!entityList.some((item) => item.value === selectedEntity)) setSelectedEntity(entityList[0].value);
  }, [entityList, selectedEntity]);

  function uniqueDayName(dayList) {
    let index = dayList.filter((day) => day !== UNSCHEDULED_DAY).length + 1;
    let candidate = `Day ${index}`;
    while (dayList.includes(candidate)) {
      index += 1;
      candidate = `Day ${index}`;
    }
    return candidate;
  }

  function insertDayBreakAfterActive() {
    const selectedId = editorTarget?.id;
    if (!selectedId) return;

    let sourceDay = null;
    let sourceIndex = -1;
    for (const day of days) {
      const idx = (stripsByDay[day] ?? []).findIndex((strip) => strip.id === selectedId);
      if (idx >= 0) {
        sourceDay = day;
        sourceIndex = idx;
        break;
      }
    }
    if (!sourceDay || sourceIndex < 0) return;

    const sourceStrips = stripsByDay[sourceDay] ?? [];
    if (sourceIndex >= sourceStrips.length - 1) return;

    const nextDayName = uniqueDayName(days);
    const sourceDayPosition = days.indexOf(sourceDay);
    const nextDays = [...days];
    nextDays.splice(sourceDayPosition + 1, 0, nextDayName);
    setDays(nextDays);

    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      const current = next[sourceDay] ?? [];
      next[sourceDay] = current.slice(0, sourceIndex + 1);
      next[nextDayName] = current.slice(sourceIndex + 1);
      return next;
    });
  }

  function moveStrip(stripId, targetDay, beforeStripId = null) {
    if (!stripId || !targetDay) return;
    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      let moving = null;
      for (const day of Object.keys(next)) {
        const idx = next[day].findIndex((strip) => strip.id === stripId);
        if (idx >= 0) {
          moving = next[day][idx];
          next[day].splice(idx, 1);
          break;
        }
      }
      if (!moving) return prev;
      const targetList = next[targetDay] ?? [];
      if (!beforeStripId) {
        targetList.push(moving);
      } else {
        const targetIndex = targetList.findIndex((strip) => strip.id === beforeStripId);
        if (targetIndex < 0) targetList.push(moving);
        else targetList.splice(targetIndex, 0, moving);
      }
      next[targetDay] = targetList;
      return next;
    });
  }

  function moveStrips(stripIds, targetDay, beforeStripId = null) {
    const ids = Array.from(new Set((stripIds || []).filter(Boolean)));
    if (!ids.length || !targetDay) return;
    setStripsByDay((prev) => {
      const idSet = new Set(ids);
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      const moving = [];
      for (const day of Object.keys(next)) {
        const kept = [];
        for (const strip of next[day]) {
          if (idSet.has(strip.id)) moving.push(strip);
          else kept.push(strip);
        }
        next[day] = kept;
      }
      if (!moving.length) return prev;
      const targetList = next[targetDay] ?? [];
      const targetIndex = beforeStripId ? targetList.findIndex((strip) => strip.id === beforeStripId) : -1;
      if (targetIndex < 0) targetList.push(...moving);
      else targetList.splice(targetIndex, 0, ...moving);
      next[targetDay] = targetList;
      return next;
    });
  }

  function getSortValue(strip, key) {
    if (key === "cast" || key === "background" || key === "props" || key === "wardrobe" || key === "sets") {
      return (strip[key] || []).join(", ").toUpperCase();
    }
    if (key === "pageEighths" || key === "estTimeMinutes" || key === "sceneNumber") {
      return Number(strip[key] || 0);
    }
    return String(strip[key] || "").toUpperCase();
  }

  function getFieldValue(fieldKey, strip) {
    if (fieldKey === "cast") {
      const values = (strip.cast || [])
        .map((name) => castNumberLookup.get(normalizeName(name)))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
      return values.join(", ");
    }
    return FIELD_DEFS[fieldKey]?.value(strip) || "";
  }

  function startFirstShootDayFromUnscheduled() {
    const unscheduled = stripsByDay[UNSCHEDULED_DAY] ?? [];
    if (!unscheduled.length) return;
    const nextDayName = uniqueDayName(days);
    setDays([UNSCHEDULED_DAY, ...shootingDays, nextDayName]);
    setStripsByDay((prev) => ({
      ...prev,
      [UNSCHEDULED_DAY]: [],
      [nextDayName]: [...(prev[nextDayName] ?? []), ...unscheduled],
    }));
  }

  function selectStrip(strip, day) {
    setEditorTarget({ id: strip.id, day });
    setDraft(toDraft(strip, day));
    setWorkbenchSelection("");
    closeWorkbenchContextMenu();
  }

  function handleRowClick(event, strip, day, orderedRows = []) {
    const isToggle = event.metaKey || event.ctrlKey;
    const isRange = event.shiftKey;
    const currentId = strip.id;
    const rowIds = orderedRows.map((row) => row.id);
    const currentIndex = rowIds.indexOf(currentId);
    if (currentIndex < 0) {
      selectStrip(strip, day);
      return;
    }

    if (isRange && lastSelectedRow.id && lastSelectedRow.day === day) {
      const lastIndex = rowIds.indexOf(lastSelectedRow.id);
      if (lastIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeIds = rowIds.slice(start, end + 1);
        setSelectedStripIds((prev) => (isToggle ? Array.from(new Set([...prev, ...rangeIds])) : rangeIds));
      } else {
        setSelectedStripIds([currentId]);
      }
    } else if (isToggle) {
      setSelectedStripIds((prev) => (
        prev.includes(currentId)
          ? prev.filter((id) => id !== currentId)
          : [...prev, currentId]
      ));
      setLastSelectedRow({ day, id: currentId });
    } else {
      setSelectedStripIds([currentId]);
      setLastSelectedRow({ day, id: currentId });
    }
    selectStrip(strip, day);
  }

  function draggedIdsPayload(fallbackId) {
    if (!draggedStrip) return [];
    if (Array.isArray(draggedStrip.ids) && draggedStrip.ids.length) return draggedStrip.ids;
    if (draggedStrip.id) return [draggedStrip.id];
    return fallbackId ? [fallbackId] : [];
  }

  function clearDragState() {
    setDraggedStrip(null);
    setDraggedDay("");
    setDropPreview(null);
  }

  function reorderShootingDays(sourceDay, targetDay) {
    if (!sourceDay || !targetDay || sourceDay === targetDay) return;
    const baseDays = days.filter((day) => day !== UNSCHEDULED_DAY);
    const fromIndex = baseDays.indexOf(sourceDay);
    const toIndex = baseDays.indexOf(targetDay);
    if (fromIndex < 0 || toIndex < 0) return;
    const reordered = [...baseDays];
    const [picked] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, picked);

    const unscheduledIndex = days.indexOf(UNSCHEDULED_DAY);
    const nextDays = unscheduledIndex === days.length - 1
      ? [...reordered, UNSCHEDULED_DAY]
      : [UNSCHEDULED_DAY, ...reordered];
    setDays(nextDays);
  }

  function beginStripDrag(event, stripId, day, isMultiSelected = false) {
    const isSelected = selectedStripIds.includes(stripId);
    const ids = isSelected ? selectedStripIds : [stripId];
    const safeIds = ids.length ? ids : [stripId];
    if (!isSelected) {
      setSelectedStripIds([stripId]);
      setLastSelectedRow({ day, id: stripId });
    }
    setDraggedStrip({ ids: safeIds, day });
    setDropPreview(null);
    setDraggedDay("");

    if (!event?.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    const preview = document.createElement("div");
    const sourceList = stripsByDay?.[day] || [];
    const leadStrip = sourceList.find((item) => item.id === stripId) || sourceList.find((item) => safeIds.includes(item.id));
    preview.className = "drag-preview-strip";
    const sceneText = leadStrip ? `SC ${leadStrip.sceneNumber || ""}` : "SC";
    const subText = leadStrip
      ? `${leadStrip.intExt || ""} ${leadStrip.timeOfDay || ""} ${leadStrip.location || leadStrip.heading || ""}`.trim()
      : "Moving strip";
    preview.innerHTML = `
      <div class="drag-preview-strip-top">${sceneText}</div>
      <div class="drag-preview-strip-sub">${subText || "Moving strip"}</div>
      ${safeIds.length > 1 ? `<div class="drag-preview-strip-more">+${safeIds.length - 1} more</div>` : ""}
    `;
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 18, 18);
    window.setTimeout(() => {
      if (preview.parentNode) preview.parentNode.removeChild(preview);
    }, 0);
  }

  function beginDayDrag(event, day) {
    setDraggedDay(day);
    setDraggedStrip(null);
    setDropPreview(null);
    if (!event?.dataTransfer) return;
    event.dataTransfer.effectAllowed = "move";
    const preview = document.createElement("div");
    preview.className = "drag-preview-pill";
    preview.textContent = `Move ${day}`;
    document.body.appendChild(preview);
    event.dataTransfer.setDragImage(preview, 18, 18);
    window.setTimeout(() => {
      if (preview.parentNode) preview.parentNode.removeChild(preview);
    }, 0);
  }

  function setDropPreviewBefore(day, beforeId, draggedIds = []) {
    if (beforeId && draggedIds.includes(beforeId)) return;
    setDropPreview({ day, beforeId: beforeId || null });
  }

  function applyHeadingToDraft(heading) {
    setDraft((prev) => {
      const derived = parseHeadingFields(heading, {
        intExt: prev.intExt,
        location: prev.location,
        timeOfDay: prev.timeOfDay,
      });
      return {
        ...prev,
        heading,
        intExt: derived.intExt,
        location: derived.location,
        timeOfDay: derived.timeOfDay,
      };
    });
  }

  function resetForNew() {
    setEditorTarget(null);
    setDraft(toDraft(null, UNSCHEDULED_DAY));
    setWorkbenchSelection("");
    closeWorkbenchContextMenu();
  }

  function buildStripFromDraft() {
    const heading = draft.heading.trim();
    const location = draft.location.trim();
    if (!heading || !location) return null;
    const numericSceneNumber = Number.parseInt(draft.sceneNumber, 10);
    const sceneNumber = Number.isNaN(numericSceneNumber) ? stripCount + 1 : numericSceneNumber;
    const parsedPageEighths = parsePageCountToEighths(draft.pageCount);
    const pageEighths = parsedPageEighths ?? estimateVisualPageEighths(draft.scriptText);
    const estTimeMinutes = Math.max(0, Number.parseInt(String(draft.estTimeMinutes || "0"), 10) || 0);
    return {
      id: draft.id || createStripId("scene"),
      sceneNumber,
      heading,
      location,
      cast: uniqueValues(draft.cast),
      background: uniqueValues(draft.background),
      props: uniqueValues(draft.props),
      wardrobe: uniqueValues(draft.wardrobe),
      sets: uniqueValues(draft.sets),
      scriptText: draft.scriptText,
      notes: draft.notes,
      needsReview: draft.needsReview,
      intExt: draft.intExt,
      timeOfDay: draft.timeOfDay,
      pageEighths,
      estTimeMinutes,
    };
  }

  function saveNewScene() {
    const strip = buildStripFromDraft();
    if (!strip) return;
    const targetDay = days.includes(draft.day) ? draft.day : UNSCHEDULED_DAY;
    strip.id = createStripId("manual");
    setStripsByDay((prev) => ({ ...prev, [targetDay]: [...(prev[targetDay] ?? []), strip] }));
    setEditorTarget({ id: strip.id, day: targetDay });
    setDraft(toDraft(strip, targetDay));
  }

  function updateScene() {
    if (!editorTarget?.id) return;
    const strip = buildStripFromDraft();
    if (!strip) return;
    const destinationDay = days.includes(draft.day) ? draft.day : editorTarget.day;
    strip.id = editorTarget.id;
    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      for (const day of Object.keys(next)) next[day] = next[day].filter((item) => item.id !== editorTarget.id);
      next[destinationDay] = [...(next[destinationDay] ?? []), strip];
      return next;
    });
    setEditorTarget({ id: strip.id, day: destinationDay });
    setDraft(toDraft(strip, destinationDay));
  }

  function duplicateScene() {
    const strip = buildStripFromDraft();
    if (!strip) return;
    const targetDay = days.includes(draft.day) ? draft.day : UNSCHEDULED_DAY;
    strip.id = createStripId("dup");
    setStripsByDay((prev) => ({ ...prev, [targetDay]: [...(prev[targetDay] ?? []), strip] }));
    setEditorTarget({ id: strip.id, day: targetDay });
    setDraft(toDraft(strip, targetDay));
  }

  function addChip(field, value) {
    const candidate = String(value || "").trim();
    if (!candidate) return;
    setDraft((prev) => ({ ...prev, [field]: uniqueValues([...(prev[field] || []), candidate]) }));
    setChipInputs((prev) => ({ ...prev, [field]: "" }));
  }

  function removeChip(field, value) {
    setDraft((prev) => ({ ...prev, [field]: (prev[field] || []).filter((item) => item !== value) }));
  }

  function setLocation(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return;
    setDraft((prev) => {
      const location = candidate.replace(/^[\s.\-:;]+/, "");
      return {
        ...prev,
        location,
        heading: buildHeadingFromParts(prev.intExt, location, prev.timeOfDay),
      };
    });
    setChipInputs((prev) => ({ ...prev, location: "" }));
  }

  function deleteCastElement() {
    if (entityType !== "cast" || !selectedEntity) return;
    const target = selectedEntity.trim().toUpperCase();
    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([day, strips]) => [day, [...strips]]));
      for (const day of Object.keys(next)) {
        next[day] = (next[day] || []).map((strip) => ({
          ...strip,
          cast: (strip.cast || []).filter((name) => String(name || "").trim().toUpperCase() !== target),
        }));
      }
      return next;
    });
    setSelectedEntity("");
  }

  function saveLayout() {
    onSaveLayoutConfig?.({
      fieldOrder,
      rowHeight,
      colorMode,
      paneSplitPercent,
      columnWidths,
    });
  }

  function onHeaderClickSort(fieldKey) {
    if (unscheduledSortKey !== fieldKey) {
      setUnscheduledSortKey(fieldKey);
      setUnscheduledSortDir("asc");
      return;
    }
    setUnscheduledSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
  }

  function beginResize(fieldKey, event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = Number(columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120);
    resizeRef.current = { fieldKey, startX, startWidth };
  }

  useEffect(() => {
    function onMouseMove(event) {
      if (resizeRef.current) {
        const { fieldKey, startX, startWidth } = resizeRef.current;
        const delta = event.clientX - startX;
        const nextWidth = Math.max(30, Math.min(700, startWidth + delta));
        setColumnWidths((prev) => ({ ...prev, [fieldKey]: nextWidth }));
        return;
      }
      if (!paneResizeRef.current || !splitContainerRef.current || !showUnscheduledPanel) return;
      const bounds = splitContainerRef.current.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const percent = ((event.clientX - bounds.left) / bounds.width) * 100;
      setPaneSplitPercent(Math.max(20, Math.min(80, percent)));
    }

    function onMouseUp() {
      if (!resizeRef.current && !paneResizeRef.current) return;
      resizeRef.current = null;
      paneResizeRef.current = false;
      onSaveLayoutConfig?.({
        fieldOrder,
        rowHeight,
        colorMode,
        paneSplitPercent,
        columnWidths,
      });
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [colorMode, columnWidths, fieldOrder, onSaveLayoutConfig, paneSplitPercent, rowHeight, showUnscheduledPanel]);

  function onFieldDrop(targetField) {
    if (!dragFieldKey || dragFieldKey === targetField) return;
    setFieldOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(dragFieldKey);
      const to = next.indexOf(targetField);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, dragFieldKey);
      return next;
    });
    setDragFieldKey(null);
  }

  const stackedDayBlocks = useMemo(() => {
    return shootingDays.map((day, index) => {
      const strips = stripsByDay[day] ?? [];
      const conflicts = getDayConflicts(day, strips);
      return {
        day,
        dayIndex: index + 1,
        strips,
        pageTotal: getDayTotalEighths(strips),
        timeTotal: getDayTotalMinutes(strips),
        conflicts,
      };
    });
  }, [shootingDays, stripsByDay]);
  const conflictSummary = useMemo(() => {
    const out = [];
    for (const block of stackedDayBlocks) {
      for (const conflict of block.conflicts || []) out.push(conflict);
    }
    return out;
  }, [stackedDayBlocks]);

  const unscheduledFieldOrder = useMemo(
    () => fieldOrder.filter((fieldKey) => fieldKey !== "heading"),
    [fieldOrder]
  );
  const scheduledFieldOrder = useMemo(
    () => fieldOrder.filter((fieldKey) => fieldKey !== "heading"),
    [fieldOrder]
  );
  const unscheduledTableWidth = useMemo(
    () => Math.max(240, unscheduledFieldOrder.reduce((total, fieldKey) => total + Number(columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120), 0)),
    [columnWidths, unscheduledFieldOrder]
  );
  const scheduledTableWidth = useMemo(
    () => Math.max(360, scheduledFieldOrder.reduce((total, fieldKey) => total + Number(columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120), 0)),
    [columnWidths, scheduledFieldOrder]
  );

  const unscheduledRows = useMemo(() => {
    const rows = [...(stripsByDay[UNSCHEDULED_DAY] ?? [])];
    rows.sort((a, b) => {
      const av = getSortValue(a, unscheduledSortKey);
      const bv = getSortValue(b, unscheduledSortKey);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return unscheduledSortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [stripsByDay, unscheduledSortKey, unscheduledSortDir]);

  useEffect(() => {
    const available = new Set(unscheduledRows.map((strip) => strip.id));
    const allStripIds = new Set(Object.values(stripsByDay).flat().map((strip) => strip.id));
    setSelectedStripIds((prev) => prev.filter((id) => allStripIds.has(id)));
    if (lastSelectedRow.id && !allStripIds.has(lastSelectedRow.id)) {
      setLastSelectedRow({ day: "", id: "" });
    }
  }, [lastSelectedRow.id, stripsByDay, unscheduledRows]);

  function moveAllScheduledToBoneyard() {
    const scheduled = shootingDays.flatMap((day) => stripsByDay[day] || []);
    if (!scheduled.length) return;
    setStripsByDay((prev) => ({
      [UNSCHEDULED_DAY]: [...(prev[UNSCHEDULED_DAY] || []), ...shootingDays.flatMap((day) => prev[day] || [])],
    }));
    setDays([UNSCHEDULED_DAY]);
    setSelectedStripIds((prev) => prev.filter((id) => (stripsByDay[UNSCHEDULED_DAY] || []).some((strip) => strip.id === id)));
    if (editorTarget && editorTarget.day !== UNSCHEDULED_DAY) {
      setEditorTarget((prev) => (prev ? { ...prev, day: UNSCHEDULED_DAY } : prev));
      setDraft((prev) => ({ ...prev, day: UNSCHEDULED_DAY, sourceDay: UNSCHEDULED_DAY }));
    }
  }

  const workbenchLines = useMemo(() => classifySceneLines(draft.scriptText || ""), [draft.scriptText]);
  const workbenchTokens = useMemo(() => workbenchTokenMap(draft), [draft]);

  function captureWorkbenchSelection() {
    const root = workbenchLineRef.current;
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0) {
      setWorkbenchSelection("");
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setWorkbenchSelection("");
      return;
    }
    setWorkbenchSelection(normalizeSelection(selection.toString()));
  }

  function openWorkbenchContextMenu(event, explicitText = "") {
    const candidate = normalizeSelection(explicitText || workbenchSelection);
    if (!candidate) return;
    event.preventDefault();
    setWorkbenchSelection(candidate);
    setWorkbenchMenu({ open: true, x: event.clientX, y: event.clientY, text: candidate });
  }

  function closeWorkbenchContextMenu() {
    setWorkbenchMenu({ open: false, x: 0, y: 0, text: "" });
  }

  function removeWorkbenchElement(type, value) {
    if (type === "location") {
      const target = normalizeName(value);
      setDraft((prev) => (normalizeName(prev.location) === target ? { ...prev, location: "" } : prev));
      return;
    }
    setDraft((prev) => ({
      ...prev,
      [type]: (prev[type] || []).filter((item) => normalizeName(item) !== normalizeName(value)),
    }));
  }

  function addWorkbenchElement(type, value) {
    const candidate = normalizeSelection(value);
    if (!candidate) return;
    if (type === "location") {
      setLocation(candidate);
    } else {
      addChip(type, candidate);
    }
    window.getSelection?.().removeAllRanges();
    setWorkbenchSelection("");
    closeWorkbenchContextMenu();
  }

  function deleteDayBreakAfter(day) {
    const breakIndex = shootingDays.indexOf(day);
    if (breakIndex < 0 || breakIndex >= shootingDays.length - 1) return;
    const nextDay = shootingDays[breakIndex + 1];

    setDays((prev) => prev.filter((item) => item !== nextDay));
    setStripsByDay((prev) => {
      const next = Object.fromEntries(Object.entries(prev).map(([key, strips]) => [key, [...strips]]));
      next[day] = [...(next[day] || []), ...(next[nextDay] || [])];
      delete next[nextDay];
      return next;
    });

    if (editorTarget?.day === nextDay) {
      setEditorTarget((prev) => (prev ? { ...prev, day } : prev));
      setDraft((prev) => ({ ...prev, day, sourceDay: day }));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <span>Total strips: {stripCount}</span>
        <label className="inline-control">
          Color Mode
          <select value={colorMode} onChange={(event) => setColorMode(event.target.value)}>
            <option value="dayNight">Day/Night</option>
            <option value="intExt">INT/EXT</option>
            <option value="none">None</option>
          </select>
        </label>
        <button type="button" onClick={insertDayBreakAfterActive} disabled={!editorTarget}>Add Day Break After Active Scene</button>
        <button type="button" onClick={startFirstShootDayFromUnscheduled} disabled={(stripsByDay[UNSCHEDULED_DAY] ?? []).length === 0}>Start Schedule From Unscheduled</button>
        <button type="button" onClick={moveAllScheduledToBoneyard} disabled={shootingDays.every((day) => !(stripsByDay[day] || []).length)}>
          Move All to Boneyard
        </button>
        <button type="button" onClick={() => setShowUnscheduledPanel((prev) => !prev)}>
          {showUnscheduledPanel ? "Hide Boneyard" : "Show Boneyard"}
        </button>
        {onReturnToStripView ? <button type="button" onClick={onReturnToStripView}>Return to Strip View</button> : null}
        {showWorkbench ? (
          <button type="button" onClick={() => setShowWorkbenchPanel((prev) => !prev)}>
            {showWorkbenchPanel ? "Hide Scene Workbench" : "Show Scene Workbench"}
          </button>
        ) : null}
      </div>
      {conflictSummary.length ? (
        <div className="conflict-panel">
          <strong>Conflicts ({conflictSummary.length})</strong>
          <div className="conflict-list">
            {conflictSummary.map((item, index) => (
              <span key={`${item.day}-${item.code}-${index}`} className={item.severity === "high" ? "conflict-chip high" : "conflict-chip medium"}>
                {item.day}: {item.title}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {showWorkbench ? (
        <section className="scene-editor">
          <div className="workbench-header">
            <h3>Scene Workbench</h3>
            <button type="button" onClick={() => setShowWorkbenchPanel((prev) => !prev)}>
              {showWorkbenchPanel ? "Minimize Scene Workbench" : "Expand Scene Workbench"}
            </button>
          </div>
          {showWorkbenchPanel ? (
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
                <select value={draft.intExt} onChange={(event) => setDraft((prev) => ({ ...prev, intExt: event.target.value, heading: buildHeadingFromParts(event.target.value, prev.location, prev.timeOfDay) }))}>
                  {INT_EXT_OPTIONS.map((option) => (<option key={option} value={option}>{option}</option>))}
                </select>
              </label>
              <label className="field-time-of-day">
                Time of Day
                <select value={draft.timeOfDay} onChange={(event) => setDraft((prev) => ({ ...prev, timeOfDay: event.target.value, heading: buildHeadingFromParts(prev.intExt, prev.location, event.target.value) }))}>
                  {TIME_OPTIONS.map((option) => (<option key={option} value={option}>{option}</option>))}
                </select>
              </label>
              <label className="field-location">
                Location
                <input
                  type="text"
                  list="location-suggestions-main"
                  value={draft.location}
                  onChange={(event) => {
                    const location = event.target.value;
                    setDraft((prev) => ({ ...prev, location, heading: buildHeadingFromParts(prev.intExt, location, prev.timeOfDay) }));
                  }}
                />
              </label>
              <label className="field-page-count">
                Page Count
                <input type="text" value={draft.pageCount} placeholder="e.g. 2 3/8" onChange={(event) => setDraft((prev) => ({ ...prev, pageCount: event.target.value }))} />
              </label>
              <label>
                Est. Time (min)
                <input type="number" min={0} value={draft.estTimeMinutes} onChange={(event) => setDraft((prev) => ({ ...prev, estTimeMinutes: event.target.value }))} />
              </label>
              <label>
                Scheduled Day
                <select value={draft.day} onChange={(event) => setDraft((prev) => ({ ...prev, day: event.target.value }))}>
                  {days.map((day) => (<option key={day} value={day}>{day}</option>))}
                </select>
              </label>
            </div>
            <datalist id="location-suggestions-main">
              {locationSuggestions.map((value) => (<option key={value} value={value} />))}
            </datalist>

            <div className="chip-grid">
              <ChipListEditor title="Cast" values={draft.cast} suggestions={castSuggestions} inputValue={chipInputs.cast} onInputChange={(value) => setChipInputs((prev) => ({ ...prev, cast: value }))} onAdd={(value) => addChip("cast", value)} onRemove={(value) => removeChip("cast", value)} placeholder="Add cast" />
              <ChipListEditor title="Background" values={draft.background} suggestions={backgroundSuggestions} inputValue={chipInputs.background} onInputChange={(value) => setChipInputs((prev) => ({ ...prev, background: value }))} onAdd={(value) => addChip("background", value)} onRemove={(value) => removeChip("background", value)} placeholder="Add background" />
              <ChipListEditor title="Props" values={draft.props} suggestions={propsSuggestions} inputValue={chipInputs.props} onInputChange={(value) => setChipInputs((prev) => ({ ...prev, props: value }))} onAdd={(value) => addChip("props", value)} onRemove={(value) => removeChip("props", value)} placeholder="Add prop" />
              <ChipListEditor title="Wardrobe" values={draft.wardrobe} suggestions={wardrobeSuggestions} inputValue={chipInputs.wardrobe} onInputChange={(value) => setChipInputs((prev) => ({ ...prev, wardrobe: value }))} onAdd={(value) => addChip("wardrobe", value)} onRemove={(value) => removeChip("wardrobe", value)} placeholder="Add wardrobe" />
              <ChipListEditor title="Sets" values={draft.sets} suggestions={setsSuggestions} inputValue={chipInputs.sets} onInputChange={(value) => setChipInputs((prev) => ({ ...prev, sets: value }))} onAdd={(value) => addChip("sets", value)} onRemove={(value) => removeChip("sets", value)} placeholder="Add set" />
            </div>

            <div className="notes-stack">
              <label>
                Notes
                <textarea className="notes-text-area" value={draft.notes} onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))} />
              </label>
              <label className="inline-check">
                <input type="checkbox" checked={draft.needsReview} onChange={(event) => setDraft((prev) => ({ ...prev, needsReview: event.target.checked }))} /> Needs Review
              </label>
            </div>
            <div className="review-line-items">
              <h4>Line Classification + Element Mapper</h4>
              <div className="review-annotate-controls">
                <span className="review-selection-preview">
                  {workbenchSelection
                    ? `Selection: "${workbenchSelection}" (right-click to choose element type)`
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
                <span className="legend-hint">Click highlighted tokens to remove.</span>
              </div>
              <div
                ref={workbenchLineRef}
                className="review-line-list"
                onMouseUp={captureWorkbenchSelection}
                onKeyUp={captureWorkbenchSelection}
                onContextMenu={(event) => openWorkbenchContextMenu(event)}
              >
                {workbenchLines.map((item, lineIndex) => {
                  const segments = buildLineSegments(item.text || "", workbenchTokens);
                  return (
                    <div key={`wb-${lineIndex}-${item.type}`} className="review-line-row">
                      <span className={`review-line-type review-type-${item.type || "action"}`}>{item.type || "action"}</span>
                      <div className="review-line-text">
                        {segments.map((segment, segmentIndex) => {
                          if (segment.kind === "plain") return <span key={`wb-p-${lineIndex}-${segmentIndex}`}>{segment.text}</span>;
                          return (
                            <button
                              key={`wb-e-${lineIndex}-${segmentIndex}`}
                              type="button"
                              className={`review-line-token review-token-${segment.type}`}
                              title={`Remove ${segment.text} from ${segment.type}`}
                              onClick={() => removeWorkbenchElement(segment.type, segment.token)}
                              onContextMenu={(event) => openWorkbenchContextMenu(event, segment.text)}
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
              {workbenchMenu.open ? (
                <div
                  className="review-context-menu"
                  style={{ left: `${workbenchMenu.x}px`, top: `${workbenchMenu.y}px` }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="review-context-title">{workbenchMenu.text}</div>
                  {WORKBENCH_ELEMENT_TYPES.map((type) => (
                    <button key={type} type="button" onClick={() => addWorkbenchElement(type, workbenchMenu.text)}>
                      Add as {type === "location" ? "Location" : type}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </form>
          ) : (
            <p className="workbench-collapsed">Workbench minimized.</p>
          )}
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
                <option value="background">Background</option>
                <option value="location">Location</option>
                <option value="props">Props</option>
                <option value="wardrobe">Wardrobe</option>
                <option value="sets">Sets</option>
              </select>
            </label>
            {entityType === "cast" ? (
              <button type="button" onClick={deleteCastElement} disabled={!selectedEntity}>Delete Cast</button>
            ) : null}
          </div>
          <div className="entity-layout">
            <div className="entity-list">
              {entityList.map((item) => (
                <button key={item.value} type="button" className={selectedEntity === item.value ? "entity-item active" : "entity-item"} onClick={() => setSelectedEntity(item.value)}>
                  <span>{item.value}</span><span>{item.count}</span>
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
          <div className="layout-builder">
            <h4>Strip Layout Builder</h4>
            <p>Drag fields to reorder strip columns. Adjust height and color scheme, then save.</p>
            <div className="layout-pill-row">
              {fieldOrder.map((fieldKey) => (
                <button
                  key={fieldKey}
                  type="button"
                  className="layout-pill"
                  draggable
                  onDragStart={() => setDragFieldKey(fieldKey)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => onFieldDrop(fieldKey)}
                >
                  {FIELD_DEFS[fieldKey]?.label || fieldKey}
                </button>
              ))}
            </div>
            <div className="layout-controls">
              <label>
                Row Height
                <input type="range" min={22} max={84} value={rowHeight} onChange={(event) => setRowHeight(Number(event.target.value))} />
              </label>
              <label>
                Color Scheme
                <select value={colorMode} onChange={(event) => setColorMode(event.target.value)}>
                  <option value="dayNight">Day/Night</option>
                  <option value="intExt">INT/EXT</option>
                  <option value="none">None</option>
                </select>
              </label>
              <button type="button" onClick={saveLayout}>Save Layout to Schedule</button>
            </div>
          </div>
        </section>
      ) : null}

      {reportView === "stripboard" ? (
        <div className="stripboard-layout">
          <div
            ref={splitContainerRef}
            className={showUnscheduledPanel ? "strip-split-layout" : "strip-split-layout unscheduled-hidden"}
            style={showUnscheduledPanel ? { gridTemplateColumns: `calc(${paneSplitPercent}% - 4px) 8px calc(${100 - paneSplitPercent}% - 4px)` } : undefined}
          >
            {showUnscheduledPanel ? (
              <section className="scene-table-wrap unscheduled-pane">
                <div className="pane-header">Boneyard</div>
                <table className="scene-table" style={{ width: `${unscheduledTableWidth}px`, minWidth: `${unscheduledTableWidth}px` }}>
                  <thead>
                    <tr>
                      {unscheduledFieldOrder.map((fieldKey) => (
                        <th
                          key={`uns-h-${fieldKey}`}
                          className={unscheduledSortKey === fieldKey ? "sortable-header is-active" : "sortable-header"}
                          style={{ width: `${columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120}px` }}
                          onClick={() => onHeaderClickSort(fieldKey)}
                        >
                          <span>{fieldKey === "sceneNumber" ? "SC" : (FIELD_DEFS[fieldKey]?.label || fieldKey)}</span>
                          {unscheduledSortKey === fieldKey ? <span>{unscheduledSortDir === "asc" ? "▲" : "▼"}</span> : null}
                          <span className="col-resize-handle" onMouseDown={(event) => beginResize(fieldKey, event)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      className="day-break-row"
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (draggedDay) return;
                        setDropPreviewBefore(UNSCHEDULED_DAY, null, draggedIdsPayload());
                      }}
                      onDrop={() => {
                        if (draggedDay) {
                          clearDragState();
                          return;
                        }
                        const ids = draggedIdsPayload();
                        if (!ids.length) return;
                        moveStrips(ids, UNSCHEDULED_DAY, null);
                        clearDragState();
                      }}
                    >
                      <td colSpan={unscheduledFieldOrder.length}>Boneyard ({unscheduledRows.length})</td>
                    </tr>
                    {unscheduledRows.map((strip) => {
                      const isActive = editorTarget?.id === strip.id;
                      const isMultiSelected = selectedStripIds.includes(strip.id);
                      return (
                        <Fragment key={strip.id}>
                        {dropPreview?.day === UNSCHEDULED_DAY && dropPreview?.beforeId === strip.id ? (
                          <tr className="drop-placeholder-row">
                            <td colSpan={unscheduledFieldOrder.length}>Drop here</td>
                          </tr>
                        ) : null}
                        <tr
                          className={isActive ? "scene-row selected" : isMultiSelected ? "scene-row multi-selected" : "scene-row"}
                          style={{ ...getStripStyle(strip, colorMode), height: `${rowHeight}px` }}
                          onClick={(event) => handleRowClick(event, strip, UNSCHEDULED_DAY, unscheduledRows)}
                          draggable
                          onDragStart={(event) => beginStripDrag(event, strip.id, UNSCHEDULED_DAY, isMultiSelected)}
                          onDragEnd={clearDragState}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (draggedDay) return;
                            setDropPreviewBefore(UNSCHEDULED_DAY, strip.id, draggedIdsPayload());
                          }}
                          onDrop={() => {
                            if (draggedDay) {
                              clearDragState();
                              return;
                            }
                            const ids = draggedIdsPayload();
                            if (!ids.length) return;
                            moveStrips(ids, UNSCHEDULED_DAY, strip.id);
                            clearDragState();
                          }}
                        >
                          {unscheduledFieldOrder.map((fieldKey) => (
                            <td key={`uns-${strip.id}-${fieldKey}`} style={{ width: `${columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120}px` }}>
                              {getFieldValue(fieldKey, strip)}
                            </td>
                          ))}
                        </tr>
                        </Fragment>
                      );
                    })}
                    {dropPreview?.day === UNSCHEDULED_DAY && !dropPreview?.beforeId ? (
                      <tr className="drop-placeholder-row">
                        <td colSpan={unscheduledFieldOrder.length}>Drop here</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </section>
            ) : null}
            {showUnscheduledPanel ? (
              <div
                className="pane-splitter"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize boneyard and schedule panes"
                onMouseDown={(event) => {
                  event.preventDefault();
                  paneResizeRef.current = true;
                }}
              />
            ) : null}

            <section className="scene-table-wrap scheduled-pane">
              <div className="pane-header">Schedule</div>
              <table className="scene-table" style={{ width: `${scheduledTableWidth}px`, minWidth: `${scheduledTableWidth}px` }}>
                <thead>
                  <tr>
                    {scheduledFieldOrder.map((fieldKey) => (
                      <th key={`sched-h-${fieldKey}`} style={{ width: `${columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120}px` }}>
                        {FIELD_DEFS[fieldKey]?.label || fieldKey}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stackedDayBlocks.map((block) => (
                    <Fragment key={`day-group-${block.day}`}>
                      {block.strips.map((strip) => {
                        const isActive = editorTarget?.id === strip.id;
                        const isMultiSelected = selectedStripIds.includes(strip.id);
                        return (
                          <Fragment key={strip.id}>
                          {dropPreview?.day === block.day && dropPreview?.beforeId === strip.id ? (
                            <tr className="drop-placeholder-row">
                              <td colSpan={scheduledFieldOrder.length}>Drop here</td>
                            </tr>
                          ) : null}
                          <tr
                            className={isActive ? "scene-row selected" : isMultiSelected ? "scene-row multi-selected" : "scene-row"}
                            style={{ ...getStripStyle(strip, colorMode), height: `${rowHeight}px` }}
                            onClick={(event) => handleRowClick(event, strip, block.day, block.strips)}
                            draggable
                            onDragStart={(event) => beginStripDrag(event, strip.id, block.day, isMultiSelected)}
                            onDragEnd={clearDragState}
                            onDragOver={(event) => {
                              event.preventDefault();
                              if (draggedDay) return;
                              setDropPreviewBefore(block.day, strip.id, draggedIdsPayload());
                            }}
                            onDrop={() => {
                              if (draggedDay) {
                                clearDragState();
                                return;
                              }
                              const ids = draggedIdsPayload();
                              if (!ids.length) return;
                              moveStrips(ids, block.day, strip.id);
                              if (ids.includes(editorTarget?.id)) {
                                setEditorTarget((prev) => (prev ? { ...prev, day: block.day } : prev));
                              }
                              clearDragState();
                            }}
                          >
                            {scheduledFieldOrder.map((fieldKey) => (
                              <td key={`sched-${strip.id}-${fieldKey}`} style={{ width: `${columnWidths[fieldKey] || DEFAULT_LAYOUT.columnWidths[fieldKey] || 120}px` }}>
                                {getFieldValue(fieldKey, strip)}
                              </td>
                            ))}
                          </tr>
                          </Fragment>
                        );
                      })}
                      {dropPreview?.day === block.day && !dropPreview?.beforeId ? (
                        <tr className="drop-placeholder-row">
                          <td colSpan={scheduledFieldOrder.length}>Drop here</td>
                        </tr>
                      ) : null}
                      <tr
                        key={`break-${block.day}`}
                        className={draggedDay && draggedDay !== block.day ? "day-break-row day-break-drop-target" : "day-break-row"}
                        draggable
                        onDragStart={(event) => beginDayDrag(event, block.day)}
                        onDragEnd={clearDragState}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (draggedDay) return;
                          setDropPreviewBefore(block.day, null, draggedIdsPayload());
                        }}
                        onDrop={() => {
                          if (draggedDay) {
                            reorderShootingDays(draggedDay, block.day);
                            clearDragState();
                            return;
                          }
                          const ids = draggedIdsPayload();
                          if (!ids.length) return;
                          moveStrips(ids, block.day, null);
                          if (ids.includes(editorTarget?.id)) {
                            setEditorTarget((prev) => (prev ? { ...prev, day: block.day } : prev));
                          }
                          clearDragState();
                        }}
                      >
                        <td colSpan={scheduledFieldOrder.length}>
                          <div className="day-break-content">
                            <span className="day-break-meta">
                              End of Day #{block.dayIndex} - {block.day} - {formatPageEighths(block.pageTotal)} pages - {formatMinutes(block.timeTotal)} est.
                            </span>
                            {block.conflicts?.length ? (
                              <span className="day-conflict-badges">
                                {block.conflicts.map((item, idx) => (
                                  <span key={`${block.day}-${item.code}-${idx}`} className={item.severity === "high" ? "conflict-badge high" : "conflict-badge medium"}>
                                    {item.code === "cast_load" ? "Cast Load" : item.code === "duplicate_scene" ? "Duplicates" : item.code === "moves" ? "Moves" : "Review"}
                                  </span>
                                ))}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className="day-break-delete"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteDayBreakAfter(block.day);
                              }}
                              disabled={block.dayIndex >= shootingDays.length}
                            >
                              Delete Day Break
                            </button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
