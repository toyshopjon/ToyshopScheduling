import { useMemo, useState } from "react";
import { ParseUploader } from "./components/ParseUploader";
import { Stripboard } from "./components/Stripboard";

const DEFAULT_SCHEDULE_DAYS = ["Day 1", "Day 2"];
const UNSCHEDULED_DAY = "Unscheduled";

export default function App() {
  const [days, setDays] = useState([...DEFAULT_SCHEDULE_DAYS, UNSCHEDULED_DAY]);
  const [stripsByDay, setStripsByDay] = useState({
    "Day 1": [],
    "Day 2": [],
    [UNSCHEDULED_DAY]: [],
  });

  const allStrips = useMemo(() => Object.values(stripsByDay).flat(), [stripsByDay]);
  const totalScenes = allStrips.length;
  const needsReview = useMemo(
    () => allStrips.filter((strip) => strip.needsReview).length,
    [allStrips]
  );

  function hydrateStrips(parsedScenes) {
    const unscheduled = parsedScenes.map((scene, index) => ({
      id: `scene-${scene.scene_number}-${index}`,
      sceneNumber: scene.scene_number,
      heading: scene.heading,
      location: scene.location,
      cast: scene.cast,
      needsReview: scene.needs_review,
    }));
    setStripsByDay(() => {
      const next = {};
      for (const day of days) {
        next[day] = [];
      }
      next[UNSCHEDULED_DAY] = unscheduled;
      return next;
    });
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <h1>Toyshop Scheduling</h1>
        <p>Upload screenplay PDFs, review scene extraction, and build a schedule with stripboard overrides.</p>
      </header>

      <section className="panel">
        <ParseUploader
          onParsed={(payload) => {
            hydrateStrips(payload.scenes);
          }}
        />
        <div className="stats">
          <strong>Scenes:</strong> {totalScenes}
          <span><strong>Needs Review:</strong> {needsReview}</span>
        </div>
      </section>

      <section className="panel">
        <Stripboard days={days} setDays={setDays} stripsByDay={stripsByDay} setStripsByDay={setStripsByDay} />
      </section>
    </main>
  );
}
