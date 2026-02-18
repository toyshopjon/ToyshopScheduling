import { useEffect, useMemo, useRef, useState } from "react";
import { ParseUploader } from "./components/ParseUploader";
import { Stripboard } from "./components/Stripboard";

const STORAGE_KEY = "toyshop_scheduling_workspace_v1";
const DEFAULT_SCHEDULE_DAYS = ["Day 1", "Day 2"];
const UNSCHEDULED_DAY = "Unscheduled";

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHeading(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function inferIntExt(heading) {
  const normalized = String(heading || "").toUpperCase();
  if (normalized.includes("INT/EXT") || normalized.includes("EXT/INT")) {
    return "INT/EXT";
  }
  if (normalized.includes("INT.")) {
    return "INT";
  }
  if (normalized.includes("EXT.")) {
    return "EXT";
  }
  return "INT";
}

function inferTimeOfDay(heading, parserTimeOfDay) {
  if (parserTimeOfDay) {
    return String(parserTimeOfDay).toUpperCase();
  }
  const normalized = String(heading || "").toUpperCase();
  const knownTimes = ["DAY", "NIGHT", "DAWN", "DUSK", "MORNING", "EVENING", "SUNRISE", "SUNSET"];
  for (const timeValue of knownTimes) {
    if (normalized.includes(timeValue)) {
      return timeValue;
    }
  }
  return "DAY";
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

function formatPageEighths(totalEighths) {
  const safeTotal = Number.isFinite(totalEighths) ? Math.max(0, totalEighths) : 0;
  const whole = Math.floor(safeTotal / 8);
  const eighths = safeTotal % 8;
  return `${whole} ${eighths}/8`;
}

function createSchedule(name) {
  return {
    id: createId("schedule"),
    name,
    days: [...DEFAULT_SCHEDULE_DAYS, UNSCHEDULED_DAY],
    stripsByDay: {
      "Day 1": [],
      "Day 2": [],
      [UNSCHEDULED_DAY]: [],
    },
  };
}

function createProject(name) {
  const firstSchedule = createSchedule("Schedule 1");
  return {
    id: createId("project"),
    name,
    schedules: [firstSchedule],
    activeScheduleId: firstSchedule.id,
  };
}

function createInitialWorkspace() {
  const firstProject = createProject("Project 1");
  return {
    projects: [firstProject],
    activeProjectId: firstProject.id,
  };
}

function normalizeWorkspace(candidate) {
  if (!candidate || !Array.isArray(candidate.projects) || !candidate.projects.length) {
    return createInitialWorkspace();
  }

  const projects = candidate.projects.map((project, projectIndex) => {
    const schedules = Array.isArray(project.schedules) && project.schedules.length
      ? project.schedules.map((schedule, scheduleIndex) => {
          const days = Array.isArray(schedule.days) && schedule.days.length
            ? schedule.days.includes(UNSCHEDULED_DAY)
              ? [...schedule.days]
              : [...schedule.days, UNSCHEDULED_DAY]
            : [...DEFAULT_SCHEDULE_DAYS, UNSCHEDULED_DAY];

          const stripsByDay = { ...(schedule.stripsByDay || {}) };
          for (const day of days) {
            stripsByDay[day] = Array.isArray(stripsByDay[day]) ? stripsByDay[day] : [];
          }

          return {
            id: schedule.id || createId(`schedule-${projectIndex}-${scheduleIndex}`),
            name: schedule.name || `Schedule ${scheduleIndex + 1}`,
            days,
            stripsByDay,
          };
        })
      : [createSchedule("Schedule 1")];

    const activeScheduleId = schedules.some((schedule) => schedule.id === project.activeScheduleId)
      ? project.activeScheduleId
      : schedules[0].id;

    return {
      id: project.id || createId(`project-${projectIndex}`),
      name: project.name || `Project ${projectIndex + 1}`,
      schedules,
      activeScheduleId,
    };
  });

  const activeProjectId = projects.some((project) => project.id === candidate.activeProjectId)
    ? candidate.activeProjectId
    : projects[0].id;

  return { projects, activeProjectId };
}

function loadWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return createInitialWorkspace();
    }
    return normalizeWorkspace(JSON.parse(stored));
  } catch {
    return createInitialWorkspace();
  }
}

