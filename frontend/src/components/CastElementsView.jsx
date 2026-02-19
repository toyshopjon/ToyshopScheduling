import { useEffect, useMemo, useState } from "react";

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function buildDefaultOrder(counts) {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

function mergeOrder(savedOrder, counts) {
  const map = new Map(Array.from(counts.keys()).map((name) => [normalize(name), name]));
  const used = new Set();
  const ordered = [];

  for (const raw of savedOrder || []) {
    const key = normalize(raw);
    const canonical = map.get(key);
    if (!canonical || used.has(key)) continue;
    ordered.push(canonical);
    used.add(key);
  }

  for (const name of buildDefaultOrder(counts)) {
    const key = normalize(name);
    if (used.has(key)) continue;
    ordered.push(name);
    used.add(key);
  }

  return ordered;
}

export function CastElementsView({
  stripsByDay,
  castOrder = [],
  castNumbersLocked = false,
  onToggleCastNumbersLocked,
  onSaveCastOrder,
  onDeleteCast,
  onBackToElements,
  onBackToStrip,
}) {
  const [dragName, setDragName] = useState("");
  const [contextMenu, setContextMenu] = useState({ open: false, x: 0, y: 0, castName: "" });

  const castCounts = useMemo(() => {
    const counts = new Map();
    for (const strips of Object.values(stripsByDay || {})) {
      for (const strip of strips || []) {
        for (const name of unique(strip.cast || [])) {
          counts.set(name, (counts.get(name) || 0) + 1);
        }
      }
    }
    return counts;
  }, [stripsByDay]);

  const orderedCast = useMemo(() => mergeOrder(castOrder, castCounts), [castOrder, castCounts]);

  function persist(nextOrder) {
    onSaveCastOrder?.(nextOrder);
  }

  function moveCast(castName, toIndex) {
    const sourceIndex = orderedCast.findIndex((name) => normalize(name) === normalize(castName));
    if (sourceIndex < 0 || toIndex < 0 || toIndex >= orderedCast.length || sourceIndex === toIndex) return;
    const next = [...orderedCast];
    const [picked] = next.splice(sourceIndex, 1);
    next.splice(toIndex, 0, picked);
    persist(next);
  }

  function renumberCast(castName) {
    const currentIndex = orderedCast.findIndex((name) => normalize(name) === normalize(castName));
    if (currentIndex < 0) return;
    const input = window.prompt(`Set number for ${castName}`, String(currentIndex + 1));
    const targetNumber = Number.parseInt(String(input || ""), 10);
    if (!Number.isFinite(targetNumber) || targetNumber < 1) return;
    const targetIndex = Math.min(orderedCast.length - 1, targetNumber - 1);
    moveCast(castName, targetIndex);
  }

  function deleteCast(castName) {
    if (!castName) return;
    const confirmDelete = window.confirm(`Delete ${castName} from all scenes?`);
    if (!confirmDelete) return;
    onDeleteCast?.(castName);
    persist(orderedCast.filter((name) => normalize(name) !== normalize(castName)));
  }

  function closeMenu() {
    setContextMenu((prev) => (prev.open ? { open: false, x: 0, y: 0, castName: "" } : prev));
  }

  useEffect(() => {
    if (!contextMenu.open) return undefined;
    function closeGlobal() {
      closeMenu();
    }
    window.addEventListener("click", closeGlobal);
    window.addEventListener("scroll", closeGlobal, true);
    window.addEventListener("resize", closeGlobal);
    return () => {
      window.removeEventListener("click", closeGlobal);
      window.removeEventListener("scroll", closeGlobal, true);
      window.removeEventListener("resize", closeGlobal);
    };
  }, [contextMenu.open]);

  return (
    <section className="panel">
      <div className="toolbar">
        <button type="button" onClick={onBackToElements}>Back to Elements</button>
        <button type="button" onClick={onBackToStrip}>Return to Strip View</button>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={Boolean(castNumbersLocked)}
            onChange={(event) => onToggleCastNumbersLocked?.(event.target.checked)}
          />
          Lock Cast Numbers (show numbers on stripboards)
        </label>
      </div>
      <h3>Cast Elements</h3>
      <p>Drag cast to reorder rank. Right click a row to renumber or delete.</p>
      <div className="scene-table-wrap cast-view-wrap" onClick={closeMenu}>
        <table className="scene-table">
          <thead>
            <tr>
              <th style={{ width: "80px" }}>#</th>
              <th style={{ width: "320px" }}>Cast</th>
              <th style={{ width: "120px" }}>Scenes</th>
              <th style={{ width: "120px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderedCast.map((name, idx) => (
              <tr
                key={name}
                className="scene-row"
                draggable
                onDragStart={() => setDragName(name)}
                onDragEnd={() => setDragName("")}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!dragName) return;
                  moveCast(dragName, idx);
                  setDragName("");
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ open: true, x: event.clientX, y: event.clientY, castName: name });
                }}
              >
                <td>{idx + 1}</td>
                <td>{name}</td>
                <td>{castCounts.get(name) || 0}</td>
                <td>
                  <button type="button" onClick={() => renumberCast(name)}>Renumber</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {contextMenu.open ? (
        <div className="review-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          <div className="review-context-title">{contextMenu.castName}</div>
          <button type="button" onClick={() => { renumberCast(contextMenu.castName); closeMenu(); }}>Renumber</button>
          <button type="button" onClick={() => { deleteCast(contextMenu.castName); closeMenu(); }}>Delete</button>
        </div>
      ) : null}
    </section>
  );
}
