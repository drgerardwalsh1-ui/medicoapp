# MedicoApp — Product Requirements Document & Architecture Blueprint

**Version:** 1.0 · **Date:** 2026-06-13 · **Status:** Draft for review
**Audience:** Consultant psychiatrist / forensic expert (single primary user), future associates

---

## 1. Executive Summary

MedicoApp is a fully **offline, local-only desktop application** (Tauri + React) for producing
psychiatric medicolegal reports: NSW PIC Motor (threshold injury, WPI, combined), NSW Workers
Compensation (WPI / treatment / earnings), Work Injury Damages (WID), Medilaw/HPL referrals, and
Queensland matters (NSW PIRS methodology, non-PIC templates). It replaces the current
Word-MasterTemplate + Excel/VBA workflow with an application that **fully owns document
generation** and is optimised for **live videoconference assessments**.

Three architectural pillars:

1. **Data Schema** — a canonical, event-sourced clinical fact store from which every report
   section (Current Symptoms, MSE, Past History, DSM-5-TR criteria, PIRS) is a *projection*.
   Facts are entered once and propagate everywhere, while preserving the clinical distinction
   between **reported symptom** and **observed sign**.
2. **UX/UI** — a keyboard-first live-assessment workspace designed around the real interview
   layout: video call pinned top-left, app occupying the remainder of a laptop screen, with
   context-aware chips/buttons that eliminate repeated data entry. No dictation (not permitted).
3. **NLP/Ingestion** — a zero-hallucination, fully local pipeline (OCR → deterministic
   extraction → provenance-bound facts → contradiction analysis) that *fails closed*: any fact
   below certainty threshold is visually flagged for manual verification during the interview,
   never silently asserted.

A fourth, cross-cutting deliverable — **app-owned document generation** — retires
`MasterTemplate.docx` by reverse-engineering its 339 content controls and conditional
matter-type blocks into a typed section model rendered directly to DOCX.

---

## 2. Users, Context & Constraints

| Item | Decision (confirmed by user) |
|---|---|
| User | Consultant psychiatrist performing forensic/medicolegal assessments |
| Assessment mode | Laptop, videoconference; client video top-left corner; app fills remaining screen |
| Input modality | Keyboard + touch-typing only — **no dictation/voice** |
| Data residency | **Absolutely no online data movement, extraction, or processing.** Everything local. |
| Platform | Tauri desktop app (not a web app). Data never leaves the machine. |
| Jurisdictions | NSW (PIC Motor, Workers Comp, WID, Medilaw/HPL) + Queensland (NSW PIRS method, different templates) |
| Document output | App fully owns generation; MasterTemplate.docx retired once parity reached |
| Backward compatibility | Not required; all current data is test data |

### 2.1 Report-type matrix (drives conditional sections and rule-engine activation)

| Matter type | PIRS required? | Threshold determination? | Pre-injury comparator? | Notes |
|---|---|---|---|---|
| MVA — WPI only (Template 9) | Yes, pre & post | No | Yes | %WPI from PIRS median/aggregate |
| MVA — Threshold only (Template 10) | No | Yes | Diagnosis-level | Adjustment disorder / acute stress reaction = threshold injury |
| MVA — Threshold AND WPI (Template 11) | Yes | Yes | Yes | Both engines active |
| Workers Comp — WPI/Treatment/Earnings (Template 12) | **Post-injury only** (usually) | No | Diagnosis & history level | Earnings-capacity sections |
| Return-to-work reports | **No PIRS** | No | History level | Functional capacity emphasis |
| WID | Case-dependent | No | Yes | Liability-oriented narrative |
| Medilaw / HPL | Case-dependent | Case-dependent | Case-dependent | Referrer-specific letterhead/sections (`medilaw*`, `hpl*` control blocks) |
| Queensland | NSW PIRS method | No (NSW-specific) | Case-dependent | Non-PIC template family |

**Requirement:** report type is selected at case creation and is a *first-class field* that
gates which sections, rule engines, and validations are active. Variability is the norm — the
section model must be composable, not four hard-coded templates.

### 2.2 Injury model (confirmed)

