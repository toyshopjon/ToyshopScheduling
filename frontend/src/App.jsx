import { useEffect, useMemo, useRef, useState } from "react";
import { ParseUploader } from "./components/ParseUploader";
import { SceneReviewMode } from "./components/SceneReviewMode";
import { Stripboard } from "./components/Stripboard";

const STORAGE_KEY = "toyshop_scheduling_workspace_v1";
const DEFAULT_SCHEDULE_DAYS = ["Day 1", "Day 2"];
const UNSCHEDULED_DAY = "Unscheduled";
const DEFAULT_STRIP_LAYOUT = {
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
const API_BASE_CANDIDATES = [
  import.meta.env.VITE_API_BASE_URL,
  "http://localhost:8000",
  "http://localhost:8001",
].filter(Boolean);

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
    stripLayout: { ...DEFAULT_STRIP_LAYOUT },
  };
}

function normalizeStripLayout(candidate) {
  if (!candidate || typeof candidate !== "object") return { ...DEFAULT_STRIP_LAYOUT };
  const fieldOrder = Array.isArray(candidate.fieldOrder) && candidate.fieldOrder.length
    ? candidate.fieldOrder
    : DEFAULT_STRIP_LAYOUT.fieldOrder;
  return {
    fieldOrder: [...fieldOrder],
    rowHeight: Number.isFinite(candidate.rowHeight) ? Math.max(22, Math.min(84, candidate.rowHeight)) : DEFAULT_STRIP_LAYOUT.rowHeight,
    colorMode: ["dayNight", "intExt", "none"].includes(candidate.colorMode) ? candidate.colorMode : DEFAULT_STRIP_LAYOUT.colorMode,
    paneSplitPercent: Number.isFinite(candidate.paneSplitPercent) ? Math.max(20, Math.min(80, candidate.paneSplitPercent)) : DEFAULT_STRIP_LAYOUT.paneSplitPercent,
    columnWidths: {
      ...DEFAULT_STRIP_LAYOUT.columnWidths,
      ...(candidate.columnWidths && typeof candidate.columnWidths === "object" ? candidate.columnWidths : {}),
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
            stripLayout: normalizeStripLayout(schedule.stripLayout),
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

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toCsv(values) {
  return (Array.isArray(values) ? values : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(",");
}

function extractDbId(prefixedId, prefix) {
  const raw = String(prefixedId || "");
  if (!raw.startsWith(prefix)) {
    return null;
  }
  const numeric = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isNaN(numeric) ? null : numeric;
}

function buildStripFromParsedScene(scene, index, fallbackIdPrefix = "scene") {
  const scriptText = scene.scene_text || "";
  return {
    id: createId(fallbackIdPrefix),
    sceneNumber: scene.scene_number,
    heading: scene.heading,
    location: scene.location,
    cast: Array.isArray(scene.cast) ? scene.cast : [],
    background: Array.isArray(scene.background) ? scene.background : [],
    needsReview: Boolean(scene.needs_review),
    pageEighths: estimateVisualPageEighths(scriptText),
    estTimeMinutes: Number.isFinite(scene.est_time_minutes) ? Math.max(0, scene.est_time_minutes) : 0,
    intExt: scene.int_ext || inferIntExt(scene.heading),
    timeOfDay: inferTimeOfDay(scene.heading, scene.time_of_day),
    props: [],
    wardrobe: [],
    notes: "",
    scriptText,
    sourceOrder: index,
  };
}

function buildParsedSceneFromStrip(strip, index) {
  return {
    scene_number: Number(strip.sceneNumber) || index + 1,
    heading: strip.heading || "",
    location: strip.location || "",
    int_ext: strip.intExt || inferIntExt(strip.heading),
    time_of_day: strip.timeOfDay || "DAY",
    est_time_minutes: Number.isFinite(strip.estTimeMinutes) ? Math.max(0, strip.estTimeMinutes) : 0,
    scene_text: strip.scriptText || "",
    cast: Array.isArray(strip.cast) ? strip.cast : [],
    background: Array.isArray(strip.background) ? strip.background : [],
    needs_review: Boolean(strip.needsReview),
  };
}

export default function App() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [activeView, setActiveView] = useState("schedule");
  const [reportView, setReportView] = useState("stripboard");
  const [selectedFullScriptSceneId, setSelectedFullScriptSceneId] = useState(null);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [dbStatus, setDbStatus] = useState("");
  const [parseStatus, setParseStatus] = useState("");
  const [parseProgress, setParseProgress] = useState({ active: false, percent: 0, error: false });
  const [trainingAliasCount, setTrainingAliasCount] = useState(0);
  const parseUploaderRef = useRef(null);
  const menuBarRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrainingPreview() {
      try {
        const { payload } = await fetchJson("/dev/review/aliases?element_type=cast");
        const aliases = Array.isArray(payload?.aliases) ? payload.aliases : [];
        if (!cancelled) setTrainingAliasCount(aliases.length);
      } catch {
        if (!cancelled) setTrainingAliasCount(0);
      }
    }
    loadTrainingPreview();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function closeMenusIfOutside(event) {
      const menuBar = menuBarRef.current;
      if (!menuBar) return;
      if (menuBar.contains(event.target)) return;
      for (const node of menuBar.querySelectorAll("details.menu-group[open]")) {
        node.removeAttribute("open");
      }
    }

    function closeMenusOnEscape(event) {
      if (event.key !== "Escape") return;
      const menuBar = menuBarRef.current;
      if (!menuBar) return;
      for (const node of menuBar.querySelectorAll("details.menu-group[open]")) {
        node.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", closeMenusIfOutside);
    document.addEventListener("keydown", closeMenusOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenusIfOutside);
      document.removeEventListener("keydown", closeMenusOnEscape);
    };
  }, []);

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

  async function fetchJson(path, init) {
    let lastError = null;
    for (const baseUrl of API_BASE_CANDIDATES) {
      try {
        const response = await fetch(`${baseUrl}${path}`, init);
        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status} from ${baseUrl}${path}`);
          continue;
        }
        const payload = await response.json();
        return { payload, baseUrl };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error(`Request failed for ${path}`);
  }

  function buildWorkspaceFromDb(projects, schedules, scenesBySchedule) {
    const mappedProjects = projects.map((project, projectIndex) => {
      const projectSchedules = schedules
        .filter((schedule) => schedule.project_id === project.id)
        .map((schedule, scheduleIndex) => {
          const dbScenes = (scenesBySchedule[schedule.id] || []).sort((a, b) => {
            if ((a.source_order ?? 0) !== (b.source_order ?? 0)) {
              return (a.source_order ?? 0) - (b.source_order ?? 0);
            }
            return (a.scene_number ?? 0) - (b.scene_number ?? 0);
          });

          const strips = dbScenes.map((scene, orderIndex) => {
            const scriptText = scene.script_text || "";
            return {
              id: `db-scene-${scene.id}`,
              sceneNumber: scene.scene_number,
              heading: scene.heading,
              location: scene.location || "",
              cast: parseCsvList(scene.cast_csv),
              background: parseCsvList(scene.background_csv),
              needsReview: parseCsvList(scene.cast_csv).length === 0,
              pageEighths: Number.isFinite(scene.page_eighths)
                ? Math.max(1, scene.page_eighths)
                : estimateVisualPageEighths(scriptText),
              estTimeMinutes: Number.isFinite(scene.est_time_minutes) ? Math.max(0, scene.est_time_minutes) : 0,
              intExt: scene.int_ext || inferIntExt(scene.heading),
              timeOfDay: scene.time_of_day || inferTimeOfDay(scene.heading, null),
              props: parseCsvList(scene.props_csv),
              wardrobe: parseCsvList(scene.wardrobe_csv),
              sets: parseCsvList(scene.sets_csv),
              notes: scene.notes || "",
              scriptText,
              sourceOrder: Number.isFinite(scene.source_order) ? scene.source_order : orderIndex,
            };
          });

          return {
            id: `db-schedule-${schedule.id}`,
            name: schedule.name || `Schedule ${scheduleIndex + 1}`,
            days: [UNSCHEDULED_DAY, ...DEFAULT_SCHEDULE_DAYS],
            stripsByDay: {
              [UNSCHEDULED_DAY]: strips,
              "Day 1": [],
              "Day 2": [],
            },
            stripLayout: { ...DEFAULT_STRIP_LAYOUT },
          };
        });

      const fallbackSchedule = createSchedule("Schedule 1");
      const safeSchedules = projectSchedules.length ? projectSchedules : [fallbackSchedule];
      return {
        id: `db-project-${project.id}`,
        name: project.name || `Project ${projectIndex + 1}`,
        schedules: safeSchedules,
        activeScheduleId: safeSchedules[0].id,
      };
    });

    const finalProjects = mappedProjects.length ? mappedProjects : [createProject("Project 1")];
    return {
      projects: finalProjects,
      activeProjectId: finalProjects[0].id,
    };
  }

  async function loadDbWorkspace() {
    setDbStatus("Loading DB data...");
    try {
      const { payload: projectPayload, baseUrl } = await fetchJson("/dev/projects");
      const projects = Array.isArray(projectPayload.projects) ? projectPayload.projects : [];
      const { payload: schedulePayload } = await fetchJson("/dev/schedules");
      const schedules = Array.isArray(schedulePayload.schedules) ? schedulePayload.schedules : [];

      const scenesBySchedule = {};
      await Promise.all(
        schedules.map(async (schedule) => {
          const { payload } = await fetchJson(`/dev/schedules/${schedule.id}/scenes`);
          scenesBySchedule[schedule.id] = Array.isArray(payload.scenes) ? payload.scenes : [];
        })
      );

      setWorkspace(buildWorkspaceFromDb(projects, schedules, scenesBySchedule));
      setActiveView("schedule");
      setReportView("stripboard");
      setDbStatus(`Loaded DB data from ${baseUrl}`);
    } catch (error) {
      setDbStatus(`DB load failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async function seedAndLoadDbWorkspace() {
    setDbStatus("Seeding DB test data...");
    try {
      await fetchJson("/dev/seed-test-data", { method: "POST" });
      await loadDbWorkspace();
    } catch (error) {
      setDbStatus(`Seed failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async function saveActiveScheduleToDb() {
    if (!activeProject || !activeSchedule) {
      return;
    }

    const dbScheduleId = extractDbId(activeSchedule.id, "db-schedule-");
    if (!dbScheduleId) {
      setDbStatus("Save failed: active schedule is not DB-backed. Use Load Test Data first.");
      return;
    }

    try {
      setDbStatus("Saving active schedule to DB...");
      const sceneRows = Object.values(activeSchedule.stripsByDay)
        .flat()
        .sort((a, b) => {
          const aOrder = Number.isFinite(a.sourceOrder) ? a.sourceOrder : Number.MAX_SAFE_INTEGER;
          const bOrder = Number.isFinite(b.sourceOrder) ? b.sourceOrder : Number.MAX_SAFE_INTEGER;
          if (aOrder !== bOrder) {
            return aOrder - bOrder;
          }
          return Number(a.sceneNumber) - Number(b.sceneNumber);
        })
        .map((scene, index) => ({
          scene_number: Number(scene.sceneNumber) || index + 1,
          heading: scene.heading || "",
          location: scene.location || "",
          int_ext: scene.intExt || "INT",
          time_of_day: scene.timeOfDay || "DAY",
          page_eighths: Number.isFinite(scene.pageEighths) ? scene.pageEighths : 1,
          est_time_minutes: Number.isFinite(scene.estTimeMinutes) ? Math.max(0, scene.estTimeMinutes) : 0,
          cast_csv: toCsv(scene.cast),
          background_csv: toCsv(scene.background),
          props_csv: toCsv(scene.props),
          wardrobe_csv: toCsv(scene.wardrobe),
          sets_csv: toCsv(scene.sets),
          notes: scene.notes || "",
          script_text: scene.scriptText || "",
          source_order: Number.isFinite(scene.sourceOrder) ? scene.sourceOrder : index,
        }));

      const { payload } = await fetchJson(`/dev/schedules/${dbScheduleId}/scenes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes: sceneRows }),
      });
      setDbStatus(`Saved ${payload.saved_scenes ?? sceneRows.length} scenes to DB schedule ${dbScheduleId}`);
    } catch (error) {
      setDbStatus(`Save failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  async function saveReviewFeedback(payload) {
    try {
      await fetchJson("/dev/review/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // Keep review flow non-blocking if feedback API is unavailable.
    }
  }

  async function saveManualAliasCorrection(payload) {
    try {
      await fetchJson("/dev/review/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { payload: aliasPayload } = await fetchJson("/dev/review/aliases?element_type=cast");
      const aliases = Array.isArray(aliasPayload?.aliases) ? aliasPayload.aliases : [];
      setTrainingAliasCount(aliases.length);
      setDbStatus(`Saved training correction: ${payload.alias} -> ${payload.canonical}`);
    } catch (error) {
      setDbStatus(`Training correction failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

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

  function startReview(parsedScenes) {
    setReviewQueue(Array.isArray(parsedScenes) ? parsedScenes : []);
    setActiveView("review");
  }

  function startReviewFromCurrentSchedule() {
    const parsedScenes = Object.values(activeSchedule.stripsByDay)
      .flat()
      .sort((a, b) => {
        const aOrder = Number.isFinite(a.sourceOrder) ? a.sourceOrder : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(b.sourceOrder) ? b.sourceOrder : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return Number(a.sceneNumber) - Number(b.sceneNumber);
      })
      .map((strip, index) => buildParsedSceneFromStrip(strip, index));

    if (!parsedScenes.length) {
      setDbStatus("No scenes available to review. Import or load scenes first.");
      return;
    }

    startReview(parsedScenes);
  }

  function applyReviewedScenes(reviewedScenes) {
    const unscheduled = (Array.isArray(reviewedScenes) ? reviewedScenes : []).map((scene, index) => {
      const scriptText = scene.scene_text || "";
      return {
        id: createId("reviewed"),
        sceneNumber: scene.scene_number,
        heading: scene.heading,
        location: scene.location || "",
        cast: Array.isArray(scene.cast) ? scene.cast : [],
        background: Array.isArray(scene.background) ? scene.background : [],
        needsReview: !(Array.isArray(scene.cast) && scene.cast.length),
        pageEighths: estimateVisualPageEighths(scriptText),
        estTimeMinutes: Number.isFinite(scene.est_time_minutes) ? Math.max(0, scene.est_time_minutes) : 0,
        intExt: scene.int_ext || inferIntExt(scene.heading),
        timeOfDay: inferTimeOfDay(scene.heading, scene.time_of_day),
        props: Array.isArray(scene.props) ? scene.props : [],
        wardrobe: Array.isArray(scene.wardrobe) ? scene.wardrobe : [],
        sets: Array.isArray(scene.sets) ? scene.sets : [],
        notes: scene.notes || "",
        scriptText,
        sourceOrder: Number.isFinite(scene.source_order) ? scene.source_order : index,
      };
    });

    updateActiveSchedule((schedule) => {
      const scheduledDays = schedule.days.filter((day) => day !== UNSCHEDULED_DAY);
      const days = [UNSCHEDULED_DAY, ...scheduledDays];
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
            background: Array.isArray(scene.background) ? scene.background : (matched.strip.background || []),
            needsReview: Boolean(scene.needs_review),
            intExt: scene.int_ext || inferIntExt(scene.heading),
            timeOfDay: inferTimeOfDay(scene.heading, scene.time_of_day),
            scriptText: scene.scene_text || "",
            pageEighths: estimateVisualPageEighths(scene.scene_text || ""),
            estTimeMinutes: Number.isFinite(scene.est_time_minutes) ? Math.max(0, scene.est_time_minutes) : (matched.strip.estTimeMinutes || 0),
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

  function setStripLayoutForActiveSchedule(nextLayout) {
    updateActiveSchedule((schedule) => ({
      ...schedule,
      stripLayout: normalizeStripLayout(nextLayout),
    }));
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
          stripLayout: normalizeStripLayout(activeSchedule.stripLayout),
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
        <div className="menu-bar" ref={menuBarRef}>
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
              <button type="button" onClick={startReviewFromCurrentSchedule}>Scene Review</button>
              <button type="button" onClick={seedAndLoadDbWorkspace}>Seed Test Data</button>
              <button type="button" onClick={loadDbWorkspace}>Load Test Data</button>
              <button type="button" onClick={saveActiveScheduleToDb}>Save Active Schedule to DB</button>
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
          onStatusChange={setParseStatus}
          onProgressChange={(progress) => {
            setParseProgress({
              active: Boolean(progress?.active),
              percent: Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0,
              error: Boolean(progress?.error),
            });
          }}
          onParsed={(payload) => {
            startReview(payload.scenes);
          }}
          onRescanned={(payload) => {
            startReview(payload.scenes);
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
                : activeView === "fullScript"
                  ? "Full Script"
                  : "Review"}
          </span>
          {dbStatus ? <span><strong>DB:</strong> {dbStatus}</span> : null}
          <span><strong>Training Aliases:</strong> {trainingAliasCount}</span>
          {parseStatus ? (
            <span className="parse-status-wrap">
              <strong>Parse:</strong> {parseStatus}
              <span className={parseProgress.error ? "parse-progress is-error" : "parse-progress"}>
                <span style={{ width: `${parseProgress.percent}%` }} />
              </span>
            </span>
          ) : null}
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
                  <p><strong>Est. Time:</strong> {selectedFullScriptScene.estTimeMinutes || 0} min</p>
                  <p><strong>Cast:</strong> {(selectedFullScriptScene.cast ?? []).join(", ") || "None"}</p>
                  <p><strong>Background:</strong> {(selectedFullScriptScene.background ?? []).join(", ") || "None"}</p>
                  <p><strong>Props:</strong> {(selectedFullScriptScene.props ?? []).join(", ") || "None"}</p>
                  <p><strong>Wardrobe:</strong> {(selectedFullScriptScene.wardrobe ?? []).join(", ") || "None"}</p>
                  <p><strong>Sets:</strong> {(selectedFullScriptScene.sets ?? []).join(", ") || "None"}</p>
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
            layoutConfig={activeSchedule.stripLayout}
            onSaveLayoutConfig={setStripLayoutForActiveSchedule}
            onReturnToStripView={() => {
              setActiveView("schedule");
              setReportView("stripboard");
            }}
          />
        </section>
      ) : null}

      {activeView === "review" ? (
        <SceneReviewMode
          parsedScenes={reviewQueue}
          onSaveFeedback={saveReviewFeedback}
          onSaveAlias={saveManualAliasCorrection}
          onComplete={(reviewedScenes) => {
            applyReviewedScenes(reviewedScenes);
            setReviewQueue([]);
            setActiveView("schedule");
            setReportView("stripboard");
          }}
          onCancel={() => {
            setReviewQueue([]);
            setActiveView("schedule");
          }}
        />
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
            layoutConfig={activeSchedule.stripLayout}
            onSaveLayoutConfig={setStripLayoutForActiveSchedule}
          />
        </section>
      ) : null}
    </main>
  );
}
