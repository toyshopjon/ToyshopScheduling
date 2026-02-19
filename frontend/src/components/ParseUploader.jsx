import { forwardRef, useImperativeHandle, useRef, useState } from "react";

const API_BASE_CANDIDATES = [
  import.meta.env.VITE_API_BASE_URL,
  "http://localhost:8000",
  "http://localhost:8001",
].filter(Boolean);

export const ParseUploader = forwardRef(function ParseUploader({ onParsed, onRescanned, onStatusChange, showControls = true }, ref) {
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

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");
    onStatusChange?.(`${mode === "rescan" ? "Rescanning" : "Importing"} ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append("file", file);

      let payload = null;
      let lastError = null;
      for (const baseUrl of API_BASE_CANDIDATES) {
        try {
          const response = await fetch(`${baseUrl}/scripts/parse`, {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            lastError = new Error(`Parse failed: ${response.status} from ${baseUrl}`);
            continue;
          }
          payload = await response.json();
          break;
        } catch (err) {
          lastError = err;
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
      onStatusChange?.(`Processed ${file.name}: ${payload.scene_count ?? 0} scenes (${payload.needs_review_count ?? 0} need review).`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected parse error.";
      setError(message);
      onStatusChange?.(`Parse error: ${message}`);
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