- Multiple compensable **and** non-compensable injuries/dates per report.
- Exactly one **reference (subject) injury date** anchors the case. All "pre/post" comparisons
  (symptoms, PIRS categories, employment, treatment) are computed relative to this anchor.
- PIRS pre/post applicability varies by matter type (see matrix); the schema always *supports*
  both, the report type decides what is *rendered and required*.

---

## 3. Product Principles

1. **Clinical accuracy is non-negotiable.** Rule engines (PIRS, DSM-5-TR, threshold logic) are
   static, versioned, immutable data — never editable at runtime, covered by golden tests
   against the published guideline tables.
2. **Every assertion has provenance.** A fact is either (a) clinician-entered during interview,
   (b) extracted from a document with verbatim snippet + page locator, or (c) derived
   deterministically by a rule engine. The report can always answer "where did this come from?"
3. **Fail closed, flag loud.** Uncertain extractions are never auto-asserted; they enter a
   verification queue surfaced during the interview.
4. **Reported ≠ Observed.** Symptoms the client reports and signs the examiner observes are
   distinct epistemic categories. Sync the underlying *fact graph*; never collapse the
   distinction in storage or in the rendered report.
5. **Reasoning is recomputed, never stored as truth.** (Already the doctrine of
   `frontend/src/engine/state.ts` — preserved and extended.)
6. **Offline forever.** No network calls in production code paths. CI should assert this
   (deny-list on `reqwest`/`fetch` outside dev tooling).

---

## 4. Current State vs Ideal Workflow — Gap Analysis

### 4.1 What exists (assessed from the repository)

**Backend (Rust/Tauri, ~60 modules):**
- Event store, projections, replay, reducers (`event_store.rs`, `projection.rs`, `replay.rs`).
- OCR + hybrid text extraction (`ocr.rs`, `extract_text_hybrid`), entity/NER cleaning.
- Structured fact extraction with snippet integrity auditing (`structured_extract.rs`,
  `snippet_integrity.rs`, `audit_snippet_integrity`).
- A mature **contradiction engine** (detection → clustering → graph → narrative → observability
  → snapshots/history/trends) — recently renamed from `step6_*` to `contradiction_*`.
- Patient timeline reconciliation, participant resolution, clinical knowledge graph,
  longitudinal reconciliation (all flagged "additive — not wired into ingestion").
- Client CRUD via events with version history, field-level restore, and diffing.
- Persistence-boundary audit tables (`clinical_events`, `resolved_attributions`).

**Frontend (React + Vite):**
- Pages: Demographics, Current Symptoms, MSE, DSM, Report, Work Timeline (+ calendar).
- Engines: `pirsEngine.ts` (PIRS calculation + narrative), `assessmentEngine`, `mseNarrative`,
  `narrativeEngine` (1,026 lines), `conflicts`, `recompute`, `exportDocx`.
- `ClinicalState` store: append-only, versioned observation log; reasoning recomputed
  deterministically — exactly the right doctrine.
- Components: `PIRSTable`, `DSMAssessment`, `FrequencyInput`, `PartialDateInput`,
  `RelationshipManager`, contradiction observability panels.

**Shared:** `types.ts` (1,012 lines), `viewModels.ts` — typed IPC contracts.

### 4.2 Gaps against the ideal psychiatric medicolegal workflow

