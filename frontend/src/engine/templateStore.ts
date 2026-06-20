// ── Interview template store — clone-and-adjust, like the Word library ────────
// Built-ins are code (data/interviewTemplates.ts, read-only). Custom
// templates are clones the clinician edits, persisted in localStorage
// (single-user desktop app; survives restarts inside the Tauri webview).
// Storage failures degrade to built-ins only — never block the interview.

import type { InterviewTemplate } from "../types/interviewTemplate";
import { BUILTIN_TEMPLATES } from "../data/interviewTemplates";

const STORAGE_KEY = "interviewTemplates.v1";

// Prefer window.localStorage (webview / jsdom). Node ≥22 exposes a global
// `localStorage` that is non-functional without --localstorage-file and
// would shadow the real one — hence the explicit window check first.
export function storageArea(): Storage | undefined {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // fall through
  }
  return undefined;
}

function readCustom(): InterviewTemplate[] {
  try {
    const raw = storageArea()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InterviewTemplate[]) : [];
  } catch {
    return [];
  }
}

function writeCustom(templates: InterviewTemplate[]): void {
  try {
    storageArea()?.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {
    // Storage unavailable — custom templates live for this session only.
  }
}

export function listTemplates(): InterviewTemplate[] {
  return [...BUILTIN_TEMPLATES, ...readCustom()];
}

export function getTemplate(id: string): InterviewTemplate | undefined {
  return listTemplates().find((t) => t.id === id);
}

/** Clone any template into an editable custom copy. */
export function cloneTemplate(sourceId: string, name?: string): InterviewTemplate | undefined {
  const source = getTemplate(sourceId);
  if (!source) return undefined;
  const clone: InterviewTemplate = {
    ...source,
    id: `custom-${crypto.randomUUID()}`,
    name: name ?? `${source.name} (copy)`,
    builtin: false,
  };
  writeCustom([...readCustom(), clone]);
  return clone;
}

/** Replace a custom template (built-ins are immutable — silently refused). */
export function saveTemplate(template: InterviewTemplate): void {
  if (template.builtin) return;
  const rest = readCustom().filter((t) => t.id !== template.id);
  writeCustom([...rest, template]);
}

export function deleteTemplate(id: string): void {
  writeCustom(readCustom().filter((t) => t.id !== id));
}
