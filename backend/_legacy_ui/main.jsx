import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

/**
 * Best-effort redaction of sensitive information before copying debug data.
 * This is intentionally conservative and only targets clearly identifiable patterns.
 */
function redactObject(obj) {
  if (!obj || typeof obj !== "object") return obj;

  const clone = JSON.parse(JSON.stringify(obj));

  const REDACT_KEYS = [
    "name",
    "patient",
    "dob",
    "dateOfBirth",
    "address",
    "phone",
    "email",
  ];

  function walk(value) {
    if (Array.isArray(value)) {
      return value.map(walk);
    }

    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        const lowerKey = key.toLowerCase();

        if (REDACT_KEYS.includes(lowerKey)) {
          value[key] = "[REDACTED]";
        } else {
          value[key] = walk(value[key]);
        }
      }
    }

    return value;
  }

  return walk(clone);
}

/**
 * Debug copy utility:
 * Copies application debug state (if present) with sensitive data redacted.
 */
async function copyDebugSnapshot() {
  try {
    const raw =
      window.__MEDICO_DEBUG__ ||
      window.__APP_STATE__ ||
      { message: "no debug state available" };

    let redacted = redactObject(raw);
let text = JSON.stringify(redacted, null, 2);

    await navigator.clipboard.writeText(text);

    alert("Debug snapshot copied (redacted).");
  } catch (err) {
    alert("Failed to copy debug snapshot: " + err);
  }
}

/**
 * Floating debug button for rapid sharing of app state.
 */
function DebugCopyButton() {
  return (
    <button
      onClick={copyDebugSnapshot}
      style={{
        position: "fixed",
        bottom: "16px",
        right: "16px",
        padding: "10px 12px",
        background: "#222",
        color: "#fff",
        border: "1px solid #555",
        borderRadius: "8px",
        cursor: "pointer",
        zIndex: 9999,
        fontSize: "12px",
      }}
      title="Copy debug snapshot (redacted)"
    >
      Copy Debug
    </button>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <DebugCopyButton />
  </React.StrictMode>
);