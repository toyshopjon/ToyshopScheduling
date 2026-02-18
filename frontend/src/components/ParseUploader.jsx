import { useRef, useState } from "react";

const API_URL = "http://localhost:8000/scripts/parse";

export function ParseUploader({ onParsed, onRescanned }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("replace");
  const inputRef = useRef(null);

  function openPicker(nextMode) {
    if (busy) {
      return;
    }
    setMode(nextMode);
    inputRef.current?.click();
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(API_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Parse failed: ${response.status}`);
      }

      const payload = await response.json();
      if (mode === "rescan") {
        onRescanned?.(payload);
      } else {
        onParsed(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected parse error.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  return (
    <div className="uploader">
      <div className="uploader-actions">
        <button type="button" onClick={() => openPicker("replace")} disabled={busy}>
          {busy && mode === "replace" ? "Importing..." : "Import Script (Replace)"}
        </button>
        <button type="button" onClick={() => openPicker("rescan")} disabled={busy}>
          {busy && mode === "rescan" ? "Rescanning..." : "Rescan Script (Merge Updates)"}
        </button>
      </div>
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
}