| # | Gap | Severity | Ideal state |
|---|---|---|---|
| G1 | **Section-siloed data entry.** Symptoms page, MSE page, DSM page each own their data; no canonical symptom ontology projecting into all of them. Cross-sectional sync (core requirement 2) is partial at best. | Critical | One `ClinicalFact` entered once → projected into Current Symptoms, MSE, Past History, DSM criteria evidence, PIRS category evidence, narrative. |
| G2 | **Two parallel truth systems.** Backend event store (clients/documents) and frontend `ClinicalState` blob are separate; reasoning duplicated across Rust contradiction engine and TS `conflicts.ts`. | Critical | Single event-sourced spine in Rust; frontend holds projections only. |
| G3 | **Ingestion outputs aren't wired into the case.** Timeline/knowledge-graph/participant commands are explicitly "not wired into ingestion"; extracted facts don't flow into interview UI as pre-populated, flagged candidates. | High | Extraction → candidate facts → verification queue → accepted facts join the same store as interview facts. |
| G4 | **No interview-optimised workspace.** Current pages are forms; user reports the UI is "clunky and unusable during live interviews." | Critical | Single live-assessment view (§6) with chips, keyboard palette, zero page-switching for common flows. |
| G5 | **PIRS conversion tables unpinned.** The aggregate→%WPI tables in `pirsEngine.ts` are confirmed correct by the user (class 5: aggregate 21 → 66%) but live inline in code with no golden tests pinning any cell, so a future edit could silently corrupt a clinically immutable rule. | **Critical — clinical** | Conversion tables stored as versioned static data, exhaustively golden-tested cell-by-cell against the user-verified values; calculation duplicated in Rust and TS only if both verified against the same fixture file. |
| G6 | **Threshold-injury logic absent as an engine.** Threshold determination (adjustment disorder / acute stress reaction = threshold; non-threshold requires full DSM-5 diagnosis) appears only as template prose. | High | Deterministic rule: diagnosis set → threshold classification, with the DSM module feeding it. |
| G7 | **Report generation tied to MasterTemplate mental model.** `exportDocx.ts` (184 lines) is far from covering 339 content controls + conditional matter-type blocks. | High | Typed section model + DOCX renderer (§8); template retired. |
| G8 | **Report-type composability.** Matter-type conditionality lives in template tag names (`permthreshwcc*`, `medilaw*`, `hplmedilaw*`), not in a section registry. | High | Declarative report-type → section manifest. |
| G9 | **Pre/post comparator not first-class.** PartialDateInput exists, but no global reference-injury anchor partitioning facts into pre/post epochs. | High | Reference injury date on case; every fact carries temporal bounds; pre/post computed, never re-entered. |

---

## 5. Pillar 1 — Data Schema (cross-sectional relational engine)

### 5.1 Canonical model

```
Case
 ├─ matterType: MVA_WPI | MVA_THRESHOLD | MVA_THRESHOLD_WPI | WC_WPI | RTW | WID | MEDILAW | HPL | QLD_*
 ├─ referenceInjury: { date, description, mechanism }
 ├─ otherInjuries: [{ date, description, compensable: bool }]
 ├─ parties: claimant, referrer, insurer, solicitors, attendees
 └─ factStore (event-sourced, append-only)

ClinicalFact (the atom — one fact, many projections)
 ├─ id, conceptId            → SymptomOntology node (e.g. concept:mood.depressed)
 ├─ epistemicType            → REPORTED | OBSERVED | DOCUMENTED | COLLATERAL | DERIVED
 ├─ temporality              → { onset?, offset?, epoch: PRE_INJURY | POST_INJURY | CURRENT, anchoredTo: referenceInjury }
 ├─ attributes               → severity, frequency, course, treatment-response (typed per concept)
 ├─ provenance               → INTERVIEW(timestamp) | DOCUMENT(docId, page, verbatimSnippet, extractorVersion) | RULE(engineId, inputs)
 ├─ certainty                → ASSERTED | FLAGGED_AMBIGUOUS | REJECTED
 └─ links                    → supports[DSMCriterionId], informs[PIRSCategoryId], contradicts[factId]
```

**The Symptom Ontology** is the sync backbone: a static, versioned graph where each concept
declares its projections. Example: `concept:concentration.impaired` declares
`{ currentSymptoms: yes, mse: cognition-section, dsm: [MDD.A8, PTSD.D?, GAD.C3], pirs: Concentration, pastHistory: yes }`.
Entering it **once** as a REPORTED fact in epoch CURRENT makes it appear in the Current
Symptoms list, as candidate evidence on every mapped DSM criterion, and as evidence in the
PIRS Concentration category worksheet. Recording the OBSERVED counterpart in MSE is a *separate
fact* linked by `conceptId` — the UI shows them side-by-side and the contradiction engine
compares them, but they are never merged (Principle 4).

### 5.2 Event-sourcing unification (resolves G2)