function buildStripFromParsedScene(scene, index, fallbackIdPrefix = "scene") {
  const scriptText = scene.scene_text || "";
  return {
    id: createId(fallbackIdPrefix),
    sceneNumber: scene.scene_number,
    heading: scene.heading,
    location: scene.location,
    cast: Array.isArray(scene.cast) ? scene.cast : [],
    needsReview: Boolean(scene.needs_review),
    pageEighths: estimateVisualPageEighths(scriptText),
    intExt: inferIntExt(scene.heading),
    timeOfDay: inferTimeOfDay(scene.heading, scene.time_of_day),
    props: [],
    wardrobe: [],
    notes: "",
    scriptText,
    sourceOrder: index,
  };
}

export default function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [activeView, setActiveView] = useState("schedule");
  const [reportView, setReportView] = useState("stripboard");
  const [selectedFullScriptSceneId, setSelectedFullScriptSceneId] = useState(null);
  const parseUploaderRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  const activeProject = useMemo(() => {
    return workspace.projects.find((project) => project.id === workspace.activeProjectId) ?? workspace.projects[0];
  }, [workspace]);

  const activeSchedule = useMemo(() => {
    if (!activeProject) {
      return null;
    }
    return (
      activeProject.schedules.find((schedule) => schedule.id === activeProject.activeScheduleId) ?? activeProject.schedules[0]
    );
  }, [activeProject]);

  const allStrips = useMemo(() => {
    if (!activeSchedule) {
      return [];
    }
    return Object.values(activeSchedule.stripsByDay).flat();
  }, [activeSchedule]);

  const sortedScenes = useMemo(() => {
    return [...allStrips].sort((a, b) => {
      const aOrder = Number.isFinite(a.sourceOrder) ? a.sourceOrder : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(b.sourceOrder) ? b.sourceOrder : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }
      return Number(a.sceneNumber) - Number(b.sceneNumber);
    });
  }, [allStrips]);

  useEffect(() => {
    if (!sortedScenes.length) {
      setSelectedFullScriptSceneId(null);
      return;
    }
    if (!sortedScenes.some((scene) => scene.id === selectedFullScriptSceneId)) {
      setSelectedFullScriptSceneId(sortedScenes[0].id);
    }
  }, [selectedFullScriptSceneId, sortedScenes]);

  const selectedFullScriptScene = useMemo(
    () => sortedScenes.find((scene) => scene.id === selectedFullScriptSceneId) ?? null,
    [selectedFullScriptSceneId, sortedScenes]
  );

  const needsReview = useMemo(() => allStrips.filter((strip) => strip.needsReview).length, [allStrips]);

  function updateActiveSchedule(mutator) {
    setWorkspace((prev) => {
      const projects = prev.projects.map((project) => {
        if (project.id !== prev.activeProjectId) {
          return project;
        }

        const schedules = project.schedules.map((schedule) => {
          if (schedule.id !== project.activeScheduleId) {
            return schedule;
          }
          return mutator(schedule);
        });

        return { ...project, schedules };
      });

      return { ...prev, projects };
    });
  }

  function hydrateStrips(parsedScenes) {
    const unscheduled = parsedScenes.map((scene, index) => buildStripFromParsedScene(scene, index, "scene"));

    updateActiveSchedule((schedule) => {
      const scheduledDays = schedule.days.filter((day) => day !== UNSCHEDULED_DAY);
      const days = [...scheduledDays, UNSCHEDULED_DAY];
      const stripsByDay = {};
      for (const day of days) {
        stripsByDay[day] = [];
      }
      stripsByDay[UNSCHEDULED_DAY] = unscheduled;
      return { ...schedule, days, stripsByDay };
    });
  }

  function rescanAndMergeStrips(parsedScenes) {
    updateActiveSchedule((schedule) => {
      const indexedExisting = new Map();

      for (const [day, strips] of Object.entries(schedule.stripsByDay)) {
        for (let index = 0; index < strips.length; index += 1) {
          const strip = strips[index];
          const key = `${String(strip.sceneNumber)}|${normalizeHeading(strip.heading)}`;
          if (!indexedExisting.has(key)) {
            indexedExisting.set(key, []);
          }
          indexedExisting.get(key).push({ day, index, strip });
        }
      }

      const replacementsById = new Map();
      const newStrips = [];

      parsedScenes.forEach((scene, orderIndex) => {
        const key = `${String(scene.scene_number)}|${normalizeHeading(scene.heading)}`;
        const bucket = indexedExisting.get(key);
        const matched = bucket && bucket.length ? bucket.shift() : null;

        if (matched) {
          replacementsById.set(matched.strip.id, {
            ...matched.strip,
            sceneNumber: scene.scene_number,
            heading: scene.heading,
            location: scene.location,
            cast: Array.isArray(scene.cast) ? scene.cast : [],
            needsReview: Boolean(scene.needs_review),
            intExt: inferIntExt(scene.heading),
            timeOfDay: inferTimeOfDay(scene.heading, scene.time_of_day),
            scriptText: scene.scene_text || "",
            pageEighths: estimateVisualPageEighths(scene.scene_text || ""),
            sourceOrder: orderIndex,
          });
          return;
        }

        newStrips.push(buildStripFromParsedScene(scene, orderIndex, "rescanned"));
      });

      const nextStripsByDay = Object.fromEntries(
        Object.entries(schedule.stripsByDay).map(([day, strips]) => [
          day,
          strips.map((strip) => replacementsById.get(strip.id) || strip),
        ])
      );

      const existingUnscheduled = (nextStripsByDay[UNSCHEDULED_DAY] ?? []).map((strip) => {
        if (Number.isFinite(strip.sourceOrder)) {
          return strip;
        }
        return { ...strip, sourceOrder: Number.MAX_SAFE_INTEGER };
      });

      const mergedUnscheduled = [...existingUnscheduled, ...newStrips].sort((a, b) => {
        if (a.sourceOrder !== b.sourceOrder) {
          return a.sourceOrder - b.sourceOrder;
        }
        const aScene = Number.parseInt(String(a.sceneNumber), 10);
        const bScene = Number.parseInt(String(b.sceneNumber), 10);
        if (!Number.isNaN(aScene) && !Number.isNaN(bScene) && aScene !== bScene) {
          return aScene - bScene;
        }
        return normalizeHeading(a.heading).localeCompare(normalizeHeading(b.heading));
      });

      nextStripsByDay[UNSCHEDULED_DAY] = mergedUnscheduled;

      const days = schedule.days.includes(UNSCHEDULED_DAY)
        ? schedule.days
        : [...schedule.days, UNSCHEDULED_DAY];

      return {
        ...schedule,
        days,
        stripsByDay: nextStripsByDay,
      };
    });
  }

  function setDaysForActiveSchedule(nextDaysOrUpdater) {
    updateActiveSchedule((schedule) => {
      const nextDays = typeof nextDaysOrUpdater === "function" ? nextDaysOrUpdater(schedule.days) : nextDaysOrUpdater;
      const normalized = nextDays.includes(UNSCHEDULED_DAY)
        ? [...nextDays]
        : [...nextDays.filter((day) => day !== UNSCHEDULED_DAY), UNSCHEDULED_DAY];

      const nextStripsByDay = { ...schedule.stripsByDay };
      for (const day of normalized) {
        nextStripsByDay[day] = Array.isArray(nextStripsByDay[day]) ? nextStripsByDay[day] : [];
      }

      return {
        ...schedule,
        days: normalized,
        stripsByDay: nextStripsByDay,
      };
    });
  }

  function setStripsForActiveSchedule(nextStripsOrUpdater) {
    updateActiveSchedule((schedule) => {
      const next = typeof nextStripsOrUpdater === "function"
        ? nextStripsOrUpdater(schedule.stripsByDay)
        : nextStripsOrUpdater;

      const normalized = { ...next };
      for (const day of schedule.days) {
        normalized[day] = Array.isArray(normalized[day]) ? normalized[day] : [];
      }

      return {
        ...schedule,
        stripsByDay: normalized,
      };
    });
  }

  function addProject() {
    setWorkspace((prev) => {
      const nextProject = createProject(`Project ${prev.projects.length + 1}`);
      return {
        projects: [...prev.projects, nextProject],
        activeProjectId: nextProject.id,
      };
    });
  }

  function renameActiveProject() {
    if (!activeProject) {
      return;
    }
    const nextName = window.prompt("Rename project", activeProject.name);
    if (!nextName || !nextName.trim()) {
      return;
    }

    setWorkspace((prev) => {
      const projects = prev.projects.map((project) =>
        project.id === prev.activeProjectId ? { ...project, name: nextName.trim() } : project
      );
      return { ...prev, projects };
    });
  }

  function renameActiveSchedule() {
    if (!activeProject || !activeSchedule) {
      return;
    }
    const nextName = window.prompt("Rename schedule", activeSchedule.name);
    if (!nextName || !nextName.trim()) {
      return;
    }

    setWorkspace((prev) => {
      const projects = prev.projects.map((project) => {
        if (project.id !== prev.activeProjectId) {
          return project;
        }
        const schedules = project.schedules.map((schedule) =>
          schedule.id === project.activeScheduleId ? { ...schedule, name: nextName.trim() } : schedule
        );
        return { ...project, schedules };
      });
      return { ...prev, projects };
    });
  }

  function duplicateSchedule() {
    if (!activeProject || !activeSchedule) {
      return;
    }

    setWorkspace((prev) => {
      const projects = prev.projects.map((project) => {
        if (project.id !== prev.activeProjectId) {
          return project;
        }

        const copyNumber = project.schedules.length + 1;
        const scheduleCopy = {
          id: createId("schedule"),
          name: `${activeSchedule.name} Copy ${copyNumber}`,
          days: [...activeSchedule.days],
          stripsByDay: JSON.parse(JSON.stringify(activeSchedule.stripsByDay)),
        };

        return {
          ...project,
          schedules: [...project.schedules, scheduleCopy],
          activeScheduleId: scheduleCopy.id,
        };
      });

      return { ...prev, projects };
    });
  }

  if (!activeProject || !activeSchedule) {
    return null;
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>Toyshop Scheduling</h1>
        <p>Upload screenplay PDFs, review scene extraction, and build versioned stripboard schedules.</p>
      </header>

      <section className="panel menu-bar-panel">
        <div className="menu-bar">
          <details className="menu-group">
            <summary>File</summary>
            <div className="menu-content">
              <button type="button" onClick={addProject}>New Project</button>
              <label>
                Project Select
                <select
                  value={activeProject.id}
                  onChange={(event) => setWorkspace((prev) => ({ ...prev, activeProjectId: event.target.value }))}
                >
                  {workspace.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={renameActiveProject}>Rename Project</button>
              <button type="button" onClick={() => parseUploaderRef.current?.openImport()}>Import Script</button>
              <button type="button" onClick={() => parseUploaderRef.current?.openUpdate()}>Update Script</button>
            </div>
          </details>

          <details className="menu-group">
            <summary>Elements</summary>
            <div className="menu-content">
              <button type="button" onClick={() => setActiveView("elements")}>Elements View</button>
              <button type="button" onClick={() => setActiveView("fullScript")}>Full Script</button>
            </div>
          </details>

          <details className="menu-group">
            <summary>Reports</summary>
            <div className="menu-content">
              <button type="button" onClick={() => { setActiveView("schedule"); setReportView("stripboard"); }}>Stripboard</button>
              <button type="button" onClick={() => { setActiveView("schedule"); setReportView("dood"); }}>DooD</button>
              <button type="button" onClick={() => { setActiveView("schedule"); setReportView("character"); }}>Character Report</button>
            </div>
          </details>

          <label className="menu-inline">
            Schedule
            <select
              value={activeSchedule.id}
              onChange={(event) => {
                const nextScheduleId = event.target.value;
                setWorkspace((prev) => {
                  const projects = prev.projects.map((project) => {
                    if (project.id !== prev.activeProjectId) {
                      return project;
                    }
                    return { ...project, activeScheduleId: nextScheduleId };
                  });
                  return { ...prev, projects };
                });
              }}
            >
              {activeProject.schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={renameActiveSchedule}>Rename Schedule</button>
          <button type="button" onClick={duplicateSchedule}>Duplicate Schedule</button>
        </div>

        <ParseUploader
          ref={parseUploaderRef}
          showControls={false}
          onParsed={(payload) => {
            hydrateStrips(payload.scenes);
          }}
          onRescanned={(payload) => {
            rescanAndMergeStrips(payload.scenes);
          }}
        />
        <div className="stats">
          <strong>Scenes:</strong> {allStrips.length}
          <span><strong>Needs Review:</strong> {needsReview}</span>
          <span>
            <strong>View:</strong>{" "}
            {activeView === "schedule"
              ? reportView === "stripboard"
                ? "Stripboard"
                : reportView === "dood"
                  ? "DooD"
                  : "Character Report"
              : activeView === "elements"
                ? "Elements View"
                : "Full Script"}
          </span>
        </div>
      </section>

      {activeView === "fullScript" ? (
        <section className="panel">
          <h3>Full Script</h3>
          <div className="full-script-layout">
            <div className="full-script-scene-list">
              {sortedScenes.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  className={selectedFullScriptSceneId === scene.id ? "entity-item active" : "entity-item"}
                  onClick={() => setSelectedFullScriptSceneId(scene.id)}
                >
                  <span>Scene {scene.sceneNumber}</span>
                  <span>{scene.heading}</span>
                </button>
              ))}
            </div>
            <div>
              {!selectedFullScriptScene ? (
                <p>No scene selected.</p>
              ) : (
                <div className="full-script-detail">
                  <h4>Scene {selectedFullScriptScene.sceneNumber}</h4>
                  <p><strong>Heading:</strong> {selectedFullScriptScene.heading}</p>
                  <p><strong>Location:</strong> {selectedFullScriptScene.location}</p>
                  <p><strong>INT/EXT:</strong> {selectedFullScriptScene.intExt}</p>
                  <p><strong>Time:</strong> {selectedFullScriptScene.timeOfDay}</p>
                  <p><strong>Page Count:</strong> {formatPageEighths(selectedFullScriptScene.pageEighths)}</p>
                  <p><strong>Cast:</strong> {(selectedFullScriptScene.cast ?? []).join(", ") || "None"}</p>
                  <p><strong>Props:</strong> {(selectedFullScriptScene.props ?? []).join(", ") || "None"}</p>
                  <p><strong>Wardrobe:</strong> {(selectedFullScriptScene.wardrobe ?? []).join(", ") || "None"}</p>
                  <p><strong>Notes:</strong> {selectedFullScriptScene.notes || "None"}</p>
                  <pre className="full-script-scene-text">{selectedFullScriptScene.scriptText || ""}</pre>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {activeView === "elements" ? (
        <section className="panel">
          <Stripboard
            days={activeSchedule.days}
            setDays={setDaysForActiveSchedule}
            stripsByDay={activeSchedule.stripsByDay}
            setStripsByDay={setStripsForActiveSchedule}
            showElementsView
            reportView="none"
            showWorkbench={false}
          />
        </section>
      ) : null}

      {activeView === "schedule" ? (
        <section className="panel">
          {reportView === "dood" ? (
            <div className="report-placeholder">
              <h3>DooD Report</h3>
              <p>DooD view scaffold is selected. Scene-day assignment data is ready for report formatting.</p>
            </div>
          ) : null}
          {reportView === "character" ? (
            <div className="report-placeholder">
              <h3>Character Report</h3>
              <p>Use Elements View to drill by cast now; printable character report formatting is next.</p>
            </div>
          ) : null}
          <Stripboard
            days={activeSchedule.days}
            setDays={setDaysForActiveSchedule}
            stripsByDay={activeSchedule.stripsByDay}
            setStripsByDay={setStripsForActiveSchedule}
            showElementsView={false}
            reportView={reportView}
            showWorkbench
          />
        </section>
      ) : null}
    </main>
  );
}
