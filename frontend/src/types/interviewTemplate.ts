// ── Interview templates — the template IS the interview script ────────────────
// Mirrors the clinician's Word workflow: a matter-type template, stripped to
// what the report needs, read top-to-bottom during the interview. Here the
// template renders as a live scrolling canvas with coverage tracking, instead
// of a static document.
//
// Templates are fully configurable: built-ins ship per matter type; the
// clinician clones and adjusts them like their Word template library.

export type InterviewSectionKind =
  | "symptomDomain" // probe chips from a Current Symptoms domain
  | "narrative" // free-history section covered by conversation (manual tick)
  | "mse" // observed-frame examination (links to MSE tab)
  | "pirs"; // PIRS worksheets (links to PIRS tab; shown only when required)

export type InterviewSection = {
  readonly id: string;
  readonly kind: InterviewSectionKind;
  readonly title: string;
  /** symptomDomain only: SYMPTOM_DOMAINS id. */
  readonly domainId?: string;
  /** symptomDomain only: subset of the domain's symptomEntityIds to probe.
   *  Omitted = every symptom in the domain. */
  readonly probeIds?: readonly string[];
  /** Short prompt shown under the title (what to cover in conversation). */
  readonly prompt?: string;
};

export type InterviewTemplate = {
  readonly id: string;
  readonly name: string;
  /** Built-ins are read-only; clones are editable + persisted locally. */
  readonly builtin: boolean;
  readonly sections: readonly InterviewSection[];
};
