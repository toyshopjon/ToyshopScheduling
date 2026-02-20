import { useMemo, useState } from "react";

const UNSCHEDULED_DAY = "Unscheduled";

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const value = String(raw || "").trim();
    const key = value.toUpperCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function DayOutOfDaysReport({ days, stripsByDay, onReorderShootDays }) {
  const [dragDayIndex, setDragDayIndex] = useState(-1);
  const shootDays = useMemo(() => (days || []).filter((day) => day !== UNSCHEDULED_DAY), [days]);

  const rows = useMemo(() => {
    const castDays = new Map();
    shootDays.forEach((day, dayIndex) => {
      for (const strip of stripsByDay?.[day] || []) {
        for (const castName of unique(strip.cast || [])) {
          if (!castDays.has(castName)) castDays.set(castName, new Set());
          castDays.get(castName).add(dayIndex);
        }
      }
    });
    return Array.from(castDays.entries())
      .map(([name, daySet]) => ({ name, daySet, total: daySet.size }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [shootDays, stripsByDay]);

  if (!shootDays.length) {
    return (
      <div className="report-placeholder">
        <h3>DooD Report</h3>
        <p>No scheduled shoot days yet. Move scenes out of Boneyard first.</p>
      </div>
    );
  }

  return (
    <div className="report-placeholder">
      <h3>DooD Report</h3>
      <div className="scene-table-wrap">
        <table className="scene-table dood-table">
          <thead>
            <tr>
              <th style={{ width: "90px" }}>Work Days</th>
              <th style={{ width: "220px" }}>Cast</th>
              {shootDays.map((day, idx) => (
                <th
                  key={day}
                  draggable
                  onDragStart={() => setDragDayIndex(idx)}
                  onDragEnd={() => setDragDayIndex(-1)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragDayIndex < 0 || dragDayIndex === idx) return;
                    onReorderShootDays?.(dragDayIndex, idx);
                    setDragDayIndex(-1);
                  }}
                  title={`Drag to reorder (${day})`}
                >
                  {`D${idx + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.total}</td>
                <td>{row.name}</td>
                {shootDays.map((day, idx) => (
                  <td key={`${row.name}-${day}`} className={row.daySet.has(idx) ? "dood-working-cell" : ""}>
                    {row.daySet.has(idx) ? "W" : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