- **Single spine:** the Rust event store becomes the only durable truth. Frontend
  `ClinicalState` is reduced to a *projection cache* hydrated via Tauri IPC; its append-only
  observation log migrates into backend events (`FactAsserted`, `FactRevised`,
  `FactVerified`, `ConflictResolved`, `CriterionAttested`, `ConclusionRecorded`,
  `SnapshotTaken`).
- **Projections (read models), all recomputed:** CurrentSymptomsView, MSEView, PastHistoryView,
  DSMCriteriaView (per candidate diagnosis: met/unmet/insufficient-evidence + evidence facts),
  PIRSWorksheetView (per category: evidence facts, selected class, pre/post), TimelineView,
  ContradictionView, ReportModel (§8).
- **Audit:** every event carries actor, timestamp, and (for extraction events) snippet hash —
  extending the existing `snippet_integrity` + version-history machinery to facts, not just
  demographics.

### 5.3 Temporal model

- `referenceInjury.date` partitions time into PRE/POST epochs; facts may also carry absolute
  partial dates (existing `PartialDateInput` semantics: year, year-month, exact).
- PIRS pre/post and "before/after the subject injury" comparisons are **computed** from epochs.
- Multiple injuries: non-reference injuries tag facts for causation/apportionment narrative but
  do not create additional epoch systems (matches user's stated practice).

### 5.4 Rule engines as immutable data (resolves G5, G6)

- `rules/pirs-nsw-v4.json`: the six categories, class descriptors, median rule
  (mean of 3rd+4th sorted classes, 0.5 rounds up), aggregate→%WPI conversion matrix per median
  class, pre-existing deduction (percentage of initial WPI, standard rounding), treatment-effect
  addition (0–3%). The existing in-code tables are user-verified as correct (class 5:
  aggregate 21 → 66%) and are transcribed **unchanged**.
- `rules/dsm5tr-logic.json`: per-disorder criterion graph — counts ("≥5 of 9, including A1 or
  A2"), duration rules, exclusion clauses, specifiers — encoded as logic with paraphrased
  labels + codes (no verbatim APA text by default; swap-in text pack possible if licensed).
- `rules/threshold-nsw-mva.json`: `diagnosisSet → THRESHOLD | NON_THRESHOLD` (adjustment
  disorder, acute stress reaction ⇒ threshold; non-threshold requires a standing DSM-5
  diagnosis), plus the Template-11 combined path requiring PIRS.
- Each file carries `guidelineVersion`, `effectiveDate`, checksum; loaded read-only; exhaustive
  golden tests (every cell of every conversion table) in both Rust and TS if duplicated.

---

## 6. Pillar 2 — UX/UI Wireframe Logic (live assessment)

### 6.1 Screen anatomy (laptop, video call pinned top-left by the VC app)

```
┌────────────┬──────────────────────────────────────────────┬───────────────┐
│ (client    │  ASSESSMENT CANVAS                           │ CONTEXT RAIL  │
│  video,    │  — one scrolling interview flow, sections    │ • Verification│
│  external) │    inline, never page-switching              │   queue (n)   │
│  ~25% of   │  — active section follows interview, but     │ • Live DSM    │
│  width,    │    any fact can be captured from anywhere    │   criteria    │
│  top-left  │    via the omnibox                           │   tally       │
│  reserved  │                                              │ • PIRS class  │
├────────────┤                                              │   so-far      │
│ TIMELINE   │                                              │ • Contradic-  │
│ STRIP      │                                              │   tions (n)   │
│ (pre│post) │                                              │ • Timer       │
└────────────┴──────────────────────────────────────────────┴───────────────┘
   [⌘K omnibox: type "conc poor 3/12" → chip: Concentration ▾ impaired ▾ 3 months]
```

- **Reserved video zone:** the app's own layout keeps its top-left quadrant visually quiet
  (timeline strip / low-interaction content) so the floating VC window never covers controls.
- **Context rail** is the "everything updates live" payoff: DSM criterion tallies, PIRS class
  evidence, and the document-verification queue tick over as facts are captured.

### 6.2 Interaction grammar (minimal friction, keyboard-first)

1. **Omnibox capture (⌘K):** fuzzy concept search over the ontology with a micro-grammar —
   `"sleep init 2hr nightly since mva"` → structured fact proposal rendered as editable chips
   (concept, attribute, frequency, epoch). Enter asserts; Tab cycles chips. Target: **< 3 s per
   symptom**, zero mouse.
2. **Context-aware chips:** each ontology concept declares its attribute set; selecting
   "Panic attacks" surfaces only frequency/situational/nocturnal chips. Chips appear exactly
   when relevant, never as blank form fields (core requirement 1).
3. **One-keystroke polarity:** every probed symptom can be marked present / absent / not-asked
   (`y` / `n` / `space`). Documented absences ("denied suicidal ideation") are facts too —
   they render into MSE and risk sections.
4. **Echo, don't re-ask:** when a fact already exists from ingestion or an earlier section, the
   interview flow shows it as a pre-filled chip with provenance badge (📄 doc p.47 / 🗣
   reported earlier) — confirm (`Enter`), amend, or contest, never retype (core requirement 2).
5. **Verification moments:** FLAGGED_AMBIGUOUS extraction facts appear in the rail with the
   verbatim snippet; one keystroke accepts into the record or marks disputed (core
   requirement 3).
6. **Reported/observed pairing in MSE:** the MSE section shows the client-reported counterpart
   greyed alongside each observation slot; the examiner records the observed sign
   independently. Discrepancy auto-creates a contradiction entry for the report's
   "inconsistencies" reasoning.
7. **Touch targets** sized for trackpad/touch (≥ 44 px) but every action keyboard-reachable.

### 6.3 Section flow & report-type gating

The canvas renders the section manifest for the case's matter type (§8.2). A RTW report shows
no PIRS worksheet; a WC report shows post-injury PIRS only; Template-11 shows threshold
determination **and** dual PIRS. Sections the manifest excludes simply don't exist in the UI —
the "Excel/VBA strips unused sections" step becomes a no-op by construction.

### 6.4 Non-interview modes

- **Preparation mode:** document ingestion review, verification queue triage, pre-filled
  demographics check (replaces the Excel step).
- **Drafting mode:** ReportModel preview with live narrative rendering, per-paragraph
  provenance inspection, and snapshot/versioning (extends existing version-history UI).

---

## 7. Pillar 3 — NLP / Ingestion Pipeline (zero-hallucination)

### 7.1 Pipeline (all local; consolidates existing modules, resolves G3)

```
Drop PDF/DOCX → classify (born-digital | scanned)
  → OCR (existing ocr.rs; per-page confidence retained)
  → segmentation (existing segment_document) → author/section attribution (participant_resolution)
  → deterministic extractors (dates, medications+doses, identifiers, diagnoses, scores)
  → CandidateFact { value, verbatimSnippet, docId, page, charRange, extractorVersion, confidence }
  → certainty gate:
       confidence = 1.0 & validators pass  → auto-assert as DOCUMENTED fact (still provenance-badged)
       otherwise                            → FLAGGED_AMBIGUOUS → verification queue
  → cross-document reconciliation (patient_timeline, longitudinal, contradiction engine)
```

### 7.2 Zero-hallucination contract (testable definition)

1. **No generative model writes a fact value.** Extractors are deterministic
   (lexicon/regex/grammar/layout). If a local LLM is ever added, it may only *locate* spans;
   the asserted value must be the verbatim source text, and it can never bypass the certainty
   gate.
2. **Every DOCUMENTED fact stores a verbatim snippet + locator**, integrity-hashed
   (existing `snippet_integrity.rs`) and re-verifiable against the stored source.
3. **Fail closed:** ambiguity (conflicting candidates, low OCR confidence, failed checksum/date
   validators) always queues for human verification — surfaced in the interview rail.
4. **Precision over recall**, and the recall shortfall is *visible*: per-document extraction
   coverage report ("12 medications found, 3 ambiguous, OCR confidence p5 = 91%").
5. **Multi-author handling:** facts attribute to their in-document author (GP, IME, physio);
   the contradiction engine compares across authors and across the interview record.

### 7.3 Verification UX

Queue items show snippet image/text, proposed structured fact, and source page thumbnail;
accept / edit / reject with single keystrokes. Accepted facts enter the same canonical store —
from then on they sync everywhere like any interview fact.

---

## 8. Document Generation (retiring MasterTemplate.docx)

### 8.1 Strategy

Reverse-engineer the 339 content controls + heading structure of `MasterTemplate.docx` into:

1. **SectionRegistry** — every section/subsection as a typed unit with data bindings into
   projections (e.g. *PIRS table section* binds PIRSWorksheetView + pirs engine output;
   *Documents Reviewed* binds the ingestion manifest; *Opinion evidence* binds the repeating
   `Opin*_X` group as a list of reviewed expert opinions).
2. **Report-type manifests** — declarative lists of sections per matter type, replacing the
   `permthreshwcc*` / `medilaw*` / `hpl*` conditional-tag system. Adding a new referrer or
   Queensland template = new manifest + letterhead asset, no code.
3. **Narrative renderers** — extend `narrativeEngine.ts` / `mseNarrative.ts` to render each
   section from projections, with deterministic phrasing (existing `buildPIRSNarrative` style)
   and clinician-editable override per paragraph (overrides stored as events, diffable).
4. **DOCX renderer** — direct generation (docx-js or Rust docx crate) with the firm's styles;
   golden-file tests compare generated output structure against the four example reports.

### 8.2 Parity gate

MasterTemplate is retired only after: every content control mapped to a binding or explicitly
deprecated; one report per matter type generated and visually signed off against its example
(`Workers Compensation Example Client1`, `WID Example Client1/2`, `Medilaw Example 1`).

---

## 9. Non-Functional Requirements

- **Offline enforcement:** no network APIs in production paths; CI lints dependencies.
- **Auditability:** full event history per case; report snapshots reproducible byte-for-byte
  from (events + rule versions + renderer version).
- **Rule integrity:** rule packs checksummed at startup; mismatch = hard refusal to compute.
- **Performance:** omnibox fact capture < 100 ms feedback; projection recompute < 250 ms for a
  full case; ingestion of a 1,000-page scanned brief may run as a background job with progress.
- **Testing:** golden tests for every rule-table cell; property tests for the median/rounding
  rules; replay determinism tests (extend existing `invariants.test.ts`,
  `architecture-freeze.test.ts`); snippet-integrity audits on every ingest.
- **Data protection:** local encryption-at-rest for the case database (SQLCipher or OS keychain
  envelope) — test data now, but architecture must be ready for real clinical data.

---

## 10. Phased Roadmap

| Phase | Scope | Exit criterion |
|---|---|---|
| **0. Rule integrity — ✅ done 2026-06-13** | PIRS rule tables extracted to versioned rule pack `rules/pirsNswRules.ts` (values unchanged, clinician-verified); cell-by-cell golden tests; threshold-injury engine `rules/thresholdNswMva.ts` | Every guideline table cell pinned by a test ✅ |
| **1. Canonical fact store — ✅ done 2026-06-13** | Symptom ontology v1 (`ontology/canonicalOntology.ts` + `data/pirsMapping.ts`); cross-sectional projections (`engine/crossSectionProjections.ts`: Current Symptoms / MSE / DSM evidence / PIRS with derived pre-post epochs); reported/observed preserved via frames. Rust spine: `ClinicalObservationRecorded` / `ClinicalReviewRecorded` events + `clinical_fact_store::fold_clinical_state` + commands (`record_clinical_observation`, `record_clinical_review_item`, `get_clinical_state`), registered in both contract registries; frontend `ClinicalState` demoted to projection cache via `integration/clinicalSpine.ts` (wire-format pinned by tests). **UI pages consuming the projections moved to Phase 2** (they are the live-assessment workspace) | One symptom entered once appears in Symptoms, MSE, DSM, PIRS views — ✅ pinned by `crossSectionProjections.test.ts`; spine fold + wire compatibility pinned on both sides |
| **2. Live-assessment workspace — ◐ template-driven canvas done 2026-06-13** | **Direction reset (clinician feedback 2026-06-13): recognition over recall — the template IS the interview script.** Decisions: single scrolling canvas (tabs remain for deep editing); fully configurable interview templates (clone-and-adjust library, like the Word templates). Done: template model + built-ins per matter type (`types/interviewTemplate.ts`, `data/interviewTemplates.ts` — MVA opens symptoms with Mood/Anxiety/PTSD; threshold-only templates omit PIRS = the VBA strip step, computed); coverage engine (`engine/interviewCoverage.ts` — probe states derived from the canonical log; "not asked" is a visible hole; end-of-interview audit); template store (`engine/templateStore.ts`, localStorage clone/save/delete); rebuilt `pages/LiveAssessmentPage.tsx` (script rail with live coverage, scrolling section canvas, tri-state probe chips cycling not-asked→present→denied as append-only events, omnibox demoted to docked accelerator that ticks the same coverage); omnibox micro-grammar (`engine/omnibox.ts`, fail-closed); `components/ContextRail.tsx` projections. Added 2026-06-13: template manager UI (`components/TemplateManager.tsx` — clone built-ins, rename, reorder, remove/re-add sections from catalog, per-domain probe toggles); narrative-section ticks persist per client (localStorage, interim until spine-backed). Clinician feedback round 2: MSE/PIRS sections **removed** from built-in templates (the clinician knows to do these; section kinds remain for custom templates); **flow-through bridge** `integration/liveAxBridge.ts` — every Live Ax capture updates the shared SymptomEntity store + MoodState on the client blob, so Current Symptoms / DSM / MSE pages (incl. the MSE shared-mood domain) reflect interview captures immediately. Flow is one-directional (Live Ax → pages) until pages consume projections natively. **Remaining:** document-fact confirm-or-contest chips inline in sections (needs ingestion-candidate → concept mapping, Phase 3); reverse sync or projection-native pages; mock-interview sign-off | Full mock interview conducted without mouse and without re-typing any fact |
| **3. Ingestion wiring — ◐ candidate bridge done 2026-06-13** | Done: candidate-fact engine `integration/candidateFacts.ts` — maps the deterministically-extracted `ClinicalEvent`s (clinical_events.rs, via `get_client_extraction`) onto ontology concepts (symptoms via `omnibox.matchConcept`, diagnoses via a canonical-name→DSM-id table), fails closed (unmatched → verification queue, never guessed), reads presence from `assertion_status` (historical → pre-injury hint), preserves verbatim snippet+page+author provenance, dedupes by stable `event_id`. `omnibox.matchConcept` added + bidirectional morphological matching + specificity tiebreak. Live Ax wiring: per-section "from the brief — confirm or contest" strips (echo, don't re-ask — Confirm asserts the fact + flows through; Contest dismisses, nothing auto-asserted) and a top-of-canvas verification queue for unmapped symptoms / diagnoses / medications; candidate actions persist per client. **Remaining:** wire timeline/participant/contradiction reasoner outputs into the case; OCR-confidence + coverage reporting surfaced in prep mode; reverse-confirm into DSM workspace | Scanned brief → flagged facts verified during mock interview |
| **4. Document generation** | SectionRegistry; manifests for Templates 9–12 + Medilaw/HPL/WID; DOCX renderer; parity sign-off | All four example reports reproduced; MasterTemplate retired |
| **5. Hardening** | Encryption at rest, performance, Queensland manifests, associate multi-user prep | Production readiness review |

---

## 11. Open Items & Risks

1. **DSM-5-TR text licensing** (unanswered Q B5): defaulting to logic + paraphrase + codes;
   verbatim criterion text only if the user holds an APA licence.
2. **PIRS conversion values are user-verified and frozen** (class 5: aggregate 21 → 66%).
   Phase 0 pins them with golden tests; no value may ever be altered without explicit
   clinician sign-off and a rule-pack version bump.
3. **OCR quality ceiling** on poor scans bounds extraction recall; mitigated by coverage
   reporting and verification queue, not by inflating confidence.
4. **Ontology scope creep:** start with the symptom set actually used across the four example
   reports + template controls (~80–120 concepts), grow by usage.
5. **Single-machine OneDrive sync:** the repo (and presumably case data) lives in OneDrive —
   this is *file replication of an encrypted-at-rest store*, acceptable, but the live SQLite DB
   should be excluded from sync to avoid corruption; revisit storage location in Phase 5.
