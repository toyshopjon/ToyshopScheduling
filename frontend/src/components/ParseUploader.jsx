import { useState } from "react";

const API_URL = "http://localhost:8000/scripts/parse";

export function ParseUploader({ onParsed }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
      onParsed(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected parse error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uploader">
      <label className="upload-label" htmlFor="script-upload">
        {busy ? "Parsing script..." : "Upload screenplay PDF"}
      </label>
      <input id="script-upload" type="file" accept="application/pdf" onChange={handleFileChange} disabled={busy} />
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
