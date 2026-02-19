import { forwardRef, useImperativeHandle, useRef, useState } from "react";

const API_BASE_CANDIDATES = [
  import.meta.env.VITE_API_BASE_URL,
  "http://localhost:8000",
  "http://localhost:8001",
].filter(Boolean);

export const ParseUploader = forwardRef(function ParseUploader({ onParsed, onRescanned, onStatusChange, onProgressChange, showControls = true }, ref) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("replace");
  const inputRef = useRef(null);

  function openPicker(nextMode) {
    if (busy) {
      return;
    }
    setMode(nextMode);
    onStatusChange?.("");
    onProgressChange?.({ active: false, percent: 0, error: false });
    inputRef.current?.click();
  }

  useImperativeHandle(
    ref,
    () => ({
      openImport() {
        openPicker("replace");
      },
      openUpdate() {
        openPicker("rescan");
      },
    }),
    [busy]
  );

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  async function tryJobParse(baseUrl, formData, fileName) {
    const createResponse = await fetch(`${baseUrl}/scripts/parse-jobs`, {
      method: "POST",
      body: formData,
    });

    if (!createResponse.ok) {
      throw new Error(`Parse job creation failed: ${createResponse.status} from ${baseUrl}`);
    }

    const created = await createResponse.json();
    const jobId = created.job_id;
    if (!jobId) {
      throw new Error(`Parse job creation failed: missing job_id from ${baseUrl}`);
    }

    for (let attempt = 0; attempt < 1800; attempt += 1) {
      const statusResponse = await fetch(`${baseUrl}/scripts/parse-jobs/${jobId}`);
      if (!statusResponse.ok) {
        throw new Error(`Parse job polling failed: ${statusResponse.status} from ${baseUrl}`);
      }

      const job = await statusResponse.json();
      const percent = Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0;
      onStatusChange?.(`${job.message || "Processing..."} ${percent}%`);
      onProgressChange?.({ active: job.status !== "completed" && job.status !== "failed", percent, error: job.status === "failed" });

      if (job.status === "completed") {
        return job.result;
      }
      if (job.status === "failed") {
        throw new Error(job.error || `Parse job failed for ${fileName}.`);
      }
      await sleep(350);
    }

    throw new Error(`Parse job timed out for ${fileName}.`);
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");
    onStatusChange?.(`${mode === "rescan" ? "Rescanning" : "Importing"} ${file.name}... 0%`);
    onProgressChange?.({ active: true, percent: 0, error: false });

    try {
      const formData = new FormData();
      formData.append("file", file);

      let payload = null;
      let lastError = null;
      for (const baseUrl of API_BASE_CANDIDATES) {
        try {
          payload = await tryJobParse(baseUrl, formData, file.name);
          break;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          try {
            const fallbackResponse = await fetch(`${baseUrl}/scripts/parse`, {
              method: "POST",
              body: formData,
            });
            if (!fallbackResponse.ok) {
              continue;
            }
            payload = await fallbackResponse.json();
            onStatusChange?.("Processed via fallback parser endpoint. 100%");
            onProgressChange?.({ active: false, percent: 100, error: false });
            break;
          } catch (fallbackError) {
            lastError = fallbackError instanceof Error ? fallbackError : lastError;
          }
        }
      }

      if (!payload) {
        throw (lastError instanceof Error ? lastError : new Error("Unable to reach parser API."));
      }

      if (mode === "rescan") {
        onRescanned?.(payload);
      } else {
        onParsed(payload);
      }
      const sceneCount = Number.isFinite(payload?.scene_count) ? payload.scene_count : (Array.isArray(payload?.scenes) ? payload.scenes.length : 0);
      onStatusChange?.(`Processed ${file.name}: ${sceneCount} scenes (${payload.needs_review_count ?? 0} need review). 100%`);
      onProgressChange?.({ active: false, percent: 100, error: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected parse error.";
      setError(message);
      onStatusChange?.(`Parse error: ${message}`);
      onProgressChange?.({ active: false, percent: 0, error: true });
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="uploader">
      {showControls ? (
        <div className="uploader-actions">
          <button type="button" onClick={() => openPicker("replace")} disabled={busy}>
            {busy && mode === "replace" ? "Importing..." : "Import Script (Replace)"}
          </button>
          <button type="button" onClick={() => openPicker("rescan")} disabled={busy}>
            {busy && mode === "rescan" ? "Rescanning..." : "Rescan Script (Merge Updates)"}
          </button>
        </div>
      ) : null}
      <input
        ref={inputRef}
        id="script-upload"
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        disabled={busy}
        className="hidden-file-input"
      />
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
});
