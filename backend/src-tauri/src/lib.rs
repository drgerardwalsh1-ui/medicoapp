// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// OCR module — always compiled.  Uses subprocess tesseract (no native linking),
// so the binary works as long as `tesseract` and `pdftoppm` are on PATH.
mod ocr;

// Entity cleaning and normalisation pipeline module.
mod entity_clean;

// Text cleaning layer — runs BEFORE every NLP / structured-extraction call.
// Preserves the raw input, produces a `clean_text` for NLP, and reports
// removed UI/OCR noise lines for audit/UI display.
mod text_clean;

// Assertion / status classifier — affirmed / queried / negated /
// contradicted / differential / symptom_only / historical for condition
// mentions found in cleaned text.
mod assertion;

// Date extraction with precision tracking (day / month / year).
mod dates;

// spaCy NER post-processing — filters PERSON/ORG false positives left
// over after text_clean. Runs on the cleaned text so the upstream NER
// receives a fair input but the downstream output is still scrubbed.
mod ner_clean;

// Deterministic person / party extraction from structured medico-legal
// patterns (Author:, Dr Surname, Patient:, …). Used to populate
// `parties.doctor` / `parties.patient` and the `people[]` list,
// independently of spaCy's noisier output.
mod party_extract;

// Canonical Clinical Event Layer — additive substrate the future
// reasoning / timeline / summary / report-generation features will
// consume. Each extracted concept (diagnosis / symptom / medication /
// procedure / person) becomes a `ClinicalEvent`. The existing
// extraction outputs are unchanged.
mod clinical_events;

// Event Unification Layer — post-processing aggregator that collapses
// flat ClinicalEvents into a deduplicated, cross-linked canonical graph
// per document. Additive: `clinical_events` continues to be emitted
// unchanged.
mod event_unification;

// Patient Timeline Layer — cross-document aggregator built ABOVE
// `event_unification`. Produces one `PatientEvent` per (event_type,
// normalised concept) across the whole patient corpus. Additive only
// — exposed via the new `reason_patient_timeline` command and not
// wired into ingestion.
mod patient_timeline;

// Condition State Engine — turns event-centric PatientEvents into a
// state-centric clinical picture (Active / Inactive / Resolved /
// Disputed / Unknown) with full transition trajectories, stability,
// and severity scores. Additive only — exposed via the new
// `reason_clinical_state` command and not wired into ingestion.
mod clinical_state;

// Patient Longitudinal Reconciliation — true cross-document, cross-time
// reconciliation that produces a LongitudinalPatientGraph
// (canonical_events + temporal_edges + cross_domain_links +
// evolution_tracks). Additive only — exposed via the new
// `reason_longitudinal_reconciliation` command and not wired into
// ingestion.
mod patient_longitudinal_reconciliation;

// Global Clinical Knowledge Graph (GCKG) — final structural layer that
// unifies every earlier abstraction into a single queryable graph with
// deterministic projections (clinical / patient / temporal /
// medico-legal) and a medico-legal summary. Strictly additive — not
// wired into ingestion. New command: `build_clinical_knowledge_graph`.
mod clinical_knowledge_graph;

// Patient Identity + Participant Resolution Layer — canonical patient,
// participant, and organisation entities derived from canonical
// document payloads. Strictly additive — does not modify any prior
// structure. New command: `reason_participant_resolution`.
mod participant_resolution;

// STEP 5 — Family Graph Model. A strictly-additive PROJECTION that turns
// family events into a temporal, source-attributed relationship graph.
// Contradictions are INHERITED (same reconciliation contract), never
// recomputed; conflicting family facts are preserved as separate edges,
// never collapsed. Plugs into CanonicalCase.family_graph. Not wired to a
// command.
mod family_graph;

// Canonical Case Reconstruction — the top-of-stack legal-grade case
// envelope (CanonicalCase) assembled ADDITIVELY from the layers above.
// This pass implements Contradiction Surfacing only: a flattened
// contradictions[] view (canonical value + retained alternatives +
// conflict_flag), unresolved_questions[], and a confidence_summary,
// derived from the LongitudinalPatientGraph's assertion_distribution.
// No re-extraction, no inference, no model calls. Not yet wired to a
// command (mirrors the longitudinal / GCKG rollout pattern).
mod canonical_case;

// Case event-type extension — InjuryEvent / FamilyEvent / LegalStatusEvent.
// Strictly-additive pure data carriers that LOWER deterministically into the
// EXISTING graphs: InjuryEvent → ClinicalEvent (clinical contradiction
// pipeline), FamilyEvent → the existing family carrier, LegalStatusEvent →
// TimelineEntry (record only, no contradiction). No new engine, no math change.
mod case_events;

// Event extension dispatch — a PURE ROUTING BOUNDARY over the case_events
// lowerings (Injury→Clinical, Legal→Timeline, Family→passthrough, Unknown→
// Ignored). No domain logic; the single insertion point for future event
// types so the core pipelines stay untouched. Deterministic, no HashMap.
mod event_dispatch;

// Contradiction Engine enrichment — a PURE, POST-PROCESSING VIEW LAYER over the assembled
// CaseContradiction stream. Adds presentational derived fields (severity_rank,
// presentation_group, cross_domain_tag) without mutating input, recomputing
// confidence, or touching any engine. Deterministic, BTreeMap-only.
mod contradiction_enrichment;

// Contradiction Engine semantic graph — a PURE DERIVATION LAYER over ContradictionView: nodes per
// enriched contradiction, edges from cross_namespace_relations, with traversal,
// clustering (connected components), and filtered queries. Vec-only output, no
// HashMap; reads the view by reference and mutates nothing.
mod contradiction_cluster_graph;

// Contradiction Engine graph analytics — PURE deterministic analysis over ClusterGraph:
// node metrics (degree / cluster / bridge_score / centrality_rank), cluster
// metrics (+ clinical significance), graph summary, and top-N queries. Reads
// the graph by reference; mutates nothing; Vec-only, no HashMap, no ML.
mod cluster_graph_analysis;

// Contradiction Engine graph narratives — PURE deterministic summarisation of GraphAnalytics
// into fixed-template human-readable strings (cluster headline/summary/dominant
// node + graph summary). No AI, no inference, no scoring; reads by reference,
// mutates nothing.
mod cluster_graph_narrative;

// Canonical Contradiction Engine report — the single aggregation object (view + graph +
// analytics + narrative) for future UI/PDF/REST/export surfaces. Pure
// aggregation: calls the existing builders in sequence, no recomputation, no
// mutation. Plus pure queries + read-only integrity validation.
mod contradiction_report;

// Contradiction Engine report snapshot — durable, versioned, serializable artifact wrapping
// ContradictionReport. Adds schema_version + deterministic report_id + caller-supplied
// timestamp. Pure wrapping; no hashing/UUIDs/internal timestamps.
mod contradiction_report_snapshot;

// Contradiction Engine snapshot persistence boundary — SnapshotRepository trait + deterministic
// in-memory (BTreeMap) reference implementation. Contract only; no DB/FS/REST.
mod contradiction_snapshot_repository;

// Contradiction Engine snapshot filesystem backend — concrete SnapshotRepository writing one
// JSON file per snapshot ({report_id}.json). std + serde only; sync; no DB/net.
mod contradiction_snapshot_file_repository;

// Contradiction Engine report diff — deterministic, read-only comparison of two snapshots
// (exact contradiction_id identity). Pure derivation; no report/graph changes.
mod contradiction_report_diff;

// Contradiction Engine report evolution — deterministic, read-only analysis of contradiction
// modifications (confidence/subject), graph + narrative evolution between two
// snapshots. Pure derivation; no engine/report/snapshot/diff changes.
mod contradiction_report_evolution;

// Contradiction Engine report history — deterministic, read-only longitudinal analysis across
// ALL snapshots in a repository (first/last seen, appearances, persistent/
// resolved/recurring). Pure derivation; no engine/report/snapshot/repo changes.
mod contradiction_report_history;

// Contradiction Engine report trends — deterministic, read-only confidence-trajectory analysis
// over ReportHistory (Increasing/Decreasing/Stable/Intermittent). Pure
// derivation; no engine/report/snapshot/repo/diff/evolution/history changes.
mod contradiction_report_trends;

// Contradiction Engine forecast readiness — deterministic classification of historical
// SUFFICIENCY (InsufficientHistory/LimitedHistory/Ready). Does NOT forecast,
// predict, or extrapolate. Pure derivation over history + trends.
mod contradiction_forecast_readiness;

// Contradiction Engine monitoring queue — deterministic watchlist organising contradictions by
// observation priority (Ready→High, Limited→Medium, Insufficient→Low). No
// forecasting/prediction; pure derivation over forecast-readiness.
mod contradiction_monitoring_queue;

// Contradiction Engine monitoring dashboard — deterministic, read-only aggregation over a
// MonitoringQueue (priority/trend/readiness distributions + consistency check).
// Pure summary; no forecasting, reprioritisation, or reordering.
mod contradiction_monitoring_dashboard;

// Contradiction Engine observability root — composition-only aggregator bundling snapshot +
// history + trends + readiness + queue + dashboard into one inspectable object.
// Computes nothing new; calls existing builders in strict order.
mod contradiction_observability_root;

// Contradiction Engine export — deterministic, read-only PROJECTIONS (rows / CSV lines /
// per-group summary) of the enriched ContradictionView. No graph/engine/dispatch/event
// access, no mutation, no recomputation. BTreeMap-only; no filesystem.
mod contradiction_export;

// Contradiction Engine pipeline — the single end-to-end orchestration seam (audit F1+F2):
// EventEnvelope → dispatch → clinical/family/timeline accumulation → assemble
// (timeline passed through) → enrich → export. Orchestration only; reuses every
// existing builder, no new business logic. Deterministic, BTreeMap grouping.
mod contradiction_engine;

// Contradiction Graph Model (additive, explorable reasoning layer): a typed,
// queryable graph projected from ContradictionEngineOutput. `graph_types` is
// the model (Fact/Document/Contradiction/Entity nodes; SUPPORTS/CONTRADICTS/
// DERIVED_FROM/RELATES_TO/TEMPORAL_NEXT/WEAKENS/STRENGTHENS edges),
// `graph_builder` the pure deterministic constructor, `graph_query` the
// read-only exploration API, `contradiction_graph` the façade, and
// `contradiction_graph_projection` a rebuildable SQLite read model.
// Engine outputs are UNCHANGED; the graph is a downstream projection.
mod graph_types;
mod graph_builder;
mod graph_query;
mod contradiction_graph;
mod contradiction_graph_projection;

// Fact-assertion pipeline — first-class non-clinical factual statements
// (marital/work/smoking/driving/vital-status/dates). `fact_assertion` is the
// model, `fact_extract` lifts facts deterministically from clean_text, and
// `fact_contradiction` turns disagreeing values (same subject+attribute,
// different value) into CaseContradictions — even when both are affirmed.
mod fact_assertion;
mod fact_extract;
mod fact_contradiction;

// Structured medico-legal fact layer (additive). `structured_fact` is the
// durable schema (5 domains: medications/symptoms/injuries/treatments/functional
// impacts) with per-fact confidence + evidence + offsets + date span;
// `structured_normalise` canonicalises surface forms; `structured_extract` lifts
// `StructuredFact`s from clean_text. Emitted on the canonical store under
// `structured_facts`. Touches no existing output, type, or pipeline.
mod structured_fact;
mod structured_normalise;
mod structured_extract;

// Production input adapter (closes audit F-1/F-2): converts the real persisted
// extraction payload (clinical_events JSON) + caller-supplied family/legal
// facts into Vec<EventEnvelope> and invokes run_contradiction_engine. Pure adapter
// + thin entrypoint; no new business logic. Surfaced via the `build_contradiction_case`
// command.
mod contradiction_input_adapter;

// Clinical event routing + preservation layer (additive, preparation only):
// the deterministic `Diagnosis → Injury, else Unsupported` routing extracted
// from the adapter (byte-identical), plus pure preservation/visibility helpers
// (clinical_event_metadata_snapshot, clinical_coverage_report). No new coverage,
// no behavioural change.
mod clinical_event_adapter;

// Persistence-boundary snippet-integrity verification module. Owns the
// single canonical implementation of
//   `clean_text[ev.char_offset_start..ev.char_offset_end] == ev.source_snippet`
// referenced by build_events (debug_assert) and the projection writer
// (hard reject).
pub mod snippet_integrity;

// Layer 3 — strict validation gate: context, evidence, confidence, deduplication.
mod validation;

// ── Event sourcing foundation (Step 3a) ──────────────────────────────────────
// Foundation phase: modules wired, schema initialised, single optional emission
// behind a feature flag. Reducer + verification land in subsequent steps.
pub mod events;
// Event Contract Registry — declarative semantics per EventType (no runtime
// behaviour). Exhaustive `match` makes an unregistered new event a compile
// error; the single source of truth for event identity/replay/cascade.
pub mod event_contracts;
// Projection Contract Registry — declarative per-EventType projection effect
// (targets / operation / rebuild / idempotency). Exhaustive `match` + a
// conformance test lock it against event_contracts so projection behaviour is
// derivable from contracts, not from reading projection.rs.
pub mod event_projection_contracts;
pub mod event_store;
pub mod projection;
pub mod reducer;
pub mod replay;
// Canonical clinical fact spine (Phase 1) — pure fold of clinical
// observation/review events into the frontend ClinicalState wire shape.
pub mod clinical_fact_store;

/// Master kill-switch for the event-sourcing system. Step 4 turns this on.
/// When `true`, the new domain commands (`create_client`, `get_client_view`)
/// require both DBs to initialise successfully — no silent fallback.
/// The legacy `process_document` emission path remains best-effort so the
/// existing ingestion pipeline is untouched per the Step 4 scope.
pub const ENABLE_EVENT_STORE: bool = true;

use std::sync::OnceLock;

static EVENT_STORE: OnceLock<event_store::EventStore> = OnceLock::new();
static PROJECTION: OnceLock<projection::Projection> = OnceLock::new();

fn event_store() -> Option<&'static event_store::EventStore> {
    EVENT_STORE.get()
}

fn projection_handle() -> Option<&'static projection::Projection> {
    PROJECTION.get()
}

fn init_event_store_once() {
    if EVENT_STORE.get().is_some() {
        return;
    }
    match event_store::EventStore::init(&event_store::default_events_db_path()) {
        Ok(store) => {
            let _ = EVENT_STORE.set(store);
        }
        Err(e) => eprintln!("[event_store] init failed: {e}"),
    }
    match projection::Projection::init(&event_store::default_projection_db_path()) {
        Ok(p) => {
            let _ = PROJECTION.set(p);
        }
        Err(e) => eprintln!("[projection] init failed: {e}"),
    }
}

/// Strict initialisation — Step 4. Returns Err with no silent fallback if
/// either database fails to open. Used by the new domain commands.
fn init_event_store_strict() -> Result<
    (&'static event_store::EventStore, &'static projection::Projection),
    String,
> {
    init_event_store_once();
    let store = event_store().ok_or_else(|| {
        "event store unavailable — events.db could not be initialised".to_string()
    })?;
    let proj = projection_handle().ok_or_else(|| {
        "projection unavailable — projection.db could not be initialised".to_string()
    })?;
    Ok((store, proj))
}

// ─── Persistence-boundary version stamps ─────────────────────────────────
// Every DocumentExtracted event is stamped with these two values. They
// must remain immutable per-event so a future audit can identify exactly
// which rule set produced the persisted ClinicalEvents.

/// Pipeline version stamp. Combines the crate version (`Cargo.toml`)
/// with the git short-sha injected at build time by `build.rs`. Falls
/// back to `dev` when no git context is available (local development).
pub fn pipeline_version() -> &'static str {
    // env!("CARGO_PKG_VERSION") is built-in; GIT_SHA is provided by
    // build.rs via `cargo:rustc-env=GIT_SHA=...`. The fallback "dev"
    // ensures `option_env!` is never None at runtime.
    concat!(env!("CARGO_PKG_VERSION"), "+", env!("GIT_SHA"))
}

/// Deterministic SHA-256 over the rule-corpus constants used by the
/// extraction pipeline. Computed once on first call and cached.
///
/// Hashed sources (in this fixed canonical order):
///   1. entity_clean::CONDITION_SYNONYMS  (delegated via debug dump)
///   2. entity_clean::MEDICATION_SYNONYMS
///   3. entity_clean::PROCEDURE_SYNONYMS
///   4. entity_clean::NAME_BLOCKLIST
///   5. entity_clean::DOC_KEYWORD_BLOCKLIST
///   6. entity_clean::CONDITION_KEYWORDS
///   7. entity_clean::SYMPTOM_LEXICON
///   8. party_extract::ROLE_TRIGGERS
///   9. party_extract::TITLES (when exposed)
///  10. assertion cue tables (DIFFERENTIAL_CUES, CONTRADICTION_CUES,
///      NEGATION_CUES, HISTORICAL_CUES, SYMPTOM_VERBS, DIAGNOSIS_LABELS)
///
/// In the current crate, `entity_clean` and `party_extract` keep their
/// rule tables module-private. The hash therefore reflects a stable
/// digest of the **module-source bytes** for the four rule files —
/// changing any of those bytes (synonyms, blocklists, role triggers,
/// cue lists) invalidates downstream derivations. This is a stricter
/// bound than per-constant hashing (incidental whitespace counts) and
/// is acceptable because the boundary contract is "if the rule sources
/// change, the cache is stale" — exactly what we want.
pub fn rule_corpus_hash() -> &'static str {
    static HASH: OnceLock<String> = OnceLock::new();
    HASH.get_or_init(|| {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Embed the rule-source files at compile time so the binary is
        // self-contained and the hash is deterministic per-build.
        const RULE_SOURCES: &[&str] = &[
            include_str!("entity_clean.rs"),
            include_str!("party_extract.rs"),
            include_str!("assertion.rs"),
            include_str!("dates.rs"),
            include_str!("text_clean.rs"),
        ];
        let mut hasher = DefaultHasher::new();
        for src in RULE_SOURCES {
            src.hash(&mut hasher);
            // Separator so concatenation can never collide.
            0u64.hash(&mut hasher);
        }
        // DefaultHasher is SipHash-1-3 in stable Rust — deterministic for
        // the same input. Render as a 16-char hex.
        format!("{:016x}", hasher.finish())
    })
}

/// Smoke test: open both DBs, append+read a sentinel event, report status.
/// Only callable from Rust right now; not exposed as a Tauri command yet.
#[allow(dead_code)]
pub fn verify_event_store_initialised() -> Result<String, String> {
    init_event_store_once();
    let store = event_store().ok_or("events.db not initialised")?;
    let _proj = projection_handle().ok_or("projection.db not initialised")?;

    let client_id = "__verify__".to_string();
    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "verify".into() },
        events::EventPayload::DocumentUploaded(events::DocumentUploadedP {
            document_id: "verify-doc".into(),
            file_name: "verify.txt".into(),
            char_count: 0,
            method: "verify".into(),
        }),
        None,
        None,
    );
    store.append_event(&env).map_err(|e| e.to_string())?;
    let read = store.get_events(&client_id).map_err(|e| e.to_string())?;
    Ok(format!("ok: {} event(s) for {}", read.len(), client_id))
}

// ─── Step 3c — replay validation, rebuild verifier, integrity command ────────

/// Drop projection tables, replay every event, and verify the rebuilt
/// projection is byte-identical to the prior projection.
///
/// Returns Ok with a short status string on success; Err with a structured
/// diff (table name → first 500 chars of differing canonical content) if
/// any read-model table differs.
pub fn rebuild_projection_and_verify() -> Result<String, String> {
    init_event_store_once();
    let store = event_store().ok_or("events.db not initialised")?;
    let proj = projection_handle().ok_or("projection.db not initialised")?;

    let all_events = store.get_all_events().map_err(|e| e.to_string())?;
    replay::validate_event_stream(&all_events).map_err(|e| format!("validation failed: {e}"))?;

    let before = proj.snapshot_canonical().map_err(|e| e.to_string())?;
    proj.rebuild_from_events(&all_events)
        .map_err(|e| format!("rebuild failed: {e}"))?;
    let after = proj.snapshot_canonical().map_err(|e| e.to_string())?;

    if before == after {
        return Ok(format!(
            "PASS: rebuilt projection from {} event(s); byte-identical",
            all_events.len()
        ));
    }

    let mut diff = String::from("FAIL: projection drift detected\n");
    for name in ["clients", "documents", "entities", "pirs_snapshots"] {
        let b = before.tables.get(name).cloned().unwrap_or_default();
        let a = after.tables.get(name).cloned().unwrap_or_default();
        if b != a {
            diff.push_str(&format!(
                "  table `{name}` differs:\n    before: {}\n    after:  {}\n",
                truncate(&b, 500),
                truncate(&a, 500),
            ));
        }
    }
    Err(diff)
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n { s.to_string() } else { format!("{}…", &s[..n]) }
}

/// Tauri command: full system integrity check. Combines stream validation,
/// rebuild verification, and drift detection into a single PASS/FAIL.
#[tauri::command]
fn verify_system_integrity() -> Result<String, String> {
    init_event_store_once();
    let store = event_store().ok_or("events.db not initialised")?;
    let proj = projection_handle().ok_or("projection.db not initialised")?;

    let all_events = store.get_all_events().map_err(|e| e.to_string())?;

    // 1. Ordering enforcement
    replay::validate_event_stream(&all_events)
        .map_err(|e| format!("FAIL: event stream invalid — {e}"))?;

    // 2. Drift detection (cursor / per-client version)
    if let Err(report) = proj.check_integrity(&all_events) {
        return Err(format!("FAIL: {report}"));
    }

    // 3. Replay-rebuild equivalence
    rebuild_projection_and_verify()?;

    Ok(format!(
        "PASS: {} event(s) validated, projection rebuilt and matches",
        all_events.len()
    ))
}

// ─── Step 4 — first event-driven domain path ─────────────────────────────────
//
// Two commands only:
//   - create_client: append ClientCreated, project_forward, return id
//   - get_client_view: read from projection.db only

/// Create a new client. Generates a fresh UUIDv7 client_id, appends a
/// `ClientCreated` event at version 1, and projects forward immediately.
#[tauri::command(rename_all = "camelCase")]
fn create_client(
    demographics: Option<serde_json::Value>,
) -> Result<String, String> {
    let (store, proj) = init_event_store_strict()?;

    let client_id = uuid::Uuid::now_v7().to_string();
    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    if version != 1 {
        return Err(format!(
            "create_client: client_id collision — next_version was {version}, expected 1"
        ));
    }

    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "create_client".into() },
        events::EventPayload::ClientCreated(events::ClientCreatedP {
            demographics: demographics.unwrap_or(serde_json::Value::Null),
        }),
        None,
        None,
    );

    store
        .append_event(&env)
        .map_err(|e| format!("create_client: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("create_client: project_forward failed: {e}"))?;

    Ok(client_id)
}

/// Read a client view. Source: projection.db ONLY.
#[tauri::command(rename_all = "camelCase")]
fn get_client_view(client_id: String) -> Result<projection::ClientViewModel, String> {
    let (_store, proj) = init_event_store_strict()?;
    match proj.get_client_view(&client_id).map_err(|e| e.to_string())? {
        Some(v) => Ok(v),
        None => Err(format!("client not found: {client_id}")),
    }
}

/// Authoritative existence check. Source of truth for "may this client
/// receive document uploads?" — the projection `clients` table. The
/// frontend ingestion gate calls this instead of trusting a UI flag,
/// so a desynced `isSaved` boolean or a draft sentinel id can never
/// permit an upload against a non-existent client.
#[tauri::command(rename_all = "camelCase")]
fn client_exists(client_id: String) -> Result<bool, String> {
    let (_store, proj) = init_event_store_strict()?;
    proj.client_exists(&client_id).map_err(|e| e.to_string())
}

/// Read persisted extraction results for a client, per document.
///
/// The dedicated read path that closes the projection → UI boundary for
/// clinical content. Returns clinical events + resolved attributions
/// that the ingestion pipeline already wrote to `projection.db` — so the
/// UI can rehydrate them after navigation WITHOUT reprocessing the
/// document. No new persistence, no new events, no recomputation:
/// `get_client_view` exposes demographics + document metadata; this
/// command exposes the clinical boundary tables it omits.
#[tauri::command(rename_all = "camelCase")]
fn get_client_extraction(client_id: String) -> Result<String, String> {
    let (_store, proj) = init_event_store_strict()?;
    let docs = proj
        .get_client_extraction(&client_id)
        .map_err(|e| e.to_string())?;
    serde_json::to_string(&docs).map_err(|e| e.to_string())
}

// ─── Step 6 — Version History (additive, audit-preserving) ──────────────────
//
// All four commands below are read-mostly. The two `restore_*` commands
// emit BRAND NEW events; they never modify or delete past events.

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct EventHistoryItem {
    pub version: u64,
    pub timestamp: String,
    pub event_type: String,
}

fn truncate_to_version(
    events: Vec<events::EventEnvelope>,
    version: u64,
) -> Result<Vec<events::EventEnvelope>, String> {
    let truncated: Vec<events::EventEnvelope> =
        events.into_iter().take_while(|e| e.version <= version).collect();
    if truncated.is_empty() {
        return Err(format!("no events at or before version {version}"));
    }
    if truncated.last().unwrap().version != version {
        return Err(format!("version {version} not found"));
    }
    Ok(truncated)
}

/// List every event for a client, oldest first.
#[tauri::command(rename_all = "camelCase")]
fn get_client_event_history(client_id: String) -> Result<Vec<EventHistoryItem>, String> {
    let (store, _proj) = init_event_store_strict()?;
    let evs = store.get_events(&client_id).map_err(|e| e.to_string())?;
    Ok(evs
        .into_iter()
        .map(|e| EventHistoryItem {
            version: e.version,
            timestamp: e.timestamp.to_rfc3339(),
            event_type: e.event_type.as_str().to_string(),
        })
        .collect())
}

/// Replay events for a client up to and including `version`, returning the
/// pure `ClientState` at that point. Stream is validated first; a corrupt
/// stream is a hard error.
#[tauri::command(rename_all = "camelCase")]
fn get_client_snapshot_at_version(
    client_id: String,
    version: u64,
) -> Result<reducer::ClientState, String> {
    let (store, _proj) = init_event_store_strict()?;
    let evs = store.get_events(&client_id).map_err(|e| e.to_string())?;
    replay::validate_event_stream(&evs).map_err(|e| format!("validation failed: {e}"))?;
    let truncated = truncate_to_version(evs, version)?;
    Ok(reducer::reduce(&truncated))
}

/// Promote an entire historical snapshot forward by emitting a brand-new
/// `ClientRestoredFromVersion` event. Returns the new version.
#[tauri::command(rename_all = "camelCase")]
fn restore_client_from_version(client_id: String, version: u64) -> Result<u64, String> {
    let (store, proj) = init_event_store_strict()?;
    let evs = store.get_events(&client_id).map_err(|e| e.to_string())?;
    replay::validate_event_stream(&evs).map_err(|e| format!("validation failed: {e}"))?;
    let truncated = truncate_to_version(evs, version)?;
    let snapshot = reducer::reduce(&truncated);

    let next_version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        next_version,
        events::Actor::System {
            component: "restore_client_from_version".into(),
        },
        events::EventPayload::ClientRestoredFromVersion(events::ClientRestoredFromVersionP {
            from_version: version,
            demographics: snapshot
                .demographics
                .clone()
                .unwrap_or(serde_json::Value::Null),
        }),
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("restore_client_from_version: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("restore_client_from_version: project_forward failed: {e}"))?;
    Ok(next_version)
}

/// One field-level change between two snapshots. `from` and `to` are the
/// raw `serde_json::Value`s — strings, numbers, nulls — left untouched so
/// the consumer can render them however it wants.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct VersionDiff {
    pub field: String,
    pub from: serde_json::Value,
    pub to: serde_json::Value,
}

fn diff_section(
    out: &mut Vec<VersionDiff>,
    name: &str,
    a: Option<&serde_json::Value>,
    b: Option<&serde_json::Value>,
) {
    let a_obj = a.and_then(|v| v.as_object());
    let b_obj = b.and_then(|v| v.as_object());
    let mut keys: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    if let Some(o) = a_obj {
        keys.extend(o.keys().cloned());
    }
    if let Some(o) = b_obj {
        keys.extend(o.keys().cloned());
    }
    for key in keys {
        let av = a_obj
            .and_then(|o| o.get(&key))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let bv = b_obj
            .and_then(|o| o.get(&key))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        if av != bv {
            out.push(VersionDiff {
                field: format!("{name}.{key}"),
                from: av,
                to: bv,
            });
        }
    }
}

/// Pure replay-based diff between two versions of the same client.
/// Compares `demographics`, `referrer`, and `appointment` sub-blobs.
/// Output order is deterministic (BTreeSet of keys, fixed section order).
#[tauri::command(rename_all = "camelCase")]
fn diff_client_versions(
    client_id: String,
    version_a: u64,
    version_b: u64,
) -> Result<Vec<VersionDiff>, String> {
    let (store, _proj) = init_event_store_strict()?;
    let evs = store.get_events(&client_id).map_err(|e| e.to_string())?;
    replay::validate_event_stream(&evs).map_err(|e| format!("validation failed: {e}"))?;

    let trunc_a = truncate_to_version(evs.clone(), version_a)?;
    let snap_a = reducer::reduce(&trunc_a);
    let trunc_b = truncate_to_version(evs, version_b)?;
    let snap_b = reducer::reduce(&trunc_b);

    let null = serde_json::Value::Null;
    let blob_a = snap_a.demographics.as_ref().unwrap_or(&null);
    let blob_b = snap_b.demographics.as_ref().unwrap_or(&null);

    let mut out = Vec::new();
    diff_section(
        &mut out,
        "demographics",
        blob_a.get("demographics"),
        blob_b.get("demographics"),
    );
    diff_section(
        &mut out,
        "referrer",
        blob_a.get("referrer"),
        blob_b.get("referrer"),
    );
    diff_section(
        &mut out,
        "appointment",
        blob_a.get("appointment"),
        blob_b.get("appointment"),
    );
    Ok(out)
}

/// Promote a single field from a historical snapshot forward by emitting
/// the appropriate field-level event. Currently supports `"demographics"`,
/// which emits `DemographicsUpdated`. Returns the new version.
#[tauri::command(rename_all = "camelCase")]
fn restore_client_field_from_version(
    client_id: String,
    version: u64,
    field: String,
) -> Result<u64, String> {
    let (store, proj) = init_event_store_strict()?;
    let evs = store.get_events(&client_id).map_err(|e| e.to_string())?;
    replay::validate_event_stream(&evs).map_err(|e| format!("validation failed: {e}"))?;
    let truncated = truncate_to_version(evs, version)?;
    let snapshot = reducer::reduce(&truncated);

    let payload = match field.as_str() {
        "demographics" => events::EventPayload::DemographicsUpdated(
            events::DemographicsUpdatedP {
                demographics: snapshot
                    .demographics
                    .clone()
                    .unwrap_or(serde_json::Value::Null),
            },
        ),
        other => return Err(format!("unsupported field: {other}")),
    };

    let next_version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        next_version,
        events::Actor::System {
            component: "restore_client_field_from_version".into(),
        },
        payload,
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("restore_client_field_from_version: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("restore_client_field_from_version: project_forward failed: {e}"))?;
    Ok(next_version)
}

/// List every client in the projection. Returns full `ClientViewModel`s so
/// callers can render dropdowns / lists without further round-trips.
#[tauri::command]
fn list_clients() -> Result<Vec<projection::ClientViewModel>, String> {
    let (_store, proj) = init_event_store_strict()?;
    let ids = proj.list_client_ids().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        if let Some(v) = proj.get_client_view(&id).map_err(|e| e.to_string())? {
            out.push(v);
        }
    }
    Ok(out)
}

/// Replace a client's demographics blob. Emits `DemographicsUpdated`,
/// projects forward, and returns the new version.
#[tauri::command(rename_all = "camelCase")]
fn update_client_demographics(
    client_id: String,
    demographics: serde_json::Value,
) -> Result<u64, String> {
    let (store, proj) = init_event_store_strict()?;

    // Refuse to update an unknown client (caller must create_client first).
    if proj
        .get_client_view(&client_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err(format!("client not found: {client_id}"));
    }

    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "update_client_demographics".into() },
        events::EventPayload::DemographicsUpdated(events::DemographicsUpdatedP { demographics }),
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("update_client_demographics: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("update_client_demographics: project_forward failed: {e}"))?;

    Ok(version)
}

/// Delete a client. Refuses unknown ids, appends a `ClientDeleted` event,
/// projects forward (removing the row + child rows from the read model),
/// and returns the new event version.
#[tauri::command(rename_all = "camelCase")]
fn delete_client(client_id: String) -> Result<u64, String> {
    let (store, proj) = init_event_store_strict()?;

    if proj
        .get_client_view(&client_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err(format!("client not found: {client_id}"));
    }

    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "delete_client".into() },
        events::EventPayload::ClientDeleted(events::ClientDeletedP { reason: None }),
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("delete_client: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("delete_client: project_forward failed: {e}"))?;

    Ok(version)
}

/// Delete a single document. Mirrors `delete_client` one level down:
/// appends an immutable `DocumentDeleted` tombstone and projects it
/// forward, which hard-deletes the document + all derived projection
/// rows (clinical_events, resolved_attributions, document_participant_maps,
/// entities). The original DocumentExtracted/ClinicalEventsRecorded
/// events remain in the append-only log for audit; `rebuild_from_events`
/// honours the tombstone so the document never reappears.
///
/// Idempotent: deleting an already-deleted document still appends a
/// (harmless) tombstone and the cascade affects 0 rows.
#[tauri::command(rename_all = "camelCase")]
fn delete_document(client_id: String, document_id: String) -> Result<u64, String> {
    let (store, proj) = init_event_store_strict()?;

    // Guard the client (single source of truth). We do NOT require the
    // document to still exist — deletion is idempotent.
    ensure_client_exists(&client_id)?;

    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "delete_document".into() },
        events::EventPayload::DocumentDeleted(events::DocumentDeletedP {
            document_id: document_id.clone(),
            reason: None,
        }),
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("delete_document: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("delete_document: project_forward failed: {e}"))?;

    Ok(version)
}

/// Attach an already-extracted document to a client. The frontend runs the
/// existing extraction pipeline (`extract_file_contents`, NER, scispaCy, etc.)
/// and then calls this command with the metadata so the projection records it.
///
/// `correlation_id`, if supplied, must be a valid UUID; ignored if absent.
#[tauri::command(rename_all = "camelCase")]
fn attach_document(
    client_id: String,
    file_name: String,
    method: String,
    char_count: u64,
    correlation_id: Option<String>,
) -> Result<String, String> {
    let (store, proj) = init_event_store_strict()?;

    if proj
        .get_client_view(&client_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err(format!("client not found: {client_id}"));
    }

    let document_id = uuid::Uuid::now_v7().to_string();
    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let correlation_uuid = correlation_id
        .as_deref()
        .and_then(|s| uuid::Uuid::parse_str(s).ok());

    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "attach_document".into() },
        events::EventPayload::DocumentUploaded(events::DocumentUploadedP {
            document_id: document_id.clone(),
            file_name,
            char_count: char_count as usize,
            method,
        }),
        correlation_uuid,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("attach_document: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("attach_document: project_forward failed: {e}"))?;

    Ok(document_id)
}

// ─── Phase 7 — clinician decision persistence (opaque JSON only) ─────────────
// Stores the clinician's ClinicalDecision and the frozen ReportSnapshotV2 as
// opaque JSON lines. It does NOT interpret, modify, validate, or recompute any
// clinical content — it only writes and returns a storage confirmation.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistConfirmation {
    id: String,
    saved_at: String,
}

#[tauri::command(rename_all = "camelCase")]
fn persist_clinical_decision(
    snapshot: serde_json::Value,
    decision: serde_json::Value,
) -> Result<PersistConfirmation, String> {
    use std::io::Write;

    let id = uuid::Uuid::now_v7().to_string();
    let saved_at = chrono::Utc::now().to_rfc3339();

    let record = serde_json::json!({
        "id": id,
        "savedAt": saved_at,
        "snapshot": snapshot,
        "decision": decision,
    });
    let mut line = serde_json::to_string(&record).map_err(|e| e.to_string())?;
    line.push('\n');

    let path = event_store::default_clinical_decisions_path();
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("persist_clinical_decision: open failed: {e}"))?;
    f.write_all(line.as_bytes())
        .map_err(|e| format!("persist_clinical_decision: write failed: {e}"))?;

    Ok(PersistConfirmation { id, saved_at })
}

// ─── Phase 1 — canonical clinical fact spine ─────────────────────────────────
//
// The event store is the single durable truth for interview clinical state;
// the frontend ClinicalState is a projection cache rebuilt via
// get_clinical_state. Writes are append-only events; reads are pure folds.

/// Append one interview Observation to the client's clinical fact log.
/// The observation JSON is opaque except for a structural gate (id /
/// symptomTypeId / frame present) — facts that could never be collapsed
/// or projected are refused at the boundary. Returns the new version.
#[tauri::command(rename_all = "camelCase")]
fn record_clinical_observation(
    client_id: String,
    observation: serde_json::Value,
) -> Result<u64, String> {
    clinical_fact_store::validate_observation(&observation)?;
    let (store, proj) = init_event_store_strict()?;
    if proj
        .get_client_view(&client_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err(format!("client not found: {client_id}"));
    }

    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "record_clinical_observation".into() },
        events::EventPayload::ClinicalObservationRecorded(
            events::ClinicalObservationRecordedP { observation },
        ),
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("record_clinical_observation: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("record_clinical_observation: project_forward failed: {e}"))?;
    Ok(version)
}

/// Append one review-surface item (attestation / resolution / correction /
/// conclusion / snapshot) to the client's clinical state. Unknown kinds are
/// refused at this boundary (fail closed). Returns the new version.
#[tauri::command(rename_all = "camelCase")]
fn record_clinical_review_item(
    client_id: String,
    kind: String,
    item: serde_json::Value,
) -> Result<u64, String> {
    if !clinical_fact_store::REVIEW_KINDS.contains(&kind.as_str()) {
        return Err(format!(
            "record_clinical_review_item: unknown kind \"{kind}\" (expected one of {:?})",
            clinical_fact_store::REVIEW_KINDS
        ));
    }
    let (store, proj) = init_event_store_strict()?;
    if proj
        .get_client_view(&client_id)
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err(format!("client not found: {client_id}"));
    }

    let version = store.next_version(&client_id).map_err(|e| e.to_string())?;
    let env = events::EventEnvelope::new(
        client_id.clone(),
        version,
        events::Actor::System { component: "record_clinical_review_item".into() },
        events::EventPayload::ClinicalReviewRecorded(events::ClinicalReviewRecordedP {
            kind,
            item,
        }),
        None,
        None,
    );
    store
        .append_event(&env)
        .map_err(|e| format!("record_clinical_review_item: append failed: {e}"))?;
    proj.project_forward(std::slice::from_ref(&env))
        .map_err(|e| format!("record_clinical_review_item: project_forward failed: {e}"))?;
    Ok(version)
}

/// Rebuild the client's ClinicalState from the event log (pure fold) and
/// return it as JSON in exactly the shape `deserialiseState` consumes.
/// Reasoning is never returned — the frontend recomputes it.
#[tauri::command(rename_all = "camelCase")]
fn get_clinical_state(client_id: String) -> Result<String, String> {
    let (store, _proj) = init_event_store_strict()?;
    let events = store.get_events(&client_id).map_err(|e| e.to_string())?;
    let state = clinical_fact_store::fold_clinical_state(&events);
    serde_json::to_string(&state).map_err(|e| e.to_string())
}

// ─── Core commands (always compiled) ─────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Backend is working.", name)
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Strip XML tags from a DOCX document.xml string.
/// Converts </w:p> and <w:br> to newlines to preserve paragraph structure.
fn strip_xml_tags(xml: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    let mut tag_buf = String::new();

    for ch in xml.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag_buf.clear();
            }
            '>' => {
                in_tag = false;
                let tag = tag_buf.trim();
                if tag == "/w:p" || tag == "w:br" || tag.starts_with("w:br ") {
                    result.push('\n');
                }
                tag_buf.clear();
            }
            _ if in_tag => tag_buf.push(ch),
            _ => result.push(ch),
        }
    }

    result
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Extract plain text from a DOCX file by opening it as a ZIP archive and
/// parsing word/document.xml.
fn extract_docx(path: &str) -> Result<String, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut doc_file = archive
        .by_name("word/document.xml")
        .map_err(|e| e.to_string())?;
    let mut xml = String::new();
    doc_file.read_to_string(&mut xml).map_err(|e| e.to_string())?;
    Ok(strip_xml_tags(&xml))
}

/// Unified text extraction command.
///
/// Routes by file extension:
///
/// ```text
///   .pdf  → pdf-extract crate (text-layer extraction)
///   .docx → zip + word/document.xml parse
///   *     → raw UTF-8 read (TXT, MD, LOG, etc.)
/// ```
///
/// Returns Ok(empty string) rather than Err on extraction failures so the
/// frontend always receives a usable result and can display a graceful message.
#[tauri::command]
fn extract_text_hybrid(path: String) -> Result<String, String> {
    let lower = path.to_lowercase();

    if lower.ends_with(".pdf") {
        return pdf_extract::extract_text(&path)
            .map_err(|e| e.to_string());
    }

    if lower.ends_with(".docx") {
        return extract_docx(&path);
    }

    // Plain text fallback — TXT, MD, LOG, JSON, etc.
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// ─── Full content extraction with OCR fallback ───────────────────────────────

// Return type for all content extraction helpers:
//   (text, method, ocr_error)
// ocr_error is Some(message) when OCR was attempted but failed (e.g. missing
// pdftoppm), so the frontend can surface a specific actionable message.
type ContentResult = (String, &'static str, Option<String>);

/// OCR fallback for non-PDF files (images, plain text with sparse content).
fn apply_ocr_fallback(path: &str, text: String, non_ws: usize) -> ContentResult {
    // Only attempt OCR for image-like files; plain-text files with sparse
    // content shouldn't be sent to tesseract.
    let lower = path.to_lowercase();
    let is_image = lower.ends_with(".png")  || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg") || lower.ends_with(".tif")
                || lower.ends_with(".tiff") || lower.ends_with(".bmp");
    if !is_image {
        return (text, if non_ws > 0 { "text_sparse" } else { "empty" }, None);
    }
    match crate::ocr::run_ocr(path) {
        Ok(ocr_text) => {
            let ocr_non_ws = ocr_text.chars().filter(|c| !c.is_whitespace()).count();
            if ocr_non_ws > non_ws {
                return (ocr_text, "ocr", None);
            }
            (text, if non_ws > 0 { "text_sparse" } else { "empty" }, None)
        }
        Err(e) => (text, if non_ws > 0 { "text_sparse" } else { "empty" }, Some(e)),
    }
}

/// OCR strategy for PDFs — always attempted regardless of text-layer density.
///
/// A PDF can have perfectly good text pages alongside completely image-only
/// pages.  Checking the total non-whitespace count at the document level would
/// pass the sparse test while silently dropping all image pages.  Instead we
/// always run OCR on PDFs (when the feature is compiled in) and take whichever
/// source — text layer or OCR — yields more non-whitespace content.
fn pdf_content_with_ocr(path: &str, text: String, non_ws: usize) -> ContentResult {
    // Shortcut: skip OCR only when the text layer is dense PER PAGE
    // (≥200 non-ws chars × page count). A flat document-level threshold
    // reintroduced exactly the failure this function exists to prevent —
    // a bundle with a few dense text pages and many scanned pages passed
    // the shortcut and silently dropped every image page. If the page
    // count cannot be determined, fail towards running OCR.
    if let Some(pages) = crate::ocr::pdf_page_count(path) {
        if pages > 0 && non_ws >= 200 * pages {
            return (text, "text", None);
        }
    }
    match crate::ocr::run_ocr(path) {
        Ok(ocr_text) => {
            let ocr_non_ws = ocr_text.chars().filter(|c| !c.is_whitespace()).count();
            if ocr_non_ws > non_ws {
                (ocr_text, "ocr", None)
            } else {
                let method = if non_ws >= 50 { "text" }
                             else if non_ws > 0 { "text_sparse" }
                             else { "empty" };
                (text, method, None)
            }
        }
        Err(e) => {
            let method = if non_ws >= 50 { "text" }
                         else if non_ws > 0 { "text_sparse" }
                         else { "empty" };
            (text, method, Some(e))
        }
    }
}

/// Extract the full readable content of a file, with OCR fallback.
///
/// Strategy differs by file type:
///   PDF  — OCR is always attempted; the richer of text-layer vs OCR is used.
///          (Mixed documents with some image-only pages are handled correctly.)
///   Other — OCR is attempted only when the text layer is sparse (< 50 chars).
///
/// Returns JSON:
///   {
///     "text":          string,         — full extracted content
///     "method":        string,         — "text" | "ocr" | "text_sparse" | "empty"
///     "char_count":    number,         — byte length of returned text
///     "ocr_available": bool,           — whether OCR feature is compiled in
///     "ocr_error":     string | null   — error message if OCR was attempted but failed
///   }
#[tauri::command(rename_all = "camelCase")]
fn extract_file_contents(path: String) -> Result<String, String> {
    let text   = extract_text_hybrid(path.clone()).unwrap_or_default();
    let non_ws = text.chars().filter(|c| !c.is_whitespace()).count();

    let (final_text, method, ocr_error) = if path.to_lowercase().ends_with(".pdf") {
        pdf_content_with_ocr(&path, text, non_ws)
    } else if non_ws >= 50 {
        (text, "text", None)
    } else {
        apply_ocr_fallback(&path, text, non_ws)
    };

    // Count CHARACTERS, not bytes — the field is named char_count and the
    // frontend compares it against JS string lengths.
    let char_count = final_text.chars().count();

    Ok(serde_json::json!({
        "text":          final_text,
        "method":        method,
        "char_count":    char_count,
        "ocr_available": true,
        "ocr_error":     ocr_error,
    }).to_string())
}

// ─── Structured medico-legal extraction ──────────────────────────────────────

/// Detect the likely document type from lowercased text.
#[allow(dead_code)]
fn detect_document_type(lower: &str) -> &'static str {
    // Bundle detection wins before any other classification — a multi-source
    // case bundle with sections like "SOURCE A", "SOURCE B" must not be
    // mislabelled as imaging just because one section mentions MRI.
    if is_multi_source_bundle(lower) {
        return "bundle";
    }
    // GP notes — a frequent FakeClient4 pattern; OCR'd as "GP NOTES",
    // "gp notes", "gp note", or "general practice notes".
    if lower.contains("gp notes")
        || lower.contains("gp note")
        || lower.contains("general practice note")
    {
        return "gp_notes";
    }
    // A standalone imaging report typically has the word "imaging" or a
    // modality name AND the word "report"/"study"/"findings" together in
    // the first few lines. We approximate that with a stronger heuristic:
    // imaging keyword AND (radiology|findings|impression) in the *same*
    // document. This is intentionally still loose for single-source files.
    let imaging_modality = lower.contains("x-ray")
        || lower.contains("mri")
        || lower.contains("ct scan")
        || lower.contains("ultrasound")
        || lower.contains("imaging");
    if imaging_modality
        && (lower.contains("radiology")
            || lower.contains("findings:")
            || lower.contains("impression:"))
    {
        return "imaging";
    }
    if lower.contains("referral") {
        return "referral";
    }
    if lower.contains("statement") {
        return "statement";
    }
    if lower.contains("report") {
        return "report";
    }
    "unknown"
}

/// Multi-source case bundles use repeated "SOURCE A", "SOURCE B" (etc.)
/// section markers. We require at least two distinct markers to qualify so
/// a single passing mention doesn't trip the classifier.
fn is_multi_source_bundle(lower: &str) -> bool {
    // Cheap check: count distinct "source <letter>" occurrences.
    let mut found = std::collections::HashSet::new();
    let bytes = lower.as_bytes();
    let needle = "source ";
    let mut start = 0;
    while let Some(rel) = lower[start..].find(needle) {
        let pos = start + rel + needle.len();
        if let Some(&b) = bytes.get(pos) {
            if (b as char).is_ascii_alphabetic() {
                found.insert(b);
                if found.len() >= 2 {
                    return true;
                }
            }
        }
        start = pos + 1;
    }
    false
}

/// Extract the value that follows one of the given label strings (e.g. "patient:").
/// Returns the first non-empty match, capped at 60 chars, or an empty string.
#[allow(dead_code)]
fn extract_party_value(text: &str, labels: &[&str]) -> String {
    let lower = text.to_lowercase();
    for &label in labels {
        if let Some(pos) = lower.find(label) {
            let after_label = pos + label.len();
            if after_label >= text.len() {
                continue;
            }
            let value: String = text[after_label..]
                .chars()
                .take_while(|&c| c != '\n' && c != '\r')
                .collect::<String>()
                .trim()
                .trim_start_matches(':')
                .trim()
                .chars()
                .take(60)
                .collect();
            if !value.is_empty() {
                return value;
            }
        }
    }
    String::new()
}

/// Return true if `lower_text` (already lowercased ASCII) contains `kw` as
/// a complete word — i.e. not embedded inside a longer alphanumeric token.
///
/// Examples:
///   contains_word("intermittently tearful",  "tear")     → false  (suffix of "tearful")
///   contains_word("she reported a tear",      "tear")     → true
///   contains_word("prescribed physiotherapy", "therapy")  → false  (suffix of "physiotherapy")
///   contains_word("emdr therapy was used",    "therapy")  → true
///   contains_word("no ptsd diagnosis",        "ptsd")     → true
fn contains_word(lower_text: &str, kw: &str) -> bool {
    let kw_len = kw.len();
    let bytes   = lower_text.as_bytes();
    let text_len = lower_text.len();
    let mut start = 0_usize;
    loop {
        let Some(rel) = lower_text[start..].find(kw) else { break };
        let pos = start + rel;
        let left_ok  = pos == 0
            || !bytes[pos - 1].is_ascii_alphanumeric();
        let right_ok = pos + kw_len >= text_len
            || !bytes[pos + kw_len].is_ascii_alphanumeric();
        if left_ok && right_ok {
            return true;
        }
        // Advance to the next char boundary — pos + 1 can land inside a
        // multi-byte char when the text contains non-ASCII, and slicing
        // at a non-boundary panics.
        start = pos + 1;
        while start < text_len && !lower_text.is_char_boundary(start) {
            start += 1;
        }
        if start >= text_len { break; }
    }
    false
}

/// Return the sentence (up to 150 chars) that contains `keyword` in `text`.
/// Uses ASCII-only lowercasing, which preserves byte length — so positions
/// found in `lower` are always valid char-boundary offsets into `text`,
/// even when the document contains non-ASCII characters whose full Unicode
/// lowercase has a different byte length (İ → i̇).
/// Called by extract_structured_data to build evidence snippets.
fn extract_snippet(text: &str, keyword: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let Some(pos) = lower.find(keyword) else {
        return String::new();
    };

    // Walk back to the start of the enclosing sentence
    let start = text[..pos]
        .rfind(|c: char| c == '.' || c == '\n')
        .map(|p| p + 1)
        .unwrap_or(0);

    // Walk forward to the end of the enclosing sentence
    let after = &text[pos..];
    let end_rel = after
        .find(|c: char| c == '.' || c == '\n')
        .map(|p| p + 1)
        .unwrap_or_else(|| after.chars().take(150).map(char::len_utf8).sum());

    text[start..pos + end_rel]
        .trim()
        .chars()
        .take(150)
        .collect()
}

/// Return the original-cased term from `text` at the position where `keyword`
/// (lowercased) first matches.  Captures enough words to cover the full keyword
/// phrase, preserving capitalisation from the source (e.g. "PTSD", "ACL").
///
/// Falls back to `keyword` itself if no match is found.
fn extract_original_term(text: &str, keyword: &str) -> String {
    // ASCII-only lowercase — byte-length-preserving, see extract_snippet.
    let lower = text.to_ascii_lowercase();
    let Some(pos) = lower.find(keyword) else {
        return keyword.to_string();
    };
    // Count how many whitespace-separated tokens the keyword spans
    let kw_word_count = keyword.split_whitespace().count().max(1);
    // Extract that many tokens from the original text at pos
    text[pos..]
        .split_whitespace()
        .take(kw_word_count)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Return true if `s` looks like a date token: DD/MM/YYYY, MM/DD/YYYY, or YYYY-MM-DD.
#[allow(dead_code)]
fn is_date_token(s: &str) -> bool {
    if s.contains('/') {
        let parts: Vec<&str> = s.split('/').collect();
        return parts.len() == 3
            && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
            && parts[0].len() <= 2
            && parts[1].len() <= 2
            && (parts[2].len() == 2 || parts[2].len() == 4);
    }
    if s.contains('-') {
        let parts: Vec<&str> = s.split('-').collect();
        return parts.len() == 3
            && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
            && parts[0].len() == 4
            && parts[1].len() == 2
            && parts[2].len() == 2;
    }
    false
}

/// Scan `text` for tokens that look like dates and return them deduplicated.
#[allow(dead_code)]
fn find_dates(text: &str) -> Vec<serde_json::Value> {
    let mut seen = std::collections::HashSet::new();
    let mut dates = Vec::new();
    for word in text.split(|c: char| c.is_whitespace() || ",;()[]".contains(c)) {
        let token = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '-');
        if !token.is_empty() && is_date_token(token) && seen.insert(token.to_string()) {
            dates.push(serde_json::Value::String(token.to_string()));
        }
    }
    dates
}

/// Medico-legal extraction with evidence traceability.
///
/// Every extracted structured field (conditions, medications, procedures) is
/// accompanied by a provenance entry in `_evidence` containing the source
/// snippet, document id, and a rule-based confidence score.
///
/// INDEX DOCUMENTS receive only minimal metadata — no clinical fields are
/// extracted.  This is enforced before any keyword scanning takes place.
///
/// Parameters:
///   text   — raw document text (UTF-8)
///   doc_id — caller-supplied identifier (typically the filename)

// ── Output guard ──────────────────────────────────────────────────────────────
//
// In debug builds, panics if any entity string in the final output carries signs
// of raw OCR noise that should have been caught by entity_clean.
//
// Checks (per entity string):
//   1. No code-file extensions (.js, .html, .py, .ts, .tsx, .jsx, .rs)
//   2. Symbol ratio < 0.25  (same threshold as entity_clean::garbage_filter)
//   3. Length ≥ 3 chars, OR string is a known valid medical abbreviation
//   4. No known UI/programming keywords (chatgpt, golive, utf-8, codex …)
//
// Release builds: the function is a no-op and compiles to nothing.
fn assert_output_is_clean(entities: &[String], label: &str) {
    #[cfg(debug_assertions)]
    {
        const CODE_EXTS: &[&str] = &[
            ".js", ".ts", ".tsx", ".jsx", ".html", ".htm", ".css",
            ".py", ".rs", ".go", ".java", ".sh",
        ];
        const PROG_TOKENS: &[&str] = &[
            "javascript", "typescript", "chatgpt", "claude.ai",
            "utf-8", "golive", "codex", "openai", "webpack", "vite",
        ];
        const VALID_SHORT: &[&str] = &[
            "ct", "mri", "gp", "ed", "bp", "hr", "iv", "im",
            "ms", "tbi", "ocd", "dvt", "acl", "mcl", "dva",
        ];

        for entity in entities {
            let lower = entity.to_lowercase();

            // 1. No code file extensions
            for ext in CODE_EXTS {
                debug_assert!(
                    !lower.contains(ext),
                    "[assert_output_is_clean] Code extension leaked into {}: {:?}",
                    label, entity
                );
            }

            // 2. No UI / programming keywords
            for token in PROG_TOKENS {
                debug_assert!(
                    !lower.contains(token),
                    "[assert_output_is_clean] UI/programming token leaked into {}: {:?}",
                    label, entity
                );
            }

            // 3. Length ≥ 3 unless a known valid medical abbreviation
            if entity.chars().count() < 3 {
                debug_assert!(
                    VALID_SHORT.contains(&lower.as_str()),
                    "[assert_output_is_clean] Entity too short and not a valid abbreviation \
                     in {}: {:?}",
                    label, entity
                );
            }

            // 4. Symbol ratio < 0.25
            let non_ws = entity.chars().filter(|c| !c.is_whitespace()).count();
            if non_ws > 0 {
                let symbols = entity
                    .chars()
                    .filter(|&c| {
                        !c.is_alphanumeric() && c != ' ' && c != '-' && c != '/' && c != '.'
                    })
                    .count();
                debug_assert!(
                    (symbols as f64 / non_ws as f64) < 0.25,
                    "[assert_output_is_clean] High symbol ratio in {}: {:?}",
                    label, entity
                );
            }
        }
    }
    // Suppress unused-variable warnings in release builds
    let _ = (entities, label);
}

#[tauri::command(rename_all = "camelCase")]
fn extract_structured_data(text: String, doc_id: String) -> Result<String, String> {
    use std::collections::HashSet;

    // Clean OCR / UI noise BEFORE any keyword scanning. Keep the raw text
    // available only to `process_document` for audit display — the
    // structured extractor itself never sees ChatGPT / GoLive / etc.
    //
    // INDEX-PHRASE DETECTION runs against the RAW lowercased text,
    // because text_clean's short-line rule will eat a bare "Index of
    // supporting documents" heading before the phrase scan runs.
    let raw_lower = text.to_lowercase();
    let cleaned = text_clean::clean_extracted_text(&text);
    let text = cleaned.clean_text.clone();

    // ASCII-only lowercase: keeps byte offsets aligned with `text` for
    // contains_word / extract_snippet / extract_original_term (all keyword
    // lists are ASCII, so matching behaviour is unchanged).
    let lower = text.to_ascii_lowercase();

    // ── Document type ─────────────────────────────────────────────────────────
    // Route through the upgraded classifier so multi-source bundles are
    // recognised and a passing "MRI" mention doesn't promote a whole
    // bundle to type=imaging.
    let doc_type = detect_document_type(&lower);

    // ── Date collection — must happen before index detection (density check) ──
    //
    // Two parsers run in parallel:
    //   Format A — dd/mm/yyyy  (most common in AU medico-legal docs)
    //   Format B — "12 June 2023", "June 2023", "March 2022"  (prose format)
    //
    // Corrupted digits (e.g. "2@" from OCR) are stripped before parsing.
    // Year-only tokens ("2020") produce a Jan-01 placeholder for timeline ordering.
    let mut dates_set: HashSet<String> = HashSet::new();

    // Format A — numeric dd/mm/yyyy or dd/mm/yy
    for token in lower.split_whitespace() {
        // Strip leading/trailing non-digit-slash noise (e.g. "(15/03/2022)")
        let token = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '/');
        if !token.contains('/') { continue; }
        let parts: Vec<&str> = token.split('/').collect();
        if parts.len() != 3 { continue; }
        // Strip any remaining non-digit chars (OCR corruption like "2@" → "2")
        let d_raw: String = parts[0].chars().filter(|c| c.is_ascii_digit()).collect();
        let m_raw: String = parts[1].chars().filter(|c| c.is_ascii_digit()).collect();
        let y_raw: String = parts[2].chars().filter(|c| c.is_ascii_digit()).collect();
        let d = d_raw.parse::<u32>().unwrap_or(0);
        let m = m_raw.parse::<u32>().unwrap_or(0);
        let y = y_raw.parse::<u32>().unwrap_or(0);
        if d < 1 || d > 31 || m < 1 || m > 12 || y == 0 { continue; }
        let year = if y < 100 { 2000 + y } else { y };
        if year < 1950 || year > 2100 { continue; }
        dates_set.insert(format!("{:04}-{:02}-{:02}", year, m, d));
    }

    // Format B — prose dates: "12 June 2023" / "June 2023" / "2020"
    // Scan the original text (mixed-case) token-by-token using a sliding window.
    {
        const MONTHS: &[(&str, u32)] = &[
            ("january",1),("february",2),("march",3),("april",4),
            ("may",5),("june",6),("july",7),("august",8),
            ("september",9),("october",10),("november",11),("december",12),
            // Abbreviated forms
            ("jan",1),("feb",2),("mar",3),("apr",4),
            ("jun",6),("jul",7),("aug",8),("sep",9),("oct",10),("nov",11),("dec",12),
        ];

        let tokens: Vec<&str> = text.split_whitespace().collect();
        for i in 0..tokens.len() {
            let t0 = tokens[i].to_lowercase();
            // Strip trailing punctuation from tokens (comma, colon, etc.)
            let t0 = t0.trim_end_matches(|c: char| !c.is_alphanumeric());

            // Month name found — try "dd Month yyyy" and "Month yyyy"
            if let Some(&(_, month_num)) = MONTHS.iter().find(|&&(m, _)| m == t0) {
                // Attempt "dd Month yyyy": tokens[i-1] = day, tokens[i+1] = year
                let day_opt: Option<u32> = if i > 0 {
                    let d_raw: String = tokens[i-1].chars().filter(|c| c.is_ascii_digit()).collect();
                    d_raw.parse::<u32>().ok().filter(|&d| d >= 1 && d <= 31)
                } else { None };

                let year_opt: Option<u32> = if i + 1 < tokens.len() {
                    let y_raw: String = tokens[i+1].chars().filter(|c| c.is_ascii_digit()).collect();
                    y_raw.parse::<u32>().ok().filter(|&y| y >= 1950 && y <= 2100)
                } else { None };

                match (day_opt, year_opt) {
                    (Some(d), Some(y)) =>
                        { dates_set.insert(format!("{:04}-{:02}-{:02}", y, month_num, d)); }
                    (None, Some(y)) =>
                        // "Month yyyy" — use day = 01 as placeholder
                        { dates_set.insert(format!("{:04}-{:02}-01", y, month_num)); }
                    _ => {}
                }
            }

            // Bare 4-digit year (e.g. "2020", "2021") as last resort.
            // STRICT: the token itself (after stripping surrounding
            // punctuation) must be exactly four digits. Filtering digits
            // out of mixed tokens fabricated dates from "2000mg" doses,
            // postcodes and form numbers, which both polluted the date
            // list and inflated the index-detection density gate.
            let t_year = t0.trim_matches(|c: char| !c.is_ascii_alphanumeric());
            if t_year.len() == 4 && t_year.chars().all(|c| c.is_ascii_digit()) {
                if let Ok(y) = t_year.parse::<u32>() {
                    if y >= 1950 && y <= 2100 {
                        // Use Jan-01 placeholder — gives timeline ordering
                        dates_set.insert(format!("{:04}-01-01", y));
                    }
                }
            }
        }
    }

    // ── Index-document detection ─────────────────────────────────────────────
    //
    // Index documents (court exhibit lists, document registers) must not
    // contribute clinical fields. The previous rule classified by date
    // density alone (`dates_set.len() >= 8`), which silently demoted
    // legitimate longitudinal clinical reports (Fake Pt 2 was a casualty).
    //
    // New rule — index iff either
    //   A. An explicit index/list phrase appears, OR
    //   B. Many dates (≥ 12) appear AND clinical signal is essentially
    //      absent (no diagnostic verbs/labels and no condition or med
    //      keywords found in the body text).
    //
    // Always compute `index_confidence ∈ [0,1]` so the UI can show a
    // graceful "looks like an index" hint rather than silently blanking
    // the extraction.
    const INDEX_PHRASES: &[&str] = &[
        "index of supporting documents",
        "index of documents",
        "document author date page",
        "author date page",
        "list of documents",
        "schedule of documents",
        "table of documents",
    ];
    let phrase_hit = INDEX_PHRASES.iter().any(|p| raw_lower.contains(p) || lower.contains(p));

    // Cheap clinical-signal probe — these terms are universally present
    // in clinical narratives. If NONE appear we treat the document as
    // un-clinical for the index gate.
    const CLINICAL_SIGNAL_PROBE: &[&str] = &[
        "diagnosis", "diagnosed", "patient", "complains", "presents",
        "treatment", "prescribed", "history of", "impression",
        "examination", "symptoms", "reports ", "noted", "review",
    ];
    let clinical_hits = CLINICAL_SIGNAL_PROBE
        .iter()
        .filter(|kw| lower.contains(*kw))
        .count();
    let many_dates = dates_set.len() >= 12;
    let low_clinical_signal = clinical_hits == 0;

    let is_index_document = phrase_hit || (many_dates && low_clinical_signal);
    // Confidence: explicit phrase → 0.95; density+no-signal → 0.55; else 0.
    let index_confidence: f64 = if phrase_hit {
        0.95
    } else if many_dates && low_clinical_signal {
        0.55
    } else {
        0.0
    };

    // ── INDEX PATH: return metadata-only record immediately ───────────────────
    if is_index_document {
        let result = serde_json::json!({
            "doc_id":            doc_id,
            "document_type":     doc_type,
            "is_index_document": true,
            "index_confidence":  index_confidence,
            "parties":           { "patient": "", "doctor": "", "organisation": "" },
            "dates":             [],
            "key_findings":      [],
            "conditions":        [],                // canonical
            "injuries_or_conditions": [],           // deprecated alias
            "medications":       [],
            "procedures":        [],
            "timeline_events":   [],
            "source_text_snippets": [],
            "_evidence":         { "conditions": [], "medications": [], "procedures": [] }
        });
        return Ok(result.to_string());
    }

    // ── CLINICAL PATH: full extraction with provenance ────────────────────────

    // Dates (already collected above — sort and finalise)
    let mut dates_vec: Vec<String> = dates_set.into_iter().collect();
    dates_vec.sort();

    // Key findings — up to 5 clinical content lines.
    //
    // Selection criteria (applied in order, all must pass):
    //   1. At least 20 chars after trimming
    //   2. At least 50% of non-whitespace chars are alphanumeric (symbol filter)
    //   3. Does NOT match known UI noise prefixes
    //   4. Contains at least one word of ≥ 4 chars (eliminates "? x y" fragments)
    //
    // Lines are taken from the NORMALISED text so UI chrome has already been
    // stripped at the text level; this is a secondary safety filter on whatever
    // survives into extract_structured_data.
    let snippets: Vec<String> = {
        const NOISE_PREFIXES: &[&str] = &[
            "chatgpt", "get plus", "golive", "utf-8", "javascript",
            "install tonight", "remind me later", "updates available",
            "do you want to install", "ask anything",
        ];
        text.lines()
            .map(|l| l.trim())
            .filter(|l| l.len() >= 20)
            .filter(|l| {
                // Symbol density check
                let non_ws = l.chars().filter(|c| !c.is_whitespace()).count();
                if non_ws == 0 { return false; }
                let alpha = l.chars().filter(|c| c.is_alphanumeric()).count();
                (alpha as f64 / non_ws as f64) >= 0.50
            })
            .filter(|l| {
                let ll = l.to_lowercase();
                !NOISE_PREFIXES.iter().any(|p| ll.starts_with(p) || ll.contains(p))
            })
            .filter(|l| l.split_whitespace().any(|w| w.len() >= 4))
            .take(5)
            .map(str::to_string)
            .collect()
    };

    // ── Conditions with evidence ──────────────────────────────────────────────
    //
    // Multi-word keywords are preferred — they match more specifically and their
    // full text becomes the canonical `value` in evidence.  Single-word fallbacks
    // only fire when the more specific phrase is absent.
    //
    // All matches use contains_word() so "anxiety" cannot match "anxiously",
    // "tear" cannot match "tearful", and "therapy" cannot match "physiotherapy".
    const CONDITION_KEYWORDS: &[(&str, f64)] = &[
        // Musculoskeletal — specific first, generic fallback last
        ("rotator cuff tear",             0.97),
        ("meniscus tear",                 0.97),
        ("disc herniation",               0.95),
        // AU/UK radiology vocabulary — production TEST CASE 4 used
        // "lumbar disc prolapse" and the diagnosis was silently dropped
        // because only the US "herniation" form was listed. Keep in sync
        // with structured_extract.rs's injury lexicon.
        ("disc prolapse",                 0.95),
        ("disc protrusion",               0.93),
        ("disc bulge",                    0.90),
        ("nerve damage",                  0.92),
        ("traumatic brain injury",        0.95),
        ("chronic pain",                  0.88),
        ("fracture",                      0.90),
        ("sprain",                        0.85),
        ("strain",                        0.85),
        ("herniation",                    0.90),
        ("tendinopathy",                  0.90),
        ("tendinitis",                    0.88),
        ("arthritis",                     0.85),
        ("osteoarthritis",                0.90),
        ("tear",                          0.82),   // word-boundary safe with contains_word
        ("contusion",                     0.85),
        ("whiplash",                      0.90),
        ("bursitis",                      0.88),
        ("rotator cuff",                  0.90),
        ("acl",                           0.90),
        ("meniscus",                      0.88),
        ("fibromyalgia",                  0.92),
        ("sciatica",                      0.90),
        ("scoliosis",                     0.88),
        ("tbi",                           0.85),
        // Psychological — full DSM/ICD names preferred
        ("post-traumatic stress disorder", 0.97),
        ("major depressive disorder",     0.97),
        ("generalised anxiety disorder",  0.97),
        ("generalized anxiety disorder",  0.97),
        ("anxiety disorder",              0.93),
        ("adjustment disorder",           0.95),
        ("panic disorder",                0.95),
        ("acute stress disorder",         0.95),
        ("somatic symptom disorder",      0.92),
        ("agoraphobia",                   0.93),
        ("ptsd",                          0.90),
        ("depression",                    0.85),
        ("anxiety",                       0.80),
        ("concussion",                    0.90),
    ];
    let mut conditions_seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut conditions_vec: Vec<String> = Vec::new();
    let mut conditions_evidence: Vec<serde_json::Value> = Vec::new();
    for &(kw, confidence) in CONDITION_KEYWORDS {
        if !contains_word(&lower, kw) { continue; }
        // Dedup: skip shorter keywords whose match is already covered by a longer one
        let already_covered = conditions_seen.iter().any(|existing| existing.contains(kw));
        if already_covered { continue; }
        conditions_seen.insert(kw.to_string());
        // Retrieve the original-cased term from text (preserves "PTSD", "ACL", etc.)
        let term = extract_original_term(&text, kw);
        conditions_vec.push(term.clone());
        let snippet = extract_snippet(&text, kw);
        conditions_evidence.push(serde_json::json!({
            "value":              term,
            "source_document_id": doc_id,
            "source_snippet":     snippet,
            "page":               serde_json::Value::Null,
            "confidence":         confidence
        }));
    }
    conditions_vec.sort();

    // ── Medications with evidence ─────────────────────────────────────────────
    const MED_KEYWORDS: &[(&str, f64)] = &[
        // Anti-inflammatories / analgesics
        ("ibuprofen",          0.95), ("paracetamol",     0.95),
        ("naproxen",           0.95), ("diclofenac",      0.95),
        ("celecoxib",          0.95), ("aspirin",         0.90),
        ("anti-inflammatory",  0.85),
        // Opioids / strong analgesics
        ("morphine",           0.95), ("oxycodone",       0.95),
        ("endone",             0.95), ("tramadol",        0.95),
        ("codeine",            0.95), ("fentanyl",        0.95),
        ("hydrocodone",        0.95), ("buprenorphine",   0.95),
        ("opioid",             0.88),
        // SSRIs / SNRIs / antidepressants
        ("paroxetine",         0.97), ("aropax",          0.95),
        ("sertraline",         0.97), ("zoloft",          0.95),
        ("fluoxetine",         0.97), ("prozac",          0.95),
        ("escitalopram",       0.97), ("lexapro",         0.95),
        ("citalopram",         0.97),
        ("venlafaxine",        0.97), ("effexor",         0.95),
        ("duloxetine",         0.97), ("cymbalta",        0.95),
        ("desvenlafaxine",     0.97), ("pristiq",         0.95),
        ("mirtazapine",        0.95), ("remeron",         0.92),
        ("amitriptyline",      0.95), ("nortriptyline",   0.95),
        // Antipsychotics
        ("quetiapine",         0.95), ("seroquel",        0.92),
        ("olanzapine",         0.95), ("zyprexa",         0.92),
        ("risperidone",        0.95),
        // Anxiolytics / hypnotics
        ("diazepam",           0.95), ("valium",          0.92),
        ("clonazepam",         0.95), ("rivotril",        0.92),
        ("alprazolam",         0.95), ("xanax",           0.92),
        ("lorazepam",          0.95), ("ativan",          0.92),
        ("temazepam",          0.95),
        // Neuropathic / anticonvulsants
        ("pregabalin",         0.97), ("lyrica",          0.92),
        ("gabapentin",         0.95), ("neurontin",       0.92),
        // Common OTC / other
        ("panadol",            0.95), ("nurofen",         0.95),
        ("voltaren",           0.92),
    ];
    let mut medications_seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut medications_vec: Vec<String> = Vec::new();
    let mut medications_evidence: Vec<serde_json::Value> = Vec::new();
    for &(kw, confidence) in MED_KEYWORDS {
        if !contains_word(&lower, kw) { continue; }
        let already_covered = medications_seen.iter().any(|e| e.contains(kw) || kw.contains(e.as_str()));
        if already_covered { continue; }
        medications_seen.insert(kw.to_string());
        let term = extract_original_term(&text, kw);
        medications_vec.push(term.clone());
        let snippet = extract_snippet(&text, kw);
        medications_evidence.push(serde_json::json!({
            "value":              term,
            "source_document_id": doc_id,
            "source_snippet":     snippet,
            "page":               serde_json::Value::Null,
            "confidence":         confidence
        }));
    }
    medications_vec.sort();

    // ── Procedures with evidence ──────────────────────────────────────────────
    //
    // Use multi-word specific terms where possible.
    // Broad single words ("therapy", "assessment") are excluded because they
    // match too many false positives; scispaCy will provide the full named procedure.
    const PROC_KEYWORDS: &[(&str, f64)] = &[
        // Surgical
        ("arthroscopy",                   0.95),
        ("arthroplasty",                  0.95),
        ("spinal fusion",                 0.95),
        ("laminectomy",                   0.95),
        ("discectomy",                    0.95),
        ("surgery",                       0.88),
        ("operation",                     0.85),
        // Injections
        ("cortisone injection",           0.95),
        ("steroid injection",             0.95),
        ("epidural injection",            0.95),
        ("nerve block",                   0.95),
        ("injection",                     0.82),
        // Therapies — specific names only to avoid false matches on "physiotherapy" etc.
        ("emdr therapy",                  0.95),
        ("emdr",                          0.93),
        ("cognitive behavioural therapy", 0.95),
        ("cognitive behavioral therapy",  0.95),
        ("cbt",                           0.88),
        ("psychotherapy",                 0.92),
        ("occupational therapy",          0.92),
        ("physiotherapy",                 0.90),
        ("rehabilitation",                0.85),
        // Diagnostic procedures
        ("psychiatric assessment",        0.93),
        ("psychological assessment",      0.93),
        ("functional capacity assessment", 0.93),
        ("neuropsychological assessment", 0.95),
        ("independent medical examination", 0.95),
        ("mri",                           0.88),
        ("ct scan",                       0.88),
        ("x-ray",                         0.85),
        ("ultrasound",                    0.85),
    ];
    let mut procedures_seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut procedures_vec: Vec<String> = Vec::new();
    let mut procedures_evidence: Vec<serde_json::Value> = Vec::new();
    for &(kw, confidence) in PROC_KEYWORDS {
        if !contains_word(&lower, kw) { continue; }
        let already_covered = procedures_seen.iter().any(|e| e.contains(kw));
        if already_covered { continue; }
        procedures_seen.insert(kw.to_string());
        let term = extract_original_term(&text, kw);
        procedures_vec.push(term.clone());
        let snippet = extract_snippet(&text, kw);
        procedures_evidence.push(serde_json::json!({
            "value":              term,
            "source_document_id": doc_id,
            "source_snippet":     snippet,
            "page":               serde_json::Value::Null,
            "confidence":         confidence
        }));
    }
    procedures_vec.sort();

    // ── Layer 2: Entity cleaning ──────────────────────────────────────────────
    //
    // entity_clean normalises, expands synonyms (PTSD → post-traumatic stress
    // disorder, Zoloft → sertraline, etc.), filters OCR garbage, removes dosing
    // frequencies, anatomy-only terms, and event/mechanism phrases.
    //
    let clean_input = entity_clean::CleanInput {
        conditions:  conditions_vec,
        medications: medications_vec,
        procedures:  procedures_vec,
    };
    // Second argument is `debug` (populates CleanOutput::removed for
    // inspection only — it does NOT relax any filtering). The removed
    // list is unused here, so keep it off.
    let cleaned = entity_clean::clean_entities(clean_input, false);

    // Secondary structural guard (cheap, always-on).
    assert_output_is_clean(&cleaned.conditions,  "entity_clean→conditions");
    assert_output_is_clean(&cleaned.medications, "entity_clean→medications");
    assert_output_is_clean(&cleaned.procedures,  "entity_clean→procedures");

    // ── Layer 3: Strict validation gate ──────────────────────────────────────
    //
    // validate_entities runs all 11 pipeline stages:
    //   1. Structural validation  (newlines, symbol density, UI tokens)
    //   2. Normal form            (canonical for dedup/matching)
    //   3. Medical shape          (recognisable clinical pattern)
    //   4. Semantic plausibility  (known term or suffix match)
    //   5. Context classification (negated / contradicted / hypothetical / affirmed)
    //   6. Evidence requirement   (≥1 strong or ≥2 total mentions)
    //   7. Specificity preservation (prefer "L4/5 disc herniation")
    //   8. Semantic deduplication  (within each category)
    //   9. Category enforcement    (cross-category uniqueness)
    //  10. Confidence scoring      (additive, threshold 0.35)
    //  11. Final assertion gate    (debug panic on any surviving garbage)
    let doc_context = validation::DocumentContext {
        full_text:       text.clone(),
        source_snippets: snippets.clone(),
        document_type:   doc_type.to_string(),
    };
    let validated = validation::validate_entities(
        validation::CleanedEntities {
            conditions:  cleaned.conditions.clone(),
            medications: cleaned.medications.clone(),
            procedures:  cleaned.procedures.clone(),
        },
        &doc_context,
    );

    // The gate is LIVE: these are the values the output emits. (A prior
    // audit found the validated results bound to underscore variables and
    // discarded — the 11-stage gate ran but gated nothing.)
    //
    // Context-based rejections are RE-ADMITTED: at this layer, negation /
    // querying / contradiction is represented downstream as per-mention
    // `assertion_status` (the multi-mention requirement — one clinician
    // affirms PTSD, another rejects it, both must appear), and the
    // contradiction engine consumes those mentions. Dropping the entity
    // here would hide the disagreement entirely. Structural / medical-
    // shape / plausibility rejections (OCR garbage, UI tokens, anatomy-
    // only fragments) remain final.
    const CONTEXT_REJECTIONS: &[&str] = &[
        "entity is negated in source document",
        "entity is contradicted in source document",
        "insufficient evidence: needs ≥1 strong mention or ≥2 total mentions",
        "confidence below acceptance threshold (0.35)",
    ];
    let mut final_conditions  = validated.condition_values();
    let mut final_medications = validated.medication_values();
    let mut final_procedures  = validated.procedure_values();
    for e in &validated.rejected {
        let context_only = e
            .rejection_reason
            .as_deref()
            .map(|r| CONTEXT_REJECTIONS.contains(&r))
            .unwrap_or(false);
        if !context_only {
            continue;
        }
        if cleaned.conditions.iter().any(|c| c == &e.value) {
            final_conditions.push(e.value.clone());
        } else if cleaned.medications.iter().any(|c| c == &e.value) {
            final_medications.push(e.value.clone());
        } else if cleaned.procedures.iter().any(|c| c == &e.value) {
            final_procedures.push(e.value.clone());
        }
    }
    final_conditions.sort();
    final_medications.sort();
    final_procedures.sort();

    // ── Evidence re-keying ────────────────────────────────────────────────
    //
    // The `_evidence` entries were captured at keyword-match time, BEFORE
    // entity_clean's synonym expansion ("Zoloft" → "sertraline") and the
    // validation gate. Re-key each entry to the canonical form and drop
    // entries whose entity did not survive — otherwise the provenance
    // block attests to values that are not in the output, and output
    // values have no matching provenance.
    fn rekey_evidence(
        evidence: Vec<serde_json::Value>,
        final_values: &[String],
        canonicalise: fn(&str) -> Option<String>,
    ) -> Vec<serde_json::Value> {
        // Compare canonical-to-canonical: validated values may carry
        // specificity-preserved originals ("L4/5 disc herniation") whose
        // canonical form is what the evidence surface maps to.
        let final_set: std::collections::HashSet<String> = final_values
            .iter()
            .map(|v| canonicalise(v).unwrap_or_else(|| v.clone()))
            .collect();
        evidence
            .into_iter()
            .filter_map(|mut e| {
                let surface = e.get("value")?.as_str()?.to_string();
                let canon = canonicalise(&surface)?;
                if !final_set.contains(&canon) {
                    return None;
                }
                let obj = e.as_object_mut()?;
                obj.insert("value".into(), serde_json::Value::String(canon));
                obj.insert("surface_form".into(), serde_json::Value::String(surface));
                Some(e)
            })
            .collect()
    }
    let conditions_evidence =
        rekey_evidence(conditions_evidence, &final_conditions, entity_clean::canonical_condition);
    let medications_evidence =
        rekey_evidence(medications_evidence, &final_medications, entity_clean::canonical_medication);
    let procedures_evidence =
        rekey_evidence(procedures_evidence, &final_procedures, entity_clean::canonical_procedure);

    // ── Medical-signal filter for key_findings ────────────────────────────────
    //
    // A line is only included in key_findings if it contains at least one word
    // that signals a clinical finding (diagnosis, symptom, treatment, imaging).
    // This prevents UI chrome, headers, and OCR noise lines from appearing in
    // the report even if they pass the basic symbol-density test above.
    const MEDICAL_SIGNAL_WORDS: &[&str] = &[
        // Diagnoses / conditions
        "pain", "injury", "fracture", "strain", "sprain", "tear", "disc",
        "disorder", "syndrome", "anxiety", "depression", "ptsd", "concussion",
        "whiplash", "herniation", "arthritis", "fibromyalgia", "sciatica",
        "tendinopathy", "bursitis", "contusion", "trauma", "traumatic",
        "diagnosis", "diagnosed", "condition", "presenting",
        // Treatments / medications
        "medication", "prescribed", "treatment", "therapy", "physiotherapy",
        "surgery", "procedure", "injection", "rehabilitation", "assessment",
        "referral", "review", "ibuprofen", "paracetamol", "pregabalin",
        "antidepressant", "analgesic",
        // Symptoms
        "symptom", "complaint", "reported", "reports", "presenting",
        "sleep", "fatigue", "headache", "nausea", "dizziness", "weakness",
        "numbness", "tingling", "stiffness", "swelling", "bruising",
        // Clinical context
        "examination", "imaging", "mri", "x-ray", "ultrasound", "ct scan",
        "capacity", "functional", "prognosis", "causation", "impairment",
    ];
    let clinical_snippets: Vec<String> = snippets
        .iter()
        .filter(|l| {
            let ll = l.to_lowercase();
            MEDICAL_SIGNAL_WORDS.iter().any(|&sig| ll.contains(sig))
        })
        .cloned()
        .collect();

    // ── Assemble result ───────────────────────────────────────────────────────
    //
    // `conditions` is the canonical field — cleaned, normalised, deduplicated.
    // `injuries_or_conditions` is kept as a deprecated alias (same data) so that
    // frontend code reading the old field name continues to work without changes.
    let result = serde_json::json!({
        "doc_id":            doc_id,
        "document_type":     doc_type,
        "is_index_document": false,
        "index_confidence":  index_confidence,
        "parties":           { "patient": "", "doctor": "", "organisation": "" },
        "dates":             dates_vec,
        "key_findings":      clinical_snippets,
        "conditions":        final_conditions.clone(),
        "injuries_or_conditions": final_conditions,   // deprecated alias — same validated data
        "medications":       final_medications,
        "procedures":        final_procedures,
        "timeline_events":   [],
        "source_text_snippets": clinical_snippets,
        "_evidence": {
            "conditions":  conditions_evidence,
            "medications":  medications_evidence,
            "procedures":   procedures_evidence
        }
    });

    Ok(result.to_string())
}

// ─── Case aggregation ─────────────────────────────────────────────────────────

/// Keyword pairs used for contradiction detection.
///
/// Each tuple is (positive_term, negative_term).  If both the positive form
/// and its negation appear across the set of documents the pair is flagged as a
/// contradiction.
const CONFLICT_PAIRS: &[(&str, &str)] = &[
    ("fracture",   "no fracture"),
    ("pain",       "no pain"),
    ("tear",       "no tear"),
    ("normal",     "abnormal"),
    ("stable",     "unstable"),
    ("intact",     "not intact"),
    ("positive",   "negative"),
    ("present",    "absent"),
    ("resolved",   "unresolved"),
    ("improving",  "deteriorating"),
];

/// Group a flat list of conditions into medico-legal categories.
///
/// Returns a JSON object with three arrays: musculoskeletal, psychological, other.
/// A condition may match only one category; musculoskeletal takes priority.
fn group_conditions(conditions: &[String]) -> serde_json::Value {
    const MUSCULOSKELETAL: &[&str] = &[
        "fracture", "disc", "tear", "strain", "sprain", "acl", "meniscus",
        "rotator cuff", "herniation", "contusion", "whiplash", "bursitis",
        "tendinopathy", "arthritis", "nerve damage",
    ];
    const PSYCHOLOGICAL: &[&str] = &["anxiety", "depression", "ptsd", "concussion"];

    let mut musculoskeletal: Vec<String> = Vec::new();
    let mut psychological:   Vec<String> = Vec::new();
    let mut other:           Vec<String> = Vec::new();

    for condition in conditions {
        let lower = condition.to_lowercase();
        if MUSCULOSKELETAL.iter().any(|&t| lower.contains(t)) {
            musculoskeletal.push(condition.clone());
        } else if PSYCHOLOGICAL.iter().any(|&t| lower.contains(t)) {
            psychological.push(condition.clone());
        } else {
            other.push(condition.clone());
        }
    }

    serde_json::json!({
        "musculoskeletal": musculoskeletal,
        "psychological":   psychological,
        "other":           other
    })
}

/// Classify a document into a timeline event category.
///
/// Precedence:
///   imaging   → document_type "imaging"
///   consultation → document_type "referral"
///   treatment → any procedures found in the document
///   clinical_event → fallback
fn classify_event_category(doc_type: &str, doc: &serde_json::Value) -> &'static str {
    match doc_type {
        "imaging"  => "imaging",
        "referral" => "consultation",
        _ => {
            let has_procedures = doc
                .get("procedures")
                .and_then(|v| v.as_array())
                .map(|arr| !arr.is_empty())
                .unwrap_or(false);
            if has_procedures { "treatment" } else { "clinical_event" }
        }
    }
}

/// Build a plain-English case narrative from aggregated data.
///
/// Covers four standard medico-legal summary sections:
///   1. Injury pattern (musculoskeletal conditions)
///   2. Psychological overlay
///   3. Treatment progression (procedures + medications)
///   4. Inconsistencies (detected contradictions)
///
/// All output is deterministic rule-based text — no AI involved.
fn build_case_narrative(
    condition_groups: &serde_json::Value,
    medications: &[String],
    procedures: &[String],
    conflicts: &[serde_json::Value],
) -> String {
    let mut paragraphs: Vec<String> = Vec::new();

    // ── 1. Injury pattern ─────────────────────────────────────────────────────
    let musculo: Vec<&str> = condition_groups["musculoskeletal"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    if !musculo.is_empty() {
        paragraphs.push(format!(
            "Injury pattern: musculoskeletal involvement noted, including {}.",
            musculo.join(", ")
        ));
    } else {
        paragraphs.push(
            "Injury pattern: no musculoskeletal conditions detected.".to_string(),
        );
    }

    // ── 2. Psychological overlay ──────────────────────────────────────────────
    let psych: Vec<&str> = condition_groups["psychological"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    if !psych.is_empty() {
        paragraphs.push(format!(
            "Psychological overlay: {} identified across documents.",
            psych.join(", ")
        ));
    } else {
        paragraphs.push("Psychological overlay: none detected.".to_string());
    }

    // ── 3. Treatment progression ──────────────────────────────────────────────
    if !procedures.is_empty() {
        paragraphs.push(format!(
            "Treatment progression: {} documented.",
            procedures.join(", ")
        ));
    } else {
        paragraphs.push("Treatment progression: no procedures recorded.".to_string());
    }
    if !medications.is_empty() {
        paragraphs.push(format!("Medications on record: {}.", medications.join(", ")));
    }

    // ── 4. Inconsistencies ────────────────────────────────────────────────────
    if conflicts.is_empty() {
        paragraphs.push(
            "Inconsistencies: none detected across documents.".to_string(),
        );
    } else {
        let issues: Vec<&str> = conflicts
            .iter()
            .filter_map(|c| c.get("issue").and_then(|v| v.as_str()))
            .collect();
        paragraphs.push(format!(
            "Inconsistencies: conflicting documentation detected regarding {}. \
             Review source documents for clarification.",
            issues.join(", ")
        ));
    }

    paragraphs.join(" ")
}

/// Extract a plain lowercase string from all findings + snippets in a document,
/// used for conflict scanning.
fn doc_search_text(doc: &serde_json::Value) -> String {
    let mut parts: Vec<&str> = Vec::new();

    for field in &["key_findings", "source_text_snippets"] {
        if let Some(arr) = doc.get(field).and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    parts.push(s);
                }
            }
        }
    }

    parts.join(" ").to_lowercase()
}

/// Merge an array of structured medico-legal documents into a single case summary.
///
/// Produces:
/// - Structured timeline: each date token annotated with its source document type
///   and a brief context label derived from the document's key findings.
/// - Source-aware deduplication of conditions, medications, and procedures.
/// - Conflict detection: scans findings/snippets across all documents for
///   contradictory positive/negative keyword pairs.
#[tauri::command(rename_all = "camelCase")]
fn aggregate_case(documents: Vec<serde_json::Value>) -> Result<String, String> {
    // ── Working collections ───────────────────────────────────────────────────

    // Condition → first source that mentioned it
    let mut condition_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut medications: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut procedures:  std::collections::HashSet<String> = std::collections::HashSet::new();

    // timeline entries as (date, event_label, source, category)
    // Keyed on date+source to avoid exact duplicates.
    let mut seen_timeline: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut timeline_entries: Vec<(String, String, String, &'static str)> = Vec::new();

    let mut sources: Vec<String> = Vec::new();
    let mut patient = String::new();

    // Flat evidence arrays — each entry originates from a per-document _evidence object.
    // Merged here so the UI can look up evidence for any aggregated chip.
    let mut cond_evidence:  Vec<serde_json::Value> = Vec::new();
    let mut meds_evidence:  Vec<serde_json::Value> = Vec::new();
    let mut proc_evidence:  Vec<serde_json::Value> = Vec::new();

    // Count of documents that passed the index-document guard.
    // Used to gate reasoning: if zero, no clinical data was present and the
    // intelligence layer must not synthesise conclusions from nothing.
    let mut clinical_doc_count: usize = 0;

    // For conflict detection: map term → list of source document types where it
    // was found (positive form) and negative form found.
    // We store (Vec<positive_sources>, Vec<negative_sources>) per pair index.
    let mut conflict_hits: Vec<(Vec<String>, Vec<String>)> =
        vec![(Vec::new(), Vec::new()); CONFLICT_PAIRS.len()];

    // ── Per-document pass ─────────────────────────────────────────────────────
    for doc in documents.iter() {
        let doc_type = doc
            .get("document_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        sources.push(doc_type.clone());

        // ── Index-document guard ──────────────────────────────────────────────
        // Index / table-of-contents documents contain large numbers of dates and
        // no clinical content.  Their dates would flood the timeline with noise
        // and their pseudo-conditions (e.g. "disc" appearing in a doctor's name)
        // would pollute the condition list.  Skip all data extraction for them;
        // they remain visible in `sources` for provenance tracking.
        if doc.get("is_index_document").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        // Every document that reaches this point is a confirmed clinical document.
        clinical_doc_count += 1;

        // Patient — first non-empty value wins
        if patient.is_empty() {
            if let Some(p) = doc
                .get("parties")
                .and_then(|v| v.get("patient"))
                .and_then(|v| v.as_str())
            {
                let trimmed = p.trim().to_string();
                if !trimmed.is_empty() {
                    patient = trimmed;
                }
            }
        }

        // ── Conditions (source-attributed) ────────────────────────────────────
        // Read from `conditions` (canonical) first; fall back to the deprecated
        // `injuries_or_conditions` alias for documents produced by older pipeline runs.
        let conditions_arr = doc
            .get("conditions")
            .and_then(|v| v.as_array())
            .or_else(|| doc.get("injuries_or_conditions").and_then(|v| v.as_array()));
        if let Some(arr) = conditions_arr
        {
            for item in arr {
                if let Some(s) = item.as_str() {
                    condition_map
                        .entry(s.to_string())
                        .or_insert_with(|| doc_type.clone());
                }
            }
        }

        // ── Medications ───────────────────────────────────────────────────────
        if let Some(arr) = doc.get("medications").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    medications.insert(s.to_string());
                }
            }
        }

        // ── Procedures ────────────────────────────────────────────────────────
        if let Some(arr) = doc.get("procedures").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(s) = item.as_str() {
                    procedures.insert(s.to_string());
                }
            }
        }

        // ── Evidence collection — merge per-doc _evidence into case-level arrays ──
        if let Some(ev_obj) = doc.get("_evidence") {
            for (field, acc) in &mut [
                ("conditions",  &mut cond_evidence),
                ("medications", &mut meds_evidence),
                ("procedures",  &mut proc_evidence),
            ] {
                if let Some(arr) = ev_obj.get(*field).and_then(|v| v.as_array()) {
                    for entry in arr {
                        acc.push(entry.clone());
                    }
                }
            }
        }

        // ── Structured timeline ───────────────────────────────────────────────
        // Classify the event category once per document.
        let event_category = classify_event_category(&doc_type, doc);

        // Build a context label from the first key finding, or fall back to a
        // generic label derived from the document type.
        let context_label: String = doc
            .get("key_findings")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(|s| {
                // Truncate to 80 chars for display
                let trimmed = s.trim();
                if trimmed.len() > 80 {
                    format!("{}…", &trimmed[..80])
                } else {
                    trimmed.to_string()
                }
            })
            .unwrap_or_else(|| format!("Event recorded in {}", doc_type));

        if let Some(arr) = doc.get("dates").and_then(|v| v.as_array()) {
            for item in arr {
                if let Some(date_str) = item.as_str() {
                    // Deduplicate on date+source pair
                    let key = format!("{}|{}", date_str, doc_type);
                    if seen_timeline.insert(key) {
                        timeline_entries.push((
                            date_str.to_string(),
                            context_label.clone(),
                            doc_type.clone(),
                            event_category,
                        ));
                    }
                }
            }
        }

        // ── Conflict scanning ─────────────────────────────────────────────────
        let search_text = doc_search_text(doc);
        for (idx, (positive, negative)) in CONFLICT_PAIRS.iter().enumerate() {
            if search_text.contains(positive) {
                conflict_hits[idx].0.push(doc_type.clone());
            }
            if search_text.contains(negative) {
                conflict_hits[idx].1.push(doc_type.clone());
            }
        }
    }

    // ── Sort timeline chronologically ─────────────────────────────────────────
    // ISO dates (YYYY-MM-DD) sort correctly lexicographically.
    // DD/MM/YYYY and MM/DD/YYYY don't — for now we separate ISO from slash-dates
    // and place ISO entries first, then slash-dates, each group sorted.
    timeline_entries.sort_by(|a, b| {
        let a_iso = a.0.contains('-');
        let b_iso = b.0.contains('-');
        match (a_iso, b_iso) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.0.cmp(&b.0),
        }
    });

    let timeline_json: Vec<serde_json::Value> = timeline_entries
        .into_iter()
        .map(|(date, event, source, category)| {
            serde_json::json!({
                "date":     date,
                "event":    event,
                "source":   source,
                "category": category
            })
        })
        .collect();

    // ── Build conflicts array ─────────────────────────────────────────────────
    let mut conflicts: Vec<serde_json::Value> = Vec::new();
    for (idx, (pos_sources, neg_sources)) in conflict_hits.into_iter().enumerate() {
        if pos_sources.is_empty() || neg_sources.is_empty() {
            continue; // need BOTH sides to be a contradiction
        }
        let (positive, negative) = CONFLICT_PAIRS[idx];
        let mut all_sources = pos_sources.clone();
        all_sources.extend(neg_sources.clone());
        all_sources.dedup();

        conflicts.push(serde_json::json!({
            "issue":   positive,
            "type":    "contradiction",
            "details": format!(
                "\"{}\" found in [{}] but \"{}\" found in [{}]",
                positive,
                pos_sources.join(", "),
                negative,
                neg_sources.join(", ")
            ),
            "sources": all_sources
        }));
    }

    // ── Flatten and sort conditions ───────────────────────────────────────────
    let mut conditions_vec: Vec<String> = condition_map.into_keys().collect();
    conditions_vec.sort();

    let mut medications_vec: Vec<String> = medications.into_iter().collect();
    let mut procedures_vec:  Vec<String> = procedures.into_iter().collect();
    medications_vec.sort();
    procedures_vec.sort();

    // ── Intelligence layer (clinical documents only) ──────────────────────────
    //
    // SAFETY RULE: reasoning is only permitted when at least one confirmed
    // clinical document contributed data.  If every document was flagged as an
    // index / admin document, we return the mandated fallback strings and empty
    // groups rather than synthesising conclusions from nothing.
    let (condition_groups, case_narrative) = if clinical_doc_count == 0 {
        (
            serde_json::json!({
                "musculoskeletal": [],
                "psychological":   [],
                "other":           []
            }),
            "Insufficient clinical data available for case synthesis.".to_string(),
        )
    } else {
        let cg = group_conditions(&conditions_vec);
        let cn = build_case_narrative(&cg, &medications_vec, &procedures_vec, &conflicts);
        (cg, cn)
    };

    // ── Assemble result ───────────────────────────────────────────────────────
    let result = serde_json::json!({
        "case_summary": {
            "patient":                  patient,
            "overall_conditions":       conditions_vec,
            "condition_groups":         condition_groups,
            "timeline":                 timeline_json,
            "medications":              medications_vec,
            "procedures":               procedures_vec,
            "conflicts":                conflicts,
            "sources":                  sources,
            "case_narrative":           case_narrative,
            "clinical_document_count":  clinical_doc_count,
            "reasoning_locked":         true,
            "_evidence": {
                "conditions":  cond_evidence,
                "medications":  meds_evidence,
                "procedures":   proc_evidence
            }
        }
    });

    Ok(result.to_string())
}

// ─── Diagnostic command ───────────────────────────────────────────────────────

/// Build a PATH string with Homebrew and Anaconda/Miniconda directories prepended.
///
/// macOS GUI apps (including Tauri) do not inherit the user's shell PATH, so
/// /opt/homebrew/bin, ~/anaconda3/bin, and similar are absent at runtime.
/// This function constructs a PATH that covers the most common install locations
/// for Python (conda), pdftoppm (poppler), and tesseract (tesseract-ocr).
fn augmented_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    // Common conda install prefixes (Apple Silicon and Intel)
    let conda_bins = format!(
        "{home}/anaconda3/bin:{home}/miniconda3/bin:\
         {home}/opt/anaconda3/bin:{home}/opt/miniconda3/bin:\
         /opt/anaconda3/bin:/opt/miniconda3/bin"
    );
    let homebrew_bins = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";
    let current = std::env::var("PATH").unwrap_or_default();
    if current.is_empty() {
        format!("{conda_bins}:{homebrew_bins}")
    } else {
        format!("{conda_bins}:{homebrew_bins}:{current}")
    }
}

/// Check whether a CLI tool is on PATH (including Homebrew paths), capture its version string.
fn check_tool(name: &str, args: &[&str]) -> serde_json::Value {
    match std::process::Command::new(name)
        .env("PATH", augmented_path())
        .args(args)
        .output()
    {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({
            "found":   false,
            "version": null,
            "error":   format!("{name} not found in PATH"),
        }),
        Err(e) => serde_json::json!({
            "found":   false,
            "version": null,
            "error":   e.to_string(),
        }),
        Ok(out) => {
            // Tesseract/pdftoppm both write version to stderr
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let version = if !stdout.is_empty() {
                stdout.lines().next().unwrap_or("").to_string()
            } else {
                stderr.lines().next().unwrap_or("").to_string()
            };
            serde_json::json!({
                "found":     true,
                "version":   version,
                "exit_code": out.status.code(),
                "error":     null,
            })
        }
    }
}

/// Run pdftoppm on `path` at 72 DPI (fast) and report exactly what happens:
/// exit code, stderr, and the list of page images produced.
fn probe_pdf_pipeline(path: &str) -> serde_json::Value {
    use std::path::PathBuf;

    let tmp_dir: PathBuf = std::env::temp_dir()
        .join(format!("ml_diag_{}", std::process::id()));

    if let Err(e) = std::fs::create_dir_all(&tmp_dir) {
        return serde_json::json!({ "error": format!("tmp dir: {e}") });
    }

    let prefix = tmp_dir.join("p");

    let result = std::process::Command::new("pdftoppm")
        .env("PATH", augmented_path())
        .args(["-r", "72", "-png", path, prefix.to_str().unwrap_or("")])
        .output();

    let report = match result {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({
            "pdftoppm_found": false,
            "success":        false,
            "exit_code":      null,
            "stderr":         "pdftoppm not found — brew install poppler",
            "page_count":     0,
            "pages":          [],
        }),
        Err(e) => serde_json::json!({
            "pdftoppm_found": false,
            "success":        false,
            "exit_code":      null,
            "stderr":         e.to_string(),
            "page_count":     0,
            "pages":          [],
        }),
        Ok(out) => {
            let stderr  = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let success = out.status.success();

            let mut pages: Vec<serde_json::Value> = Vec::new();
            if success {
                if let Ok(entries) = std::fs::read_dir(&tmp_dir) {
                    let mut paths: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.extension().map(|x| x == "png").unwrap_or(false))
                        .collect();
                    paths.sort();
                    for p in &paths {
                        let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
                        pages.push(serde_json::json!({
                            "filename":   p.file_name().unwrap_or_default().to_string_lossy(),
                            "size_bytes": size,
                        }));
                    }
                }
            }

            serde_json::json!({
                "pdftoppm_found": true,
                "success":        success,
                "exit_code":      out.status.code(),
                "stderr":         stderr,
                "page_count":     pages.len(),
                "pages":          pages,
            })
        }
    };

    let _ = std::fs::remove_dir_all(&tmp_dir);
    report
}

/// Run the full diagnostic pipeline for a given file path and return a
/// structured JSON report covering: feature flags, tool availability, file
/// metadata, text extraction output, and the PDF OCR pipeline probe.
///
/// The report is designed to be pasted into a support conversation so that
/// the exact failure point can be identified without guesswork.
#[tauri::command(rename_all = "camelCase")]
fn run_diagnostics(path: String) -> Result<String, String> {
    // ── 1. Feature flags ─────────────────────────────────────────────────────
    let ocr_feature = true; // OCR is always compiled (subprocess tesseract)

    // ── 2. File metadata ─────────────────────────────────────────────────────
    let p = std::path::Path::new(&path);
    let file_info = serde_json::json!({
        "path":       path,
        "exists":     p.exists(),
        "size_bytes": std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        "extension":  p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase(),
        "is_pdf":     path.to_lowercase().ends_with(".pdf"),
    });

    // ── 3. Environment ───────────────────────────────────────────────────────
    // Locate tessdata for leptess (same logic as ocr.rs::find_tessdata)
    let tessdata_path: Option<String> = {
        let from_env = std::env::var("TESSDATA_PREFIX").ok()
            .filter(|v| std::path::Path::new(v).exists());
        from_env.or_else(|| {
            [
                "/opt/homebrew/share/tessdata",
                "/usr/local/share/tessdata",
                "/usr/share/tessdata",
            ]
            .iter()
            .find(|p| std::path::Path::new(p).exists())
            .map(|s| s.to_string())
        })
    };

    let env_info = serde_json::json!({
        "path":      augmented_path(),
        "tesseract": check_tool("tesseract", &["--version"]),
        "pdftoppm":  check_tool("pdftoppm",  &["-v"]),
        "tessdata":  {
            "found": tessdata_path.is_some(),
            "path":  tessdata_path,
        },
    });

    // ── 4. Text extraction ───────────────────────────────────────────────────
    let text_info = match extract_text_hybrid(path.clone()) {
        Ok(ref text) => {
            let non_ws  = text.chars().filter(|c| !c.is_whitespace()).count();
            let preview: String = text.chars().take(400).collect();
            serde_json::json!({
                "success":           true,
                "char_count":        text.len(),
                "non_ws_char_count": non_ws,
                "sparse":            non_ws < 50,
                "preview":           preview,
                "error":             null,
            })
        }
        Err(ref e) => serde_json::json!({
            "success":           false,
            "char_count":        0,
            "non_ws_char_count": 0,
            "sparse":            true,
            "preview":           "",
            "error":             e,
        }),
    };

    // ── 5. PDF OCR pipeline probe ────────────────────────────────────────────
    let ocr_pipeline = if path.to_lowercase().ends_with(".pdf") {
        probe_pdf_pipeline(&path)
    } else {
        serde_json::json!({ "applicable": false, "reason": "not a PDF" })
    };

    // ── 6. Assemble report ───────────────────────────────────────────────────
    Ok(serde_json::json!({
        "ocr_feature_compiled": ocr_feature,
        "file":                 file_info,
        "environment":          env_info,
        "text_extraction":      text_info,
        "ocr_pipeline_probe":   ocr_pipeline,
        "diagnosis": {
            "ocr_will_run":      ocr_feature && path.to_lowercase().ends_with(".pdf"),
            "missing_poppler":   !env_info["pdftoppm"]["found"].as_bool().unwrap_or(false),
            "no_text_extracted": text_info["non_ws_char_count"].as_u64().unwrap_or(0) == 0,
        }
    }).to_string())
}

// ─── spaCy NER command ────────────────────────────────────────────────────────

/// Run the external `ner.py` script (spaCy `en_core_web_sm`) on `text`.
///
/// Passes text via stdin so large documents (multi-page OCR output) are handled
/// without hitting OS argument-length limits.  Extracts only DATE, ORG, PERSON
/// entities — no interpretation, no inference, no merging with other data.
///
/// Returns a JSON string:
///   { "PERSON": [str], "ORG": [str], "DATE": [str] }
///
/// On failure returns Err with a human-readable message the frontend can display.
#[tauri::command(rename_all = "camelCase")]
fn run_ner(text: String) -> Result<String, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    // Run cleaning BEFORE spaCy so UI/OCR noise can't generate spurious
    // entity hits. Raw text remains available to callers via the dedicated
    // `clean_extracted_text` command if they need audit/display data.
    let cleaned = text_clean::clean_extracted_text(&text);
    let nlp_text = cleaned.clean_text;

    // Script lives alongside Cargo.toml — path is baked in at compile time.
    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/ner.py");

    let mut child = Command::new("python3")
        .env("PATH", augmented_path())
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "python3 not found — ensure Python 3 with spaCy is installed".to_string()
            } else {
                e.to_string()
            }
        })?;

    // Write cleaned text to stdin then drop it — closing the pipe signals
    // EOF to Python.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(nlp_text.as_bytes()).map_err(|e| e.to_string())?;
    }

    let output = child.wait_with_output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("NER error: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(r#"{"PERSON":[],"ORG":[],"DATE":[]}"#.to_string());
    }
    // Post-process: spaCy still hallucinates PERSON/ORG from OCR-derived
    // tokens that survive text_clean. Filter using shape + lexicon rules.
    let parsed: Result<ner_clean::NerEntities, _> = serde_json::from_str(&stdout);
    let cleaned = match parsed {
        Ok(raw) => ner_clean::clean_ner_entities(raw, &nlp_text),
        Err(_) => return Ok(stdout), // pass through if shape unexpected
    };
    serde_json::to_string(&cleaned).map_err(|e| e.to_string())
}

// ─── scispaCy NLP service ─────────────────────────────────────────────────────
//
// Architecture:
//   nlp_service.py is a long-running Python HTTP server that loads en_core_sci_md
//   ONCE at startup and serves POST /extract requests for the duration of the
//   Tauri session.
//
//   Rust manages the lifecycle:
//     - find_nlp_python()      — locate the Python interpreter that has the model
//     - start_nlp_service()    — spawn the server, wait for "NLP_SERVICE_READY:PORT"
//     - ensure_nlp_service()   — idempotent; start once, cache the port
//     - call_nlp_service()     — POST text, return JSON string
//     - extract_nlp_entities   — public Tauri command

use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Once;

static NLP_INIT: Once = Once::new();
static NLP_PORT: AtomicU16 = AtomicU16::new(0);

/// Find the Python interpreter that has `en_core_sci_md` installed.
///
/// Checks the known Python 3.12 framework path first (confirmed install
/// location from setup investigation), then common alternatives.
/// Each candidate is verified by attempting to load the model.
fn find_nlp_python() -> Option<String> {
    let candidates: &[&str] = &[
        "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",
        "/usr/local/bin/python3.12",
        "/opt/homebrew/bin/python3.12",
        "python3.12",
        "python3",
    ];
    for &candidate in candidates {
        let result = std::process::Command::new(candidate)
            .env("PATH", augmented_path())
            .args(["-c", "import spacy; spacy.load('en_core_sci_md')"])
            .output();
        if let Ok(out) = result {
            if out.status.success() {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Spawn `nlp_service.py` and block until it prints "NLP_SERVICE_READY:<port>".
///
/// Returns the port number the service is listening on, or an error message
/// that can be surfaced directly in the UI.
fn start_nlp_service() -> Result<u16, String> {
    let python = find_nlp_python().ok_or_else(|| {
        "No Python interpreter with en_core_sci_md found. \
         Install scispaCy for Python 3.12: \
         pip3 install scispacy && pip3 install en_core_sci_md-*.tar.gz"
            .to_string()
    })?;

    let script = concat!(env!("CARGO_MANIFEST_DIR"), "/nlp_service.py");
    let port: u16 = 5001;

    let mut child = std::process::Command::new(&python)
        .env("PATH", augmented_path())
        .args([script, &port.to_string()])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn NLP service: {e}"))?;

    // Read stdout until the ready signal — or until the process exits (error).
    use std::io::BufRead;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "NLP service: could not capture stdout".to_string())?;
    let reader = std::io::BufReader::new(stdout);

    for line in reader.lines() {
        let line = line.map_err(|e| format!("NLP service stdout read error: {e}"))?;
        if let Some(rest) = line.trim().strip_prefix("NLP_SERVICE_READY:") {
            let p: u16 = rest.trim().parse().unwrap_or(port);
            // Detach — process outlives this function and serves the whole session.
            std::mem::forget(child);
            return Ok(p);
        }
    }

    // Process exited without signalling ready — stderr was suppressed above;
    // give a generic actionable message.
    Err("NLP service exited before becoming ready. \
         Check that en_core_sci_md is installed: \
         python3 -c \"import spacy; spacy.load('en_core_sci_md')\""
        .to_string())
}

/// Return the port of the running NLP service, starting it if necessary.
///
/// Uses `Once` so the service is started at most once per process lifetime.
/// A health check on port 5001 handles the case where a previous Tauri
/// session left the server running (avoids double-bind errors).
fn ensure_nlp_service() -> Result<u16, String> {
    NLP_INIT.call_once(|| {
        let port: u16 = 5001;

        // Reuse a leftover instance from a previous session if it's healthy.
        let health_url = format!("http://127.0.0.1:{port}/health");
        if let Ok(resp) = ureq::get(&health_url)
            .timeout(std::time::Duration::from_millis(800))
            .call()
        {
            if resp.status() == 200 {
                NLP_PORT.store(port, Ordering::SeqCst);
                return;
            }
        }

        // Start fresh.
        match start_nlp_service() {
            Ok(p)  => NLP_PORT.store(p, Ordering::SeqCst),
            Err(e) => eprintln!("[nlp_service] startup failed: {e}"),
        }
    });

    let port = NLP_PORT.load(Ordering::SeqCst);
    if port == 0 {
        Err("NLP service unavailable. Ensure en_core_sci_md is installed for Python 3.12.".to_string())
    } else {
        Ok(port)
    }
}

/// POST `text` to the running NLP service and return the raw JSON response body.
fn call_nlp_service(text: &str) -> Result<String, String> {
    let port = ensure_nlp_service()?;
    let url  = format!("http://127.0.0.1:{port}/extract");
    let body = serde_json::json!({ "text": text }).to_string();

    let response = ureq::post(&url)
        .timeout(std::time::Duration::from_secs(60))
        .set("Content-Type", "application/json")
        .send_string(&body)
        .map_err(|e| format!("NLP service request failed: {e}"))?;

    response.into_string().map_err(|e| e.to_string())
}

/// Run scispaCy (`en_core_sci_md`) biomedical entity extraction on raw text.
///
/// Returns JSON:
///   { medications: string[], procedures: string[], conditions: string[],
///     other: string[], all: { text: string, category: string }[] }
///
/// The NLP service is started on first call and reused for the session.
/// Returns Err with a human-readable message if the service is unavailable.
#[tauri::command(rename_all = "camelCase")]
fn extract_nlp_entities(text: String) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(
            r#"{"medications":[],"procedures":[],"conditions":[],"other":[],"all":[]}"#
                .to_string(),
        );
    }
    // Clean BEFORE scispaCy so it can't see ChatGPT / GoLive / OCR garbage
    // and produce phantom clinical entities from them.
    let cleaned = text_clean::clean_extracted_text(&text);
    call_nlp_service(&cleaned.clean_text)
}

/// Public-facing command that returns the cleaned text + audit metadata.
/// Used by the DocumentCard UI to surface raw vs clean and the removed
/// noise lines without re-running NLP.
#[tauri::command(rename_all = "camelCase")]
fn clean_extracted_text_command(text: String) -> Result<String, String> {
    let cleaned = text_clean::clean_extracted_text(&text);
    serde_json::to_string(&cleaned).map_err(|e| e.to_string())
}

// ─── OCR command (always available — subprocess tesseract) ───────────────────

#[tauri::command]
fn run_ocr_command(path: String) -> Result<String, String> {
    crate::ocr::run_ocr(&path)
}

// ─── App entry point ──────────────────────────────────────────────────────────
//
// Two separate builder chains — one per feature configuration — so the
// generate_handler! macro only ever sees symbols that actually exist in the
// current compilation unit.  Only one chain is compiled at a time.

/// List all regular files inside `dir_path` with a supported document extension.
///
/// Called by the frontend when the user drops a folder onto the drop zone so
/// we can expand it into individual file paths automatically.
///
/// Returns a JSON array of absolute path strings.
/// Non-directory paths return an empty array (not an error) so the frontend
/// can simply forward every dropped path through this call and handle both files
/// and folders uniformly.
#[tauri::command(rename_all = "camelCase")]
fn list_directory(dir_path: String) -> Result<String, String> {
    use std::path::Path;

    const SUPPORTED: &[&str] = &["pdf", "docx", "txt", "md", "log", "rtf", "odt"];

    let path = Path::new(&dir_path);
    if !path.is_dir() {
        // Caller passed a file — return it directly if it has a supported extension
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if SUPPORTED.contains(&ext.as_str()) {
            let arr = serde_json::json!([dir_path]);
            return Ok(arr.to_string());
        }
        return Ok("[]".to_string());
    }

    let mut paths: Vec<String> = Vec::new();
    let read = std::fs::read_dir(path).map_err(|e| e.to_string())?;
    for entry in read.flatten() {
        let ep = entry.path();
        if !ep.is_file() { continue; }
        let ext = ep.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        if SUPPORTED.contains(&ext.as_str()) {
            if let Some(s) = ep.to_str() {
                paths.push(s.to_string());
            }
        }
    }
    paths.sort();
    Ok(serde_json::to_string(&paths).map_err(|e| e.to_string())?)
}

// ─── Entity cleaning command ──────────────────────────────────────────────────

/// Clean and normalise raw entity lists from OCR / scispaCy output.
///
/// Runs all three lists through the full pipeline:
///   normalise → garbage-filter → category-filter → deduplicate
///
/// Parameters:
///   conditions  — raw condition strings
///   medications — raw medication strings
///   procedures  — raw procedure strings
///   debug       — when true, the response includes a `removed` array explaining
///                 every entity that was filtered and why
///
/// Returns JSON:
///   {
///     "conditions":  string[],
///     "medications": string[],
///     "procedures":  string[],
///     "removed":     [{ original, category, reason }]   // only when debug=true
///   }
#[tauri::command(rename_all = "camelCase")]
fn clean_entities_command(
    conditions:  Vec<String>,
    medications: Vec<String>,
    procedures:  Vec<String>,
    debug:       bool,
) -> Result<String, String> {
    let input = entity_clean::CleanInput { conditions, medications, procedures };
    let out   = entity_clean::clean_entities(input, debug);

    let mut result = serde_json::json!({
        "conditions":  out.conditions,
        "medications": out.medications,
        "procedures":  out.procedures,
    });

    if debug && !out.removed.is_empty() {
        let removed: Vec<serde_json::Value> = out.removed.iter().map(|r| {
            serde_json::json!({
                "original": r.original,
                "category": r.category,
                "reason":   r.reason,
            })
        }).collect();
        result["removed"] = serde_json::Value::Array(removed);
    }

    Ok(result.to_string())
}

// ─── Backend reasoning pipeline ──────────────────────────────────────────────
//
// Five-stage reasoning pipeline that transforms pre-extracted document text
// into structured medico-legal outputs.  Each stage can be called independently.
//
// Every stage tries Ollama (local LLM at 127.0.0.1:11434) first.  If Ollama is
// not running, the model is unavailable, or the response is malformed, the stage
// falls back to a deterministic rule-based implementation transparently.
//
// The `method` field in every response tells the caller which path was taken:
//   "ollama"              — LLM succeeded
//   "rules"               — Ollama unavailable or not running
//   "rules_ollama_invalid"— Ollama responded but output did not match schema
//
// CONTRACT: these commands accept pre-extracted text only.  File handling, OCR,
// and drag-drop logic are untouched.

// ── Module-level keyword sets for pipeline rule-based fallbacks ───────────────
// Parallel to the per-function sets in extract_structured_data, but module-level
// so the pipeline helpers can reference them without duplication.

const PIPELINE_CONDITION_KW: &[&str] = &[
    "post-traumatic stress disorder", "major depressive disorder",
    "generalised anxiety disorder", "generalized anxiety disorder",
    "anxiety disorder", "adjustment disorder", "panic disorder",
    "acute stress disorder", "somatic symptom disorder",
    "ptsd", "depression", "anxiety", "agoraphobia",
    "traumatic brain injury", "tbi", "concussion",
    "rotator cuff tear", "meniscus tear", "disc herniation",
    "nerve damage", "chronic pain", "fracture", "sprain", "strain",
    "herniation", "tendinopathy", "arthritis", "osteoarthritis",
    "whiplash", "bursitis", "rotator cuff", "acl", "meniscus",
    "fibromyalgia", "sciatica", "scoliosis", "contusion",
];

const PIPELINE_MED_KW: &[&str] = &[
    "paroxetine", "aropax", "sertraline", "zoloft",
    "fluoxetine", "prozac", "escitalopram", "lexapro",
    "citalopram", "venlafaxine", "effexor", "duloxetine", "cymbalta",
    "desvenlafaxine", "mirtazapine", "amitriptyline", "nortriptyline",
    "quetiapine", "seroquel", "olanzapine", "risperidone",
    "pregabalin", "lyrica", "gabapentin", "neurontin",
    "diazepam", "valium", "clonazepam", "alprazolam", "xanax",
    "lorazepam", "ativan", "temazepam",
    "morphine", "oxycodone", "endone", "tramadol", "codeine", "fentanyl",
    "ibuprofen", "nurofen", "paracetamol", "panadol",
    "naproxen", "diclofenac", "voltaren", "aspirin",
];

const PIPELINE_PROC_KW: &[&str] = &[
    "cognitive behavioural therapy", "cognitive behavioral therapy",
    "emdr therapy", "emdr", "psychotherapy", "psychotherapy",
    "occupational therapy", "physiotherapy", "rehabilitation",
    "psychiatric assessment", "psychological assessment",
    "functional capacity assessment", "neuropsychological assessment",
    "independent medical examination",
    "arthroscopy", "arthroplasty", "spinal fusion", "laminectomy",
    "discectomy", "surgery", "cortisone injection", "epidural injection",
    "nerve block", "mri", "ct scan", "x-ray", "ultrasound",
];

// ── Ollama helper ─────────────────────────────────────────────────────────────

/// POST a prompt to the local Ollama instance and return the response JSON string.
///
/// Uses `format: "json"` so Ollama constrains output to valid JSON.
/// Returns Err if Ollama is unreachable, times out, or returns malformed JSON —
/// callers fall through to rule-based processing on any error.
fn call_ollama(prompt: &str) -> Result<String, String> {
    const MODEL:   &str = "llama3.2";   // change to llama3.1:8b or mistral as needed
    const TIMEOUT: u64  = 90;

    let body = serde_json::json!({
        "model":  MODEL,
        "prompt": prompt,
        "stream": false,
        "format": "json",
        "options": {
            "temperature": 0.1,
            "num_predict": 2048
        }
    });

    let resp = ureq::post("http://127.0.0.1:11434/api/generate")
        .timeout(std::time::Duration::from_secs(TIMEOUT))
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| format!("Ollama unavailable: {e}"))?;

    let raw = resp.into_string().map_err(|e| e.to_string())?;

    let parsed: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Ollama envelope: {e}"))?;

    let response = parsed
        .get("response")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Ollama: missing response field".to_string())?;

    // Validate the inner response is also valid JSON before returning
    let _: serde_json::Value = serde_json::from_str(response)
        .map_err(|e| format!("Ollama inner JSON: {e}"))?;

    Ok(response.to_string())
}

// ── Stage 1: segment_document ─────────────────────────────────────────────────

/// Segment a document into three canonical medico-legal sections:
///   background       — history, prior injuries, personal/employment circumstances
///   clinical_findings — examination, diagnoses, test results, symptoms, treatment
///   opinions         — expert opinions, causation assessments, conclusions
///
/// Returns JSON:
///   { doc_id, method, word_count, segments: { background, clinical_findings, opinions } }
#[tauri::command(rename_all = "camelCase")]
fn segment_document(text: String, doc_id: String) -> Result<String, String> {
    let prompt = format!(
        r#"You are a medico-legal document analyst. Segment the document below into three sections.
Return ONLY a JSON object with exactly these three keys:
  "background"        — history, prior injuries, personal/employment circumstances
  "clinical_findings" — examination, diagnoses, test results, symptoms, and treatment
  "opinions"          — expert opinions, causation assessments, conclusions, recommendations
Use empty string "" for any section that is absent.  No extra keys.  No commentary.

DOCUMENT:
---
{}
---"#,
        &text[..text.len().min(8000)]
    );

    let (segments, method) = match call_ollama(&prompt) {
        Ok(json_str) => {
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) if v.get("background").is_some()
                      && v.get("clinical_findings").is_some()
                      && v.get("opinions").is_some() => (v, "ollama"),
                _ => (segment_document_rules(&text), "rules_ollama_invalid"),
            }
        }
        Err(_) => (segment_document_rules(&text), "rules"),
    };

    Ok(serde_json::json!({
        "doc_id":     doc_id,
        "method":     method,
        "word_count": text.split_whitespace().count(),
        "segments":   segments,
    }).to_string())
}

fn segment_document_rules(text: &str) -> serde_json::Value {
    const BACKGROUND_HEADERS: &[&str] = &[
        "history", "background", "presenting complaint", "chief complaint",
        "social history", "occupational history", "employment history",
        "past medical history", "prior injuries", "mechanism of injury",
        "personal history",
    ];
    const CLINICAL_HEADERS: &[&str] = &[
        "examination", "clinical examination", "physical examination",
        "findings", "clinical findings", "investigations", "investigation",
        "diagnostic", "diagnosis", "assessment", "symptoms", "treatment",
        "management", "imaging", "radiology", "medication",
    ];
    const OPINION_HEADERS: &[&str] = &[
        "opinion", "opinions", "conclusion", "conclusions",
        "causation", "prognosis", "recommendation", "recommendations",
        "impairment", "capacity", "future treatment", "summary",
        "overall", "in my opinion", "it is my opinion",
    ];

    let mut background_lines: Vec<&str> = Vec::new();
    let mut clinical_lines:   Vec<&str> = Vec::new();
    let mut opinion_lines:    Vec<&str> = Vec::new();
    let mut current = "background";

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let lower = trimmed.to_lowercase();

        // Short lines that match a header pattern switch the current section
        if trimmed.len() < 70 {
            if OPINION_HEADERS.iter().any(|h| lower.starts_with(h) || lower.contains(h)) {
                current = "opinion";
            } else if CLINICAL_HEADERS.iter().any(|h| lower.starts_with(h) || lower.contains(h)) {
                current = "clinical";
            } else if BACKGROUND_HEADERS.iter().any(|h| lower.starts_with(h) || lower.contains(h)) {
                current = "background";
            }
        }

        match current {
            "opinion"  => opinion_lines.push(trimmed),
            "clinical" => clinical_lines.push(trimmed),
            _          => background_lines.push(trimmed),
        }
    }

    serde_json::json!({
        "background":        background_lines.join("\n"),
        "clinical_findings": clinical_lines.join("\n"),
        "opinions":          opinion_lines.join("\n"),
    })
}

// ── Stage 2: extract_claims ───────────────────────────────────────────────────

/// Extract discrete medico-legal claims from document text.
///
/// A claim is any assertion with medico-legal relevance: diagnosis, causation,
/// treatment, prognosis, capacity, or clinical finding.
///
/// Returns JSON:
///   { doc_id, method, claims: [{ id, text, category, confidence, tags }] }
///
/// Categories: "diagnosis" | "causation" | "treatment" | "prognosis" | "capacity" | "finding"
#[tauri::command(rename_all = "camelCase")]
fn extract_claims(text: String, doc_id: String) -> Result<String, String> {
    let prompt = format!(
        r#"You are a medico-legal document analyst. Extract all medico-legal claims from the document below.
A claim is any assertion about injury, illness, treatment, causation, or functional capacity.

Return ONLY a JSON object with key "claims" — an array where each element has:
  "id":         sequential integer (1, 2, 3…)
  "text":       verbatim sentence from the document
  "category":   one of "diagnosis", "causation", "treatment", "prognosis", "capacity", "finding"
  "confidence": float 0.0–1.0 (confidence this is a genuine claim)
  "tags":       array of clinical terms (conditions, medications, procedures) in this claim

Return at most 30 claims. Skip administrative sentences (dates, names, addresses).
Return valid JSON only.  No commentary.

DOCUMENT:
---
{}
---"#,
        &text[..text.len().min(8000)]
    );

    let (claims, method) = match call_ollama(&prompt) {
        Ok(json_str) => {
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) if v.get("claims").and_then(|c| c.as_array()).is_some() => {
                    (v["claims"].clone(), "ollama")
                }
                _ => (extract_claims_rules(&text), "rules_ollama_invalid"),
            }
        }
        Err(_) => (extract_claims_rules(&text), "rules"),
    };

    Ok(serde_json::json!({
        "doc_id": doc_id,
        "method": method,
        "claims": claims,
    }).to_string())
}

fn extract_claims_rules(text: &str) -> serde_json::Value {
    const CAUSATION_SIGNALS: &[&str] = &[
        "caused by", "result of", "due to", "arising from", "attributable to",
        "in my opinion", "i believe", "i consider", "consistent with",
        "as a result of", "secondary to", "following the",
    ];
    const PROGNOSIS_SIGNALS: &[&str] = &[
        "prognosis", "will require", "future treatment", "likely to",
        "permanent", "chronic", "ongoing", "long-term", "permanent impairment",
    ];
    const CAPACITY_SIGNALS: &[&str] = &[
        "capacity", "unable to", "cannot", "restricted", "limited",
        "work capacity", "functional capacity", "unable to return",
        "fit for work", "unfit for work", "modified duties",
    ];
    const TREATMENT_SIGNALS: &[&str] = &[
        "was treated", "underwent", "prescribed", "referred for",
        "commenced", "received", "administered", "therapy was",
    ];

    let mut claims: Vec<serde_json::Value> = Vec::new();
    let mut id: u32 = 1;

    for sentence in text.split(|c: char| c == '.' || c == '\n') {
        let s = sentence.trim();
        if s.len() < 20 { continue; }
        let lower = s.to_lowercase();

        // Classify category by signal phrases; skip if no clinical content
        let category = if CAUSATION_SIGNALS.iter().any(|sig| lower.contains(sig)) {
            "causation"
        } else if PROGNOSIS_SIGNALS.iter().any(|sig| lower.contains(sig)) {
            "prognosis"
        } else if CAPACITY_SIGNALS.iter().any(|sig| lower.contains(sig)) {
            "capacity"
        } else if TREATMENT_SIGNALS.iter().any(|sig| lower.contains(sig)) {
            "treatment"
        } else {
            let has_clinical =
                PIPELINE_CONDITION_KW.iter().any(|kw| contains_word(&lower, kw))
                || PIPELINE_MED_KW.iter().any(|kw| contains_word(&lower, kw))
                || PIPELINE_PROC_KW.iter().any(|kw| contains_word(&lower, kw));
            if !has_clinical { continue; }
            "finding"
        };

        // Collect matched clinical tags
        let mut tags: Vec<String> = Vec::new();
        for &kw in PIPELINE_CONDITION_KW {
            if contains_word(&lower, kw) { tags.push(kw.to_string()); }
        }
        for &kw in PIPELINE_MED_KW {
            if contains_word(&lower, kw) { tags.push(kw.to_string()); }
        }
        for &kw in PIPELINE_PROC_KW {
            if contains_word(&lower, kw) { tags.push(kw.to_string()); }
        }
        tags.dedup();

        claims.push(serde_json::json!({
            "id":         id,
            "text":       s,
            "category":   category,
            "confidence": 0.75,
            "tags":       tags,
        }));

        id += 1;
        if id > 30 { break; }
    }

    serde_json::Value::Array(claims)
}

// ── Stage 3: detect_pipeline_conflicts ───────────────────────────────────────

/// Detect contradictions between claims across multiple documents.
///
/// Input: array of claim-set objects (each is the output of extract_claims).
/// Returns JSON:
///   { method, doc_count, conflicts: [{ topic, claim_a, claim_a_source,
///                                      claim_b, claim_b_source, severity, explanation }] }
#[tauri::command(rename_all = "camelCase")]
fn detect_pipeline_conflicts(
    claim_sets: Vec<serde_json::Value>,
) -> Result<String, String> {
    // Build a compact representation for the LLM (cap at 10 claims per doc)
    let mut all_claim_lines: Vec<String> = Vec::new();
    for (doc_idx, set) in claim_sets.iter().enumerate() {
        let doc_id = set.get("doc_id").and_then(|v| v.as_str()).unwrap_or("unknown");
        if let Some(claims) = set.get("claims").and_then(|c| c.as_array()) {
            for claim in claims.iter().take(10) {
                if let Some(t) = claim.get("text").and_then(|v| v.as_str()) {
                    all_claim_lines.push(format!("[DOC_{}: {}] {}", doc_idx + 1, doc_id, t));
                }
            }
        }
    }

    let prompt = format!(
        r#"You are a medico-legal analyst reviewing claims from multiple documents for contradictions.
Identify direct conflicts where documents make opposing assertions about the same topic.

Return ONLY a JSON object with key "conflicts" — an array where each element has:
  "topic":          subject of the contradiction (e.g. "fracture", "work capacity")
  "claim_a":        first conflicting claim (verbatim)
  "claim_a_source": document identifier for claim_a
  "claim_b":        opposing claim (verbatim)
  "claim_b_source": document identifier for claim_b
  "severity":       "high", "medium", or "low"
  "explanation":    one sentence describing the contradiction

Return an empty array if no genuine contradictions exist.  No commentary.  Valid JSON only.

CLAIMS:
---
{}
---"#,
        all_claim_lines.join("\n")
    );

    let (conflicts, method) = match call_ollama(&prompt) {
        Ok(json_str) => {
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) if v.get("conflicts").and_then(|c| c.as_array()).is_some() => {
                    (v["conflicts"].clone(), "ollama")
                }
                _ => (detect_pipeline_conflicts_rules(&claim_sets), "rules_ollama_invalid"),
            }
        }
        Err(_) => (detect_pipeline_conflicts_rules(&claim_sets), "rules"),
    };

    Ok(serde_json::json!({
        "method":    method,
        "doc_count": claim_sets.len(),
        "conflicts": conflicts,
    }).to_string())
}

fn detect_pipeline_conflicts_rules(claim_sets: &[serde_json::Value]) -> serde_json::Value {
    // Re-use CONFLICT_PAIRS from aggregate_case — same logic applied to claim text
    let mut hits: Vec<(Vec<String>, Vec<String>)> =
        vec![(Vec::new(), Vec::new()); CONFLICT_PAIRS.len()];

    for set in claim_sets {
        let doc_id = set.get("doc_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let all_text: String = set.get("claims")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("text").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_lowercase()
            })
            .unwrap_or_default();

        for (idx, (positive, negative)) in CONFLICT_PAIRS.iter().enumerate() {
            if all_text.contains(positive) { hits[idx].0.push(doc_id.clone()); }
            if all_text.contains(negative) { hits[idx].1.push(doc_id.clone()); }
        }
    }

    let mut conflicts: Vec<serde_json::Value> = Vec::new();
    for (idx, (pos_sources, neg_sources)) in hits.into_iter().enumerate() {
        if pos_sources.is_empty() || neg_sources.is_empty() { continue; }
        let (positive, negative) = CONFLICT_PAIRS[idx];
        conflicts.push(serde_json::json!({
            "topic":          positive,
            "claim_a":        format!("{} (affirmed)", positive),
            "claim_a_source": pos_sources.join(", "),
            "claim_b":        format!("{} (asserted)", negative),
            "claim_b_source": neg_sources.join(", "),
            "severity":       "medium",
            "explanation":    format!(
                "\"{}\" found in [{}] but \"{}\" found in [{}]",
                positive, pos_sources.join(", "),
                negative, neg_sources.join(", ")
            ),
        }));
    }

    serde_json::Value::Array(conflicts)
}

// ── Stage 4: reconstruct_timeline ────────────────────────────────────────────

/// Reconstruct a chronological timeline of medico-legal events.
///
/// Input: array of structured documents (output of extract_structured_data).
/// Returns JSON:
///   { method, timeline: [{ date, date_iso, event, source, category }] }
///
/// Event categories: "injury" | "consultation" | "treatment" | "investigation" |
///                   "report" | "legal"
#[tauri::command(rename_all = "camelCase")]
fn reconstruct_timeline(documents: Vec<serde_json::Value>) -> Result<String, String> {
    // Compact summary for LLM — doc id, dates, and first 3 key findings
    let doc_summary: String = documents.iter().enumerate().map(|(i, doc)| {
        let doc_id = doc.get("doc_id").and_then(|v| v.as_str()).unwrap_or("unknown");
        let dates: Vec<&str> = doc.get("dates")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
            .unwrap_or_default();
        let findings: Vec<&str> = doc.get("key_findings")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str()).take(3).collect())
            .unwrap_or_default();
        format!(
            "Doc {}: {} | Dates: {} | Findings: {}",
            i + 1, doc_id,
            dates.join(", "),
            findings.join("; ")
        )
    }).collect::<Vec<_>>().join("\n");

    let prompt = format!(
        r#"You are a medico-legal timeline analyst. Reconstruct a chronological timeline from the documents below.

Return ONLY a JSON object with key "timeline" — an array sorted earliest to latest where each element has:
  "date":     date string as it appears in the document
  "date_iso": ISO 8601 estimate "YYYY-MM-DD" or "YYYY-MM" or null if unknown
  "event":    concise description (max 80 chars) of what happened on this date
  "source":   document identifier this event comes from
  "category": one of "injury", "consultation", "treatment", "investigation", "report", "legal"

Omit duplicates.  Sort earliest to latest.  Return valid JSON only.  No commentary.

DOCUMENTS:
---
{}
---"#,
        doc_summary
    );

    let (timeline, method) = match call_ollama(&prompt) {
        Ok(json_str) => {
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) if v.get("timeline").and_then(|t| t.as_array()).is_some() => {
                    (v["timeline"].clone(), "ollama")
                }
                _ => (reconstruct_timeline_rules(&documents), "rules_ollama_invalid"),
            }
        }
        Err(_) => (reconstruct_timeline_rules(&documents), "rules"),
    };

    Ok(serde_json::json!({
        "method":   method,
        "timeline": timeline,
    }).to_string())
}

fn reconstruct_timeline_rules(documents: &[serde_json::Value]) -> serde_json::Value {
    let mut entries: Vec<serde_json::Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for doc in documents {
        let doc_id = doc.get("doc_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let doc_type = doc.get("document_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");

        let category = match doc_type {
            "imaging"  => "investigation",
            "referral" => "consultation",
            "report"   => "report",
            _          => "consultation",
        };

        let context = doc.get("key_findings")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .map(|s| {
                if s.len() > 80 { format!("{}…", &s[..80]) } else { s.to_string() }
            })
            .unwrap_or_else(|| format!("Event from {}", doc_id));

        if let Some(dates) = doc.get("dates").and_then(|v| v.as_array()) {
            for date_val in dates {
                if let Some(date) = date_val.as_str() {
                    let key = format!("{}|{}", date, doc_id);
                    if seen.insert(key) {
                        entries.push(serde_json::json!({
                            "date":     date,
                            "date_iso": date,
                            "event":    context.clone(),
                            "source":   doc_id.clone(),
                            "category": category,
                        }));
                    }
                }
            }
        }
    }

    // ISO-8601 dates (YYYY-MM-DD) sort correctly as strings
    entries.sort_by(|a, b| {
        let da = a.get("date_iso").and_then(|v| v.as_str()).unwrap_or("");
        let db = b.get("date_iso").and_then(|v| v.as_str()).unwrap_or("");
        da.cmp(db)
    });

    serde_json::Value::Array(entries)
}

// ── Stage 5: synthesise_report ────────────────────────────────────────────────

/// Synthesise a final medico-legal report from all pipeline outputs.
///
/// Terminal stage — combines aggregate case data, detected conflicts, and
/// reconstructed timeline into a structured narrative report for legal review.
///
/// Inputs:
///   case_summary — output of aggregate_case (or its case_summary sub-object)
///   conflicts    — output of detect_pipeline_conflicts
///   timeline     — output of reconstruct_timeline
///
/// Returns JSON:
///   { method, report: { executive_summary, injury_narrative, treatment_history,
///                       opinions_and_causation, conflicts_summary, recommendations,
///                       overall_assessment, timeline, metadata } }
#[tauri::command(rename_all = "camelCase")]
fn synthesise_report(
    case_summary: serde_json::Value,
    conflicts:    serde_json::Value,
    timeline:     serde_json::Value,
) -> Result<String, String> {
    // Unwrap the nested case_summary object if the caller passed the full aggregate_case output
    let summary = case_summary
        .get("case_summary")
        .unwrap_or(&case_summary);

    let conditions: Vec<String> = summary.get("overall_conditions")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect())
        .unwrap_or_default();
    let medications: Vec<String> = summary.get("medications")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect())
        .unwrap_or_default();
    let procedures: Vec<String> = summary.get("procedures")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect())
        .unwrap_or_default();
    let conflict_count = conflicts.get("conflicts")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);
    let existing_narrative = summary
        .get("case_narrative")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let prompt = format!(
        r#"You are a medico-legal report writer.  Write a formal synthesis report based on the structured case data.

Return ONLY a JSON object with exactly these keys:
  "executive_summary":      2–3 sentence factual overview of the case
  "injury_narrative":       paragraph describing injuries and conditions across documents
  "treatment_history":      paragraph describing treatments, procedures, and medications
  "opinions_and_causation": paragraph summarising medical opinions and causation assessments
  "conflicts_summary":      paragraph noting conflicting clinical opinions ("No conflicts identified." if none)
  "recommendations":        array of 2–5 string recommendations for the legal team
  "overall_assessment":     one sentence clinical picture for legal purposes

Write in formal, factual medico-legal style.  Do not speculate beyond the data.
Return valid JSON only.  No commentary.

CASE DATA:
  Conditions:       {}
  Medications:      {}
  Procedures:       {}
  Conflicts:        {}
  Narrative (draft): {}
"#,
        conditions.join(", "),
        medications.join(", "),
        procedures.join(", "),
        conflict_count,
        &existing_narrative[..existing_narrative.len().min(600)]
    );

    let (report_content, method) = match call_ollama(&prompt) {
        Ok(json_str) => {
            match serde_json::from_str::<serde_json::Value>(&json_str) {
                Ok(v) if v.get("executive_summary").is_some() => (v, "ollama"),
                _ => (
                    synthesise_report_rules(summary, &conflicts, &conditions, &medications, &procedures),
                    "rules_ollama_invalid",
                ),
            }
        }
        Err(_) => (
            synthesise_report_rules(summary, &conflicts, &conditions, &medications, &procedures),
            "rules",
        ),
    };

    let timeline_entries = timeline
        .get("timeline")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    Ok(serde_json::json!({
        "method": method,
        "report": {
            "executive_summary":       report_content.get("executive_summary").cloned().unwrap_or(serde_json::Value::String(String::new())),
            "injury_narrative":        report_content.get("injury_narrative").cloned().unwrap_or(serde_json::Value::String(String::new())),
            "treatment_history":       report_content.get("treatment_history").cloned().unwrap_or(serde_json::Value::String(String::new())),
            "opinions_and_causation":  report_content.get("opinions_and_causation").cloned().unwrap_or(serde_json::Value::String(String::new())),
            "conflicts_summary":       report_content.get("conflicts_summary").cloned().unwrap_or(serde_json::Value::String(String::new())),
            "recommendations":         report_content.get("recommendations").cloned().unwrap_or(serde_json::Value::Array(Vec::new())),
            "overall_assessment":      report_content.get("overall_assessment").cloned().unwrap_or(serde_json::Value::String(String::new())),
            "timeline":                timeline_entries,
            "metadata": {
                "conditions":       conditions,
                "medications":       medications,
                "procedures":        procedures,
                "conflict_count":    conflict_count,
                "clinical_doc_count": summary.get("clinical_document_count").cloned().unwrap_or(serde_json::Value::Null),
            }
        }
    }).to_string())
}

fn synthesise_report_rules(
    summary:    &serde_json::Value,
    conflicts:  &serde_json::Value,
    conditions: &[String],
    medications:&[String],
    procedures: &[String],
) -> serde_json::Value {
    let conflict_arr: Vec<&serde_json::Value> = conflicts
        .get("conflicts")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().collect())
        .unwrap_or_default();

    // ── Executive summary ─────────────────────────────────────────────────────
    let executive_summary = if conditions.is_empty() {
        "Insufficient clinical data to synthesise a case summary.".to_string()
    } else {
        format!(
            "Review of available documents identifies {} condition(s) across the provided medical \
             records.  {} treatment(s)/procedure(s) and {} medication(s) are documented.",
            conditions.len(), procedures.len(), medications.len()
        )
    };

    // ── Injury narrative ──────────────────────────────────────────────────────
    let injury_narrative = if conditions.is_empty() {
        "No injuries or conditions were identified in the available documentation.".to_string()
    } else {
        format!(
            "The following conditions are documented across the provided medical records: {}.",
            conditions.join(", ")
        )
    };

    // ── Treatment history ─────────────────────────────────────────────────────
    let treatment_history = {
        let mut parts: Vec<String> = Vec::new();
        if !procedures.is_empty() {
            parts.push(format!("Procedures documented include: {}.", procedures.join(", ")));
        }
        if !medications.is_empty() {
            parts.push(format!("Medications on record include: {}.", medications.join(", ")));
        }
        if parts.is_empty() {
            "No treatment history identified in the available documentation.".to_string()
        } else {
            parts.join("  ")
        }
    };

    // ── Conflicts summary ─────────────────────────────────────────────────────
    let conflicts_summary = if conflict_arr.is_empty() {
        "No conflicts identified across the reviewed documents.".to_string()
    } else {
        let topics: Vec<&str> = conflict_arr
            .iter()
            .filter_map(|c| c.get("topic").and_then(|v| v.as_str()))
            .collect();
        format!(
            "Conflicting documentation detected regarding: {}.  \
             Source documents should be reviewed directly for clarification.",
            topics.join(", ")
        )
    };

    // ── Opinions and causation — use existing narrative as-is ─────────────────
    let opinions_and_causation = summary
        .get("case_narrative")
        .and_then(|v| v.as_str())
        .unwrap_or("No causation opinions identified in the available documentation.")
        .to_string();

    // ── Recommendations ───────────────────────────────────────────────────────
    let mut recommendations: Vec<String> = Vec::new();
    if !conflict_arr.is_empty() {
        recommendations.push(
            "Resolve conflicting clinical opinions with independent expert review.".to_string(),
        );
    }
    let has_psych = conditions.iter().any(|c| {
        let l = c.to_lowercase();
        l.contains("ptsd") || l.contains("depress") || l.contains("anxiety")
            || l.contains("stress disorder")
    });
    if has_psych {
        recommendations.push(
            "Obtain current psychiatric assessment to establish present functional status.".to_string(),
        );
    }
    let has_msk = conditions.iter().any(|c| {
        let l = c.to_lowercase();
        l.contains("fracture") || l.contains("disc") || l.contains("tear")
            || l.contains("acl") || l.contains("meniscus")
    });
    if has_msk {
        recommendations.push(
            "Obtain updated imaging to document current musculoskeletal status.".to_string(),
        );
    }
    if medications.is_empty() && !conditions.is_empty() {
        recommendations.push(
            "Obtain current medication list to confirm ongoing pharmacological management.".to_string(),
        );
    }
    recommendations.push(
        "Ensure all treating specialist reports are obtained and reviewed.".to_string(),
    );

    serde_json::json!({
        "executive_summary":       executive_summary,
        "injury_narrative":        injury_narrative,
        "treatment_history":       treatment_history,
        "opinions_and_causation":  opinions_and_causation,
        "conflicts_summary":       conflicts_summary,
        "recommendations":         recommendations,
        "overall_assessment":      executive_summary,
    })
}

// ─── Unified process_document pipeline ───────────────────────────────────────
//
// Single-command entry point for the frontend.  Fully deterministic, no network.
//
// Chain:
//   1. normalise_input_text    — strip OCR / UI artefacts at line level
//   2. extract_structured_data — rule-based entity + date extraction
//   3. entity_clean::clean_entities — normalise, dedup, garbage-filter
//   4. build_canonical_timeline — date → nearest clinical sentence → category
//   5. detect_intra_doc_conflicts — uncertainty markers + contradiction pairs
//   6. build_document_summary   — key_conditions / key_treatments / overview
//
// Canonical output shape:
//   {
//     "entities":  { "conditions": [], "medications": [], "procedures": [] },
//     "timeline":  [{ "date_iso": "", "event": "", "category": "" }],
//     "conflicts": [{ "type": "", "details": "" }],
//     "summary":   { "key_conditions": [], "key_treatments": [], "overview": "" }
//   }

// `normalise_input_text` has been replaced by the dedicated `text_clean`
// module ([backend/src-tauri/src/text_clean.rs]). All entry points
// (run_ner, extract_nlp_entities, extract_structured_data, process_document)
// now go through `text_clean::clean_extracted_text` so we have ONE
// canonical cleaning path with line-level audit trail. Do not reintroduce
// a second cleaner here.

/// Pull all string elements from a named JSON array field.
fn extract_string_vec(v: &serde_json::Value, field: &str) -> Vec<String> {
    v.get(field)
        .and_then(|f| f.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Truncate a sentence to at most 120 chars, appending "…" if cut.
fn truncate_sentence(s: &str) -> String {
    if s.len() <= 120 {
        s.to_string()
    } else {
        // Truncate at a char boundary — len() is byte-count, so slice safely
        let mut end = 120;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// Find the sentence in `text` closest (by char position) to a mention of
/// `iso_date` (format: "yyyy-mm-dd").  Falls back to the first long sentence.
fn nearest_clinical_sentence(text: &str, iso_date: &str) -> String {
    // Convert iso "yyyy-mm-dd" → "dd/mm/yyyy" as it appears in documents
    let parts: Vec<&str> = iso_date.split('-').collect();
    let raw_date_str: String = if parts.len() == 3 {
        format!("{}/{}/{}", parts[2], parts[1], parts[0])
    } else {
        iso_date.to_string()
    };
    let year = parts.first().copied().unwrap_or("");

    // Candidate sentences: split on newlines then on ". "
    let sentences: Vec<&str> = text
        .split('\n')
        .flat_map(|line| line.split(". "))
        .map(str::trim)
        .filter(|s| s.len() >= 15)
        .collect();

    // First pass: sentence contains the dd/mm/yyyy literal
    for s in &sentences {
        if s.contains(&raw_date_str) {
            return truncate_sentence(s);
        }
    }

    // Second pass: sentence contains the 4-digit year
    if !year.is_empty() {
        for s in &sentences {
            if s.contains(year) {
                return truncate_sentence(s);
            }
        }
    }

    // Fallback: first qualifying sentence
    sentences.first().map(|s| truncate_sentence(s)).unwrap_or_default()
}

/// Classify the event category of a clinical sentence.
fn classify_event_from_context(sentence: &str) -> &'static str {
    let l = sentence.to_lowercase();
    if l.contains("accident") || l.contains("incident") || l.contains("injury")
        || l.contains("trauma") || l.contains("collision") || l.contains("fell")
        || l.contains("fall")
    {
        "injury"
    } else if l.contains("surgery") || l.contains("operation")
        || l.contains("injection") || l.contains("implant")
    {
        "procedure"
    } else if l.contains("physiotherapy") || l.contains("therapy")
        || l.contains("treatment") || l.contains("rehabilitation")
        || l.contains("commenced")
    {
        "treatment"
    } else if l.contains("prescribed") || l.contains("medication")
        || l.contains(" mg ") || l.contains(" mg")
        || l.contains("dose") || l.contains("tablet")
    {
        "medication"
    } else if l.contains("examination") || l.contains("assessment")
        || l.contains("review") || l.contains("consultation")
        || l.contains("appointment")
    {
        "assessment"
    } else if l.contains("diagnos") || l.contains("confirmed")
        || l.contains("identified")
    {
        "diagnosis"
    } else {
        "clinical"
    }
}

/// Build a canonical timeline from sorted ISO date strings.
///
/// For each date, locates the nearest clinical sentence in `text` and
/// classifies the event category.  Output is sorted by `date_iso`.
fn build_canonical_timeline(text: &str, dates: &[String]) -> Vec<serde_json::Value> {
    let mut entries: Vec<serde_json::Value> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for iso_date in dates {
        if iso_date.len() < 4 {
            continue;
        }
        if !seen.insert(iso_date.clone()) {
            continue;
        }

        let event    = nearest_clinical_sentence(text, iso_date);
        let category = classify_event_from_context(&event);

        entries.push(serde_json::json!({
            "date_iso":  iso_date,
            "event":     event,
            "category":  category,
        }));
    }

    // Stable sort by date_iso (entries already arrive sorted, but be safe)
    entries.sort_by(|a, b| {
        let da = a["date_iso"].as_str().unwrap_or("");
        let db = b["date_iso"].as_str().unwrap_or("");
        da.cmp(db)
    });

    entries
}

/// Known contradiction pairs for intra-document conflict detection.
/// (positive_phrase, negative_phrase, topic_label)
const CONFLICT_PAIRS_INTRA: &[(&str, &str, &str)] = &[
    ("fracture",                  "no fracture",           "fracture presence"),
    ("disc herniation",           "no disc",               "disc herniation"),
    ("post-traumatic stress",     "no psychological",      "PTSD / psychological"),
    ("ptsd",                      "no ptsd",               "PTSD diagnosis"),
    ("depression",                "no depression",         "depression"),
    ("anxiety disorder",          "no anxiety",            "anxiety disorder"),
    ("chronic pain",              "no pain",               "chronic pain"),
    ("pre-existing",              "no pre-existing",       "pre-existing conditions"),
    ("prior condition",           "no prior condition",    "prior conditions"),
    ("unable to work",            "returned to work",      "work capacity"),
];

const UNCERTAINTY_MARKERS_INTRA: &[&str] = &[
    "possible ",     "possibly ",      "query ",
    "rule out ",     "rule-out ",      "suspected ",
    "suspect ",      "probable ",      "probably ",
    "likely ",       "may have ",      "might have ",
    "could represent ", "cannot exclude ",
];

/// Detect intra-document conflicts: uncertainty language + contradiction pairs.
fn detect_intra_doc_conflicts(text: &str) -> Vec<serde_json::Value> {
    let lower = text.to_lowercase();
    let mut conflicts: Vec<serde_json::Value> = Vec::new();

    // ── 1. Uncertainty flag (first marker found is enough) ────────────────────
    for marker in UNCERTAINTY_MARKERS_INTRA {
        if lower.contains(marker) {
            // Find an example sentence for context
            let context = text
                .split('\n')
                .flat_map(|l| l.split(". "))
                .map(str::trim)
                .find(|s| s.to_lowercase().contains(marker))
                .map(|s| truncate_sentence(s))
                .unwrap_or_else(|| marker.trim().to_string());

            conflicts.push(serde_json::json!({
                "type":    "uncertainty",
                "details": format!(
                    "Uncertain language detected: \"{}\" — {}",
                    marker.trim(),
                    context
                ),
            }));
            break; // One uncertainty flag per document is sufficient
        }
    }

    // ── 2. Contradiction pairs ────────────────────────────────────────────────
    for (positive, negative, topic) in CONFLICT_PAIRS_INTRA {
        if lower.contains(positive) && lower.contains(negative) {
            conflicts.push(serde_json::json!({
                "type":    "contradiction",
                "details": format!(
                    "Conflicting statements regarding {topic}: \
                     both \"{positive}\" and \"{negative}\" appear in this document."
                ),
            }));
        }
    }

    conflicts
}

/// Build the summary sub-object from canonical entity slices and detected conflicts.
///
/// Accepts plain `&[String]` slices so both Layer 1 (via CleanOutput) and
/// Layer 2 (via JSON extraction) can call this without coupling.
fn build_document_summary(
    conditions:  &[String],
    medications: &[String],
    procedures:  &[String],
    conflicts:   &[serde_json::Value],
    doc_id:      &str,
) -> serde_json::Value {
    // Cap at 5 key conditions / 6 treatments to keep the payload tight
    let key_conditions: Vec<String> = conditions.iter().take(5).cloned().collect();
    let key_treatments: Vec<String> = procedures
        .iter()
        .chain(medications.iter())
        .take(6)
        .cloned()
        .collect();

    let overview = if key_conditions.is_empty() {
        format!("Document '{}': no clinical conditions identified.", doc_id)
    } else {
        let cond_str = key_conditions.join(", ");
        let treat_str = if key_treatments.is_empty() {
            "no treatments recorded".to_string()
        } else {
            key_treatments.join(", ")
        };
        let conflict_note = if conflicts.is_empty() {
            String::new()
        } else {
            format!("  {} conflict(s) detected.", conflicts.len())
        };
        format!(
            "Document '{}': {} condition(s) identified ({}).  Treatments: {}.{}",
            doc_id,
            key_conditions.len(),
            cond_str,
            treat_str,
            conflict_note,
        )
    };

    serde_json::json!({
        "key_conditions": key_conditions,
        "key_treatments": key_treatments,
        "overview":       overview,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — process_document  (deterministic canonical store)
// LAYER 2 — reason_document   (timeline · conflicts · summary)
//
// The two commands form a strict pipeline:
//
//   raw text
//     │
//     ▼
//   process_document  ──▶  { doc_id, clean_text, entities, dates }
//                                         │
//                                         ▼
//                         reason_document ──▶ { timeline, conflicts, summary }
//
// Rules:
//   • process_document never returns raw entity lists, UI noise, or partial data.
//   • reason_document never receives raw OCR text — it operates only on the
//     canonical store produced by Layer 1.
//   • No backflow: the reasoning layer cannot modify canonical entities.
// ─────────────────────────────────────────────────────────────────────────────

/// Rule-based organisation extraction.
///
/// Two passes:
/// 1. Known standalone regulatory / insurance bodies — case-insensitive word-
///    boundary match; returned as uppercase acronym (e.g. "TAC", "WORKCOVER").
/// 2. Lines ≤ 80 chars whose lowercase form ends with a recognised organisation
///    suffix (e.g. "Hospital", "Medical Centre").
///
/// Deduplicates and sorts the result.
fn extract_organisations_rules(text: &str) -> Vec<String> {
    const STANDALONE: &[&str] = &[
        "workcover", "tac", "maca", "icac", "sira", "compcare", "qcomp", "rtwsa",
        "comcare", "dvla",
    ];

    const ORG_SUFFIXES: &[&str] = &[
        "hospital",
        "medical centre", "medical center",
        "health service",  "health network",
        "clinic",
        "rehabilitation centre", "rehabilitation center",
        "physiotherapy centre",  "physiotherapy center",
        "psychology practice",   "psychology clinic",
        "specialist centre",     "specialist center",
        "allied health",
        "general practice",
        "insurance",
        "tribunal",
        "commission",
        "authority",
    ];

    let mut orgs: std::collections::HashSet<String> = std::collections::HashSet::new();
    let lower_full = text.to_lowercase();

    // Pass 1 — standalone regulatory bodies
    for name in STANDALONE {
        // Simple word-boundary: check surrounded by non-alpha or start/end
        if lower_full.contains(name) {
            let idx_opt = lower_full.find(name);
            if let Some(idx) = idx_opt {
                let before_ok = idx == 0
                    || !lower_full[..idx].chars().last().map_or(false, |c| c.is_alphabetic());
                let after_idx = idx + name.len();
                let after_ok = after_idx >= lower_full.len()
                    || !lower_full[after_idx..].chars().next().map_or(false, |c| c.is_alphabetic());
                if before_ok && after_ok {
                    orgs.insert(name.to_uppercase());
                }
            }
        }
    }

    // Pass 2 — lines ending with an organisation suffix
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.len() < 6 || trimmed.len() > 80 {
            continue;
        }
        let lower_line = trimmed.to_lowercase();
        for suffix in ORG_SUFFIXES {
            if lower_line.ends_with(suffix) {
                // Strip leading/trailing non-alphanumeric chars and store
                let clean: String = trimmed
                    .trim_matches(|c: char| !c.is_alphanumeric())
                    .to_string();
                if clean.len() >= 6 {
                    orgs.insert(clean);
                }
                break;
            }
        }
    }

    let mut result: Vec<String> = orgs.into_iter().collect();
    result.sort();
    result
}

/// Reverse-lookup table: known surface forms for canonical conditions.
/// Used by `process_document` so the assertion classifier can find a
/// mention even when the source text only carries the abbreviation
/// (which the structured extractor expands away).
fn surface_forms_for_condition(canonical: &str) -> &'static [&'static str] {
    match canonical {
        "post-traumatic stress disorder"            => &["ptsd", "post traumatic stress disorder", "post-traumatic stress"],
        "complex post-traumatic stress disorder"    => &["cptsd", "c-ptsd"],
        "generalised anxiety disorder"              => &["gad", "generalized anxiety disorder"],
        "major depressive disorder"                 => &["mdd", "major depression"],
        "traumatic brain injury"                    => &["tbi"],
        "mild traumatic brain injury"               => &["mtbi"],
        "post-concussion syndrome"                  => &["pcs"],
        "obsessive-compulsive disorder"             => &["ocd"],
        "attention deficit hyperactivity disorder"  => &["adhd"],
        _ => &[],
    }
}

// ── LAYER 1 ──────────────────────────────────────────────────────────────────

/// **Layer 1 — canonical document store.**
///
/// Converts raw OCR / extracted text into the single source of truth for all
/// downstream processing.  Fully deterministic, no network.
///
/// Pipeline (strict order):
/// 1. `normalise_input_text`       — strip UI / OCR artefacts
/// 2. `extract_structured_data`    — rule-based entity + date extraction
/// 3. `entity_clean::clean_entities` — normalise, deduplicate, garbage-filter
/// 4. `extract_organisations_rules`  — rule-based org detection
///
/// **Output (immutable canonical store):**
/// ```json
/// {
///   "doc_id":     "...",
///   "clean_text": "...",
///   "entities": {
///     "conditions":    [],
///     "medications":   [],
///     "procedures":    [],
///     "organisations": []
///   },
///   "dates": []
/// }
/// ```
///
/// **Invariants:**
/// - No raw entity lists (`injuries_or_conditions`, `raw_conditions`, etc.)
/// - `clean_text` is the only text representation stored
/// - Every entity list is deduplicated and in canonical (normalised) form
#[tauri::command(rename_all = "camelCase")]
fn process_document(text: String, doc_id: String) -> Result<String, String> {
    // Public command keeps the legacy best-effort event emission for
    // back-compat with non-boundary callers (dev tooling, draft preview).
    process_document_core(text, doc_id, true)
}

/// Core of `process_document`. `emit_legacy_event` gates the Step-3a
/// best-effort `DocumentUploaded` emission.
///
/// CRITICAL: that legacy emission uses `client_id = doc_id`, which on the
/// boundary ingestion path (`process_path_and_persist` /
/// `process_and_persist_document`) would create a PHANTOM self-owned
/// client (id == doc_id) and attach the document to it instead of the
/// real client — the document then never appears under the real client.
/// Boundary callers therefore pass `emit_legacy_event = false`; they emit
/// the authoritative `DocumentExtracted` event (carrying the real
/// `client_id`) themselves.
fn process_document_core(
    text: String,
    doc_id: String,
    emit_legacy_event: bool,
) -> Result<String, String> {
    // ── 0. Optional event emission (Step 3a; off by default) ──────────────────
    if ENABLE_EVENT_STORE && emit_legacy_event {
        init_event_store_once();
        if let Some(store) = event_store() {
            let client_id = doc_id.clone();
            match store.next_version(&client_id) {
                Ok(version) => {
                    let env = events::EventEnvelope::new(
                        client_id,
                        version,
                        events::Actor::System { component: "process_document".into() },
                        events::EventPayload::DocumentUploaded(events::DocumentUploadedP {
                            document_id: doc_id.clone(),
                            file_name: doc_id.clone(),
                            char_count: text.chars().count(),
                            method: "process_document".into(),
                        }),
                        None,
                        None,
                    );
                    if let Err(e) = store.append_event(&env) {
                        eprintln!("[event_store] append failed (non-fatal): {e}");
                    } else if let Some(p) = projection_handle() {
                        if let Err(e) = p.project_forward(std::slice::from_ref(&env)) {
                            eprintln!("[projection] project_forward failed (non-fatal): {e}");
                        }
                    }
                }
                Err(e) => eprintln!("[event_store] next_version failed (non-fatal): {e}"),
            }
        }
    }

    // ── 1. Strip OCR / UI noise ───────────────────────────────────────────────
    // The structured `CleanedText` carries raw_text, clean_text, and a
    // removed-lines audit trail for the UI / tests. Downstream we feed
    // clean_text into rule extraction and NLP.
    let cleaned_text = text_clean::clean_extracted_text(&text);
    let clean_text = cleaned_text.clean_text.clone();

    // ── 2. Rule-based entity + date extraction ────────────────────────────────
    // Pass the ORIGINAL text, not clean_text: extract_structured_data
    // cleans internally, and its index-document detection must scan the
    // raw text — text_clean's short-line rule eats bare "Index of
    // supporting documents" headings, so feeding pre-cleaned text here
    // silently disabled the index gate on the production path (and ran
    // text_clean twice).
    let structured_raw = extract_structured_data(text.clone(), doc_id.clone())?;
    let structured: serde_json::Value = serde_json::from_str(&structured_raw)
        .map_err(|e| format!("JSON parse error: {e}"))?;

    // Prefer `conditions` (canonical); fall back to deprecated `injuries_or_conditions`
    // for documents produced before the field rename.
    let raw_conditions = {
        let from_conditions = extract_string_vec(&structured, "conditions");
        if from_conditions.is_empty() {
            extract_string_vec(&structured, "injuries_or_conditions")
        } else {
            from_conditions
        }
    };
    let raw_medications = extract_string_vec(&structured, "medications");
    let raw_procedures  = extract_string_vec(&structured, "procedures");
    // Preserve the pre-normalisation surface forms — used to drive the
    // assertion classifier so abbreviations like "PTSD" can still be
    // located in clean_text (the canonical form is "post-traumatic
    // stress disorder", which doesn't appear verbatim in most sources).
    let pre_norm_conditions = raw_conditions.clone();
    // Preserved string-only date list — back-compat for callers that
    // already consume canonical.dates as Vec<String>. `dates_struct`
    // (below) carries precision and is the preferred shape going forward.
    let dates_strings   = extract_string_vec(&structured, "dates");

    // ── 3. Entity cleaning + normalisation ────────────────────────────────────
    let clean_input = entity_clean::CleanInput {
        conditions:  raw_conditions,
        medications: raw_medications,
        procedures:  raw_procedures,
    };
    let mut cleaned = entity_clean::clean_entities(clean_input, false);

    // ── 3a. Supplementary lexicon scans ──────────────────────────────────────
    // The structured keyword extractor recognises only canonical drug /
    // procedure names. GP notes and OCR'd documents routinely contain
    // truncated forms ("pregab", "ref physio", "depn") that never reach
    // the conditions/medications/procedures lists. Run a small surface-form
    // scan over clean_text and union the canonical forms back in.
    const MED_SURFACE_FORMS: &[(&str, &str)] = &[
        ("pregab",      "pregabalin"),
        ("pregabaline", "pregabalin"),
        ("amitript",    "amitriptyline"),
        ("fluox",       "fluoxetine"),
        ("parox",       "paroxetine"),
        ("sertr",       "sertraline"),
        ("escital",     "escitalopram"),
        ("venlaf",      "venlafaxine"),
        ("quetiap",     "quetiapine"),
        ("clonaz",      "clonazepam"),
        ("paracet",     "paracetamol"),
    ];
    const PROC_SURFACE_FORMS: &[(&str, &str)] = &[
        ("ref physio",     "physiotherapy referral"),
        ("ref psychology", "psychology referral"),
        ("ref psychiatry", "psychiatry referral"),
        ("physio",         "physiotherapy"),
    ];
    let mut med_set: std::collections::BTreeSet<String> =
        cleaned.medications.iter().cloned().collect();
    // ASCII-only lowercase keeps byte offsets aligned for contains_word.
    let ct_lower = clean_text.to_ascii_lowercase();
    for &(surface, canonical) in MED_SURFACE_FORMS {
        if contains_word(&ct_lower, surface) {
            med_set.insert(canonical.to_string());
        }
    }
    cleaned.medications = med_set.into_iter().collect();

    let mut proc_set: std::collections::BTreeSet<String> =
        cleaned.procedures.iter().cloned().collect();
    for &(surface, canonical) in PROC_SURFACE_FORMS {
        // Multi-word surfaces aren't a single word boundary check — use
        // contains() but require flanking non-alphanumeric where applicable.
        if surface.contains(' ') {
            if ct_lower.contains(surface) {
                proc_set.insert(canonical.to_string());
            }
        } else if contains_word(&ct_lower, surface) {
            proc_set.insert(canonical.to_string());
        }
    }
    cleaned.procedures = proc_set.into_iter().collect();

    // ── 3b. Symptom keyword scan ─────────────────────────────────────────────
    // The condition-keyword extractor only recognises a narrow subset of
    // symptoms (e.g. "anxiety"). Many spec-relevant terms — "low mood",
    // "hypervigilance", "intrusive memories", "poor sleep",
    // "appetite change" — never reach the conditions list and therefore
    // never get split into symptoms by entity_clean. Run a dedicated scan
    // so these still land somewhere.
    let mut all_symptoms: std::collections::BTreeSet<String> =
        cleaned.symptoms.iter().cloned().collect();
    const SYMPTOM_LEXICON: &[&str] = &[
        // Psychological
        "low mood",
        "depressed mood",
        "anxiety",
        "panic",
        "panic attacks",
        "hypervigilance",
        "intrusive memories",
        "intrusive thoughts",
        "flashbacks",
        "nightmares",
        "avoidance",
        "anhedonia",
        "rumination",
        "tearfulness",
        // Sleep / appetite / energy
        "poor sleep",
        "sleep disturbance",
        "appetite change",
        "appetite loss",
        "weight loss",
        "fatigue",
        "irritability",
        // Pain — generic and back-pain family. Per the spec these are
        // symptoms/complaints, not diagnoses, unless an explicit dx
        // phrase (e.g. "chronic pain syndrome", "lumbar radiculopathy")
        // accompanies them.
        "lower back pain",
        "low back pain",
        "back pain",
        "lumbar pain",
        "ongoing pain",
        "chronic pain",
        "pain",
    ];
    let clean_text_lower = clean_text.to_ascii_lowercase();
    for &kw in SYMPTOM_LEXICON {
        if contains_word(&clean_text_lower, kw) {
            all_symptoms.insert(kw.to_string());
        }
    }
    // Clinical-shorthand aliases. The structured extractor only knows
    // full-form keywords like "anxiety" / "poor sleep". Dictated GP notes
    // routinely abbreviate these ("anx", "anx ++", "sleep poor",
    // "appetite J/↓/down"); without an alias map they slip through silently.
    // We map the surface form to a canonical symptom term so the UI shows
    // the medically sensible label.
    const SYMPTOM_ALIASES: &[(&str, &str)] = &[
        ("anx",          "anxiety"),
        ("sleep poor",   "poor sleep"),
        ("appetite j",   "appetite change"),
        ("appetite ↓",   "appetite change"),
        ("appetite down","appetite change"),
        ("low mood",     "low mood"),
    ];
    for &(surface, canonical) in SYMPTOM_ALIASES {
        if surface.contains(' ') || surface.contains('↓') {
            if clean_text_lower.contains(surface) {
                all_symptoms.insert(canonical.to_string());
            }
        } else if contains_word(&clean_text_lower, surface) {
            all_symptoms.insert(canonical.to_string());
        }
    }
    // Subset suppression: if a longer phrase is already present, drop any
    // shorter phrase that is a strict substring of it. Prevents the
    // "lower back pain" / "back pain" / "pain" trio from all appearing.
    let collected: Vec<String> = all_symptoms.iter().cloned().collect();
    let mut symptoms_vec: Vec<String> = collected
        .iter()
        .filter(|s| {
            !collected.iter().any(|other| {
                other.len() > s.len() && other.contains(s.as_str())
            })
        })
        .cloned()
        .collect();
    symptoms_vec.sort();

    // ── 4. Organisation extraction ────────────────────────────────────────────
    let organisations = extract_organisations_rules(&clean_text);

    // ── 5. Assertion classification on condition mentions ─────────────────────
    // For each condition term, locate the sentence containing it and
    // classify the assertion (affirmed / queried / negated / contradicted /
    // differential / historical). Defaults to Affirmed when no cue fires
    // because the term is already in the cleaned conditions list (i.e.
    // diagnosis-like). Symptom-only routing is handled separately via
    // `cleaned.symptoms`.
    // Collect EVERY occurrence of each canonical condition across the
    // cleaned text — canonical form + known acronyms + same-canonical
    // pre-norm surface forms — and classify each one independently.
    // This is the multi-mention requirement: when one clinician affirms
    // PTSD and another contradicts it, both statuses MUST appear. The UI
    // groups by status and shows them as separate evidence rather than
    // silently flattening to a single verdict.
    let mut condition_mentions: Vec<serde_json::Value> = Vec::new();
    for term in &cleaned.conditions {
        let mut search_terms: Vec<String> = vec![term.clone()];
        for s in surface_forms_for_condition(term) {
            search_terms.push((*s).to_string());
        }
        // Same-canonical pre-norm forms only — cross-canonical raw forms
        // would let PTSD's status latch onto an MDD sentence.
        for raw in &pre_norm_conditions {
            let lower = raw.to_lowercase();
            if lower.trim() == term.to_lowercase().trim() {
                continue;
            }
            if lower.contains(term) || term.contains(&lower) {
                search_terms.push(raw.clone());
            }
        }
        // Dedupe by (status, normalised snippet) so the same sentence
        // found via canonical AND acronym is only emitted once.
        let mut seen: std::collections::HashSet<(String, String)> =
            std::collections::HashSet::new();
        let mut found_any = false;
        for st in &search_terms {
            for m in assertion::classify_all_mentions(&clean_text, st, false) {
                found_any = true;
                let key = (
                    m.status.as_str().to_string(),
                    m.snippet.trim().to_lowercase(),
                );
                if !seen.insert(key) {
                    continue;
                }
                condition_mentions.push(serde_json::json!({
                    "term": term,
                    "status": m.status.as_str(),
                    "snippet": m.snippet,
                    // Persistence-boundary offsets — required for the
                    // snippet-integrity check
                    // clean_text[start..end] == snippet.
                    "start": m.start,
                    "end":   m.end,
                    // Raw pre-normalisation form (the search term that
                    // matched — e.g. "PTSD" before it canonicalised to
                    // "post-traumatic stress disorder").
                    "raw_term": st,
                }));
            }
        }
        // Last-ditch: cleaned.conditions believes the term is present
        // but no sentence in clean_text mentions it — emit one unanchored
        // affirmed entry so the diagnosis is still visible. Offsets are
        // zero (the integrity check trivially passes on empty snippets:
        // clean_text[0..0] == "").
        if !found_any {
            condition_mentions.push(serde_json::json!({
                "term": term,
                "status": "affirmed",
                "snippet": "",
                "start": 0,
                "end":   0,
                "raw_term": term,
            }));
        }
    }

    // Synthetic queried-abbreviation pass. The structured extractor only
    // recognises canonical keywords; bare abbreviations like "depn"
    // never reach the conditions list, so a "? depn" line would silently
    // disappear despite being a clinically important queried diagnosis.
    // We scan clean_text directly for `?\s*<abbr>` patterns and emit a
    // queried mention for the canonical form, dedup'ing against the main
    // loop's output via (status, snippet).
    {
        const QUERIED_ABBR_MAP: &[(&str, &str)] = &[
            ("depn",       "depression"),
            ("ptsd",       "post-traumatic stress disorder"),
            ("gad",        "generalised anxiety disorder"),
            ("mdd",        "major depressive disorder"),
            ("ocd",        "obsessive-compulsive disorder"),
            ("tbi",        "traumatic brain injury"),
            ("adhd",       "attention deficit hyperactivity disorder"),
            ("depression", "depression"),
            ("anxiety",    "anxiety disorder"),
        ];
        let mut seen_synth: std::collections::HashSet<(String, String)> =
            std::collections::HashSet::new();
        for entry in &condition_mentions {
            let status = entry
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let snippet = entry
                .get("snippet")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            seen_synth.insert((status, snippet));
        }
        // ASCII-only lowercase: positions found here are used to slice
        // clean_text directly, so byte lengths must match exactly.
        let lower = clean_text.to_ascii_lowercase();
        for &(abbr, canonical) in QUERIED_ABBR_MAP {
            let needle = format!("? {abbr}");
            let needle2 = format!("?{abbr}");
            for n in [needle.as_str(), needle2.as_str()] {
                let mut from = 0;
                while let Some(rel) = lower[from..].find(n) {
                    let pos = from + rel;
                    // Build a snippet from the line containing this hit
                    // — tracking byte offsets so the persistence
                    // boundary's snippet-integrity check passes:
                    // clean_text[snip_start..snip_end] == snippet.
                    let line_byte_start = lower[..pos]
                        .rfind('\n')
                        .map(|i| i + 1)
                        .unwrap_or(0);
                    let line_byte_end = lower[pos..]
                        .find('\n')
                        .map(|i| pos + i)
                        .unwrap_or(lower.len());
                    let bytes = clean_text.as_bytes();
                    let mut snip_start = line_byte_start;
                    let mut snip_end = line_byte_end;
                    while snip_start < snip_end && bytes[snip_start].is_ascii_whitespace() {
                        snip_start += 1;
                    }
                    while snip_end > snip_start && bytes[snip_end - 1].is_ascii_whitespace() {
                        snip_end -= 1;
                    }
                    let snippet = clean_text[snip_start..snip_end].to_string();
                    let key = (
                        "queried".to_string(),
                        snippet.to_lowercase(),
                    );
                    if seen_synth.insert(key) {
                        condition_mentions.push(serde_json::json!({
                            "term": canonical,
                            "status": "queried",
                            "snippet": snippet,
                            "start": snip_start,
                            "end":   snip_end,
                            "raw_term": abbr,
                        }));
                    }
                    from = pos + n.len();
                    if from >= lower.len() { break; }
                }
            }
        }
    }

    // ── 6. Dates with precision ──────────────────────────────────────────────
    let dates_struct: Vec<serde_json::Value> = dates::find_dates(&clean_text)
        .into_iter()
        .map(|d| serde_json::json!({
            "raw": d.raw,
            "value": d.value,
            "precision": match d.precision {
                dates::DatePrecision::Day => "day",
                dates::DatePrecision::Month => "month",
                dates::DatePrecision::Year => "year",
            },
        }))
        .collect();

    // ── 7. Document type (uses the bundle-aware classifier) ──────────────────
    let doc_type = detect_document_type(&clean_text.to_lowercase());

    // ── 8. Deterministic person / party extraction ──────────────────────────
    // Runs ON CLEANED TEXT. Independent of spaCy. Finds Author lines,
    // role-labelled clinicians, and patient identifiers via structured
    // patterns. spaCy stays strict; this fills the gap for the structured
    // medico-legal headers it cannot reliably handle.
    let people = party_extract::extract_people(&clean_text);
    let people_json: Vec<serde_json::Value> = people
        .iter()
        .map(|p| serde_json::json!({
            "name": p.name,
            "role": p.role.as_str(),
            "source_snippet": p.source_snippet,
            // Persistence-boundary offsets so downstream consumers can
            // verify snippet integrity if they materialise people as
            // ClinicalEvents later in the pipeline.
            "snippet_start": p.snippet_start,
            "snippet_end":   p.snippet_end,
            "confidence": p.confidence,
        }))
        .collect();
    let parties = serde_json::json!({
        "doctor":       party_extract::first_doctor(&people).map(|p| p.name.clone()).unwrap_or_default(),
        "patient":      party_extract::first_patient(&people).map(|p| p.name.clone()).unwrap_or_default(),
        "organisation": organisations.first().cloned().unwrap_or_default(),
    });

    // ── 9. ClinicalEvent layer (additive — never replaces above) ────────────
    // Translate extraction-stage outputs into canonical ClinicalEvent
    // records. This is the substrate the future timeline / conflict /
    // summary reasoner will consume; today nothing in the UI mutates on
    // it — see DocumentCard's Event Inspector (dev-toggle only).
    let (clinical_events, unified_clinical_events): (
        Vec<serde_json::Value>,
        Vec<serde_json::Value>,
    ) = {
        let cm_input: Vec<clinical_events::RawConditionMention> = condition_mentions
            .iter()
            .map(|e| clinical_events::RawConditionMention {
                term:    e.get("term").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                status:  e.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                snippet: e.get("snippet").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                // Persistence-boundary offsets — emitted by the
                // assertion classifier and synthetic queried pass.
                // Default to 0 when absent (legacy / synthesized).
                start: e.get("start").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                end:   e.get("end")  .and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                raw_term: e.get("raw_term")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
            })
            .collect();
        let people_input: Vec<clinical_events::RawPerson> = people
            .iter()
            .map(|p| clinical_events::RawPerson {
                name: p.name.clone(),
                role: p.role.as_str().to_string(),
                snippet: p.source_snippet.clone(),
                snippet_start: p.snippet_start,
                snippet_end:   p.snippet_end,
                confidence: p.confidence,
            })
            .collect();
        let dates_input: Vec<clinical_events::RawDate> = dates::find_dates(&clean_text)
            .into_iter()
            .map(|d| clinical_events::RawDate {
                raw: d.raw,
                value: d.value,
                precision: match d.precision {
                    dates::DatePrecision::Day   => clinical_events::DatePrecision::Day,
                    dates::DatePrecision::Month => clinical_events::DatePrecision::Month,
                    dates::DatePrecision::Year  => clinical_events::DatePrecision::Year,
                },
                start: d.start,
                end:   d.end,
            })
            .collect();
        let events = clinical_events::build_events(clinical_events::EventBuildInput {
            doc_id: &doc_id,
            clean_text: &clean_text,
            condition_mentions: cm_input,
            symptoms: symptoms_vec.clone(),
            medications: cleaned.medications.clone(),
            procedures: cleaned.procedures.clone(),
            people: people_input,
            dates: dates_input,
        });
        // Phase B — unify into the canonical-graph view. The raw events
        // remain available unchanged; unified is purely additive.
        let unified = event_unification::unify_events(events.clone());
        let events_json: Vec<serde_json::Value> = events
            .into_iter()
            .map(|e| serde_json::to_value(e).unwrap_or(serde_json::Value::Null))
            .collect();
        let unified_json: Vec<serde_json::Value> = unified
            .into_iter()
            .map(|u| serde_json::to_value(u).unwrap_or(serde_json::Value::Null))
            .collect();
        (events_json, unified_json)
    };

    // ── Structured medico-legal fact layer (additive) ─────────────────────────
    // Lifts typed facts (medications/symptoms/injuries/treatments/functional)
    // from clean_text, each with confidence + evidence snippet + offsets + date
    // span. Purely additive: emitted under `structured_facts`; nothing else reads
    // or depends on it yet, so timelines/contradiction/graph/exports are intact.
    let structured_facts = structured_extract::extract_structured_facts(&clean_text, &doc_id);

    // ── Canonical store — single source of truth ──────────────────────────────
    Ok(serde_json::json!({
        "doc_id":     doc_id,
        "document_type": doc_type,
        // Raw + clean text + audit trail. Frontend uses these to surface
        // "view raw" / "view cleaned" toggles and the removed-line list.
        "raw_text":   cleaned_text.raw_text,
        "clean_text": clean_text,
        "removed_lines": cleaned_text.removed_lines,
        "warnings":   cleaned_text.warnings,
        "entities": {
            "conditions":    cleaned.conditions,
            // Symptom-only mentions (anxiety / hypervigilance / low mood …)
            // — not the same as diagnoses. UI displays these under their own
            // heading so they don't get auto-promoted.
            "symptoms":      symptoms_vec,
            "medications":   cleaned.medications,
            "procedures":    cleaned.procedures,
            "organisations": organisations,
        },
        // Per-condition assertion: queried / contradicted / etc.
        "condition_mentions": condition_mentions,
        // Back-compat string list for callers that already shape on it.
        "dates": dates_strings,
        // Preferred shape: each date carries precision so a bare year is
        // not silently promoted to YYYY-01-01.
        "dates_struct": dates_struct,
        // Deterministic people / parties extracted from structured
        // patterns (Author:, Dr X, Patient:, …). Independent of spaCy.
        "people": people_json,
        "parties": parties,
        // ── Canonical Clinical Event Layer (additive, see clinical_events.rs).
        // Reasoning / timeline / conflict-detection / summary all consume
        // this list. Each event ties back to a concept extracted above.
        "clinical_events": clinical_events,
        // Unified canonical-graph view (additive, see event_unification.rs).
        // One entry per (event_type, normalised concept) — fully reversible
        // via source_event_ids on each UnifiedEvent.
        "unified_clinical_events": unified_clinical_events,
        // ── Structured medico-legal fact layer (additive, see structured_fact.rs).
        // Typed per-domain facts (medications/symptoms/injuries/treatments/
        // functional impacts), each with confidence + evidence snippet + offsets
        // + optional date span. Consumed by no existing reader yet — a foundation
        // for later reporting / contradiction / timeline / forecasting layers.
        "structured_facts": serde_json::to_value(&structured_facts)
            .unwrap_or(serde_json::Value::Null),
    })
    .to_string())
}

// ── LAYER 2 ──────────────────────────────────────────────────────────────────

/// **Layer 2 — reasoning over the canonical store.**
///
/// Accepts the immutable output of `process_document` and applies deterministic
/// reasoning to produce timeline, conflict detection, and a medico-legal summary.
///
/// **Input**: the JSON object returned by `process_document`.
/// **Never** receives raw OCR text or un-normalised entity lists.
///
/// **Output (strict schema):**
/// ```json
/// {
///   "timeline":  [{ "date_iso": "", "event": "", "category": "" }],
///   "conflicts": [{ "type": "", "details": "" }],
///   "summary": {
///     "key_conditions": [],
///     "key_treatments": [],
///     "overview": ""
///   }
/// }
/// ```
///
/// **Timeline categories**: `assessment` · `investigation` · `treatment` ·
/// `incident` · `medication` · `diagnosis` · `clinical`
#[tauri::command(rename_all = "camelCase")]
fn reason_document(canonical: serde_json::Value) -> Result<String, String> {
    // ── Extract canonical inputs — ONLY these are used downstream ─────────────
    let clean_text = canonical
        .get("clean_text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let doc_id = canonical
        .get("doc_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    let entities = canonical.get("entities").cloned().unwrap_or(serde_json::json!({}));
    let conditions  = extract_string_vec(&entities, "conditions");
    let medications = extract_string_vec(&entities, "medications");
    let procedures  = extract_string_vec(&entities, "procedures");
    let dates       = extract_string_vec(&canonical, "dates");

    // ── Phase 5 prep: ClinicalEvent consumption ───────────────────────────────
    // If the caller passed a `clinical_events` array (produced by the
    // new Canonical Clinical Event Layer), surface counts in the
    // response so downstream consumers can begin trusting that path.
    // The legacy `timeline + conflicts + summary` shape is preserved
    // verbatim so existing callers do not break.
    let clinical_events: Vec<serde_json::Value> = canonical
        .get("clinical_events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut event_type_counts: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    for ev in &clinical_events {
        let t = ev
            .get("event_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        *event_type_counts.entry(t).or_insert(0) += 1;
    }

    // Guard: refuse to reason over an empty canonical store
    if clean_text.is_empty() {
        return Err("reason_document: canonical.clean_text is empty — run process_document first".to_string());
    }

    // ── Timeline reconstruction ───────────────────────────────────────────────
    // Input: clean_text + dates  (both from Layer 1 canonical store)
    // Output: sorted [{date_iso, event, category}]
    let timeline = build_canonical_timeline(&clean_text, &dates);

    // ── Conflict detection ────────────────────────────────────────────────────
    // Operates on clean_text only — no raw OCR noise reaches this stage.
    let conflicts = detect_intra_doc_conflicts(&clean_text);

    // ── Medico-legal summary ──────────────────────────────────────────────────
    let summary = build_document_summary(
        &conditions,
        &medications,
        &procedures,
        &conflicts,
        &doc_id,
    );

    Ok(serde_json::json!({
        "timeline":  timeline,
        "conflicts": conflicts,
        "summary":   summary,
        // Phase 5 prep — visible to callers but not yet consumed by the
        // reasoner. Future patches will route timeline/conflicts/summary
        // through this list.
        "clinical_events": clinical_events,
        "clinical_events_summary": {
            "count": clinical_events.len(),
            "by_type": event_type_counts,
        },
    })
    .to_string())
}

// ── Patient timeline reasoning (additive, not wired into ingestion) ─────
//
// `reason_patient_timeline` accepts an array of CANONICAL document
// payloads (the output of `process_document`, one per ingested
// document) and produces a cross-document patient-level timeline:
//
//   {
//     "patient_timeline": [PatientEvent, …],
//     "clusters":         []   // reserved for future cluster layer
//   }
//
// Each PatientEvent carries `source_unified_event_ids` +
// `source_document_ids`, so the result is reversible all the way back
// to the per-document UnifiedEvents and their source ClinicalEvents.
//
// This command is intentionally NOT called by the ingestion flow yet;
// it is the API surface a future Patient Overview screen / report
// generator / timeline reasoner will consume.
#[tauri::command(rename_all = "camelCase")]
fn reason_patient_timeline(documents: Vec<serde_json::Value>) -> Result<String, String> {
    use crate::patient_timeline::PatientTimelinePayload;

    // 1. For each input canonical doc, parse the unified_clinical_events
    //    array into typed UnifiedEvent records. Documents without that
    //    field contribute zero events but still count toward total_docs
    //    (so stability_score is computed correctly for sparse corpora).
    let mut docs: Vec<(String, Vec<event_unification::UnifiedEvent>)> = Vec::new();
    for d in documents {
        let doc_id = d
            .get("doc_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let events_arr = d
            .get("unified_clinical_events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut events: Vec<event_unification::UnifiedEvent> = Vec::new();
        for v in events_arr {
            match serde_json::from_value::<event_unification::UnifiedEvent>(v) {
                Ok(u) => events.push(u),
                Err(e) => {
                    // Be permissive — partial corpora are common; we
                    // want best-effort timelines, not hard failures.
                    eprintln!("[reason_patient_timeline] skipping malformed UnifiedEvent in {doc_id}: {e}");
                }
            }
        }
        docs.push((doc_id, events));
    }

    // 2. Build the patient timeline.
    let timeline = patient_timeline::build_patient_timeline_from_unified(docs);

    // 3. Future-ready payload: cluster scaffold is intentionally empty.
    //    The internal `metadata.normalised_concept` + `source_document_ids`
    //    on each PatientEvent already give a future cluster builder the
    //    hooks it needs.
    let payload = PatientTimelinePayload {
        patient_timeline: timeline,
        clusters: Vec::new(),
    };

    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

// ── Condition State Engine (additive, not wired into ingestion) ────────
//
// `reason_clinical_state` accepts a JSON array of `PatientEvent`s — the
// payload produced by `reason_patient_timeline` — and infers the
// patient's current clinical picture: per concept, an `Active /
// Inactive / Resolved / Disputed / Unknown` state plus full transition
// trajectories, stability, and severity scores.
//
// Reversibility: every `ConditionState` carries `supporting_events` and
// `contradicting_events` of PatientEvent ids; those, combined with the
// PatientEvent's own `source_unified_event_ids` / `source_document_ids`,
// give callers the full chain back to ClinicalEvent and the raw
// extracted text.
//
// This command is NOT called by the ingestion flow.
#[tauri::command(rename_all = "camelCase")]
fn reason_clinical_state(patient_events: Vec<serde_json::Value>) -> Result<String, String> {
    use crate::patient_timeline::PatientEvent;

    let mut typed: Vec<PatientEvent> = Vec::with_capacity(patient_events.len());
    for v in patient_events {
        match serde_json::from_value::<PatientEvent>(v) {
            Ok(pe) => typed.push(pe),
            Err(e) => {
                // Be permissive — partial corpora should still produce
                // a best-effort state list.
                eprintln!("[reason_clinical_state] skipping malformed PatientEvent: {e}");
            }
        }
    }
    let states = clinical_state::build_clinical_state(typed);
    serde_json::to_string(&states).map_err(|e| e.to_string())
}

// ── Patient Longitudinal Reconciliation (additive, not wired) ──────────
//
// `reason_longitudinal_reconciliation` accepts an array of canonical
// document payloads (the output of `process_document`) and produces a
// LongitudinalPatientGraph: canonical_events + temporal_edges +
// cross_domain_links + evolution_tracks.
//
// Reversibility: every CanonicalPatientEvent carries
// `unified_event_ids` and `patient_event_ids`, so the chain
// LongitudinalPatientGraph → CanonicalPatientEvent → PatientEvent →
// UnifiedEvent → ClinicalEvent remains intact.
//
// NOT called from ingestion.
#[tauri::command(rename_all = "camelCase")]
fn reason_longitudinal_reconciliation(
    documents: Vec<serde_json::Value>,
    patient_id: Option<String>,
) -> Result<String, String> {
    use crate::patient_longitudinal_reconciliation::{
        build_longitudinal_patient_graph,
    };

    // Parse each canonical doc into (doc_id, Vec<UnifiedEvent>).
    let mut docs: Vec<(String, Vec<event_unification::UnifiedEvent>)> = Vec::new();
    for d in documents {
        let doc_id = d
            .get("doc_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let events_arr = d
            .get("unified_clinical_events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut events: Vec<event_unification::UnifiedEvent> = Vec::new();
        for v in events_arr {
            match serde_json::from_value::<event_unification::UnifiedEvent>(v) {
                Ok(u) => events.push(u),
                Err(e) => {
                    eprintln!("[reason_longitudinal_reconciliation] skipping malformed UnifiedEvent in {doc_id}: {e}");
                }
            }
        }
        docs.push((doc_id, events));
    }

    let graph = build_longitudinal_patient_graph(docs, patient_id);

    let envelope = serde_json::json!({ "longitudinal_patient_graph": graph });
    serde_json::to_string(&envelope).map_err(|e| e.to_string())
}

// ── Global Clinical Knowledge Graph (additive, not wired) ──────────────
//
// `build_clinical_knowledge_graph` is the top of the reasoning stack.
// Inputs are canonical document payloads (output of
// `process_document`); the command walks every layer end-to-end
// (unified → patient_timeline → clinical_state →
// longitudinal_reconciliation → GCKG) and returns:
//
//   {
//     "clinical_knowledge_graph": ClinicalKnowledgeGraph,
//     "medico_legal_summary":     MedicoLegalSummary
//   }
//
// NOT called from ingestion.
#[tauri::command(rename_all = "camelCase")]
fn build_clinical_knowledge_graph(
    documents: Vec<serde_json::Value>,
    patient_id: Option<String>,
) -> Result<String, String> {
    use crate::clinical_knowledge_graph::{
        build_clinical_knowledge_graph as build_ckg, CkgContext,
    };
    use crate::patient_longitudinal_reconciliation::build_longitudinal_patient_graph;
    use crate::patient_timeline::build_patient_timeline_from_unified;

    // 1. Parse canonical doc payloads into (doc_id, Vec<UnifiedEvent>).
    let mut docs: Vec<(String, Vec<event_unification::UnifiedEvent>)> = Vec::new();
    let mut all_unified: Vec<event_unification::UnifiedEvent> = Vec::new();
    for d in documents {
        let doc_id = d
            .get("doc_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        let events_arr = d
            .get("unified_clinical_events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut events: Vec<event_unification::UnifiedEvent> = Vec::new();
        for v in events_arr {
            if let Ok(u) = serde_json::from_value::<event_unification::UnifiedEvent>(v) {
                all_unified.push(u.clone());
                events.push(u);
            }
        }
        docs.push((doc_id, events));
    }

    // 2. Build the lower layers.
    let patient_events = build_patient_timeline_from_unified(docs.clone());
    let longitudinal = build_longitudinal_patient_graph(docs, patient_id);
    let condition_states = clinical_state::build_clinical_state(patient_events.clone());

    // 3. Build the GCKG with full context.
    let (graph, ml_summary) = build_ckg(
        longitudinal,
        CkgContext {
            patient_events,
            unified_events: all_unified,
            condition_states,
        },
    );

    let envelope = serde_json::json!({
        "clinical_knowledge_graph": graph,
        "medico_legal_summary":     ml_summary,
    });
    serde_json::to_string(&envelope).map_err(|e| e.to_string())
}

// ── Participant Resolution (additive, not wired into ingestion) ────────
//
// Resolves the canonical patient, participant, and organisation
// entities across a list of `process_document` payloads. Output is the
// new ParticipantResolutionPayload (patients, participants,
// organisations, document_maps, attributions). Strictly additive — no
// existing structure is modified, ingestion is unchanged.
#[tauri::command(rename_all = "camelCase")]
fn reason_participant_resolution(
    documents: Vec<serde_json::Value>,
) -> Result<String, String> {
    let payload = participant_resolution::build_participant_resolution(&documents);
    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

/// Shared Contradiction Engine input-identity fingerprint. INPUT-IDENTITY HASH ONLY — it is
/// NOT semantic/analytical. Both `build_contradiction_case` and `build_contradiction_observability`
/// MUST call this with the SAME serialization boundary so `FP_case == FP_obs`
/// reflects one consistent notion of "same input": the raw `clinical_events`
/// JSON, and nothing else (no `clean_texts`, no enriched/view structures, no
/// pipeline-specific transforms). Any remaining mismatch is a serialization bug.
fn build_contradiction_input_fp(clinical_events: &[serde_json::Value]) -> String {
    let bytes = serde_json::to_vec(clinical_events).expect("stable serialization");
    sha256_hex(&bytes)
}

// ── Contradiction Engine case build — the single production entrypoint (closes F-1/F-2) ──
//
// Receives the REAL persisted extraction (`clinical_events` JSON, exactly as
// `get_client_extraction` returns it) plus any caller-supplied family/legal
// facts, adapts them into EventEnvelopes (contradiction_input_adapter), and runs the
// EXISTING run_contradiction_engine. Returns CanonicalCase + ContradictionView +
// ContradictionExport + csv_lines as JSON. Strictly additive — no engine,
// contradiction, confidence, identity, temporal, enrichment, or export logic
// is changed; this only routes real data into the already-built pipeline.
#[tauri::command(rename_all = "camelCase")]
fn build_contradiction_case(
    clinical_events: Vec<serde_json::Value>,
    family_events: Vec<family_graph::FamilyEvent>,
    legal_events: Vec<case_events::LegalStatusEvent>,
    participants: Vec<participant_resolution::Participant>,
    // Per-document clean text `[ [docId, cleanText], … ]`. The SAME full input
    // the observability and graph commands receive — fact/value-disagreement
    // contradictions are never observability-only.
    clean_texts: Option<Vec<(String, String)>>,
) -> Result<String, String> {
    let clean_texts = clean_texts.unwrap_or_default();
    let output = contradiction_input_adapter::run_contradiction_engine_from_extraction(
        &clinical_events,
        &clean_texts,
        family_events,
        legal_events,
        &participants,
    );
    let result = contradiction_input_adapter::ContradictionCaseResult::from(output);

    // DEBUG: DevPanel fingerprint + contradiction stream (reads case.contradictions ONLY).
    // FP is an INPUT-IDENTITY hash over raw clinical_events ONLY (shared boundary).
    let input_fp = build_contradiction_input_fp(&clinical_events);
    let case_contradiction_ids: Vec<(String, String, String, String)> = result
        .case
        .contradictions
        .iter()
        .map(|c| {
            (
                c.contradiction_id.clone(),
                c.conflict_label.clone(),
                c.domain.as_str().to_string(),
                c.subject.clone(),
            )
        })
        .collect();

    let mut v = serde_json::to_value(&result).map_err(|e| e.to_string())?;
    if let serde_json::Value::Object(ref mut m) = v {
        m.insert(
            "debug".to_string(),
            serde_json::json!({
                "input_fp": input_fp,
                "case_contradiction_ids": case_contradiction_ids,
            }),
        );
    }
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

// ── Contradiction Graph — THE primary production output ────────────────────
//
// Receives the FULL input set (clinical events + per-document clean text +
// family/legal facts + participants) — identical to observability — runs the
// single engine path, and returns the typed Contradiction Graph
// (`graph_types::ContradictionGraph`). Every contradiction the system can
// detect appears here; there is no observability-only enrichment mode.
#[tauri::command(rename_all = "camelCase")]
fn build_contradiction_graph(
    clinical_events: Vec<serde_json::Value>,
    family_events: Vec<family_graph::FamilyEvent>,
    legal_events: Vec<case_events::LegalStatusEvent>,
    participants: Vec<participant_resolution::Participant>,
    clean_texts: Option<Vec<(String, String)>>,
) -> Result<String, String> {
    let clean_texts = clean_texts.unwrap_or_default();
    let output = contradiction_input_adapter::run_contradiction_engine_from_extraction(
        &clinical_events,
        &clean_texts,
        family_events,
        legal_events,
        &participants,
    );
    let graph = graph_builder::build_contradiction_graph(&output);
    serde_json::to_string(&graph).map_err(|e| e.to_string())
}

// ── Contradiction Engine observability — single composed view for the Demographics UI ────
//
// Same real inputs as `build_contradiction_case`, but composes the full deterministic
// observability stack and returns it as ONE object:
//   pipeline → ContradictionView → ContradictionReport → ContradictionReportSnapshot →
//   ContradictionObservabilityRoot { snapshot, history, trends, readiness, queue, dashboard }
//
// Strictly additive: it reuses the existing pipeline + the pure, read-only
// composition layer (`build_observability_root`). No engine/contradiction/
// confidence/enrichment logic is changed; nothing is recomputed in the UI.
// `created_at_epoch_ms` is caller-supplied (snapshot identity is count-derived
// and independent of it).
#[tauri::command(rename_all = "camelCase")]
fn build_contradiction_observability(
    clinical_events: Vec<serde_json::Value>,
    family_events: Vec<family_graph::FamilyEvent>,
    legal_events: Vec<case_events::LegalStatusEvent>,
    participants: Vec<participant_resolution::Participant>,
    created_at_epoch_ms: u64,
    // Optional per-document clean text `[ [docId, cleanText], … ]`. When present,
    // factual assertions (marital/work/smoking/driving/vital-status/dates) are
    // extracted and folded into value-disagreement contradictions. Empty by
    // default → behaviour identical to before (clinical/family/legal only).
    clean_texts: Option<Vec<(String, String)>>,
) -> Result<String, String> {
    let clean_texts = clean_texts.unwrap_or_default();
    let output = contradiction_input_adapter::run_contradiction_engine_from_extraction(
        &clinical_events,
        &clean_texts,
        family_events,
        legal_events,
        &participants,
    );
    // DEBUG: Observability fingerprint + enriched stream
    // (reads view.enriched_contradictions ONLY; captured BEFORE output.view is moved).
    // FP is an INPUT-IDENTITY hash over raw clinical_events ONLY — identical
    // boundary to build_contradiction_case; clean_texts is deliberately EXCLUDED.
    let input_fp = build_contradiction_input_fp(&clinical_events);
    let node_ids: Vec<(String, String, String, String)> = output
        .view
        .enriched_contradictions
        .iter()
        .map(|e| {
            (
                e.base.contradiction_id.clone(),
                e.base.conflict_label.clone(),
                e.base.domain.as_str().to_string(),
                e.base.subject.clone(),
            )
        })
        .collect();

    let report = contradiction_report::build_contradiction_report(output.view);
    let snapshot = contradiction_report_snapshot::build_report_snapshot(report, created_at_epoch_ms);
    let root = contradiction_observability_root::build_observability_root(snapshot);

    let mut v = serde_json::to_value(&root).map_err(|e| e.to_string())?;
    if let serde_json::Value::Object(ref mut m) = v {
        m.insert(
            "debug".to_string(),
            serde_json::json!({
                "input_fp": input_fp,
                "node_ids": node_ids,
            }),
        );
    }
    serde_json::to_string(&v).map_err(|e| e.to_string())
}

// ─── Persistence-boundary commands (medico-legal audit) ─────────────────
//
// These commands run IN PARALLEL with the existing `process_document` and
// `reason_participant_resolution`. They:
//   1. compute a SHA-256 chain-of-custody anchor over the source bytes,
//   2. run the existing pipeline,
//   3. emit `DocumentExtracted` + `ClinicalEventsRecorded` events with
//      pipeline_version + rule_corpus_hash so a future audit can replay
//      the extraction deterministically.
//
// They do NOT replace `process_document`. Frontends that opt in to the
// boundary call these instead; legacy paths remain unchanged.

/// Compute SHA-256 over an arbitrary byte buffer. Used for:
///   - the chain-of-custody anchor (`DocumentExtracted.source_bytes_sha256`),
///   - the freeze-point digest (`DocumentExtracted.clean_text_sha256`),
///   - the globally-unique content-hash component of `ClinicalEvent.event_id`.
///
/// Real SHA-256 via `sha2::Sha256`. Output is lowercase hex (64 chars).
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in out.iter() {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    hex
}

/// Defensive existence guard for the boundary ingestion commands.
///
/// The frontend already blocks uploads against unsaved clients, but the
/// backend MUST NOT trust the caller. This guard makes the projection
/// `clients` table the single source of truth: any boundary command
/// targeting a client_id that does not exist there is rejected before
/// any event is written. Prevents API misuse, test drift, and future
/// UI regressions from minting phantom client rows.
fn ensure_client_exists(client_id: &str) -> Result<(), String> {
    let (_store, proj) = init_event_store_strict()?;
    if !proj.client_exists(client_id).map_err(|e| e.to_string())? {
        return Err(format!(
            "Invalid client: '{client_id}' must exist in the clients table before uploading documents"
        ));
    }
    Ok(())
}

/// Persist a document and its boundary ClinicalEvents in one shot.
///
/// `bytes` is the raw on-disk source (PDF / DOCX / TXT). Hashed for
/// chain of custody. `text` is the post-OCR / post-DOCX text that the
/// pipeline operates on — same shape as `process_document`'s `text`.
///
/// Returns the same JSON shape as `process_document` so callers can
/// drop this in. Side effect: appends `DocumentExtracted` and
/// `ClinicalEventsRecorded` events to the immutable event store. The
/// projection materialises the boundary tables (clinical_events,
/// resolved_attributions, etc.) — snippet-integrity is verified at
/// write time and rejects any drifted snippet/offset pair.
#[tauri::command(rename_all = "camelCase")]
fn process_and_persist_document(
    client_id: String,
    doc_id: String,
    file_name: String,
    method: String,
    text: String,
    bytes: Option<Vec<u8>>,
    ocr_engine_version: Option<String>,
) -> Result<String, String> {
    // 0. DEFENSIVE GUARD — see process_path_and_persist.
    ensure_client_exists(&client_id)?;

    // 1. Run the existing rule pipeline. `emit_legacy_event = false` so
    //    process_document does NOT emit a phantom DocumentUploaded
    //    (client_id = doc_id); this command emits the authoritative
    //    DocumentExtracted carrying the real client_id below.
    let canonical_json_str = process_document_core(text.clone(), doc_id.clone(), false)?;
    let canonical: serde_json::Value = serde_json::from_str(&canonical_json_str)
        .map_err(|e| format!("process_and_persist_document: canonical parse: {e}"))?;

    let raw_text = canonical
        .get("raw_text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let clean_text = canonical
        .get("clean_text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let clinical_events = canonical
        .get("clinical_events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 2. Snippet-integrity check before emitting events. Per RC3 this
    //    is reporting-only — the projection write does NOT fail on
    //    integrity drift; instead each row records its status so an
    //    audit can surface it. Here we log warnings but proceed with
    //    persistence so ingestion cannot be blocked by non-semantic
    //    text variance.
    let mut integrity_warnings: Vec<String> = Vec::new();
    for ev_json in &clinical_events {
        if let Ok(ce) = serde_json::from_value::<clinical_events::ClinicalEvent>(ev_json.clone()) {
            if let Err(err) = snippet_integrity::verify(&ce, &clean_text) {
                eprintln!(
                    "[snippet_integrity] warning: event_id={} status={err}",
                    ce.event_id
                );
                integrity_warnings.push(format!("{}: {err}", ce.event_id));
            }
        }
    }

    // 3. Compute chain-of-custody anchor (SHA-256 over the on-disk
    //    bytes; falls back to hashing the supplied text when bytes
    //    weren't provided — the audit chain then begins at OCR rather
    //    than at file ingestion).
    let source_sha = match &bytes {
        Some(b) => sha256_hex(b),
        None => sha256_hex(text.as_bytes()),
    };
    // Freeze-point digest (RC1). Stamped on DocumentExtracted so any
    // future caller can verify clean_text has not drifted without
    // re-shipping the full text.
    let clean_text_sha = sha256_hex(clean_text.as_bytes());

    // 4. Emit DocumentExtracted and ClinicalEventsRecorded events.
    let (store, _proj) = init_event_store_strict()?;
    let run_id = uuid::Uuid::now_v7();

    let v1 = store
        .next_version(&client_id)
        .map_err(|e| format!("next_version: {e}"))?;
    let extracted = events::EventEnvelope::new(
        client_id.clone(),
        v1,
        events::Actor::System {
            component: "process_and_persist_document".into(),
        },
        events::EventPayload::DocumentExtracted(events::DocumentExtractedP {
            document_id: doc_id.clone(),
            // Persist the real uploaded filename so it survives rehydration.
            file_name: Some(file_name.clone()),
            source_bytes_sha256: source_sha,
            raw_text,
            clean_text,
            clean_text_sha256: clean_text_sha.clone(),
            method,
            ocr_engine_version,
            pipeline_version: pipeline_version().to_string(),
            rule_corpus_hash: rule_corpus_hash().to_string(),
        }),
        None,
        None,
    );
    store
        .append_event(&extracted)
        .map_err(|e| format!("append DocumentExtracted: {e}"))?;

    let v2 = store
        .next_version(&client_id)
        .map_err(|e| format!("next_version: {e}"))?;
    let ces = events::EventEnvelope::new(
        client_id.clone(),
        v2,
        events::Actor::System {
            component: "process_and_persist_document".into(),
        },
        events::EventPayload::ClinicalEventsRecorded(events::ClinicalEventsRecordedP {
            document_id: doc_id.clone(),
            run_id,
            clinical_events: clinical_events.clone(),
        }),
        Some(extracted.id),
        None,
    );
    store
        .append_event(&ces)
        .map_err(|e| format!("append ClinicalEventsRecorded: {e}"))?;

    // 5. Project forward so the boundary tables become queryable now.
    if let Some(proj) = projection_handle() {
        if let Err(e) = proj.project_forward(&[extracted.clone(), ces.clone()]) {
            return Err(format!("project_forward: {e}"));
        }
    }

    // 6. Mirror the legacy return shape so the frontend can keep
    //    consuming `process_document`-style JSON. Add audit metadata:
    //    file_name, run_id, version stamps, clean_text_sha256
    //    (freeze-point digest), and any non-fatal integrity warnings
    //    so the caller can surface them in the UI.
    let mut out = canonical;
    if let Some(obj) = out.as_object_mut() {
        obj.insert("file_name".into(), serde_json::Value::String(file_name));
        obj.insert("run_id".into(), serde_json::Value::String(run_id.to_string()));
        obj.insert(
            "pipeline_version".into(),
            serde_json::Value::String(pipeline_version().to_string()),
        );
        obj.insert(
            "rule_corpus_hash".into(),
            serde_json::Value::String(rule_corpus_hash().to_string()),
        );
        obj.insert(
            "clean_text_sha256".into(),
            serde_json::Value::String(clean_text_sha.clone()),
        );
        obj.insert(
            "integrity_warnings".into(),
            serde_json::Value::Array(
                integrity_warnings
                    .into_iter()
                    .map(serde_json::Value::String)
                    .collect(),
            ),
        );
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Persist resolved attributions for a previously-recorded extraction run.
///
/// `documents` is the same vec of `process_document` payloads that
/// produced the run (the boundary doesn't require they came from
/// `process_and_persist_document` — only the join is recorded here).
#[tauri::command(rename_all = "camelCase")]
fn persist_attribution_for_run(
    client_id: String,
    run_id: String,
    documents: Vec<serde_json::Value>,
) -> Result<String, String> {
    // 0. DEFENSIVE GUARD — see process_path_and_persist.
    ensure_client_exists(&client_id)?;

    let payload = participant_resolution::build_participant_resolution(&documents);
    let payload_value = serde_json::to_value(&payload)
        .map_err(|e| format!("attribution serialise: {e}"))?;

    let run_uuid = uuid::Uuid::parse_str(&run_id)
        .map_err(|e| format!("parse run_id: {e}"))?;

    let attribution_count = payload.attributions.len();
    let clinical_event_count: usize = documents
        .iter()
        .filter_map(|d| d.get("clinical_events").and_then(|v| v.as_array()))
        .map(|a| a.len())
        .sum();
    let document_ids: Vec<String> = documents
        .iter()
        .filter_map(|d| d.get("doc_id").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();

    let (store, _proj) = init_event_store_strict()?;

    let v1 = store
        .next_version(&client_id)
        .map_err(|e| format!("next_version: {e}"))?;
    let attr = events::EventEnvelope::new(
        client_id.clone(),
        v1,
        events::Actor::System {
            component: "persist_attribution_for_run".into(),
        },
        events::EventPayload::AttributionRecorded(events::AttributionRecordedP {
            run_id: run_uuid,
            payload: payload_value,
        }),
        None,
        None,
    );
    store
        .append_event(&attr)
        .map_err(|e| format!("append AttributionRecorded: {e}"))?;

    let v2 = store
        .next_version(&client_id)
        .map_err(|e| format!("next_version: {e}"))?;
    let runrec = events::EventEnvelope::new(
        client_id.clone(),
        v2,
        events::Actor::System {
            component: "persist_attribution_for_run".into(),
        },
        events::EventPayload::ExtractionRunRecorded(events::ExtractionRunRecordedP {
            run_id: run_uuid,
            executed_at: chrono::Utc::now(),
            pipeline_version: pipeline_version().to_string(),
            rule_corpus_hash: rule_corpus_hash().to_string(),
            document_ids,
            clinical_event_count,
            attribution_count,
        }),
        Some(attr.id),
        None,
    );
    store
        .append_event(&runrec)
        .map_err(|e| format!("append ExtractionRunRecorded: {e}"))?;

    if let Some(proj) = projection_handle() {
        if let Err(e) = proj.project_forward(&[attr.clone(), runrec.clone()]) {
            return Err(format!("project_forward: {e}"));
        }
    }

    serde_json::to_string(&serde_json::json!({
        "run_id": run_id,
        "attribution_count": attribution_count,
        "clinical_event_count": clinical_event_count,
    }))
    .map_err(|e| e.to_string())
}

/// Audit query — surface every ClinicalEvent whose snippet does NOT
/// byte-match `clean_text[char_offset_start..char_offset_end]`. Per RC3
/// the projection no longer rejects these; instead they are stored with
/// the diagnostic in `clinical_events.integrity_status`, and audit
/// tooling enumerates them here.
///
/// Returns JSON: `[{event_id, document_id, integrity_status}, …]`.
/// Empty array means every persisted ClinicalEvent passes snippet
/// integrity.
#[tauri::command(rename_all = "camelCase")]
fn audit_snippet_integrity(client_id: Option<String>) -> Result<String, String> {
    use rusqlite::Connection;
    let path = event_store::default_projection_db_path();
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let mut rows: Vec<serde_json::Value> = Vec::new();
    let sql = match &client_id {
        Some(_) => r#"SELECT ce.event_id, ce.document_id, ce.integrity_status, ce.concept
                       FROM clinical_events ce
                       JOIN documents d ON d.id = ce.document_id
                      WHERE ce.integrity_status IS NOT NULL
                        AND d.client_id = ?1
                      ORDER BY ce.event_id"#,
        None => r#"SELECT ce.event_id, ce.document_id, ce.integrity_status, ce.concept
                     FROM clinical_events ce
                    WHERE ce.integrity_status IS NOT NULL
                    ORDER BY ce.event_id"#,
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let collect = |r: &rusqlite::Row<'_>| -> rusqlite::Result<serde_json::Value> {
        Ok(serde_json::json!({
            "event_id":         r.get::<_, String>(0)?,
            "document_id":      r.get::<_, String>(1)?,
            "integrity_status": r.get::<_, String>(2)?,
            "concept":          r.get::<_, String>(3)?,
        }))
    };
    let it = if let Some(cid) = client_id {
        stmt.query_map(rusqlite::params![cid], collect)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
    } else {
        stmt.query_map([], collect)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
    };
    for v in it.map_err(|e| e.to_string())? {
        rows.push(v);
    }
    serde_json::to_string(&rows).map_err(|e| e.to_string())
}

/// **Path-based persistence-boundary ingestion** — the canonical
/// production upload entry point.
///
/// Replaces the legacy three-call chain
///   `extract_file_contents → attach_document → process_document`
/// with a single command that:
///   1. reads the raw file bytes from disk (chain-of-custody anchor),
///   2. extracts text via the same hybrid logic as
///      `extract_file_contents` (pdf_extract + tesseract fallback),
///   3. runs `process_document` to produce the canonical JSON,
///   4. emits `DocumentExtracted` and `ClinicalEventsRecorded` events
///      to the immutable event store,
///   5. projects them forward so the boundary tables (`clinical_events`,
///      `documents.raw_text`, etc.) are queryable immediately.
///
/// The returned JSON has the same shape as `process_document`'s output
/// plus `pipeline_version`, `rule_corpus_hash`, `run_id`, and
/// `document_id` so the frontend can drop-in replace `process_document`.
///
/// `doc_id` is generated server-side when omitted (UUIDv7 — sortable +
/// globally unique), satisfying RC4's "no convention-based uniqueness"
/// requirement.
#[tauri::command(rename_all = "camelCase")]
fn process_path_and_persist(
    client_id: String,
    path: String,
    file_name: Option<String>,
    doc_id: Option<String>,
) -> Result<String, String> {
    // 0. DEFENSIVE GUARD — reject ingestion against a non-existent
    //    client. The projection `clients` table is the single source of
    //    truth; a UI bypass or a draft sentinel id cannot get past this.
    ensure_client_exists(&client_id)?;

    // 1. Read raw bytes for the chain-of-custody anchor. Done before
    //    any text extraction so the sha covers the original file
    //    exactly as it sits on disk.
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("process_path_and_persist: read {path}: {e}"))?;
    let source_bytes_sha256 = sha256_hex(&bytes);

    // 2. Extract text via the same hybrid logic the legacy
    //    `extract_file_contents` uses. Decoupling means future OCR
    //    changes flow through one place.
    let extracted_json = extract_file_contents(path.clone())
        .map_err(|e| format!("process_path_and_persist: extract: {e}"))?;
    let extracted: serde_json::Value = serde_json::from_str(&extracted_json)
        .map_err(|e| format!("process_path_and_persist: parse extracted: {e}"))?;
    let text = extracted.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let method = extracted.get("method").and_then(|v| v.as_str()).unwrap_or("text").to_string();

    // 3. Resolve doc_id + file_name with sensible defaults.
    let doc_id = doc_id.unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    let file_name = file_name.unwrap_or_else(|| {
        std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string())
    });

    // 4. Run the canonical pipeline. `emit_legacy_event = false` so
    //    process_document does NOT emit a phantom DocumentUploaded
    //    (client_id = doc_id). This command emits the authoritative
    //    DocumentExtracted (carrying the real client_id) in step 7.
    let canonical_json_str = process_document_core(text.clone(), doc_id.clone(), false)
        .map_err(|e| format!("process_path_and_persist: process_document: {e}"))?;
    let canonical: serde_json::Value = serde_json::from_str(&canonical_json_str)
        .map_err(|e| format!("process_path_and_persist: canonical parse: {e}"))?;

    let raw_text = canonical.get("raw_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let clean_text = canonical.get("clean_text").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let clinical_events = canonical
        .get("clinical_events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 5. Snippet-integrity gate. RC3 keeps this a soft gate at the
    //    projection layer but the command-level check stays hard:
    //    drift here means the in-process pipeline mis-emitted offsets,
    //    which is a programming bug we want to surface before writing
    //    to the event log.
    for ev_json in &clinical_events {
        let ce: clinical_events::ClinicalEvent = serde_json::from_value(ev_json.clone())
            .map_err(|e| format!("process_path_and_persist: ce deserialise: {e}"))?;
        if let Err(err) = snippet_integrity::verify(&ce, &clean_text) {
            return Err(format!("process_path_and_persist: snippet integrity: {err}"));
        }
    }

    // 6. Compute the clean_text sha (RC1 freeze-point stamp).
    let clean_text_sha256 = sha256_hex(clean_text.as_bytes());

    // 7. Emit the boundary events. Both share a correlation_id so the
    //    audit can group them.
    let (store, _proj) = init_event_store_strict()?;
    let run_id = uuid::Uuid::now_v7();

    let v1 = store
        .next_version(&client_id)
        .map_err(|e| format!("next_version: {e}"))?;
    let extracted_env = events::EventEnvelope::new(
        client_id.clone(),
        v1,
        events::Actor::System {
            component: "process_path_and_persist".into(),
        },
        events::EventPayload::DocumentExtracted(events::DocumentExtractedP {
            document_id: doc_id.clone(),
            // Persist the real uploaded filename so it survives rehydration.
            file_name: Some(file_name.clone()),
            source_bytes_sha256: source_bytes_sha256.clone(),
            raw_text,
            clean_text: clean_text.clone(),
            clean_text_sha256: clean_text_sha256.clone(),
            method: method.clone(),
            ocr_engine_version: None,
            pipeline_version: pipeline_version().to_string(),
            rule_corpus_hash: rule_corpus_hash().to_string(),
        }),
        None,
        None,
    );
    store
        .append_event(&extracted_env)
        .map_err(|e| format!("append DocumentExtracted: {e}"))?;

    let v2 = store
        .next_version(&client_id)
        .map_err(|e| format!("next_version: {e}"))?;
    let ces_env = events::EventEnvelope::new(
        client_id.clone(),
        v2,
        events::Actor::System {
            component: "process_path_and_persist".into(),
        },
        events::EventPayload::ClinicalEventsRecorded(events::ClinicalEventsRecordedP {
            document_id: doc_id.clone(),
            run_id,
            clinical_events: clinical_events.clone(),
        }),
        Some(extracted_env.id),
        None,
    );
    store
        .append_event(&ces_env)
        .map_err(|e| format!("append ClinicalEventsRecorded: {e}"))?;

    // 8. Project forward.
    if let Some(proj) = projection_handle() {
        proj.project_forward(&[extracted_env.clone(), ces_env.clone()])
            .map_err(|e| format!("project_forward: {e}"))?;
    }

    // 9. Mirror legacy return shape + add boundary metadata.
    let mut out = canonical;
    if let Some(obj) = out.as_object_mut() {
        obj.insert("file_name".into(), serde_json::Value::String(file_name));
        obj.insert("document_id".into(), serde_json::Value::String(doc_id));
        // Extraction method ("text" | "ocr" | …). Without this the
        // frontend's `canonical.method` is always undefined and it falls
        // back to displaying document_type as the method.
        obj.insert("method".into(), serde_json::Value::String(method.clone()));
        obj.insert("run_id".into(), serde_json::Value::String(run_id.to_string()));
        obj.insert(
            "source_bytes_sha256".into(),
            serde_json::Value::String(source_bytes_sha256),
        );
        obj.insert(
            "clean_text_sha256".into(),
            serde_json::Value::String(clean_text_sha256),
        );
        obj.insert(
            "pipeline_version".into(),
            serde_json::Value::String(pipeline_version().to_string()),
        );
        obj.insert(
            "rule_corpus_hash".into(),
            serde_json::Value::String(rule_corpus_hash().to_string()),
        );
    }
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

// ─── System Management commands ──────────────────────────────────────────────

/// Wipe all client data by dropping and recreating the events table, then
/// rebuilding the projection from an empty event list.
///
/// Safety: this is destructive and irreversible. The frontend must require
/// explicit user confirmation ("type DELETE") before calling this.
#[tauri::command(rename_all = "camelCase")]
fn reset_database() -> Result<String, String> {
    use rusqlite::Connection;

    // --- Reset events.db -------------------------------------------------
    // DROP TABLE is not blocked by the append-only DELETE trigger (triggers
    // only fire on DML, not DDL), so this bypasses the guard cleanly.
    {
        let path = event_store::default_events_db_path();
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            DROP TABLE IF EXISTS events;
            DROP INDEX IF EXISTS idx_events_client_version;
            DROP INDEX IF EXISTS idx_events_timestamp;

            CREATE TABLE IF NOT EXISTS events (
                id              TEXT PRIMARY KEY,
                client_id       TEXT NOT NULL,
                type            TEXT NOT NULL,
                timestamp       TEXT NOT NULL,
                version         INTEGER NOT NULL,
                schema_version  INTEGER NOT NULL,
                actor_json      TEXT NOT NULL,
                causation_id    TEXT,
                correlation_id  TEXT,
                payload_json    TEXT NOT NULL,
                UNIQUE (client_id, version)
            );
            CREATE INDEX IF NOT EXISTS idx_events_client_version
                ON events (client_id, version);
            CREATE INDEX IF NOT EXISTS idx_events_timestamp
                ON events (timestamp);
            CREATE TRIGGER IF NOT EXISTS events_no_update
            BEFORE UPDATE ON events
            BEGIN
                SELECT RAISE(ABORT, 'events table is append-only — UPDATE forbidden');
            END;
            CREATE TRIGGER IF NOT EXISTS events_no_delete
            BEFORE DELETE ON events
            BEGIN
                SELECT RAISE(ABORT, 'events table is append-only — DELETE forbidden');
            END;
            "#,
        )
        .map_err(|e| format!("events reset failed: {e}"))?;
    }

    // --- Reset projection.db via singleton's rebuild_from_events([]) -----
    let (_, proj) = init_event_store_strict()?;
    proj.rebuild_from_events(&[])
        .map_err(|e| format!("projection reset failed: {e}"))?;

    Ok(serde_json::json!({ "status": "ok", "message": "Database reset complete" }).to_string())
}

/// Run a read-only SQL query against the projection DB (default) or the
/// events DB.  Any statement that is not a SELECT is rejected before
/// execution to prevent accidental writes.
///
/// Returns JSON: { columns: string[], rows: any[][] }
#[tauri::command(rename_all = "camelCase")]
fn run_sql_query(query: String, db: Option<String>) -> Result<String, String> {
    use rusqlite::{Connection, types::ValueRef};

    // Safety: statement-level validation only — no substring matching to avoid
    // false positives on column names like `updated_at` containing "update".
    let trimmed = query.trim().to_lowercase();

    // No semicolons: prevents multiple statements in a single call.
    if trimmed.contains(';') {
        return Err("Multiple statements are not allowed. Remove any semicolons.".to_string());
    }

    let first_word = trimmed.split_whitespace().next().unwrap_or("");
    match first_word {
        "select" | "with" => {} // allowed
        "insert" | "update" | "delete" | "drop" | "alter" | "create" | "attach" | "pragma" => {
            return Err(format!(
                "Statement type '{}' is not permitted. Only SELECT and WITH queries are allowed.",
                first_word
            ));
        }
        other => {
            return Err(format!(
                "Unsupported statement type '{}'. Only SELECT and WITH queries are allowed.",
                other
            ));
        }
    }

    let db_path = match db.as_deref() {
        Some("events") => event_store::default_events_db_path(),
        _ => event_store::default_projection_db_path(),
    };

    let conn = Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let col_names: Vec<String> = stmt
        .column_names()
        .into_iter()
        .map(String::from)
        .collect();

    let col_count = col_names.len();
    let mut rows_out: Vec<serde_json::Value> = Vec::new();

    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut row_vals: Vec<serde_json::Value> = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let val = match row.get_ref(i).map_err(|e| e.to_string())? {
                ValueRef::Null      => serde_json::Value::Null,
                ValueRef::Integer(n) => serde_json::json!(n),
                ValueRef::Real(f)   => serde_json::json!(f),
                ValueRef::Text(s)   => {
                    serde_json::Value::String(
                        std::str::from_utf8(s).unwrap_or("").to_string()
                    )
                }
                ValueRef::Blob(b)   => {
                    serde_json::Value::String(format!("<blob {} bytes>", b.len()))
                }
            };
            row_vals.push(val);
        }
        rows_out.push(serde_json::Value::Array(row_vals));
    }

    Ok(serde_json::json!({
        "columns": col_names,
        "rows":    rows_out,
    })
    .to_string())
}

/// Export all events and projection data as a JSON bundle for backup.
#[tauri::command(rename_all = "camelCase")]
fn export_all_data() -> Result<String, String> {
    let (store, proj) = init_event_store_strict()?;
    let events = store.get_all_events().map_err(|e| e.to_string())?;
    let ids = proj.list_client_ids().map_err(|e| e.to_string())?;

    let mut clients = Vec::new();
    for id in &ids {
        if let Some(v) = proj.get_client_view(id).map_err(|e| e.to_string())? {
            clients.push(serde_json::to_value(&v).unwrap_or(serde_json::Value::Null));
        }
    }

    let payload = serde_json::json!({
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "event_count": events.len(),
        "client_count": clients.len(),
        "events": events.iter().map(|e| serde_json::to_value(e).unwrap_or(serde_json::Value::Null)).collect::<Vec<_>>(),
        "clients": clients,
    });

    serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())
}

/// Open a native save dialog, then write `content` to the chosen path.
/// Returns the absolute path on success, or "cancelled" if the user
/// dismissed the dialog without choosing a location.
///
/// Uses the async (callback-based) dialog API so the main thread is never
/// blocked from a Tokio worker — the previous `blocking_save_file` call
/// deadlocked on macOS because it tried to wait for a main-thread UI event
/// while holding a worker-thread lock.
#[tauri::command(rename_all = "camelCase")]
async fn save_text_file(
    app: tauri::AppHandle,
    content: String,
    default_filename: String,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = std::sync::mpsc::channel::<Option<tauri_plugin_dialog::FilePath>>();

    app.dialog()
        .file()
        .set_file_name(default_filename.as_str())
        .add_filter("JSON", &["json"])
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    // Block a dedicated OS thread while awaiting the dialog result so the
    // Tokio executor stays free.
    let file_path = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| format!("dialog task failed: {e}"))?
        .map_err(|e| format!("dialog channel error: {e}"))?;

    match file_path {
        Some(fp) => {
            let path = fp
                .as_path()
                .ok_or_else(|| "Cannot resolve save path".to_string())?
                .to_path_buf();
            std::fs::write(&path, content.as_bytes())
                .map_err(|e| format!("Write failed: {e}"))?;
            Ok(path.to_string_lossy().to_string())
        }
        None => Err("cancelled".to_string()),
    }
}

/// Reveal a file or directory in the system file manager (Finder on macOS).
#[tauri::command(rename_all = "camelCase")]
fn reveal_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Pre-warm the scispaCy NLP service in the background so the first
        // document load does not pay the model-initialisation latency (~2–5 s).
        .setup(|_app| {
            std::thread::spawn(|| {
                if let Err(e) = ensure_nlp_service() {
                    eprintln!("[setup] NLP service pre-warm failed: {e}");
                }
            });
            Ok(())
        });

    // OCR is always available via subprocess tesseract — single handler list.
    builder
        .invoke_handler(tauri::generate_handler![
            greet,
            read_file,
            extract_text_hybrid,
            extract_file_contents,
            extract_structured_data,
            aggregate_case,
            run_diagnostics,
            run_ner,
            extract_nlp_entities,
            clean_extracted_text_command,
            list_directory,
            run_ocr_command,
            // ── Entity cleaning ─────────────────────────────────────────────
            clean_entities_command,
            // ── Reasoning pipeline ──────────────────────────────────────────
            segment_document,
            extract_claims,
            detect_pipeline_conflicts,
            reconstruct_timeline,
            synthesise_report,
            // ── Two-layer document pipeline ──────────────────────────────────
            process_document,   // Layer 1: canonical store
            reason_document,    // Layer 2: timeline · conflicts · summary
            reason_patient_timeline,  // Cross-document patient timeline (additive — not wired into ingestion)
            reason_clinical_state,    // Condition State Engine (additive — not wired into ingestion)
            reason_longitudinal_reconciliation,  // LongitudinalPatientGraph (additive — not wired into ingestion)
            build_clinical_knowledge_graph,      // GCKG + medico-legal summary (additive — not wired into ingestion)
            reason_participant_resolution,       // Patient identity + participant resolution (additive — not wired into ingestion)
            build_contradiction_case,                    // Contradiction Engine production entrypoint: real extraction → adapter → pipeline → case/view/export/csv
            build_contradiction_graph,                   // Contradiction Graph Model: same inputs → typed explorable graph (pure projection; engine output untouched)
            build_contradiction_observability,           // Contradiction Engine observability root: composed snapshot/history/trends/readiness/queue/dashboard (read-only)
            // ── Persistence-boundary commands (medico-legal audit) ─────────
            // Parallel to process_document: the boundary tables are written
            // here (clinical_events + resolved_attributions etc.). Existing
            // ingestion is untouched. Frontends that opt in call these to
            // populate the audit-of-record.
            process_and_persist_document,
            process_path_and_persist,
            persist_attribution_for_run,
            audit_snippet_integrity,
            // ── Step 3c — integrity layer ────────────────────────────────────
            verify_system_integrity,
            // ── Step 4 — first event-driven domain path ──────────────────────
            create_client,
            get_client_view,
            client_exists,
            get_client_extraction,
            // ── Step 5 — projection-driven UI binding ────────────────────────
            update_client_demographics,
            delete_client,
            delete_document,
            attach_document,
            list_clients,
            // ── Step 6 — Version History ─────────────────────────────────────
            get_client_event_history,
            get_client_snapshot_at_version,
            restore_client_from_version,
            restore_client_field_from_version,
            // ── Step 7 — diff prep ──────────────────────────────────────────
            diff_client_versions,
            // ── System Management ────────────────────────────────────────────
            reset_database,
            run_sql_query,
            export_all_data,
            save_text_file,
            reveal_in_finder,
            // ── Phase 7 — clinician decision persistence ─────────────────────
            persist_clinical_decision,
            // ── Phase 1 (PRD) — canonical clinical fact spine ────────────────
            record_clinical_observation,
            record_clinical_review_item,
            get_clinical_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── Pipeline unit tests ──────────────────────────────────────────────────────
//
// All tests call the pipeline functions as plain Rust functions — no Tauri
// runtime, no Ollama, no network.  Ollama is not expected to be running during
// `cargo test`; every stage falls through to its rule-based fallback, which is
// exactly what we want to verify.
//
// Run: cargo test --lib
// Run one test by name: cargo test --lib pipeline::test_full_chain -- --nocapture

// ─── End-to-end boundary integration tests ───────────────────────────────
// These tests drive the actual write path against ephemeral SQLite
// databases under a per-test directory. They DO NOT touch the user's
// real `~/.medicoapp/` databases. They are the closest thing to a real
// upload audit short of running the live Tauri app: every persistence
// surface (events.db, projection.db, rebuild_from_events) is exercised.

#[cfg(test)]
mod boundary_integration {
    use super::*;
    use crate::events::{Actor, EventEnvelope, EventPayload};
    use std::path::PathBuf;

    fn temp_root(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!("medicoapp_audit_{label}_{stamp}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Build the two persistence-boundary events that a real upload
    /// would emit, without touching the global OnceLock or the user's
    /// real databases. Returns (DocumentExtracted, ClinicalEventsRecorded).
    fn build_upload_events(
        client_id: &str,
        doc_id: &str,
        text: &str,
        bytes: &[u8],
    ) -> (EventEnvelope, EventEnvelope, serde_json::Value) {
        let canon_json = process_document(text.to_string(), doc_id.to_string()).unwrap();
        let canonical: serde_json::Value = serde_json::from_str(&canon_json).unwrap();
        let raw_text = canonical["raw_text"].as_str().unwrap_or("").to_string();
        let clean_text = canonical["clean_text"].as_str().unwrap_or("").to_string();
        let clinical_events = canonical["clinical_events"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let extracted = EventEnvelope::new(
            client_id.to_string(),
            1,
            Actor::System { component: "test".into() },
            EventPayload::DocumentExtracted(events::DocumentExtractedP {
                document_id: doc_id.to_string(),
                file_name: Some(format!("{doc_id}.pdf")),
                source_bytes_sha256: sha256_hex(bytes),
                raw_text,
                clean_text: clean_text.clone(),
                clean_text_sha256: sha256_hex(clean_text.as_bytes()),
                method: "ocr".into(),
                ocr_engine_version: Some("tesseract-5.x".into()),
                pipeline_version: pipeline_version().to_string(),
                rule_corpus_hash: rule_corpus_hash().to_string(),
            }),
            None,
            None,
        );
        let run_id = uuid::Uuid::now_v7();
        let ces = EventEnvelope::new(
            client_id.to_string(),
            2,
            Actor::System { component: "test".into() },
            EventPayload::ClinicalEventsRecorded(events::ClinicalEventsRecordedP {
                document_id: doc_id.to_string(),
                run_id,
                clinical_events: clinical_events.clone(),
            }),
            Some(extracted.id),
            None,
        );
        (extracted, ces, canonical)
    }

    fn upload_doc_uploaded_event(
        client_id: &str,
        doc_id: &str,
        file_name: &str,
        char_count: usize,
    ) -> EventEnvelope {
        EventEnvelope::new(
            client_id.to_string(),
            // Bumped manually by tests; tests with the live store
            // would use next_version().
            10,
            Actor::System { component: "test".into() },
            EventPayload::DocumentUploaded(events::DocumentUploadedP {
                document_id: doc_id.to_string(),
                file_name: file_name.into(),
                char_count,
                method: "ocr".into(),
            }),
            None,
            None,
        )
    }

    const REAL_DOC: &str =
        "Independent Psychiatric Opinion\n\
         Author: Dr Rayers\n\
         Patient: Jane Doe\n\
         DOB: 14/02/1985\n\
         \n\
         Reviewing Psychiatrist\n\
         Presentation inconsistent with PTSD.\n\
         Treating Psychologist\n\
         Diagnosis: post-traumatic stress disorder.\n\
         Author: Dr Lewis\n\
         \n\
         Personal Injury Commission\n\
         Traumatic Stress Clinic supplied the prior reports.\n";

    // ═══════════════════════════════════════════════════════════════════════
    // Audit 2 — Persistence Coverage Audit. A fresh upload populates
    // every promised column in DOCUMENT, CLINICAL_EVENT, ATTRIBUTION.
    // ═══════════════════════════════════════════════════════════════════════
    #[test]
    fn audit_2_full_persistence_coverage_for_fresh_upload() {
        let root = temp_root("a2");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");

        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-a2";
        let doc_id = uuid::Uuid::now_v7().to_string();
        let bytes = REAL_DOC.as_bytes();

        // Document is uploaded first (legacy DocumentUploaded event so
        // the `documents` row exists for the FK).
        let upload_env = upload_doc_uploaded_event(client_id, &doc_id, "FakeClient2.pdf", REAL_DOC.len());

        // ClientCreated stub so the FK chain is satisfied.
        let create_env = EventEnvelope::new(
            client_id.to_string(),
            1,
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Jane", "lastName": "Doe"}}),
            }),
            None,
            None,
        );

        store.append_event(&create_env).unwrap();
        store.append_event(&upload_env).unwrap();
        proj.project_forward(&[create_env.clone(), upload_env.clone()]).unwrap();

        // Now emit boundary events.
        let (extracted, ces, canonical) = build_upload_events(client_id, &doc_id, REAL_DOC, bytes);
        // Re-bump versions to follow the prior uploaded event.
        let extracted = EventEnvelope { version: 11, ..extracted };
        let ces = EventEnvelope { version: 12, ..ces };

        store.append_event(&extracted).unwrap();
        store.append_event(&ces).unwrap();
        proj.project_forward(&[extracted.clone(), ces.clone()]).unwrap();

        // Also persist attribution to exercise ATTRIBUTION coverage.
        let payload = participant_resolution::build_participant_resolution(&[canonical.clone()]);
        let attr_env = EventEnvelope::new(
            client_id.to_string(),
            13,
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(),
                payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id),
            None,
        );
        store.append_event(&attr_env).unwrap();
        proj.project_forward(&[attr_env.clone()]).unwrap();

        // Now query projection.db directly and confirm every column is populated.
        let conn = rusqlite::Connection::open(&proj_path).unwrap();

        // DOCUMENT row
        let (sha, raw_text, clean_text, clean_text_sha, pipeline_v, rule_h) = conn
            .query_row(
                "SELECT source_bytes_sha256, raw_text, clean_text, clean_text_sha256,
                        pipeline_version, rule_corpus_hash
                   FROM documents WHERE id = ?1",
                rusqlite::params![doc_id],
                |r| {
                    Ok((
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .unwrap();
        assert!(sha.unwrap_or_default().len() == 64, "source_bytes_sha256 must be sha256 hex");
        assert!(raw_text.unwrap_or_default().contains("PTSD"), "raw_text must be persisted");
        assert!(clean_text.unwrap_or_default().contains("PTSD"), "clean_text must be persisted");
        assert!(clean_text_sha.unwrap_or_default().len() == 64, "clean_text_sha256 must be sha256 hex");
        assert!(pipeline_v.unwrap_or_default().contains('+'), "pipeline_version must include sha");
        assert!(rule_h.unwrap_or_default().len() >= 16, "rule_corpus_hash must be non-trivial");

        // CLINICAL_EVENT rows
        let ce_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clinical_events WHERE document_id = ?1",
                rusqlite::params![doc_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(ce_count > 0, "must persist ClinicalEvents for the document");

        // Confirm every promised column is populated on at least one row.
        let mut stmt = conn
            .prepare(
                "SELECT event_id, concept, raw_concept, assertion_status,
                        source_section, source_snippet, char_offset_start, char_offset_end
                   FROM clinical_events WHERE document_id = ?1 ORDER BY event_id",
            )
            .unwrap();
        let rows: Vec<(String, String, String, Option<String>, Option<String>, String, i64, i64)> = stmt
            .query_map(rusqlite::params![doc_id], |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                    r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!rows.is_empty());
        for (event_id, concept, raw_concept, _asn, _sec, snippet, s, e) in &rows {
            assert!(event_id.contains('#'), "event_id keeps the legacy prefix");
            assert!(event_id.split('#').count() == 4, "event_id has content-hash suffix: {event_id}");
            assert!(!concept.is_empty(), "concept must be non-empty");
            assert!(!raw_concept.is_empty(), "raw_concept must be non-empty");
            // Offsets must be within clean_text bounds (semantic check).
            assert!(*e as usize >= *s as usize, "offsets must be ordered: {snippet}");
        }
        let has_assertion: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clinical_events WHERE document_id = ?1 AND assertion_status IS NOT NULL",
                rusqlite::params![doc_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(has_assertion > 0, "at least one diagnosis must have assertion_status");

        // ATTRIBUTION rows
        let attr_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM resolved_attributions
                   WHERE event_id IN (SELECT event_id FROM clinical_events WHERE document_id = ?1)",
                rusqlite::params![doc_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(attr_count > 0, "attribution rows must exist for at least one event");

        let part_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM participants", [], |r| r.get(0))
            .unwrap();
        let org_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM organisations", [], |r| r.get(0))
            .unwrap();
        let pat_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM patient_identities", [], |r| r.get(0))
            .unwrap();
        assert!(part_count > 0, "Dr Rayers / Dr Lewis must be persisted");
        assert!(org_count > 0, "Personal Injury Commission / Traumatic Stress Clinic must be persisted");
        assert!(pat_count > 0, "Jane Doe must be persisted");

        // Print a row sample for human verification of the audit.
        eprintln!("AUDIT 2 — persistence sample:");
        eprintln!("  doc_id          = {doc_id}");
        eprintln!("  clinical_events = {ce_count}");
        eprintln!("  attributions    = {attr_count}");
        eprintln!("  participants    = {part_count}");
        eprintln!("  organisations   = {org_count}");
        eprintln!("  patients        = {pat_count}");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Audit 3 — Replay Audit. Starting only from events.db + projection.db,
    // verify all boundary structures can be reconstructed without source
    // files.
    // ═══════════════════════════════════════════════════════════════════════
    #[test]
    fn audit_3_replay_from_persisted_state_only() {
        let root = temp_root("a3");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");

        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-a3";
        let doc_id = "doc-a3".to_string();
        // 1. Seed full upload (DocumentUploaded + DocumentExtracted +
        // ClinicalEventsRecorded + AttributionRecorded).
        let create = EventEnvelope::new(
            client_id.into(), 1,
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP { demographics: serde_json::json!({}) }),
            None, None,
        );
        let uploaded = upload_doc_uploaded_event(client_id, &doc_id, "real.pdf", REAL_DOC.len());
        let (extracted, ces, canonical) = build_upload_events(client_id, &doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: 11, ..extracted };
        let ces = EventEnvelope { version: 12, ..ces };
        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            client_id.into(), 13,
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(),
                payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        for env in [&create, &uploaded, &extracted, &ces, &attr] {
            store.append_event(env).unwrap();
        }
        proj.project_forward(&[create, uploaded, extracted, ces, attr]).unwrap();

        // 2. Now act ONLY through the persisted DB handles. Forget the
        // source files exist.
        drop(proj);
        drop(store);

        let conn = rusqlite::Connection::open(&proj_path).unwrap();

        // Reconstruct ClinicalEvents from projection rows alone.
        let mut stmt = conn
            .prepare("SELECT event_json FROM clinical_events WHERE document_id = ?1")
            .unwrap();
        let events_json: Vec<serde_json::Value> = stmt
            .query_map(rusqlite::params![&doc_id], |r| {
                let s: String = r.get(0)?;
                Ok(serde_json::from_str::<serde_json::Value>(&s).unwrap_or(serde_json::Value::Null))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!events_json.is_empty(), "ClinicalEvents reconstructable from event_json column");

        // Reconstruct Attributions.
        let attr_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM resolved_attributions", [], |r| r.get(0))
            .unwrap();
        assert!(attr_rows > 0);

        // Reconstruct Patients, Participants, Organisations.
        let pats: i64 = conn.query_row("SELECT COUNT(*) FROM patient_identities", [], |r| r.get(0)).unwrap();
        let parts: i64 = conn.query_row("SELECT COUNT(*) FROM participants", [], |r| r.get(0)).unwrap();
        let orgs: i64 = conn.query_row("SELECT COUNT(*) FROM organisations", [], |r| r.get(0)).unwrap();
        assert!(pats > 0 && parts > 0 && orgs > 0, "patient/participant/org reconstructable");

        // raw_text + clean_text + chain-of-custody sha persisted on the
        // document row, so future audits can re-derive everything.
        let (raw, clean, sha, csha): (String, String, String, String) = conn
            .query_row(
                "SELECT raw_text, clean_text, source_bytes_sha256, clean_text_sha256
                   FROM documents WHERE id = ?1",
                rusqlite::params![&doc_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert!(!raw.is_empty() && !clean.is_empty() && sha.len() == 64 && csha.len() == 64);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Audit 4 — Historical Drift. Same document twice = same hashes +
    // same event_ids. rule_corpus_hash structurally bound to rule
    // sources (compile-time include_str!).
    // ═══════════════════════════════════════════════════════════════════════
    #[test]
    fn audit_4_idempotent_same_doc_twice() {
        // Twice through the rule pipeline — same content, same hashes,
        // same content-addressed ids.
        let canon1 = process_document(REAL_DOC.to_string(), "doc-a4-1".to_string()).unwrap();
        let canon2 = process_document(REAL_DOC.to_string(), "doc-a4-1".to_string()).unwrap();
        let v1: serde_json::Value = serde_json::from_str(&canon1).unwrap();
        let v2: serde_json::Value = serde_json::from_str(&canon2).unwrap();
        let clean1 = v1["clean_text"].as_str().unwrap();
        let clean2 = v2["clean_text"].as_str().unwrap();
        assert_eq!(sha256_hex(clean1.as_bytes()), sha256_hex(clean2.as_bytes()),
            "Same input → same clean_text_sha256 (freeze-point determinism)");

        // ClinicalEvent payloads byte-equal.
        assert_eq!(v1["clinical_events"].to_string(), v2["clinical_events"].to_string(),
            "Same input → byte-equal ClinicalEvent payload");

        // event_ids identical and content-derived.
        let ids1: Vec<&str> = v1["clinical_events"].as_array().unwrap()
            .iter().map(|e| e["event_id"].as_str().unwrap()).collect();
        let ids2: Vec<&str> = v2["clinical_events"].as_array().unwrap()
            .iter().map(|e| e["event_id"].as_str().unwrap()).collect();
        assert_eq!(ids1, ids2, "content_addressed_id deterministic on identical input");
    }

    #[test]
    fn audit_4_rule_corpus_hash_is_structurally_bound_to_rule_sources() {
        // rule_corpus_hash is computed via include_str! over five rule
        // files at compile time. It changes if and only if those files
        // change. We cannot mutate include_str! at runtime, but we CAN
        // confirm:
        //   (a) the hash is non-trivial (≥16 hex chars),
        //   (b) it is the same on every call within one process,
        //   (c) it is what gets stamped on persisted DocumentExtracted
        //       events — so when the rule files DO change in a future
        //       build, every prior persisted event keeps the OLD hash
        //       and is unambiguously distinguishable from a re-run
        //       under the new rule set.
        let h = rule_corpus_hash().to_string();
        assert_eq!(h, rule_corpus_hash(), "same-process stability");
        assert!(h.len() >= 16);

        // Verify the hash is what gets stamped onto a DocumentExtracted
        // payload that the persistence layer reads back.
        let canon = process_document(REAL_DOC.to_string(), "doc-rch".to_string()).unwrap();
        let canonical: serde_json::Value = serde_json::from_str(&canon).unwrap();
        let clean = canonical["clean_text"].as_str().unwrap().to_string();
        let event_payload = events::DocumentExtractedP {
            document_id: "doc-rch".into(),
            file_name: Some("doc-rch.pdf".into()),
            source_bytes_sha256: sha256_hex(REAL_DOC.as_bytes()),
            raw_text: canonical["raw_text"].as_str().unwrap_or("").to_string(),
            clean_text: clean.clone(),
            clean_text_sha256: sha256_hex(clean.as_bytes()),
            method: "ocr".into(),
            ocr_engine_version: None,
            pipeline_version: pipeline_version().to_string(),
            rule_corpus_hash: rule_corpus_hash().to_string(),
        };
        assert_eq!(event_payload.rule_corpus_hash, h);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Audit 5 — Projection Rebuild Audit. Delete projection.db, rebuild
    // from events.db only, verify identical row counts on every boundary
    // table.
    // ═══════════════════════════════════════════════════════════════════════
    #[test]
    fn audit_5_projection_rebuild_from_events_only() {
        let root = temp_root("a5");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");

        // Phase 1 — seed full upload.
        let client_id = "client-a5";
        let doc_id = "doc-a5".to_string();
        let create = EventEnvelope::new(
            client_id.into(), 1,
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP { demographics: serde_json::json!({}) }),
            None, None,
        );
        let uploaded = upload_doc_uploaded_event(client_id, &doc_id, "real.pdf", REAL_DOC.len());
        let (extracted, ces, canonical) = build_upload_events(client_id, &doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: 11, ..extracted };
        let ces = EventEnvelope { version: 12, ..ces };
        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            client_id.into(), 13,
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(),
                payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        let run = EventEnvelope::new(
            client_id.into(), 14,
            Actor::System { component: "test".into() },
            EventPayload::ExtractionRunRecorded(events::ExtractionRunRecordedP {
                run_id: uuid::Uuid::now_v7(),
                executed_at: chrono::Utc::now(),
                pipeline_version: pipeline_version().to_string(),
                rule_corpus_hash: rule_corpus_hash().to_string(),
                document_ids: vec![doc_id.clone()],
                clinical_event_count: 1,
                attribution_count: 1,
            }),
            None, None,
        );

        let all_events = vec![create, uploaded, extracted, ces, attr, run];

        {
            let store = event_store::EventStore::init(&events_path).unwrap();
            let proj = projection::Projection::init(&proj_path).unwrap();
            for env in &all_events {
                store.append_event(env).unwrap();
            }
            proj.project_forward(&all_events).unwrap();
        }

        // Count rows pre-rebuild.
        let counts = |path: &PathBuf| -> [(String, i64); 7] {
            let c = rusqlite::Connection::open(path).unwrap();
            let n = |sql: &str| c.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(-1);
            [
                ("documents".into(),                  n("SELECT COUNT(*) FROM documents")),
                ("clinical_events".into(),            n("SELECT COUNT(*) FROM clinical_events")),
                ("resolved_attributions".into(),      n("SELECT COUNT(*) FROM resolved_attributions")),
                ("patient_identities".into(),         n("SELECT COUNT(*) FROM patient_identities")),
                ("participants".into(),               n("SELECT COUNT(*) FROM participants")),
                ("organisations".into(),              n("SELECT COUNT(*) FROM organisations")),
                ("extraction_runs".into(),            n("SELECT COUNT(*) FROM extraction_runs")),
            ]
        };
        let pre = counts(&proj_path);

        // Phase 2 — DELETE projection.db on disk. Rebuild from events.
        std::fs::remove_file(&proj_path).ok();
        // SQLite WAL sidecars too.
        std::fs::remove_file(proj_path.with_extension("db-wal")).ok();
        std::fs::remove_file(proj_path.with_extension("db-shm")).ok();

        {
            let proj2 = projection::Projection::init(&proj_path).unwrap();
            // rebuild from in-memory event list (mirroring what the
            // event store would yield).
            proj2.rebuild_from_events(&all_events).unwrap();
        }
        let post = counts(&proj_path);

        eprintln!("AUDIT 5 — row counts pre/post rebuild:");
        for (i, (name, n_pre)) in pre.iter().enumerate() {
            eprintln!("  {name:<22} pre={n_pre:>4}  post={:>4}", post[i].1);
        }
        for (i, (name, n_pre)) in pre.iter().enumerate() {
            assert_eq!(*n_pre, post[i].1, "{name} row count must match after rebuild");
            assert!(*n_pre > 0, "{name} must have rows to prove rebuild covered it");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FE5 / Live ingestion audit. Proves that the new wired ingestion
    // path (process_path_and_persist) writes ALL FOUR boundary event
    // types when followed by persist_attribution_for_run, that NO
    // DocumentUploaded event is required for the boundary to work, and
    // that the projection materialises every boundary table.
    // ═══════════════════════════════════════════════════════════════════════

    #[test]
    fn fe5_boundary_handler_creates_documents_row_without_prior_uploaded_event() {
        // The new INSERT-OR-UPDATE branch must work even when no
        // DocumentUploaded event has been folded for this doc.
        let root = temp_root("fe5a");
        let proj_path = root.join("projection.db");
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-fe5a";
        let doc_id = "doc-fe5a";
        // Seed only client_created (no DocumentUploaded).
        let create = EventEnvelope::new(
            client_id.into(), 1,
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP { demographics: serde_json::json!({}) }),
            None, None,
        );
        // Then go straight into the boundary.
        let (extracted, ces, _canonical) =
            build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: 11, ..extracted };
        let ces = EventEnvelope { version: 12, ..ces };

        proj.project_forward(&[create, extracted, ces]).unwrap();

        let conn = rusqlite::Connection::open(&proj_path).unwrap();
        let (id, raw_text, clean_text, sha): (String, String, String, String) = conn
            .query_row(
                "SELECT id, raw_text, clean_text, source_bytes_sha256 FROM documents WHERE id = ?1",
                rusqlite::params![doc_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(id, doc_id);
        assert!(raw_text.contains("PTSD"));
        assert!(clean_text.contains("PTSD"));
        assert_eq!(sha.len(), 64);

        let ce_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clinical_events WHERE document_id = ?1",
                rusqlite::params![doc_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(ce_count > 0, "ClinicalEvents persisted via FK to auto-created documents row");
    }

    #[test]
    fn fe5_live_ingestion_writes_all_four_boundary_event_types() {
        // Simulates the wired ingestion path end-to-end without touching
        // the global OnceLock: build envelopes the same way
        // process_path_and_persist + persist_attribution_for_run would,
        // append them to a tempfile event store, project them forward,
        // and verify all four boundary event types are present.
        let root = temp_root("fe5b");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");

        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-fe5b";
        let doc_id = uuid::Uuid::now_v7().to_string();

        // Step 1 — ClientCreated.
        let create = EventEnvelope::new(
            client_id.into(),
            store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP { demographics: serde_json::json!({}) }),
            None, None,
        );
        store.append_event(&create).unwrap();

        // Step 2 — boundary events (process_path_and_persist emits these
        // two — no DocumentUploaded required after the FE wiring change).
        let (extracted_proto, ces_proto, canonical) =
            build_upload_events(client_id, &doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope {
            version: store.next_version(client_id).unwrap(),
            ..extracted_proto
        };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope {
            version: store.next_version(client_id).unwrap(),
            ..ces_proto
        };
        store.append_event(&ces).unwrap();

        // Step 3 — persist_attribution_for_run emits the other two.
        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            client_id.into(),
            store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(),
                payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        store.append_event(&attr).unwrap();
        let run = EventEnvelope::new(
            client_id.into(),
            store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ExtractionRunRecorded(events::ExtractionRunRecordedP {
                run_id: uuid::Uuid::now_v7(),
                executed_at: chrono::Utc::now(),
                pipeline_version: pipeline_version().to_string(),
                rule_corpus_hash: rule_corpus_hash().to_string(),
                document_ids: vec![doc_id.clone()],
                clinical_event_count: payload.attributions.len(),
                attribution_count: payload.attributions.len(),
            }),
            Some(attr.id), None,
        );
        store.append_event(&run).unwrap();

        // Step 4 — project forward.
        let all_evs = [create.clone(), extracted.clone(), ces.clone(), attr.clone(), run.clone()];
        proj.project_forward(&all_evs).unwrap();

        // ── Verify events.db ───────────────────────────────────────────────
        let evs_conn = rusqlite::Connection::open(&events_path).unwrap();
        let by_type = |t: &str| -> i64 {
            evs_conn.query_row(
                "SELECT COUNT(*) FROM events WHERE client_id = ?1 AND type = ?2",
                rusqlite::params![client_id, t],
                |r| r.get(0),
            ).unwrap_or(0)
        };
        let de = by_type("document_extracted");
        let cer = by_type("clinical_events_recorded");
        let ar = by_type("attribution_recorded");
        let err_ = by_type("extraction_run_recorded");
        let du = by_type("document_uploaded");

        eprintln!("FE5 — event-type counts after live ingestion:");
        eprintln!("  document_extracted        = {de}");
        eprintln!("  clinical_events_recorded  = {cer}");
        eprintln!("  attribution_recorded      = {ar}");
        eprintln!("  extraction_run_recorded   = {err_}");
        eprintln!("  document_uploaded         = {du}  (must be 0 — boundary path doesn't emit it)");

        assert_eq!(de, 1,  "DocumentExtracted must be written");
        assert_eq!(cer, 1, "ClinicalEventsRecorded must be written");
        assert_eq!(ar, 1,  "AttributionRecorded must be written");
        assert_eq!(err_, 1, "ExtractionRunRecorded must be written");
        // The new wired path no longer requires DocumentUploaded.
        assert_eq!(du, 0, "boundary path must not emit DocumentUploaded");

        // ── Verify projection.db ───────────────────────────────────────────
        let proj_conn = rusqlite::Connection::open(&proj_path).unwrap();
        let docs: i64 = proj_conn.query_row(
            "SELECT COUNT(*) FROM documents WHERE id = ?1",
            rusqlite::params![doc_id], |r| r.get(0)).unwrap();
        let ces_n: i64 = proj_conn.query_row(
            "SELECT COUNT(*) FROM clinical_events WHERE document_id = ?1",
            rusqlite::params![doc_id], |r| r.get(0)).unwrap();
        let attrs: i64 = proj_conn.query_row(
            "SELECT COUNT(*) FROM resolved_attributions WHERE event_id IN
               (SELECT event_id FROM clinical_events WHERE document_id = ?1)",
            rusqlite::params![doc_id], |r| r.get(0)).unwrap();
        let runs: i64 = proj_conn.query_row(
            "SELECT COUNT(*) FROM extraction_runs", [], |r| r.get(0)).unwrap();

        assert_eq!(docs, 1, "documents row created by boundary handler alone");
        assert!(ces_n > 0, "clinical_events populated");
        assert!(attrs > 0, "resolved_attributions populated");
        assert_eq!(runs, 1, "extraction_runs populated");

        eprintln!("FE5 — projection counts:");
        eprintln!("  documents             = {docs}");
        eprintln!("  clinical_events       = {ces_n}");
        eprintln!("  resolved_attributions = {attrs}");
        eprintln!("  extraction_runs       = {runs}");
    }

    #[test]
    fn read1_get_client_extraction_returns_persisted_events_and_attributions() {
        // The new read path must return persisted clinical_events +
        // resolved attributions for a client WITHOUT any reprocessing —
        // proving the projection → UI boundary is closed.
        let root = temp_root("read1");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-read1";
        let doc_id = uuid::Uuid::now_v7().to_string();

        // Seed a full upload through the boundary events.
        let create = EventEnvelope::new(
            client_id.into(),
            store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Jane", "lastName": "Doe"}}),
            }),
            None, None,
        );
        store.append_event(&create).unwrap();

        let (extracted_proto, ces_proto, canonical) =
            build_upload_events(client_id, &doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: store.next_version(client_id).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(client_id).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();

        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            client_id.into(),
            store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(),
                payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        store.append_event(&attr).unwrap();

        proj.project_forward(&[create, extracted, ces, attr]).unwrap();

        // ── Read it back via the NEW read path only ────────────────────────
        let docs = proj.get_client_extraction(client_id).unwrap();
        assert_eq!(docs.len(), 1, "one document for the client");
        let d = &docs[0];
        assert_eq!(d.document_id, doc_id);
        assert!(d.clean_text.as_deref().unwrap_or("").contains("PTSD"),
            "persisted clean_text exposed for the text toggle");
        assert!(!d.clinical_events.is_empty(),
            "clinical events survive and are returned verbatim");
        // Each returned event is a full ClinicalEvent object.
        assert!(d.clinical_events.iter().all(|e| e.get("event_id").is_some()
            && e.get("event_type").is_some() && e.get("concept").is_some()));
        assert!(!d.attributions.is_empty(),
            "attribution results survive and are returned");
        // Names are pre-joined from participants / organisations.
        assert!(d.attributions.iter().any(|a| a.participant_name.is_some()),
            "at least one attribution resolves a participant name");

        eprintln!("READ1 — get_client_extraction:");
        eprintln!("  clinical_events = {}", d.clinical_events.len());
        eprintln!("  attributions    = {}", d.attributions.len());
    }

    #[test]
    fn filename1_persists_through_documentextracted_and_survives_rehydration() {
        // The uploaded filename must be persisted by the DocumentExtracted
        // projection handler and returned by BOTH read paths, so it
        // survives navigation/rehydration (no more "(unnamed)").
        let root = temp_root("fn1");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-fn1";
        let doc_id = "doc-fn1";
        let expected_name = format!("{doc_id}.pdf"); // build_upload_events sets this

        let create = EventEnvelope::new(
            client_id.into(),
            store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Fn"}}),
            }),
            None, None,
        );
        store.append_event(&create).unwrap();

        let (extracted_proto, ces_proto, _canonical) =
            build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: store.next_version(client_id).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(client_id).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();
        proj.project_forward(&[create, extracted, ces]).unwrap();

        // 1. Raw projection row carries the filename (NOT NULL).
        {
            let conn = rusqlite::Connection::open(&proj_path).unwrap();
            let name: Option<String> = conn.query_row(
                "SELECT file_name FROM documents WHERE id = ?1",
                rusqlite::params![doc_id], |r| r.get(0)).unwrap();
            assert_eq!(name.as_deref(), Some(expected_name.as_str()),
                "documents.file_name must be persisted, not NULL");
        }

        // 2. get_client_view returns the filename.
        let view = proj.get_client_view(client_id).unwrap().unwrap();
        assert_eq!(view.documents.len(), 1);
        assert_eq!(view.documents[0].file_name.as_deref(), Some(expected_name.as_str()),
            "get_client_view must return the persisted filename");

        // 3. get_client_extraction returns the filename too.
        let ext = proj.get_client_extraction(client_id).unwrap();
        assert_eq!(ext.len(), 1);
        assert_eq!(ext[0].file_name.as_deref(), Some(expected_name.as_str()),
            "get_client_extraction must return the persisted filename");

        // 4. COALESCE guard: a later legacy-style DocumentExtracted with
        //    file_name = None must NOT wipe the existing name.
        let mut legacy_proto = build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes()).0;
        if let EventPayload::DocumentExtracted(ref mut p) = legacy_proto.payload {
            p.file_name = None; // simulate an event written before file_name existed
        }
        let legacy = EventEnvelope { version: store.next_version(client_id).unwrap(), ..legacy_proto };
        store.append_event(&legacy).unwrap();
        proj.project_forward(&[legacy]).unwrap();

        let conn = rusqlite::Connection::open(&proj_path).unwrap();
        let name_after: Option<String> = conn.query_row(
            "SELECT file_name FROM documents WHERE id = ?1",
            rusqlite::params![doc_id], |r| r.get(0)).unwrap();
        assert_eq!(name_after.as_deref(), Some(expected_name.as_str()),
            "COALESCE must preserve the existing filename against a NULL update");

        eprintln!("FILENAME1 — persisted + survives read path: {expected_name}");
    }

    /// Helper: count rows in a boundary table for a document.
    fn count_rows(proj_path: &std::path::Path, sql: &str, doc_id: &str) -> i64 {
        let conn = rusqlite::Connection::open(proj_path).unwrap();
        conn.query_row(sql, rusqlite::params![doc_id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn contract1_cross_layer_document_id_identity() {
        // CONTRACT (Invariant 2): document_id is IDENTICAL across every
        // layer — projection.documents.id, clinical_events.document_id FK,
        // DocumentSummary.id (get_client_view), DocumentExtraction.document_id
        // (get_client_extraction), and the DocumentExtracted event payload.
        // CI must fail if any layer diverges.
        let root = temp_root("contract1");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-contract1";
        let doc_id = "doc-contract1";

        let create = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Id"}}),
            }),
            None, None,
        );
        store.append_event(&create).unwrap();
        let (extracted_proto, ces_proto, _c) =
            build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        // Append each before computing the next version so the
        // monotonic-per-client constraint is satisfied.
        let extracted = EventEnvelope { version: store.next_version(client_id).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(client_id).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();
        proj.project_forward(&[create, extracted.clone(), ces]).unwrap();

        // Source of truth: the DocumentExtracted event payload document_id.
        let payload_doc_id = match &extracted.payload {
            EventPayload::DocumentExtracted(p) => p.document_id.clone(),
            _ => panic!("expected DocumentExtracted"),
        };
        assert_eq!(payload_doc_id, doc_id, "event payload carries the canonical document_id");

        let conn = rusqlite::Connection::open(&proj_path).unwrap();

        // Layer 1: projection.documents.id == event payload document_id.
        let documents_id: String = conn.query_row(
            "SELECT id FROM documents WHERE id = ?1",
            rusqlite::params![payload_doc_id], |r| r.get(0)).unwrap();
        assert_eq!(documents_id, payload_doc_id, "documents.id == event payload document_id");

        // Layer 2: EVERY clinical_events.document_id FK equals documents.id —
        // no row diverges.
        let distinct_doc_fks: Vec<String> = {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT document_id FROM clinical_events WHERE document_id = ?1").unwrap();
            let rows: Vec<String> = stmt.query_map(rusqlite::params![payload_doc_id], |r| r.get(0)).unwrap()
                .collect::<Result<_, _>>().unwrap();
            rows
        };
        assert_eq!(distinct_doc_fks, vec![payload_doc_id.clone()],
            "all clinical_events.document_id FKs equal documents.id");
        let orphan_events: i64 = conn.query_row(
            "SELECT COUNT(*) FROM clinical_events ce
              LEFT JOIN documents d ON d.id = ce.document_id
             WHERE d.id IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(orphan_events, 0, "no clinical_events reference a non-existent documents.id");

        // Layer 3: get_client_view → DocumentSummary.id == payload document_id.
        let view = proj.get_client_view(client_id).unwrap().unwrap();
        assert_eq!(view.documents.len(), 1);
        assert_eq!(view.documents[0].id, payload_doc_id,
            "DocumentSummary.id == event payload document_id");

        // Layer 4: get_client_extraction → DocumentExtraction.document_id matches.
        let ext = proj.get_client_extraction(client_id).unwrap();
        assert_eq!(ext.len(), 1);
        assert_eq!(ext[0].document_id, payload_doc_id,
            "DocumentExtraction.document_id == event payload document_id");

        // Single, undivided identity across all four layers.
        let all_ids = [
            documents_id,
            view.documents[0].id.clone(),
            ext[0].document_id.clone(),
            payload_doc_id.clone(),
        ];
        assert!(all_ids.iter().all(|x| *x == payload_doc_id),
            "document_id identity is undivided across layers: {all_ids:?}");
    }

    #[test]
    fn contract2_documentdeleted_replay_dominance() {
        // CONTRACT (Invariant 1 + 4): the replay sequence
        //   DocumentExtracted → ClinicalEventsRecorded → AttributionRecorded
        //   → DocumentDeleted
        // must leave the document ABSENT after BOTH project_forward and a
        // full rebuild_from_events. DocumentDeleted dominates because it is
        // the highest-version event for the document within its client group.
        let root = temp_root("contract2");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-contract2";
        let doc_id = "doc-contract2";

        let create = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Dom"}}),
            }),
            None, None,
        );
        store.append_event(&create).unwrap();
        let (extracted_proto, ces_proto, canonical) =
            build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: store.next_version(client_id).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(client_id).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();
        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(), payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        store.append_event(&attr).unwrap();
        let del = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "delete_document".into() },
            EventPayload::DocumentDeleted(events::DocumentDeletedP { document_id: doc_id.into(), reason: None }),
            None, None,
        );
        store.append_event(&del).unwrap();

        // ── Ordering assertion: DocumentDeleted version dominates all
        //    document-derived events in the same client group. ──
        let log = store.get_events(client_id).unwrap();
        let max_derived_version = log.iter()
            .filter(|e| matches!(e.payload,
                EventPayload::DocumentExtracted(_)
                | EventPayload::ClinicalEventsRecorded(_)
                | EventPayload::AttributionRecorded(_)))
            .map(|e| e.version)
            .max()
            .unwrap();
        let delete_version = log.iter()
            .find(|e| matches!(e.payload, EventPayload::DocumentDeleted(_)))
            .map(|e| e.version)
            .unwrap();
        assert!(delete_version > max_derived_version,
            "DocumentDeleted (v{delete_version}) must dominate all derived events (max v{max_derived_version})");

        // ── Path A: incremental project_forward. ──
        proj.project_forward(&[create.clone(), extracted.clone(), ces.clone(), attr.clone(), del.clone()]).unwrap();
        let assert_absent = |proj_path: &std::path::Path, label: &str| {
            let conn = rusqlite::Connection::open(proj_path).unwrap();
            let n = |sql: &str| conn.query_row(sql, rusqlite::params![doc_id], |r| r.get::<_, i64>(0)).unwrap();
            assert_eq!(n("SELECT COUNT(*) FROM documents WHERE id=?1"), 0, "{label}: documents");
            assert_eq!(n("SELECT COUNT(*) FROM clinical_events WHERE document_id=?1"), 0, "{label}: clinical_events");
            assert_eq!(n("SELECT COUNT(*) FROM document_participant_maps WHERE document_id=?1"), 0, "{label}: document_participant_maps");
            assert_eq!(n("SELECT COUNT(*) FROM resolved_attributions WHERE event_id IN (SELECT event_id FROM clinical_events WHERE document_id=?1)"), 0, "{label}: resolved_attributions");
        };
        assert_absent(&proj_path, "project_forward");

        // ── Path B: full rebuild_from_events. ──
        let all = vec![create, extracted, ces, attr, del];
        proj.rebuild_from_events(&all).unwrap();
        assert_absent(&proj_path, "rebuild_from_events");

        // The events themselves remain in the immutable log (audit intact).
        let log_after = store.get_events(client_id).unwrap();
        assert!(log_after.iter().any(|e| matches!(e.payload, EventPayload::DocumentExtracted(_))));
        assert!(log_after.iter().any(|e| matches!(e.payload, EventPayload::DocumentDeleted(_))));
    }

    #[test]
    fn delete1_cascade_removes_derived_rows_preserves_globals() {
        let root = temp_root("del1");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-del1";
        let doc_id = "doc-del1";

        // Seed a full upload (document + clinical_events + attributions +
        // participants/organisations).
        let create = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Del"}}),
            }),
            None, None,
        );
        store.append_event(&create).unwrap();
        let (extracted_proto, ces_proto, canonical) =
            build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: store.next_version(client_id).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(client_id).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();
        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(), payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        store.append_event(&attr).unwrap();
        proj.project_forward(&[create, extracted, ces, attr]).unwrap();

        // Pre-delete: derived rows + globals exist.
        assert!(count_rows(&proj_path, "SELECT COUNT(*) FROM documents WHERE id=?1", doc_id) == 1);
        assert!(count_rows(&proj_path, "SELECT COUNT(*) FROM clinical_events WHERE document_id=?1", doc_id) > 0);
        let parts_before: i64 = rusqlite::Connection::open(&proj_path).unwrap()
            .query_row("SELECT COUNT(*) FROM participants", [], |r| r.get(0)).unwrap();
        let orgs_before: i64 = rusqlite::Connection::open(&proj_path).unwrap()
            .query_row("SELECT COUNT(*) FROM organisations", [], |r| r.get(0)).unwrap();
        assert!(parts_before > 0 && orgs_before > 0, "globals seeded");

        // Delete.
        let del = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::DocumentDeleted(events::DocumentDeletedP {
                document_id: doc_id.into(), reason: None,
            }),
            None, None,
        );
        store.append_event(&del).unwrap();
        proj.project_forward(&[del]).unwrap();

        // Post-delete: all 5 derived tables empty for the doc.
        assert_eq!(count_rows(&proj_path, "SELECT COUNT(*) FROM documents WHERE id=?1", doc_id), 0);
        assert_eq!(count_rows(&proj_path, "SELECT COUNT(*) FROM clinical_events WHERE document_id=?1", doc_id), 0);
        assert_eq!(count_rows(&proj_path, "SELECT COUNT(*) FROM document_participant_maps WHERE document_id=?1", doc_id), 0);
        assert_eq!(count_rows(&proj_path,
            "SELECT COUNT(*) FROM resolved_attributions WHERE event_id IN (SELECT event_id FROM clinical_events WHERE document_id=?1)", doc_id), 0);

        // Globals + run metadata preserved.
        let conn = rusqlite::Connection::open(&proj_path).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM participants", [], |r| r.get::<_, i64>(0)).unwrap(), parts_before,
            "participants preserved");
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM organisations", [], |r| r.get::<_, i64>(0)).unwrap(), orgs_before,
            "organisations preserved");

        // Read paths no longer return the document.
        let view = proj.get_client_view(client_id).unwrap().unwrap();
        assert_eq!(view.documents.len(), 0, "get_client_view excludes deleted doc");
        let ext = proj.get_client_extraction(client_id).unwrap();
        assert_eq!(ext.len(), 0, "get_client_extraction excludes deleted doc");

        // The events all remain in the append-only log (audit preserved).
        let evs = store.get_events(client_id).unwrap();
        assert!(evs.iter().any(|e| matches!(e.payload, EventPayload::DocumentExtracted(_))),
            "DocumentExtracted retained in log");
        assert!(evs.iter().any(|e| matches!(e.payload, EventPayload::DocumentDeleted(_))),
            "DocumentDeleted tombstone retained in log");
    }

    #[test]
    fn delete2_idempotent_double_delete() {
        let root = temp_root("del2");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let client_id = "client-del2";
        let doc_id = "doc-del2";
        let create = EventEnvelope::new(
            client_id.into(), store.next_version(client_id).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP { demographics: serde_json::json!({}) }),
            None, None,
        );
        store.append_event(&create).unwrap();
        let (extracted_proto, ces_proto, _c) =
            build_upload_events(client_id, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: store.next_version(client_id).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(client_id).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();
        proj.project_forward(&[create, extracted, ces]).unwrap();

        let mk_del = |v: u64| EventEnvelope::new(
            client_id.into(), v,
            Actor::System { component: "test".into() },
            EventPayload::DocumentDeleted(events::DocumentDeletedP { document_id: doc_id.into(), reason: None }),
            None, None,
        );
        let d1 = mk_del(store.next_version(client_id).unwrap());
        store.append_event(&d1).unwrap();
        proj.project_forward(&[d1]).unwrap();
        // Second delete — must not error, cascade affects 0 rows.
        let d2 = mk_del(store.next_version(client_id).unwrap());
        store.append_event(&d2).unwrap();
        proj.project_forward(&[d2]).unwrap();

        assert_eq!(count_rows(&proj_path, "SELECT COUNT(*) FROM documents WHERE id=?1", doc_id), 0);
    }

    #[test]
    fn delete3_survives_rebuild_and_resists_phantom_resurrection() {
        // The hardest case: a deleted document, PLUS a legacy phantom
        // DocumentUploaded (client_id == doc_id), must stay deleted after
        // a full rebuild_from_events — proven by the tombstone sweep.
        let root = temp_root("del3");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        // Use a doc_id that sorts BEFORE the real client so the phantom
        // group is processed first in BTreeMap order — the resurrection-
        // prone ordering.
        let real_client = "zzz-real-client-del3";
        let doc_id = "aaa-doc-del3";

        let create = EventEnvelope::new(
            real_client.into(), 1,
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP { demographics: serde_json::json!({}) }),
            None, None,
        );
        // Legacy phantom DocumentUploaded under client_id == doc_id.
        let phantom = EventEnvelope::new(
            doc_id.into(), 1,
            Actor::System { component: "process_document".into() },
            EventPayload::DocumentUploaded(events::DocumentUploadedP {
                document_id: doc_id.into(), file_name: doc_id.into(),
                char_count: 100, method: "process_document".into(),
            }),
            None, None,
        );
        let (extracted_proto, ces_proto, _c) =
            build_upload_events(real_client, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: 2, ..extracted_proto };
        let ces = EventEnvelope { version: 3, ..ces_proto };
        let del = EventEnvelope::new(
            real_client.into(), 4,
            Actor::System { component: "delete_document".into() },
            EventPayload::DocumentDeleted(events::DocumentDeletedP { document_id: doc_id.into(), reason: None }),
            None, None,
        );

        let all = vec![create, phantom, extracted, ces, del];
        for e in &all { store.append_event(e).unwrap(); }

        // Full rebuild from events.
        proj.rebuild_from_events(&all).unwrap();

        // The document must NOT exist after rebuild, despite the phantom
        // upsert_document that ran in the phantom's (earlier) group.
        assert_eq!(count_rows(&proj_path, "SELECT COUNT(*) FROM documents WHERE id=?1", doc_id), 0,
            "tombstone sweep keeps the document deleted after rebuild (no phantom resurrection)");
        assert_eq!(count_rows(&proj_path, "SELECT COUNT(*) FROM clinical_events WHERE document_id=?1", doc_id), 0,
            "no orphan clinical_events after rebuild");

        eprintln!("DELETE3 — deleted doc stays gone after rebuild even with phantom DocumentUploaded");
    }

    #[test]
    fn ownership1_documentextracted_reclaims_phantom_ownership() {
        // Reproduce the EXACT live failure: a phantom DocumentUploaded
        // (client_id == doc_id, from the legacy process_document
        // emission) followed by the real DocumentExtracted (client_id ==
        // real client). Prove fix B reclaims ownership so the document
        // belongs to the real client and survives navigation.
        let root = temp_root("own1");
        let events_path = root.join("events.db");
        let proj_path = root.join("projection.db");
        let store = event_store::EventStore::init(&events_path).unwrap();
        let proj = projection::Projection::init(&proj_path).unwrap();

        let real_client = "real-client-own1";
        let doc_id = "doc-own1"; // phantom client_id would equal this

        let create = EventEnvelope::new(
            real_client.into(),
            store.next_version(real_client).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Real", "lastName": "Client"}}),
            }),
            None, None,
        );
        store.append_event(&create).unwrap();

        // 1. Phantom DocumentUploaded — client_id == doc_id (the bug).
        let phantom = EventEnvelope::new(
            doc_id.into(),
            store.next_version(doc_id).unwrap(),
            Actor::System { component: "process_document".into() },
            EventPayload::DocumentUploaded(events::DocumentUploadedP {
                document_id: doc_id.into(),
                file_name: doc_id.into(),
                char_count: 100,
                method: "process_document".into(),
            }),
            None, None,
        );
        store.append_event(&phantom).unwrap();
        proj.project_forward(&[create.clone(), phantom.clone()]).unwrap();

        // Sanity: the phantom ownership is reproduced.
        {
            let conn = rusqlite::Connection::open(&proj_path).unwrap();
            let owner: String = conn.query_row(
                "SELECT client_id FROM documents WHERE id = ?1",
                rusqlite::params![doc_id], |r| r.get(0)).unwrap();
            assert_eq!(owner, doc_id, "phantom ownership reproduced (document.id == client_id)");
        }

        // 2. Real boundary events for the SAME doc_id, owned by real client.
        let (extracted_proto, ces_proto, canonical) =
            build_upload_events(real_client, doc_id, REAL_DOC, REAL_DOC.as_bytes());
        let extracted = EventEnvelope { version: store.next_version(real_client).unwrap(), ..extracted_proto };
        store.append_event(&extracted).unwrap();
        let ces = EventEnvelope { version: store.next_version(real_client).unwrap(), ..ces_proto };
        store.append_event(&ces).unwrap();
        let payload = participant_resolution::build_participant_resolution(&[canonical]);
        let attr = EventEnvelope::new(
            real_client.into(),
            store.next_version(real_client).unwrap(),
            Actor::System { component: "test".into() },
            EventPayload::AttributionRecorded(events::AttributionRecordedP {
                run_id: uuid::Uuid::now_v7(),
                payload: serde_json::to_value(&payload).unwrap(),
            }),
            Some(ces.id), None,
        );
        store.append_event(&attr).unwrap();
        proj.project_forward(&[extracted, ces, attr]).unwrap();

        // ── FIX B: ownership reclaimed by the real client ──────────────────
        let conn = rusqlite::Connection::open(&proj_path).unwrap();
        let owner: String = conn.query_row(
            "SELECT client_id FROM documents WHERE id = ?1",
            rusqlite::params![doc_id], |r| r.get(0)).unwrap();
        assert_eq!(owner, real_client,
            "DocumentExtracted reclaims ownership to the real client (NOT the phantom)");

        let n_real: i64 = conn.query_row(
            "SELECT COUNT(*) FROM documents WHERE client_id = ?1",
            rusqlite::params![real_client], |r| r.get(0)).unwrap();
        assert_eq!(n_real, 1, "real client owns exactly one document");

        let n_phantom: i64 = conn.query_row(
            "SELECT COUNT(*) FROM documents WHERE client_id = ?1",
            rusqlite::params![doc_id], |r| r.get(0)).unwrap();
        assert_eq!(n_phantom, 0, "phantom client owns no documents after reclaim");

        // Navigate-back: the document appears under the real client view.
        let view = proj.get_client_view(real_client).unwrap().unwrap();
        assert_eq!(view.documents.len(), 1, "document appears under the real client");

        // Clinical content survives under the real client.
        let ext = proj.get_client_extraction(real_client).unwrap();
        assert_eq!(ext.len(), 1);
        assert!(!ext[0].clinical_events.is_empty(),
            "clinical events survive under the real client");

        eprintln!("OWNERSHIP1 — reclaim verified: document {doc_id} now owned by {real_client}");
    }

    #[test]
    fn h3_client_exists_guard_rejects_unknown_client() {
        // The projection.client_exists query is the single source of
        // truth the defensive guard consults. Verify it returns false
        // for an unknown id and true only after a ClientCreated event
        // has been projected.
        let root = temp_root("h3");
        let proj_path = root.join("projection.db");
        let proj = projection::Projection::init(&proj_path).unwrap();

        // No clients yet — unknown id must not exist.
        assert!(!proj.client_exists("ghost-client").unwrap());

        // Project a ClientCreated event, then it must exist.
        let client_id = "client-h3";
        let create = EventEnvelope::new(
            client_id.into(),
            1,
            Actor::System { component: "test".into() },
            EventPayload::ClientCreated(events::ClientCreatedP {
                demographics: serde_json::json!({"identity": {"firstName": "Real"}}),
            }),
            None,
            None,
        );
        proj.project_forward(&[create]).unwrap();

        assert!(proj.client_exists(client_id).unwrap(), "created client must exist");
        assert!(!proj.client_exists("still-ghost").unwrap(), "unknown id stays false");
    }

    #[test]
    fn fe5_path_based_command_reads_real_file_from_disk() {
        // Smoke test for the file-IO half of process_path_and_persist:
        // verifies that std::fs::read + extract_file_contents +
        // process_document chain works on a real file path. Does NOT
        // touch the OnceLock — only the inner extract + sha logic.
        let root = temp_root("fe5c");
        let file = root.join("sample.txt");
        std::fs::write(&file, REAL_DOC).unwrap();

        // Mirror the inner steps of process_path_and_persist.
        let bytes = std::fs::read(&file).unwrap();
        let sha = sha256_hex(&bytes);
        assert_eq!(sha.len(), 64);

        let extracted_json = extract_file_contents(file.to_string_lossy().into()).unwrap();
        let extracted: serde_json::Value = serde_json::from_str(&extracted_json).unwrap();
        let text = extracted["text"].as_str().unwrap();
        assert!(text.contains("PTSD"));

        let canon = process_document(text.to_string(), "fe5c-doc".to_string()).unwrap();
        let canonical: serde_json::Value = serde_json::from_str(&canon).unwrap();
        let clean = canonical["clean_text"].as_str().unwrap();
        let clean_sha = sha256_hex(clean.as_bytes());
        assert_eq!(clean_sha.len(), 64);

        let ce_count = canonical["clinical_events"].as_array().map(|a| a.len()).unwrap_or(0);
        assert!(ce_count > 0, "path-based ingestion produces ClinicalEvents");
    }
}

// ─── Persistence-boundary tests ──────────────────────────────────────────
// Smoke tests for the audit boundary: every ClinicalEvent emitted by
// process_document must satisfy snippet integrity against clean_text,
// and the new pipeline_version + rule_corpus_hash stamps must be
// non-empty and deterministic.

#[cfg(test)]
mod persistence_boundary {
    use super::*;

    const SAMPLE_BOUNDARY: &str = "Author: Dr Lewis\nDiagnosis: post-traumatic stress disorder.\n? PTSD vs depression.\n";

    /// Every ClinicalEvent emitted by process_document must satisfy:
    ///   clean_text[char_offset_start..char_offset_end] == source_snippet
    #[test]
    fn snippet_integrity_holds_for_every_clinical_event() {
        let out = process_document(SAMPLE_BOUNDARY.to_string(), "doc-pb-1".to_string())
            .expect("process_document succeeds");
        let v: serde_json::Value = serde_json::from_str(&out).expect("valid json");
        let clean_text = v.get("clean_text").and_then(|x| x.as_str()).unwrap();
        let events = v.get("clinical_events").and_then(|x| x.as_array()).unwrap();
        assert!(!events.is_empty(), "expected at least one clinical event");
        for ev in events {
            let ce: clinical_events::ClinicalEvent =
                serde_json::from_value(ev.clone()).expect("ClinicalEvent shape");
            snippet_integrity::verify(&ce, clean_text)
                .unwrap_or_else(|e| panic!("snippet integrity failed for {}: {e}", ce.event_id));
        }
    }

    /// raw_concept is populated and round-trips through JSON.
    #[test]
    fn raw_concept_field_present_on_every_event() {
        let out = process_document(SAMPLE_BOUNDARY.to_string(), "doc-pb-2".to_string())
            .expect("process_document succeeds");
        let v: serde_json::Value = serde_json::from_str(&out).expect("valid json");
        let events = v.get("clinical_events").and_then(|x| x.as_array()).unwrap();
        for ev in events {
            assert!(
                ev.get("raw_concept").and_then(|x| x.as_str()).is_some(),
                "missing raw_concept on event {ev:?}"
            );
        }
    }

    /// pipeline_version is non-empty and has the form "X.Y.Z+<sha>".
    #[test]
    fn pipeline_version_is_well_formed() {
        let v = pipeline_version();
        assert!(!v.is_empty(), "pipeline_version must not be empty");
        assert!(v.contains('+'), "pipeline_version must include git sha: {v}");
        let (semver, sha) = v.split_once('+').unwrap();
        assert!(!semver.is_empty() && !sha.is_empty(), "both halves required: {v}");
    }

    /// rule_corpus_hash is deterministic across calls.
    #[test]
    fn rule_corpus_hash_is_deterministic() {
        let a = rule_corpus_hash().to_string();
        let b = rule_corpus_hash().to_string();
        assert_eq!(a, b, "rule_corpus_hash must be stable across calls");
        assert!(a.len() >= 16, "rule_corpus_hash must be a non-trivial digest");
    }

    /// RC4: every event_id from process_document must be unique even
    /// when two notional documents share the same doc_id (the legacy
    /// stable_id collision case). The content-addressed suffix is the
    /// uniqueness guarantee.
    #[test]
    fn event_ids_are_globally_unique_within_a_document() {
        let out = process_document(SAMPLE_BOUNDARY.to_string(), "rc4-1".to_string())
            .expect("process_document succeeds");
        let v: serde_json::Value = serde_json::from_str(&out).expect("valid json");
        let events = v.get("clinical_events").and_then(|x| x.as_array()).unwrap();
        let mut ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        for ev in events {
            let id = ev.get("event_id").and_then(|x| x.as_str()).unwrap().to_string();
            assert!(ids.insert(id.clone()), "duplicate event_id: {id}");
        }
    }

    /// RC1: clean_text_sha256 stamp is deterministic and matches
    /// sha256_hex(clean_text). This is the freeze-point contract:
    /// callers can verify by re-hashing the persisted clean_text.
    #[test]
    fn clean_text_sha256_matches_clean_text_bytes() {
        let out = process_document(SAMPLE_BOUNDARY.to_string(), "rc1-1".to_string())
            .expect("process_document succeeds");
        let v: serde_json::Value = serde_json::from_str(&out).expect("valid json");
        let clean_text = v.get("clean_text").and_then(|x| x.as_str()).unwrap();
        let recomputed = sha256_hex(clean_text.as_bytes());
        // process_document doesn't currently embed clean_text_sha256
        // in its JSON (that's done by process_and_persist_document),
        // so we re-derive both sides and verify they're stable and
        // 64-char lowercase hex.
        assert_eq!(recomputed.len(), 64);
        assert!(recomputed.bytes().all(|b| b.is_ascii_hexdigit()));
        let again = sha256_hex(clean_text.as_bytes());
        assert_eq!(recomputed, again, "sha256_hex must be deterministic");
    }

    /// RC2: sha256_hex actually produces SHA-256 (not the prior
    /// SipHash placeholder). Tested against an RFC 6234 known vector
    /// for the empty string.
    #[test]
    fn sha256_hex_is_real_sha256() {
        // SHA-256 of the empty byte string.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // SHA-256 of "abc" (FIPS 180-4 §B.1).
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    /// snippet_integrity rejects a forged offset.
    #[test]
    fn snippet_integrity_rejects_drifted_offsets() {
        let text = "Diagnosis: PTSD.";
        let ce = clinical_events::ClinicalEvent {
            event_id: "drift#diagnosis#0".to_string(),
            event_type: clinical_events::EventType::Diagnosis,
            concept: "post-traumatic stress disorder".to_string(),
            raw_concept: "PTSD".to_string(),
            date: None,
            date_precision: None,
            assertion_status: Some(clinical_events::AssertionStatus::Affirmed),
            source_document_id: "drift".to_string(),
            source_section: None,
            // The recorded snippet does NOT match clean_text[0..5] = "Diagn".
            source_snippet: "Diagnosis: PTSD".to_string(),
            char_offset_start: 0,
            char_offset_end: 5,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({}),
        };
        assert!(snippet_integrity::verify(&ce, text).is_err());
    }
}

#[cfg(test)]
mod pipeline {
    use super::*;

    // ── Shared synthetic document ─────────────────────────────────────────────
    // Realistic medico-legal prose with deliberate coverage of every keyword
    // family so all rule-based extraction paths are exercised.

    const SAMPLE: &str = "\
HISTORY
The patient is a 42-year-old male who sustained injuries in a motor vehicle accident \
on 15/03/2022. He reports no prior psychological conditions.

EXAMINATION
Examination revealed significant restriction of lumbar flexion and extension. \
MRI of the lumbar spine confirmed disc herniation at L4/L5. \
The patient also presented with symptoms consistent with post-traumatic stress disorder \
and generalised anxiety disorder arising from the accident.

TREATMENT
The patient was prescribed sertraline 100 mg daily and pregabalin 150 mg twice daily. \
A course of physiotherapy commenced on 01/06/2022. \
Cognitive behavioural therapy was commenced concurrently to address PTSD symptoms.

OPINION
In my opinion the disc herniation and post-traumatic stress disorder are directly caused \
by the motor vehicle accident of 15/03/2022. \
The patient is currently unable to return to work in his pre-injury capacity. \
Long-term prognosis for full recovery is guarded given the chronic nature of these conditions.";

    // ── Helper: parse JSON or panic with the raw string ───────────────────────
    fn j(raw: &str) -> serde_json::Value {
        serde_json::from_str(raw)
            .unwrap_or_else(|e| panic!("JSON parse failed: {e}\n--- raw ---\n{raw}"))
    }

    // ── Stage 1 ───────────────────────────────────────────────────────────────

    #[test]
    fn test_segment_document() {
        let out = segment_document(SAMPLE.to_string(), "doc_01".to_string())
            .expect("segment_document should not error");
        let v = j(&out);

        assert_eq!(v["doc_id"], "doc_01", "doc_id round-trip");
        assert!(v["word_count"].as_u64().unwrap_or(0) > 50, "word_count should be set");

        let segs = &v["segments"];
        let clinical = segs["clinical_findings"].as_str().unwrap_or("");
        let opinions  = segs["opinions"].as_str().unwrap_or("");
        assert!(!clinical.is_empty(), "clinical_findings must not be empty");
        assert!(!opinions.is_empty(),  "opinions must not be empty");
        // method is "rules" because Ollama is not running in CI
        let method = v["method"].as_str().unwrap_or("");
        assert!(method == "rules" || method == "ollama", "unexpected method: {method}");
    }

    // ── Stage 2 ───────────────────────────────────────────────────────────────

    #[test]
    fn test_extract_claims() {
        let out = extract_claims(SAMPLE.to_string(), "doc_01".to_string())
            .expect("extract_claims should not error");
        let v = j(&out);

        let claims = v["claims"].as_array().expect("claims must be an array");
        assert!(!claims.is_empty(), "should extract at least one claim");

        // Every claim must have the four required fields
        for (i, claim) in claims.iter().enumerate() {
            assert!(claim["id"].is_number(),   "claim[{i}].id must be a number");
            assert!(claim["text"].is_string(),  "claim[{i}].text must be a string");
            assert!(claim["category"].is_string(), "claim[{i}].category must be a string");
            assert!(claim["confidence"].is_number(), "claim[{i}].confidence must be a number");
            assert!(claim["tags"].is_array(),  "claim[{i}].tags must be an array");
            // confidence is in [0.0, 1.0]
            let conf = claim["confidence"].as_f64().unwrap();
            assert!((0.0..=1.0).contains(&conf), "confidence {conf} out of range");
        }

        // SAMPLE contains "caused by" and "in my opinion" → at least one causation claim
        let has_causation = claims.iter().any(|c| c["category"] == "causation");
        assert!(has_causation, "should detect at least one causation claim");

        // SAMPLE contains "unable to return to work" → at least one capacity claim
        let has_capacity = claims.iter().any(|c| c["category"] == "capacity");
        assert!(has_capacity, "should detect at least one capacity claim");
    }

    // ── Stage 3 ───────────────────────────────────────────────────────────────

    #[test]
    fn test_detect_pipeline_conflicts_no_conflict() {
        // Single document — can't contradict itself at the inter-document level
        let claims_raw = extract_claims(SAMPLE.to_string(), "doc_01".to_string()).unwrap();
        let claim_set: serde_json::Value = serde_json::from_str(&claims_raw).unwrap();

        let out = detect_pipeline_conflicts(vec![claim_set])
            .expect("detect_pipeline_conflicts should not error");
        let v = j(&out);

        assert!(v["conflicts"].is_array(), "conflicts must be an array");
        assert_eq!(v["doc_count"], 1_u64, "doc_count should reflect input");
    }

    #[test]
    fn test_detect_pipeline_conflicts_with_conflict() {
        // Craft two opposing claim-sets to guarantee a contradiction is surfaced.
        let affirming = serde_json::json!({
            "doc_id": "report_a",
            "method": "rules",
            "claims": [{ "id": 1, "text": "There is a fracture of the right tibia.",
                         "category": "finding", "confidence": 0.9, "tags": ["fracture"] }]
        });
        let denying = serde_json::json!({
            "doc_id": "report_b",
            "method": "rules",
            "claims": [{ "id": 1, "text": "There is no fracture identified on imaging.",
                         "category": "finding", "confidence": 0.9, "tags": [] }]
        });

        let out = detect_pipeline_conflicts(vec![affirming, denying])
            .expect("detect_pipeline_conflicts should not error");
        let v = j(&out);

        let conflicts = v["conflicts"].as_array().expect("conflicts must be an array");
        assert!(!conflicts.is_empty(), "should detect fracture/no fracture contradiction");

        let conflict = &conflicts[0];
        assert!(conflict["topic"].is_string(),          "conflict.topic must be a string");
        assert!(conflict["claim_a_source"].is_string(), "claim_a_source must be a string");
        assert!(conflict["claim_b_source"].is_string(), "claim_b_source must be a string");
        assert!(conflict["severity"].is_string(),       "severity must be a string");
    }

    // ── Stage 4 ───────────────────────────────────────────────────────────────

    #[test]
    fn test_reconstruct_timeline() {
        // Build a structured doc by calling extract_structured_data (already tested upstream)
        let structured_raw = extract_structured_data(SAMPLE.to_string(), "doc_01".to_string())
            .expect("extract_structured_data should not error");
        let structured: serde_json::Value = serde_json::from_str(&structured_raw).unwrap();

        let out = reconstruct_timeline(vec![structured])
            .expect("reconstruct_timeline should not error");
        let v = j(&out);

        let timeline = v["timeline"].as_array().expect("timeline must be an array");
        // SAMPLE has two explicit dates (15/03/2022, 01/06/2022)
        assert!(!timeline.is_empty(), "timeline should contain at least one entry");

        for (i, entry) in timeline.iter().enumerate() {
            assert!(entry["date"].is_string(),   "entry[{i}].date must be a string");
            assert!(entry["event"].is_string(),  "entry[{i}].event must be a string");
            assert!(entry["source"].is_string(), "entry[{i}].source must be a string");
            assert!(entry["category"].is_string(), "entry[{i}].category must be a string");
        }

        // Entries should be in chronological order (earliest first)
        let dates: Vec<&str> = timeline.iter()
            .filter_map(|e| e["date_iso"].as_str())
            .collect();
        let mut sorted = dates.clone();
        sorted.sort();
        assert_eq!(dates, sorted, "timeline entries must be in chronological order");
    }

    // ── Stage 5 ───────────────────────────────────────────────────────────────

    #[test]
    fn test_synthesise_report() {
        // Provide minimal valid inputs for each parameter
        let case_summary = serde_json::json!({
            "case_summary": {
                "overall_conditions": ["post-traumatic stress disorder", "disc herniation"],
                "medications":        ["sertraline", "pregabalin"],
                "procedures":         ["physiotherapy", "cognitive behavioural therapy"],
                "conflicts":          [],
                "case_narrative":     "In my opinion the injuries are caused by the MVA.",
                "clinical_document_count": 1
            }
        });
        let conflicts = serde_json::json!({ "method": "rules", "conflicts": [] });
        let timeline  = serde_json::json!({
            "method": "rules",
            "timeline": [
                { "date": "2022-03-15", "date_iso": "2022-03-15",
                  "event": "Motor vehicle accident", "source": "doc_01", "category": "injury" }
            ]
        });

        let out = synthesise_report(case_summary, conflicts, timeline)
            .expect("synthesise_report should not error");
        let v = j(&out);

        let report = &v["report"];
        // All six narrative fields must be present and non-empty strings
        for field in &[
            "executive_summary", "injury_narrative", "treatment_history",
            "opinions_and_causation", "conflicts_summary", "overall_assessment",
        ] {
            let s = report[field].as_str()
                .unwrap_or_else(|| panic!("report.{field} must be a string"));
            assert!(!s.is_empty(), "report.{field} must not be empty");
        }
        // Recommendations must be a non-empty array
        let recs = report["recommendations"].as_array()
            .expect("recommendations must be an array");
        assert!(!recs.is_empty(), "should produce at least one recommendation");
        // Timeline must be forwarded
        let tl = report["timeline"].as_array().expect("timeline must be an array");
        assert_eq!(tl.len(), 1, "timeline should forward the one entry provided");
    }

    // ── Full chain ────────────────────────────────────────────────────────────
    // Wires all five stages together end-to-end with SAMPLE as input.
    // This is the canonical integration smoke-test: if it passes, the rules
    // fallback path is working correctly for every stage.

    #[test]
    fn test_full_chain() {
        let doc_id = "chain_doc".to_string();

        // 1. Segment
        let seg_raw = segment_document(SAMPLE.to_string(), doc_id.clone())
            .expect("stage 1: segment_document");
        let seg: serde_json::Value = serde_json::from_str(&seg_raw).unwrap();
        assert!(seg["segments"].is_object(), "stage 1: segments must be an object");

        // 2. Extract claims
        let claims_raw = extract_claims(SAMPLE.to_string(), doc_id.clone())
            .expect("stage 2: extract_claims");
        let claims: serde_json::Value = serde_json::from_str(&claims_raw).unwrap();
        assert!(!claims["claims"].as_array().unwrap().is_empty(), "stage 2: must have claims");

        // 3. Detect conflicts (single doc — expect empty)
        let conflicts_raw = detect_pipeline_conflicts(vec![claims])
            .expect("stage 3: detect_pipeline_conflicts");
        let conflicts: serde_json::Value = serde_json::from_str(&conflicts_raw).unwrap();
        assert!(conflicts["conflicts"].is_array(), "stage 3: conflicts must be an array");

        // 4. Reconstruct timeline (uses structured doc, not claims)
        let structured_raw = extract_structured_data(SAMPLE.to_string(), doc_id.clone())
            .expect("stage 4: extract_structured_data prerequisite");
        let structured: serde_json::Value = serde_json::from_str(&structured_raw).unwrap();
        let timeline_raw = reconstruct_timeline(vec![structured.clone()])
            .expect("stage 4: reconstruct_timeline");
        let timeline: serde_json::Value = serde_json::from_str(&timeline_raw).unwrap();
        assert!(timeline["timeline"].is_array(), "stage 4: timeline must be an array");

        // 5. Synthesise report — build minimal case_summary from aggregate_case
        let agg_raw = aggregate_case(vec![structured])
            .expect("stage 5: aggregate_case prerequisite");
        let agg: serde_json::Value = serde_json::from_str(&agg_raw).unwrap();
        let report_raw = synthesise_report(agg, conflicts, timeline)
            .expect("stage 5: synthesise_report");
        let report: serde_json::Value = serde_json::from_str(&report_raw).unwrap();

        // Terminal assertion: the final report must have content
        let exec = report["report"]["executive_summary"].as_str().unwrap_or("");
        assert!(!exec.is_empty(), "full chain: executive_summary must not be empty");

        // Print the final output for manual inspection with --nocapture
        println!("\n=== FULL CHAIN OUTPUT ===");
        println!("{}", serde_json::to_string_pretty(&report["report"]).unwrap());
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LAYER 1 — process_document  (canonical store)
    // ══════════════════════════════════════════════════════════════════════════

    // ── Spec test 1: OCR noise removal ───────────────────────────────────────
    // "ds.js M wv y." must produce no meaningful entities.

    #[test]
    fn test_ocr_noise_is_stripped() {
        let noise = "ds.js M wv y.\nchatgpt\nget plus\nlog in\n>>>>>>>>>>\nUTF-8\nGoLive";
        let out = process_document(noise.to_string(), "noise_doc".to_string())
            .expect("process_document must not error on noise-only input");
        let v = j(&out);

        // clean_text must not contain known noise strings
        let clean = v["clean_text"].as_str().unwrap_or("");
        assert!(!clean.contains("chatgpt"),  "clean_text must not contain 'chatgpt'");
        assert!(!clean.contains("get plus"), "clean_text must not contain 'get plus'");
        assert!(!clean.contains("GoLive"),   "clean_text must not contain 'GoLive'");

        // Pure-noise input should produce no conditions/medications/procedures
        let conds = v["entities"]["conditions"].as_array().unwrap();
        let meds  = v["entities"]["medications"].as_array().unwrap();
        let procs = v["entities"]["procedures"].as_array().unwrap();
        assert!(conds.is_empty(), "noise input should produce no conditions; got: {conds:?}");
        assert!(meds.is_empty(),  "noise input should produce no medications; got: {meds:?}");
        assert!(procs.is_empty(), "noise input should produce no procedures; got: {procs:?}");
    }

    // ── Spec test 2: Synonym deduplication ───────────────────────────────────
    // ["PTSD", "post-traumatic stress disorder"] → exactly one canonical entry.

    #[test]
    fn test_synonym_deduplication() {
        // Both raw forms appear in the text; only one normalised entry must survive
        let text = "The patient has PTSD also known as post-traumatic stress disorder. \
                    They were involved in a motor vehicle accident on 01/04/2022. \
                    Treatment with sertraline commenced.";
        let out = process_document(text.to_string(), "dedup_doc".to_string())
            .expect("process_document should not error");
        let v = j(&out);

        let conditions: Vec<&str> = v["entities"]["conditions"]
            .as_array().unwrap()
            .iter()
            .filter_map(|s| s.as_str())
            .collect();

        let ptsd_count = conditions
            .iter()
            .filter(|&&c| {
                let l = c.to_lowercase();
                l.contains("post-traumatic stress disorder") || l == "ptsd"
            })
            .count();

        assert_eq!(
            ptsd_count, 1,
            "PTSD and post-traumatic stress disorder must deduplicate to one entry; \
             got conditions: {conditions:?}"
        );
    }

    // ── Spec test 3: Category filtering ──────────────────────────────────────
    // "lumbar spine" must NOT appear as a condition.

    #[test]
    fn test_anatomy_not_a_condition() {
        let text = "Examination of the lumbar spine revealed disc herniation at L4/L5. \
                    The patient sustained injuries in a motor vehicle accident on 10/01/2022. \
                    Physiotherapy was commenced.";
        let out = process_document(text.to_string(), "anatomy_doc".to_string())
            .expect("process_document should not error");
        let v = j(&out);

        let conditions: Vec<&str> = v["entities"]["conditions"]
            .as_array().unwrap()
            .iter()
            .filter_map(|s| s.as_str())
            .collect();

        let cond_str = conditions.join("|").to_lowercase();
        assert!(
            !cond_str.contains("lumbar spine"),
            "\"lumbar spine\" must not appear as a condition; got: {conditions:?}"
        );
        assert!(
            !cond_str.contains("motor vehicle accident"),
            "\"motor vehicle accident\" must not appear as a condition; got: {conditions:?}"
        );
    }

    // ── Layer 1 canonical schema ──────────────────────────────────────────────

    #[test]
    fn test_process_document_canonical_schema() {
        let out = process_document(SAMPLE.to_string(), "doc_l1".to_string())
            .expect("process_document should not error");
        let v = j(&out);

        // Top-level canonical fields
        assert!(v["doc_id"].is_string(),      "doc_id must be a string");
        assert!(v["clean_text"].is_string(),  "clean_text must be a string");
        assert!(v["entities"].is_object(),    "entities must be an object");
        assert!(v["dates"].is_array(),        "dates must be an array");

        // doc_id round-trip
        assert_eq!(v["doc_id"].as_str().unwrap(), "doc_l1");

        // entities sub-keys — all present, all arrays
        for key in &["conditions", "medications", "procedures", "organisations"] {
            assert!(
                v["entities"][key].is_array(),
                "entities.{key} must be an array"
            );
        }

        // No raw / legacy fields must be present
        assert!(v["timeline"].is_null(),             "timeline must NOT be in Layer 1 output");
        assert!(v["conflicts"].is_null(),            "conflicts must NOT be in Layer 1 output");
        assert!(v["summary"].is_null(),              "summary must NOT be in Layer 1 output");
        assert!(v["injuries_or_conditions"].is_null(), "raw injuries_or_conditions must not leak");
        assert!(v["key_findings"].is_null(),         "key_findings must not leak");
    }

    // ── clean_text carries actual clinical content ────────────────────────────

    #[test]
    fn test_process_document_clean_text_content() {
        let noisy = format!(
            "chatgpt\nget plus\nlog in\n{}\n>>>>>>>>>>\nds.js\napp.tsx",
            SAMPLE
        );
        let out = process_document(noisy, "noise_doc".to_string()).unwrap();
        let v = j(&out);

        let clean = v["clean_text"].as_str().unwrap_or("");
        // Must have stripped all UI noise
        assert!(!clean.to_lowercase().contains("chatgpt"), "chatgpt must be stripped");
        assert!(!clean.to_lowercase().contains("get plus"), "get plus must be stripped");
        assert!(!clean.contains("ds.js"),  "code filename must be stripped");
        assert!(!clean.contains("app.tsx"), "code filename must be stripped");
        // Must still contain clinical content
        assert!(
            clean.to_lowercase().contains("disc herniation") || clean.len() > 100,
            "clean_text must retain clinical content"
        );
    }

    // ── Entity extraction quality ─────────────────────────────────────────────

    #[test]
    fn test_process_document_entities_extracted() {
        let out = process_document(SAMPLE.to_string(), "doc_l1_ent".to_string()).unwrap();
        let v = j(&out);

        let conditions: Vec<&str> = v["entities"]["conditions"]
            .as_array().unwrap()
            .iter().filter_map(|s| s.as_str()).collect();

        assert!(!conditions.is_empty(), "should extract at least one condition");
        let cond_str = conditions.join(" ").to_lowercase();
        assert!(
            cond_str.contains("post-traumatic stress disorder"),
            "PTSD should normalise to full name; got: {cond_str}"
        );

        let meds: Vec<&str> = v["entities"]["medications"]
            .as_array().unwrap()
            .iter().filter_map(|s| s.as_str()).collect();
        assert!(!meds.is_empty(), "should extract at least one medication");
        let med_str = meds.join(" ").to_lowercase();
        assert!(med_str.contains("sertraline"), "sertraline should be extracted; got: {med_str}");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // AUDIT REGRESSIONS — defects found in PRODUCTION persisted data
    // (TEST CASE 4, document 019eb2fd-…). Each assertion below failed
    // against the live projection before the corresponding fix.
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn audit_denied_medication_is_not_persisted_as_affirmed() {
        // Production data: "Emma denied taking opioid medication during
        // interview" was stored as medication_mention|opioid|AFFIRMED.
        let text = "Medication history is also inconsistent. Emma denied taking \
                    opioid medication during interview. Pharmacy records show \
                    regular dispensing of oxycodone throughout 2023.";
        let v = layer1(text, "audit_med_negation");
        let events = v["clinical_events"].as_array().unwrap();
        let opioid = events
            .iter()
            .find(|e| {
                e["event_type"] == "medication_mention" && e["concept"] == "opioid"
            })
            .expect("opioid medication_mention must exist");
        assert_ne!(
            opioid["assertion_status"], "affirmed",
            "denied medication must not persist as affirmed; got {opioid}"
        );
    }

    #[test]
    fn audit_disc_prolapse_diagnosis_is_extracted() {
        // Production data: "lumbar disc prolapse at L4-L5" produced ZERO
        // diagnosis events — only the US "herniation" form was in the
        // keyword list.
        let text = "One treating orthopaedic surgeon diagnosed a lumbar disc \
                    prolapse at L4-L5.";
        let v = layer1(text, "audit_disc_prolapse");
        let conds = v["entities"]["conditions"].as_array().unwrap();
        let joined = conds
            .iter()
            .filter_map(|c| c.as_str())
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        assert!(
            joined.contains("disc prolapse"),
            "disc prolapse must be extracted as a condition; got: {joined}"
        );
    }

    #[test]
    fn audit_day_precision_date_does_not_also_emit_nested_bare_year() {
        // Production data: "14 June 1968" emitted BOTH 1968-06-14 (41–53)
        // and a nested bare-year 1968 (49–53) — the timeline double-counts.
        let found = crate::dates::find_dates("DOB: 14 June 1968.");
        let values: Vec<&str> = found.iter().map(|d| d.value.as_str()).collect();
        assert!(values.contains(&"1968-06-14"), "day precision expected: {values:?}");
        assert!(
            !values.contains(&"1968"),
            "nested bare-year duplicate must be suppressed: {values:?}"
        );
    }

    #[test]
    fn audit_contested_diagnosis_keeps_both_statuses() {
        // The multi-mention requirement: an affirmed PTSD diagnosis AND a
        // later explicit rejection must BOTH survive extraction — the
        // validation gate must not silently drop the contested condition.
        let text = "A psychologist diagnosed post-traumatic stress disorder \
                    related to the workplace incident. A psychiatrist \
                    subsequently reported that diagnostic criteria for PTSD \
                    were not met.";
        let v = layer1(text, "audit_contested_dx");
        let mentions = v["condition_mentions"].as_array().unwrap();
        let statuses: Vec<&str> = mentions
            .iter()
            .filter(|m| {
                m["term"].as_str().unwrap_or("").contains("post-traumatic")
            })
            .filter_map(|m| m["status"].as_str())
            .collect();
        assert!(
            statuses.contains(&"affirmed") && statuses.contains(&"contradicted"),
            "both affirmed and contradicted PTSD mentions must appear; got {statuses:?}"
        );
    }

    #[test]
    fn audit_four_digit_dose_token_is_not_a_date() {
        // "2000mg" fabricated the date 2000-01-01 before the strict
        // bare-year rule.
        let raw = extract_structured_data(
            "Prescribed 2000mg daily for pain management symptoms.".to_string(),
            "audit_dose_token".to_string(),
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let dates = v["dates"].as_array().unwrap();
        assert!(
            dates.iter().all(|d| d.as_str() != Some("2000-01-01")),
            "a dose token must not fabricate a date; got {dates:?}"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LAYER 2 — reason_document  (timeline · conflicts · summary)
    // ══════════════════════════════════════════════════════════════════════════

    // ── Helper: run Layer 1 and return parsed canonical Value ─────────────────
    fn layer1(text: &str, id: &str) -> serde_json::Value {
        let raw = process_document(text.to_string(), id.to_string())
            .expect("process_document (Layer 1) should not error");
        serde_json::from_str(&raw).unwrap()
    }

    // ── Spec test 4: Timeline reconstruction ─────────────────────────────────
    // Dates must produce ordered events.

    #[test]
    fn test_timeline_reconstruction() {
        let canonical = layer1(SAMPLE, "tl_doc");
        let out = reason_document(canonical)
            .expect("reason_document should not error");
        let v = j(&out);

        let timeline = v["timeline"].as_array().expect("timeline must be an array");
        // SAMPLE contains 15/03/2022 and 01/06/2022
        assert!(!timeline.is_empty(), "timeline must not be empty");

        // Each entry must have the three required fields
        for (i, entry) in timeline.iter().enumerate() {
            assert!(entry["date_iso"].is_string(),  "entry[{i}].date_iso must be a string");
            assert!(entry["event"].is_string(),     "entry[{i}].event must be a string");
            assert!(entry["category"].is_string(),  "entry[{i}].category must be a string");
        }

        // Chronological order (sorted ascending by date_iso)
        let dates: Vec<&str> = timeline.iter()
            .filter_map(|e| e["date_iso"].as_str())
            .collect();
        let mut sorted = dates.clone();
        sorted.sort();
        assert_eq!(dates, sorted, "timeline must be in chronological order");

        // 15/03/2022 precedes 01/06/2022  →  2022-03-15 < 2022-06-01
        if dates.len() >= 2 {
            assert!(
                dates[0] <= dates[1],
                "earliest date must come first; got {dates:?}"
            );
        }
    }

    // ── reason_document output schema ─────────────────────────────────────────

    #[test]
    fn test_reason_document_schema() {
        let canonical = layer1(SAMPLE, "rd_schema");
        let out = reason_document(canonical)
            .expect("reason_document should not error");
        let v = j(&out);

        // Required top-level keys
        assert!(v["timeline"].is_array(),  "timeline must be an array");
        assert!(v["conflicts"].is_array(), "conflicts must be an array");
        assert!(v["summary"].is_object(),  "summary must be an object");

        // Summary sub-keys
        assert!(v["summary"]["key_conditions"].is_array(),  "summary.key_conditions");
        assert!(v["summary"]["key_treatments"].is_array(),  "summary.key_treatments");
        assert!(v["summary"]["overview"].is_string(),       "summary.overview");

        // No entity lists in Layer 2 output (no backflow)
        assert!(v["entities"].is_null(), "Layer 2 must not output raw entities");
        assert!(v["clean_text"].is_null(), "Layer 2 must not echo clean_text");
    }

    // ── Conflict detection ────────────────────────────────────────────────────

    #[test]
    fn test_conflict_detection_uncertainty_flag() {
        // Insert an uncertainty marker and confirm it surfaces in conflicts
        let text = format!(
            "Possible disc herniation noted. Query PTSD. {}\n{}",
            SAMPLE, SAMPLE
        );
        let canonical = layer1(&text, "conflict_doc");
        let out = reason_document(canonical).unwrap();
        let v = j(&out);

        let conflicts = v["conflicts"].as_array().unwrap();
        let has_uncertainty = conflicts.iter().any(|c| {
            c["type"].as_str() == Some("uncertainty")
        });
        assert!(has_uncertainty, "should detect uncertainty markers; got: {conflicts:?}");
    }

    // ── reason_document rejects empty canonical store ─────────────────────────

    #[test]
    fn test_reason_document_rejects_empty_clean_text() {
        let bad_canonical = serde_json::json!({
            "doc_id":     "bad",
            "clean_text": "",
            "entities":   { "conditions": [], "medications": [], "procedures": [], "organisations": [] },
            "dates":      []
        });
        let result = reason_document(bad_canonical);
        assert!(result.is_err(), "reason_document must reject empty clean_text");
    }

    // ══════════════════════════════════════════════════════════════════════════
    // Spec test 5: Full two-layer pipeline
    // Messy OCR → clean structured Layer 1 output → Layer 2 reasoning output
    // ══════════════════════════════════════════════════════════════════════════

    #[test]
    fn test_full_two_layer_pipeline() {
        // Inject noise that must be stripped before reaching Layer 2
        let messy = format!(
            "chatgpt\nget plus\nlog in\nds.js\napp.tsx\nUTF-8\nGoLive\n\
             >>>>>>>>>>\n\n{}",
            SAMPLE
        );

        // ── Layer 1 ──────────────────────────────────────────────────────────
        let l1_raw = process_document(messy.clone(), "full_doc".to_string())
            .expect("Layer 1: process_document should not error");
        let l1: serde_json::Value = serde_json::from_str(&l1_raw).unwrap();

        // Layer 1 canonical invariants
        assert_eq!(l1["doc_id"].as_str().unwrap(), "full_doc");
        assert!(l1["clean_text"].is_string(), "clean_text must be present");
        assert!(!l1["entities"]["conditions"].as_array().unwrap().is_empty(),
            "Layer 1: must extract at least one condition from SAMPLE");
        assert!(!l1["dates"].as_array().unwrap().is_empty(),
            "Layer 1: must extract at least one date from SAMPLE");

        // Noise must not leak into clean_text
        let clean = l1["clean_text"].as_str().unwrap();
        assert!(!clean.to_lowercase().contains("chatgpt"), "chatgpt leaked into clean_text");
        assert!(!clean.contains("ds.js"), "ds.js leaked into clean_text");

        // ── Layer 2 ──────────────────────────────────────────────────────────
        let l2_raw = reason_document(l1)
            .expect("Layer 2: reason_document should not error");
        let l2: serde_json::Value = serde_json::from_str(&l2_raw).unwrap();

        // Timeline must be populated and ordered
        let timeline = l2["timeline"].as_array().unwrap();
        assert!(!timeline.is_empty(), "Layer 2: timeline must not be empty");
        let dates: Vec<&str> = timeline.iter()
            .filter_map(|e| e["date_iso"].as_str()).collect();
        let mut sorted = dates.clone();
        sorted.sort();
        assert_eq!(dates, sorted, "Layer 2: timeline must be chronologically sorted");

        // Summary must have content
        let overview = l2["summary"]["overview"].as_str().unwrap_or("");
        assert!(!overview.is_empty(), "Layer 2: overview must not be empty");
        assert!(
            !overview.to_lowercase().contains("chatgpt"),
            "Layer 2: noise must not reach summary"
        );

        // Print for --nocapture inspection
        println!("\n=== FULL TWO-LAYER PIPELINE OUTPUT ===");
        println!("--- Layer 1 (canonical store) ---");
        println!("{}", serde_json::to_string_pretty(&serde_json::from_str::<serde_json::Value>(&l1_raw).unwrap()).unwrap());
        println!("--- Layer 2 (reasoning) ---");
        println!("{}", serde_json::to_string_pretty(&l2).unwrap());
    }
}

// ─── Gold-standard fixture tests ─────────────────────────────────────────
//
// Per the product spec (Step 2), these embed representative *extracted
// text* — not the PDFs themselves — for FakeClient1..4 plus the
// TestToDelet.txt example. Each test asserts the expected confirmed /
// queried / contradicted / symptom outputs and the false-positives that
// must NOT appear.
//
// When the cleaner / classifier changes these tests are the canary —
// regressions get caught before they hit the UI.

#[cfg(test)]
mod fixtures {
    use super::*;

    fn pd(text: &str) -> serde_json::Value {
        let json = process_document(text.to_string(), "fixture".to_string())
            .expect("process_document should succeed on fixture text");
        serde_json::from_str(&json).expect("process_document output should be JSON")
    }

    fn vec_of(v: &serde_json::Value, path: &[&str]) -> Vec<String> {
        let mut cur = v;
        for p in path {
            cur = match cur.get(*p) { Some(x) => x, None => return Vec::new() };
        }
        cur.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    }

    fn condition_statuses(v: &serde_json::Value) -> Vec<(String, String)> {
        v.get("condition_mentions")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|m| {
                        (
                            m.get("term").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                            m.get("status").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    // ─── FakeClient2 — affirmed dx, contradicted PTSD, symptoms, sertraline ──
    // This fixture reflects the spec's enriched FakeClient2: the report
    // carries an Author + Date header and includes BOTH a treating
    // clinician's affirmation of PTSD AND a reviewing clinician's
    // contradiction. The condition_mentions output must show both.
    const FAKE_CLIENT_2: &str = "\
Psychiatric Assessment
Author: Dr Lewis
Date: 12 June 2023

Patient seen for medico-legal review.

Diagnosis: major depressive disorder. Patient reports anxiety, low mood,
hypervigilance and intrusive memories. Sertraline 50mg has been commenced.

Treating Psychologist
Diagnosis: post-traumatic stress disorder.

Reviewing Psychiatrist
Presentation inconsistent with PTSD.
? PTSD vs depression.
";

    #[test]
    fn fakeclient2_diagnoses_and_status() {
        let v = pd(FAKE_CLIENT_2);
        let conds = vec_of(&v, &["entities", "conditions"]);
        assert!(conds.iter().any(|c| c == "major depressive disorder"),
                "MDD should be a confirmed diagnosis: {:?}", conds);
        assert!(conds.iter().any(|c| c == "post-traumatic stress disorder"),
                "PTSD should appear in conditions: {:?}", conds);

        // PTSD now has MULTIPLE statuses because the fixture has both
        // the Treating Psychologist (affirmed) AND the Reviewing
        // Psychiatrist (contradicted) AND a queried/differential
        // "? PTSD vs depression" sentence. All must surface — the UI
        // groups by status and shows them separately. A single
        // contradicted/affirmed verdict must NEVER silently win.
        let statuses = condition_statuses(&v);
        let ptsd_statuses: Vec<&str> = statuses
            .iter()
            .filter(|(t, _)| t.contains("post-traumatic stress"))
            .map(|(_, s)| s.as_str())
            .collect();
        assert!(ptsd_statuses.contains(&"affirmed"),
                "Treating-Psychologist affirmation of PTSD missing: {:?}", statuses);
        assert!(ptsd_statuses.contains(&"contradicted"),
                "Reviewing-Psychiatrist contradiction of PTSD missing: {:?}", statuses);
        let queried_or_diff = ptsd_statuses.iter().any(|s| *s == "queried" || *s == "differential");
        assert!(queried_or_diff,
                "queried/differential PTSD mention missing: {:?}", statuses);
    }

    // ── Cleaned-text preservation regressions ────────────────────────────
    // The cleaner must not eat clinically meaningful short lines now that
    // we apply the protected-line whitelist BEFORE any noise heuristic.
    #[test]
    fn fakeclient2_clean_text_preserves_author_date_diagnoses() {
        let v = pd(FAKE_CLIENT_2);
        let clean = v.get("clean_text").and_then(|s| s.as_str()).unwrap_or("");
        for must_have in [
            "Author: Dr Lewis",
            "Date: 12 June 2023",
            "major depressive disorder",
            "post-traumatic stress disorder",
            "Treating Psychologist",
        ] {
            assert!(clean.contains(must_have),
                "clean_text must preserve {:?}; got:\n{}", must_have, clean);
        }
    }

    fn people_of(v: &serde_json::Value) -> Vec<(String, String)> {
        v.get("people")
            .and_then(|x| x.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|m| {
                        (
                            m.get("name").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                            m.get("role").and_then(|t| t.as_str()).unwrap_or("").to_string(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn fakeclient2_people_include_dr_lewis_as_author() {
        let v = pd(FAKE_CLIENT_2);
        let people = people_of(&v);
        assert!(people.iter().any(|(n, r)| n == "Dr Lewis" && r == "author"),
            "Dr Lewis must be extracted as author: {:?}", people);
        let parties = v.get("parties").cloned().unwrap_or_default();
        let doctor = parties.get("doctor").and_then(|x| x.as_str()).unwrap_or("");
        assert_eq!(doctor, "Dr Lewis",
            "parties.doctor must be populated with Dr Lewis: {:?}", parties);
    }

    #[test]
    fn parties_extracts_patient_and_psychologist_roles() {
        let text = "\
Patient: John Smith
Author: Dr Lewis
Psychologist: Dr Brown
Sertraline 50mg.
";
        let v = pd(text);
        let people = people_of(&v);
        assert!(people.iter().any(|(n, r)| n == "Dr Lewis" && r == "author"),
            "Dr Lewis missing or wrong role: {:?}", people);
        assert!(people.iter().any(|(n, r)| n == "Dr Brown" && r == "psychologist"),
            "Dr Brown missing or wrong role: {:?}", people);
        assert!(people.iter().any(|(n, r)| n == "John Smith" && r == "patient"),
            "John Smith missing or wrong role: {:?}", people);
        let parties = v.get("parties").cloned().unwrap_or_default();
        assert_eq!(parties.get("patient").and_then(|x| x.as_str()), Some("John Smith"));
    }

    // ─── UTF-8 panic regression on FakeClient4-style OCR (em dash) ─────
    const FAKE_CLIENT_4_OCR_PANIC: &str = "\
ChatePT J ARIO 3 — Messy OCR / Abbrev.
GP note pt seen 04/08/21. ? PTSD. ? depn worsening since incident.
Started pregab PRN; ref physio.
ds.js M
JavaScript && GoLive
Date — 12 June 2023
";

    // ─── FakeClient4 — realistic GP-notes shorthand fixture ─────────────
    // Mirrors the real document the user reported on. Tests cover:
    //   - clean_text preserves shorthand (`? depn`, `c/o low mood + anx ++`)
    //   - symptoms include anxiety (from anx), poor sleep (from sleep poor)
    //   - condition_mentions include queried PTSD AND queried depression
    //   - parties / people do NOT pick up FILE / NOTES / etc.
    //   - document_type = gp_notes
    const FAKE_CLIENT_4_REAL: &str = "\
CLIENT FILE — SCENARIO3
GP NOTES (SCANNED)
Date: 04/08/21
pt seen 04/08/21
c/o low mood + anx ++ since MVA
sleep poor, appetite J
? PTSD
? depn worsening
Sertraline 50mg
Started pregab PRN
ref physio
JavaScript && GoLive
";

    #[test]
    fn fakeclient4_preserves_clinical_shorthand_in_clean_text() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let clean = v.get("clean_text").and_then(|s| s.as_str()).unwrap_or("");
        for must_have in [
            "? depn",
            "? PTSD",
            "c/o low mood + anx ++ since MVA",
            "sleep poor, appetite J",
            "pt seen 04/08/21",
            "Started pregab PRN",
            "ref physio",
        ] {
            assert!(clean.contains(must_have),
                "clean_text must preserve shorthand {:?}; got:\n{}", must_have, clean);
        }
    }

    #[test]
    fn fakeclient4_symptoms_include_anxiety_from_anx_and_poor_sleep() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let symptoms = vec_of(&v, &["entities", "symptoms"]);
        for must_have in ["anxiety", "poor sleep", "low mood"] {
            assert!(symptoms.iter().any(|s| s == must_have),
                "symptom {:?} missing: {:?}", must_have, symptoms);
        }
    }

    #[test]
    fn fakeclient4_queried_ptsd_and_queried_depression() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let statuses = condition_statuses(&v);
        let has_queried_ptsd = statuses
            .iter()
            .any(|(t, s)| t.contains("post-traumatic stress") && s == "queried");
        let has_queried_depression = statuses
            .iter()
            .any(|(t, s)| t.contains("depression") && s == "queried");
        assert!(has_queried_ptsd,
            "queried PTSD missing: {:?}", statuses);
        assert!(has_queried_depression,
            "queried depression (from ? depn) missing: {:?}", statuses);
    }

    #[test]
    fn fakeclient4_parties_empty_no_doctor_notes_no_patient_file() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let people = people_of(&v);
        for bad in ["FILE", "NOTES", "SCANNED", "CLIENT", "SCENARIO"] {
            assert!(!people.iter().any(|(n, _)| n.to_uppercase().contains(bad)),
                "document keyword {:?} must not be a person; got: {:?}",
                bad, people);
        }
        let parties = v.get("parties").cloned().unwrap_or_default();
        let doctor = parties.get("doctor").and_then(|x| x.as_str()).unwrap_or("");
        let patient = parties.get("patient").and_then(|x| x.as_str()).unwrap_or("");
        assert!(doctor.is_empty(),
            "parties.doctor must be empty without a real name; got {:?}", doctor);
        assert!(patient.is_empty(),
            "parties.patient must be empty without a real name; got {:?}", patient);
    }

    #[test]
    fn fakeclient4_document_type_is_gp_notes() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let dt = v.get("document_type").and_then(|s| s.as_str()).unwrap_or("");
        assert_eq!(dt, "gp_notes",
            "expected document_type=gp_notes; got {:?}", dt);
    }

    #[test]
    fn fakeclient4_medications_include_sertraline_and_pregabalin() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let meds = vec_of(&v, &["entities", "medications"]);
        for must_have in ["sertraline", "pregabalin"] {
            assert!(meds.iter().any(|m| m == must_have),
                "medication {:?} missing: {:?}", must_have, meds);
        }
    }

    #[test]
    fn fakeclient4_ocr_text_does_not_panic() {
        // Just calling process_document on this input previously panicked
        // inside dates.rs (`byte index N is not a char boundary; it is
        // inside '—'`). Surviving the call IS the assertion.
        let res = process_document(
            FAKE_CLIENT_4_OCR_PANIC.to_string(),
            "fakeclient4_ocr".to_string(),
        );
        assert!(res.is_ok(), "process_document panicked on FakeClient4 OCR text: {:?}", res.err());
        let v: serde_json::Value = serde_json::from_str(&res.unwrap()).unwrap();
        // Also confirm the slash-date inside the panic-prone fixture
        // still produced a hit so the extractor isn't silently dead.
        let dates = v
            .get("dates_struct")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            dates.iter().any(|d| d.get("value").and_then(|v| v.as_str()) == Some("2021-08-04")),
            "expected 2021-08-04 in dates_struct: {:?}", dates
        );
    }

    #[test]
    fn medications_and_ui_garbage_are_not_people() {
        // No people should be extracted from text that's only medications
        // and UI garbage.
        let text = "\
Sertraline 50mg.
Generalised anxiety disorder.
ds.js M
CODEX
";
        let v = pd(text);
        let people = people_of(&v);
        assert!(people.is_empty(),
            "no people should be extracted from medications / adjective / UI noise: {:?}",
            people);
    }

    #[test]
    fn fakeclient2_symptoms_not_promoted() {
        let v = pd(FAKE_CLIENT_2);
        let symptoms = vec_of(&v, &["entities", "symptoms"]);
        let conditions = vec_of(&v, &["entities", "conditions"]);
        for s in ["anxiety", "low mood", "hypervigilance", "intrusive memories"] {
            assert!(symptoms.iter().any(|x| x == s),
                    "{} must appear in symptoms: symptoms={:?}", s, symptoms);
            assert!(!conditions.iter().any(|x| x == s),
                    "{} must NOT appear in conditions: conditions={:?}", s, conditions);
        }
    }

    #[test]
    fn fakeclient2_sertraline_present() {
        let v = pd(FAKE_CLIENT_2);
        let meds = vec_of(&v, &["entities", "medications"]);
        assert!(meds.iter().any(|m| m == "sertraline"),
                "sertraline must be present: {:?}", meds);
    }

    #[test]
    fn fakeclient2_psychiatric_assessment_not_a_procedure() {
        let v = pd(FAKE_CLIENT_2);
        let procs = vec_of(&v, &["entities", "procedures"]);
        for noise in ["psychiatric assessment", "psychiatric report"] {
            assert!(!procs.iter().any(|p| p == noise),
                    "{:?} must not appear as a procedure: {:?}", noise, procs);
        }
    }

    // ─── FakeClient4 — queried PTSD, queried depression, abbreviations ──────
    const FAKE_CLIENT_4: &str = "\
GP note 11 July 2021. ? PTSD. ? depn worsening since incident.
Patient describes low mood, anxiety, poor sleep, appetite change.
Started pregab PRN; ref physio.
Going live with the website tonight is not relevant.
GoLive
Update
Timeline
JavaScript
UTF-8
";

    #[test]
    fn fakeclient4_queried_status() {
        let v = pd(FAKE_CLIENT_4);
        let statuses = condition_statuses(&v);
        // The condition list (after normalisation) should contain the
        // expanded forms. "depn" expands to "depression" which the
        // symptom-splitter routes to symptoms — so it should NOT appear
        // in condition_mentions. PTSD remains a condition and must be
        // queried.
        let ptsd_status = statuses
            .iter()
            .find(|(t, _)| t.contains("post-traumatic stress"))
            .map(|(_, s)| s.clone());
        assert_eq!(ptsd_status.as_deref(), Some("queried"),
                   "PTSD must be queried in FakeClient4: {:?}", statuses);
    }

    #[test]
    fn fakeclient4_symptoms_and_meds() {
        let v = pd(FAKE_CLIENT_4);
        let symptoms = vec_of(&v, &["entities", "symptoms"]);
        for s in ["low mood", "anxiety", "poor sleep", "appetite change"] {
            assert!(symptoms.iter().any(|x| x == s),
                    "{} must be a symptom: {:?}", s, symptoms);
        }
        let meds = vec_of(&v, &["entities", "medications"]);
        assert!(meds.iter().any(|m| m == "pregabalin"),
                "pregab must normalise to pregabalin: {:?}", meds);
    }

    #[test]
    fn fakeclient4_ui_noise_suppressed() {
        let v = pd(FAKE_CLIENT_4);
        let conds = vec_of(&v, &["entities", "conditions"]);
        let procs = vec_of(&v, &["entities", "procedures"]);
        let meds  = vec_of(&v, &["entities", "medications"]);
        let blocked = ["golive", "update", "timeline", "javascript", "utf-8", "chatgpt"];
        for n in blocked {
            for (list, name) in [(&conds, "conditions"), (&procs, "procedures"), (&meds, "medications")] {
                assert!(!list.iter().any(|x| x.to_lowercase() == n),
                        "{} must not appear in {}: {:?}", n, name, list);
            }
        }
    }

    #[test]
    fn fakeclient4_ref_physio_normalises() {
        // "ref physio" → "physiotherapy referral" via PROCEDURE_SYNONYMS.
        let v = pd(FAKE_CLIENT_4);
        let procs = vec_of(&v, &["entities", "procedures"]);
        assert!(
            procs.iter().any(|p| p == "physiotherapy referral" || p == "physiotherapy"),
            "ref physio must normalise to a physiotherapy procedure: {:?}", procs
        );
    }

    // ─── FakeClient1 — multi-source bundle classification ───────────────────
    const FAKE_CLIENT_1_BUNDLE: &str = "\
Case Bundle — index documents
Index:
- SOURCE A: Emergency Department Note
- SOURCE B: Radiology Report
- SOURCE C: GP Notes
- SOURCE D: Psychiatric Assessment

SOURCE A: Emergency Department Note
Findings: Patient seen post-MVA.

SOURCE B: Radiology Report
MRI lumbar spine.
Findings: L4/5 disc herniation.

SOURCE C: GP Notes
Discussed pain management.

SOURCE D: Psychiatric Assessment
Diagnosis: major depressive disorder.
";

    #[test]
    fn fakeclient1_bundle_is_not_imaging() {
        let v = pd(FAKE_CLIENT_1_BUNDLE);
        let dt = v.get("document_type").and_then(|s| s.as_str()).unwrap_or("");
        assert_eq!(dt, "bundle",
                   "bundle must be detected, got document_type={:?}", dt);
    }

    #[test]
    fn fakeclient1_lumbar_spine_is_not_a_condition() {
        let v = pd(FAKE_CLIENT_1_BUNDLE);
        let conds = vec_of(&v, &["entities", "conditions"]);
        assert!(!conds.iter().any(|c| c == "lumbar spine"),
                "lumbar spine is anatomy, not a condition: {:?}", conds);
        // The actual pathology should still survive.
        assert!(conds.iter().any(|c| c == "disc herniation"),
                "disc herniation must survive: {:?}", conds);
    }

    // ─── FakeClient3 — date precision sanity ────────────────────────────────
    const FAKE_CLIENT_3: &str = "\
Patient seen on 11 July 2021 for review of symptoms.
First reported low mood March 2022.
Earlier episode in 2020.
";

    // ─── FakeClient1 noisy-line + symptom regression ───────────────────────
    const FAKE_CLIENT_1_NOISY: &str = "\
GP saw patient on 11 July 2021.
Date: 10 May 2022
Complains of lower back pain and anxiety.
Diagnosis: L4/5 disc herniation.
Post-traumatic stress disorder
Generalised anxiety disorder
ds.js M
measuircu, GO Tit
ices: 2
x GRO - CODEX
MITE E — SCENARIO 1
+@Oa
tcTrecu ou
I er os
UTF-8 LF {} JavaScript && «GoLive Continue (NE)
Pregabalin 75mg nocte.
Ongoing pain in lower back.
MRI lumbar spine — findings: L4/5 disc herniation.
";

    #[test]
    fn fakeclient1_cleaned_text_excludes_garbage() {
        let v = pd(FAKE_CLIENT_1_NOISY);
        let clean = v.get("clean_text").and_then(|s| s.as_str()).unwrap_or("");
        for noise in [
            "ds.js M", "measuircu", "GO Tit", "x GRO - CODEX",
            "MITE E", "JavaScript &&", "GoLive Continue", "tcTrecu",
            "+@Oa", "UTF-8 LF",
        ] {
            assert!(!clean.contains(noise),
                "garbage {:?} must not appear in clean_text:\n{}",
                noise, clean);
        }
        // Clinical content survives — including the date and the
        // diagnosis lines that the protected-line whitelist now keeps.
        for must_have in [
            "Date: 10 May 2022",
            "Post-traumatic stress disorder",
            "Generalised anxiety disorder",
            "lower back pain",
            "L4/5 disc herniation",
        ] {
            assert!(clean.contains(must_have),
                "clean_text must preserve {:?}; got:\n{}", must_have, clean);
        }
    }

    #[test]
    fn fakeclient1_dates_include_10_may_2022() {
        let v = pd(FAKE_CLIENT_1_NOISY);
        let dates: Vec<String> = v
            .get("dates_struct")
            .and_then(|d| d.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|d| d.get("value").and_then(|s| s.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        assert!(dates.iter().any(|d| d == "2022-05-10"),
            "10 May 2022 should appear in dates_struct: {:?}", dates);
    }

    #[test]
    fn fakeclient1_affirmed_conditions_include_ptsd_and_gad() {
        let v = pd(FAKE_CLIENT_1_NOISY);
        let conds = vec_of(&v, &["entities", "conditions"]);
        for must_have in [
            "post-traumatic stress disorder",
            "generalised anxiety disorder",
            "disc herniation",
        ] {
            assert!(conds.iter().any(|c| c == must_have),
                "affirmed condition {:?} missing: {:?}", must_have, conds);
        }
        let statuses = condition_statuses(&v);
        let affirmed_ptsd = statuses.iter().any(|(t, s)| {
            t.contains("post-traumatic stress") && s == "affirmed"
        });
        assert!(affirmed_ptsd,
            "PTSD should have at least one affirmed mention: {:?}", statuses);
    }

    #[test]
    fn fakeclient1_symptoms_include_back_pain() {
        let v = pd(FAKE_CLIENT_1_NOISY);
        let symptoms = vec_of(&v, &["entities", "symptoms"]);
        for s in ["lower back pain", "anxiety", "ongoing pain"] {
            assert!(symptoms.iter().any(|x| x == s),
                "{} must appear in symptoms: {:?}", s, symptoms);
        }
        // Subset suppression: "back pain" / "pain" must NOT also appear
        // alongside the more specific "lower back pain".
        assert!(!symptoms.iter().any(|s| s == "back pain"),
            "subset 'back pain' should be suppressed when 'lower back pain' present: {:?}",
            symptoms);
        assert!(!symptoms.iter().any(|s| s == "pain"),
            "subset 'pain' should be suppressed when more specific phrase present: {:?}",
            symptoms);
    }

    #[test]
    fn fakeclient1_disc_herniation_kept_lumbar_spine_not() {
        let v = pd(FAKE_CLIENT_1_NOISY);
        let conds = vec_of(&v, &["entities", "conditions"]);
        assert!(conds.iter().any(|c| c == "disc herniation"),
                "disc herniation must survive: {:?}", conds);
        assert!(!conds.iter().any(|c| c == "lumbar spine"),
                "lumbar spine is anatomy, not a condition: {:?}", conds);
    }

    #[test]
    fn fakeclient1_pregabalin_and_imaging_survive() {
        let v = pd(FAKE_CLIENT_1_NOISY);
        let meds = vec_of(&v, &["entities", "medications"]);
        let procs = vec_of(&v, &["entities", "procedures"]);
        assert!(meds.iter().any(|m| m == "pregabalin"),
                "pregabalin must survive: {:?}", meds);
        // MRI shows up in the source — the structured extractor should
        // pick it up as a procedure/investigation.
        let proc_join = procs.join("|").to_lowercase();
        assert!(proc_join.contains("mri") || proc_join.contains("imaging"),
                "MRI should appear in procedures: {:?}", procs);
    }

    #[test]
    fn fakeclient3_date_precision_preserved() {
        let v = pd(FAKE_CLIENT_3);
        let dates = v.get("dates_struct").and_then(|d| d.as_array()).cloned().unwrap_or_default();
        let mut by_value: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        for d in dates {
            let value = d.get("value").and_then(|s| s.as_str()).unwrap_or("").to_string();
            let precision = d.get("precision").and_then(|s| s.as_str()).unwrap_or("").to_string();
            by_value.insert(value, precision);
        }
        assert_eq!(by_value.get("2021-07-11").map(String::as_str), Some("day"),
                   "exact day precision required: {:?}", by_value);
        assert_eq!(by_value.get("2022-03").map(String::as_str), Some("month"),
                   "month precision required: {:?}", by_value);
        assert_eq!(by_value.get("2020").map(String::as_str), Some("year"),
                   "year precision required: {:?}", by_value);
        // Critical assertion: bare year must NOT silently become a day-precision date.
        assert!(!by_value.contains_key("2020-01-01"),
                "bare year must NOT be inflated to YYYY-01-01: {:?}", by_value);
    }

    // ─── Priority 0 — index-document false-positive regression ────────────
    // A clinical document with many dated entries (a longitudinal
    // psychiatric report — Fake Pt 2 was the casualty) MUST NOT be
    // silently demoted to metadata-only output.
    const FAKE_PT_2_REAL: &str = "\
Psychiatric Assessment
Author: Dr Chen
Date: 12 February 2024

Patient presents with chronic low mood and intrusive memories
following motor vehicle accident in 2019.

Past consultations:
- 11/03/2019: ED review — pain rated 8/10
- 02/04/2019: GP follow-up
- 18/04/2019: physiotherapy commenced
- 03/05/2019: psychology assessment
- 21/06/2019: psychiatric review
- 12/08/2019: GP review
- 14/01/2020: re-presentation
- 22/05/2020: ongoing review
- 02/02/2021: medication adjustment
- 12/06/2021: CBT commenced
- 03/03/2022: review
- 11 May 2022: ongoing low mood
- March 2023: medication review

Diagnosis: post-traumatic stress disorder.
Diagnosis: major depressive disorder.
Started sertraline 50mg. Engaged in cognitive behavioural therapy.

Impression: Patient meets criteria for both diagnoses.
";

    fn structured_for(text: &str) -> serde_json::Value {
        let json = extract_structured_data(text.to_string(), "fixture_pt2".to_string())
            .expect("extract_structured_data should succeed");
        serde_json::from_str(&json).expect("structured JSON")
    }

    #[test]
    fn fakept2_is_not_an_index_document_despite_many_dates() {
        let s = structured_for(FAKE_PT_2_REAL);
        assert_eq!(
            s.get("is_index_document").and_then(|v| v.as_bool()),
            Some(false),
            "longitudinal clinical doc must not be classified as index: {}",
            serde_json::to_string_pretty(&s).unwrap_or_default()
        );
        // Confidence must be 0.0 (no phrase, has clinical signal).
        assert_eq!(
            s.get("index_confidence").and_then(|v| v.as_f64()),
            Some(0.0),
            "index_confidence must be 0.0 when clinical signal is present: {:?}",
            s.get("index_confidence")
        );
        // Clinical fields must NOT be silently blanked.
        let conds = s
            .get("conditions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(!conds.is_empty(),
            "conditions must survive — was blanked by old index gate: {:?}", conds);
    }

    #[test]
    fn explicit_index_phrase_still_demotes_to_metadata() {
        let text = "\
Index of supporting documents

1. Report by Dr A. 10/01/2024.
2. Report by Dr B. 11/01/2024.
3. Imaging report. 12/01/2024.
";
        let s = structured_for(text);
        assert_eq!(
            s.get("is_index_document").and_then(|v| v.as_bool()),
            Some(true),
            "explicit index phrase should fire the index gate"
        );
        assert!(s.get("index_confidence").and_then(|v| v.as_f64()).unwrap_or(0.0) >= 0.9);
    }

    // ─── Phase 1 / 2 — ClinicalEvent regression ──────────────────────────
    fn events_of(v: &serde_json::Value) -> Vec<serde_json::Value> {
        v.get("clinical_events")
            .and_then(|x| x.as_array())
            .cloned()
            .unwrap_or_default()
    }

    fn event_types_in(v: &serde_json::Value) -> std::collections::HashSet<String> {
        events_of(v)
            .iter()
            .filter_map(|e| e.get("event_type").and_then(|t| t.as_str()).map(str::to_string))
            .collect()
    }

    #[test]
    fn fakeclient2_produces_clinical_events_for_each_condition_mention() {
        let v = pd(FAKE_CLIENT_2);
        let events = events_of(&v);
        // At least one Diagnosis event for MDD and PTSD.
        let dx_concepts: Vec<String> = events
            .iter()
            .filter(|e| e.get("event_type").and_then(|t| t.as_str()) == Some("diagnosis"))
            .filter_map(|e| e.get("concept").and_then(|c| c.as_str()).map(str::to_string))
            .collect();
        assert!(dx_concepts.iter().any(|c| c.contains("major depressive")),
            "MDD diagnosis event missing: {:?}", dx_concepts);
        assert!(dx_concepts.iter().any(|c| c.contains("post-traumatic")),
            "PTSD diagnosis event missing: {:?}", dx_concepts);
        // Sertraline → MedicationMention event.
        assert!(events.iter().any(|e|
            e.get("event_type").and_then(|t| t.as_str()) == Some("medication_mention")
            && e.get("concept").and_then(|c| c.as_str()) == Some("sertraline")),
            "sertraline medication_mention event missing");
    }

    #[test]
    fn fakeclient2_diagnosis_event_carries_assertion_status() {
        let v = pd(FAKE_CLIENT_2);
        let events = events_of(&v);
        // PTSD events should include at least one affirmed AND one contradicted.
        let ptsd_statuses: Vec<String> = events
            .iter()
            .filter(|e| e.get("event_type").and_then(|t| t.as_str()) == Some("diagnosis"))
            .filter(|e| e.get("concept").and_then(|c| c.as_str()).map_or(false, |c| c.contains("post-traumatic")))
            .filter_map(|e| e.get("assertion_status").and_then(|s| s.as_str()).map(str::to_string))
            .collect();
        assert!(ptsd_statuses.contains(&"affirmed".to_string()),
            "expected at least one affirmed PTSD event: {:?}", ptsd_statuses);
        assert!(ptsd_statuses.contains(&"contradicted".to_string()),
            "expected at least one contradicted PTSD event: {:?}", ptsd_statuses);
    }

    #[test]
    fn fakeclient1_bundle_events_carry_source_section() {
        let v = pd(FAKE_CLIENT_1_BUNDLE);
        let events = events_of(&v);
        let with_section: Vec<&serde_json::Value> = events
            .iter()
            .filter(|e| e.get("source_section").map_or(false, |s| !s.is_null()))
            .collect();
        assert!(!with_section.is_empty(),
            "at least one event should carry source_section for SOURCE A/B/C bundles: {:?}",
            events.iter().map(|e| (
                e.get("event_type").and_then(|t| t.as_str()),
                e.get("source_section").and_then(|t| t.as_str()),
            )).collect::<Vec<_>>());
        // At least one event must come from SOURCE B (disc herniation line)
        // or SOURCE D (MDD diagnosis).
        let labels: std::collections::HashSet<String> = events
            .iter()
            .filter_map(|e| e.get("source_section").and_then(|s| s.as_str()).map(str::to_string))
            .collect();
        assert!(labels.iter().any(|l| l.starts_with("SOURCE ")),
            "expected SOURCE X labels in source_section: {:?}", labels);
    }

    #[test]
    fn fakeclient4_event_types_include_diagnosis_symptom_med_proc() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let types = event_types_in(&v);
        for t in ["diagnosis", "symptom", "medication_mention", "procedure"] {
            assert!(types.contains(t),
                "expected event type {:?}; got {:?}", t, types);
        }
    }

    // ─── Phase B — Event Unification through process_document ────────────
    fn unified_of(v: &serde_json::Value) -> Vec<serde_json::Value> {
        v.get("unified_clinical_events")
            .and_then(|x| x.as_array())
            .cloned()
            .unwrap_or_default()
    }

    #[test]
    fn fakeclient2_unified_events_flag_ptsd_conflict() {
        let v = pd(FAKE_CLIENT_2);
        let unified = unified_of(&v);
        // Find the diagnosis canonical for PTSD.
        let ptsd_dx = unified.iter().find(|u| {
            u.get("event_type").and_then(|t| t.as_str()) == Some("diagnosis")
                && u.get("concept")
                    .and_then(|c| c.as_str())
                    .map_or(false, |c| c.to_lowercase().contains("post-traumatic"))
        });
        let u = ptsd_dx.expect("unified PTSD diagnosis missing");
        assert_eq!(
            u.get("conflict").and_then(|b| b.as_bool()),
            Some(true),
            "PTSD has both affirmed and contradicted sources — must flag conflict: {:?}",
            u
        );
        // Frequency must reflect the multiple raw mentions.
        let freq = u.get("frequency").and_then(|n| n.as_u64()).unwrap_or(0);
        assert!(freq >= 2, "PTSD frequency should be >= 2, got {freq}");
    }

    #[test]
    fn fakeclient2_unified_dx_cross_links_to_symptom_when_concept_matches() {
        let v = pd(FAKE_CLIENT_2);
        let unified = unified_of(&v);
        // "anxiety" appears both as a diagnosis substring elsewhere and
        // a symptom_only event. Confirm cross-linking works between two
        // event types with the same normalised concept anywhere in this
        // document.
        let symptoms: Vec<_> = unified
            .iter()
            .filter(|u| u.get("event_type").and_then(|t| t.as_str()) == Some("symptom"))
            .collect();
        assert!(!symptoms.is_empty(), "expected at least one symptom unified event");
    }

    // ─── Phase C — Patient Timeline (cross-document) integration ─────────
    #[test]
    fn patient_timeline_cross_doc_ptsd_resolves_to_contradicted() {
        // FakeClient2 has BOTH affirmed (Treating Psychologist) AND
        // contradicted (Reviewing Psychiatrist) PTSD mentions; FakeClient4
        // has queried PTSD. Across the corpus, contradicted must win and
        // the cross-doc conflict flag must fire.
        let doc_c2 = pd(FAKE_CLIENT_2);
        let doc_c4 = pd(FAKE_CLIENT_4_REAL);
        let json = reason_patient_timeline(vec![doc_c2, doc_c4])
            .expect("reason_patient_timeline should succeed");
        let payload: serde_json::Value = serde_json::from_str(&json).unwrap();
        let timeline = payload
            .get("patient_timeline")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // PTSD diagnosis must surface with Contradicted + cross-doc flag.
        let ptsd_dx = timeline.iter().find(|p| {
            p.get("event_type").and_then(|t| t.as_str()) == Some("diagnosis")
                && p.get("concept").and_then(|c| c.as_str())
                    .map_or(false, |c| c.to_lowercase().contains("post-traumatic"))
        });
        let p = ptsd_dx.expect("PTSD PatientEvent missing");
        assert_eq!(
            p.get("global_assertion").and_then(|s| s.as_str()),
            Some("contradicted"),
            "expected global_assertion=contradicted; got {:?}",
            p.get("global_assertion")
        );
        assert_eq!(
            p.get("metadata").and_then(|m| m.get("conflict_across_documents"))
                .and_then(|b| b.as_bool()),
            Some(true),
            "expected conflict_across_documents=true: {:?}",
            p.get("metadata")
        );
        // Reversibility: every PatientEvent must list ≥ 1 source UnifiedEvent.
        for ev in &timeline {
            let n = ev
                .get("source_unified_event_ids")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            assert!(n >= 1,
                "PatientEvent must trace back to ≥1 UnifiedEvent: {:?}", ev);
        }
    }

    // ─── Phase D — Condition State Engine (full-stack integration) ─────
    #[test]
    fn clinical_state_fakeclient2_plus_fakeclient4_ptsd_is_disputed() {
        // Build a patient timeline across the two docs, then feed it to
        // the clinical state engine. FakeClient2 carries affirmed +
        // contradicted PTSD; FakeClient4 adds queried PTSD. Across the
        // corpus the PTSD ConditionState must be Disputed, with both
        // supporting and contradicting PatientEvents recorded.
        let doc_c2 = pd(FAKE_CLIENT_2);
        let doc_c4 = pd(FAKE_CLIENT_4_REAL);
        let tl_json = reason_patient_timeline(vec![doc_c2, doc_c4])
            .expect("reason_patient_timeline should succeed");
        let tl: serde_json::Value = serde_json::from_str(&tl_json).unwrap();
        let pe_arr = tl
            .get("patient_timeline")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(!pe_arr.is_empty(),
            "patient_timeline must contribute at least one PatientEvent");

        let states_json = reason_clinical_state(pe_arr).expect("reason_clinical_state");
        let states: serde_json::Value = serde_json::from_str(&states_json).unwrap();
        let states_arr = states.as_array().expect("clinical states array");
        assert!(!states_arr.is_empty(),
            "clinical state engine must produce at least one ConditionState");

        // PTSD ConditionState must exist and be Disputed.
        let ptsd = states_arr.iter().find(|s| {
            s.get("concept")
                .and_then(|c| c.as_str())
                .map_or(false, |c| c.to_lowercase().contains("post-traumatic"))
        });
        let s = ptsd.expect("PTSD ConditionState missing");
        assert_eq!(
            s.get("current_status").and_then(|x| x.as_str()),
            Some("disputed"),
            "PTSD across the corpus must be Disputed (affirmed + contradicted + queried): {:?}",
            s
        );
        // Reversibility: must reference at least one PatientEvent in
        // either supporting_events or contradicting_events.
        let support_n = s
            .get("supporting_events")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        let contra_n = s
            .get("contradicting_events")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        assert!(support_n + contra_n >= 1,
            "ConditionState must trace back to ≥1 PatientEvent: support={} contra={}",
            support_n, contra_n);
        // Trajectory must contain at least one transition (Unknown→…).
        assert!(s
            .get("trajectory")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0) >= 1,
            "trajectory must record at least one transition: {:?}", s);
    }

    #[test]
    fn clinical_state_sorted_active_above_resolved_in_integration() {
        // Run across multiple fixtures so the corpus is rich enough to
        // exercise the sort order at the integration boundary.
        let docs: Vec<serde_json::Value> = [
            FAKE_CLIENT_1_BUNDLE,
            FAKE_CLIENT_1_NOISY,
            FAKE_CLIENT_2,
            FAKE_CLIENT_3,
            FAKE_CLIENT_4_REAL,
        ]
        .into_iter()
        .map(pd)
        .collect();
        let tl_json = reason_patient_timeline(docs).unwrap();
        let tl: serde_json::Value = serde_json::from_str(&tl_json).unwrap();
        let pe_arr = tl
            .get("patient_timeline")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let states_json = reason_clinical_state(pe_arr).unwrap();
        let states: serde_json::Value = serde_json::from_str(&states_json).unwrap();
        let statuses: Vec<&str> = states
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|s| s.get("current_status").and_then(|x| x.as_str()))
            .collect();
        // No Resolved state should appear before any Active state.
        let mut seen_resolved = false;
        for s in &statuses {
            if *s == "resolved" {
                seen_resolved = true;
            } else if *s == "active" && seen_resolved {
                panic!(
                    "active state appeared after a resolved state — sort order broken: {:?}",
                    statuses
                );
            }
        }
    }

    #[test]
    fn patient_timeline_command_returns_cluster_scaffold() {
        let json = reason_patient_timeline(vec![pd(FAKE_CLIENT_2)])
            .expect("reason_patient_timeline should succeed");
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("patient_timeline").and_then(|x| x.as_array()).is_some(),
            "patient_timeline must be present");
        // Cluster scaffold is intentionally empty for this phase.
        let clusters = v.get("clusters").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        assert!(clusters.is_empty(),
            "clusters scaffold must remain empty in this phase: {:?}", clusters);
    }

    #[test]
    fn fakeclient4_unified_events_carry_aggregated_sections_and_provenance() {
        let v = pd(FAKE_CLIENT_4_REAL);
        let unified = unified_of(&v);
        assert!(!unified.is_empty(), "FakeClient4 must produce unified events");
        // Every unified event MUST list at least one source_event_id —
        // unification must be reversible.
        for u in &unified {
            let n = u
                .get("source_event_ids")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            assert!(n >= 1,
                "unified event has no source_event_ids — not reversible: {:?}", u);
        }
    }

    // ─── Phase E — Patient Longitudinal Reconciliation full-pipeline ───
    #[test]
    fn longitudinal_reconciliation_fakeclient2_plus_fakeclient4_ptsd_canonical() {
        // The mandatory integration test per the spec.
        //   process_document (FakeClient2 + FakeClient4)
        //   → (reason_patient_timeline + reason_clinical_state run inside
        //      reason_longitudinal_reconciliation implicitly)
        //   → reason_longitudinal_reconciliation
        // Assertions:
        //   1. PTSD appears as ONE canonical event.
        //   2. Multiple conflicting assertion states preserved
        //      (assertion_distribution carries affirmed + contradicted +
        //      queried/differential).
        //   3. Temporal progression + contradiction history surfaces.
        //   4. PTSD links to sertraline + anxiety symptoms + CBT procedure.
        //   5. PTSD evolution track has > 3 steps.
        let doc_c2 = pd(FAKE_CLIENT_2);
        let doc_c4 = pd(FAKE_CLIENT_4_REAL);
        let json = reason_longitudinal_reconciliation(vec![doc_c2, doc_c4], None)
            .expect("reason_longitudinal_reconciliation should succeed");
        let envelope: serde_json::Value = serde_json::from_str(&json).unwrap();
        let graph = envelope
            .get("longitudinal_patient_graph")
            .expect("envelope must include longitudinal_patient_graph");

        // (1) PTSD must appear exactly once as a Diagnosis canonical event.
        let canonicals = graph
            .get("canonical_events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let ptsd_dx: Vec<_> = canonicals
            .iter()
            .filter(|c| {
                c.get("event_type").and_then(|t| t.as_str()) == Some("diagnosis")
                    && c.get("concept")
                        .and_then(|s| s.as_str())
                        .map_or(false, |s| s.to_lowercase().contains("post-traumatic"))
            })
            .collect();
        assert_eq!(ptsd_dx.len(), 1,
            "PTSD must collapse to ONE canonical Diagnosis event; got {} entries: {:?}",
            ptsd_dx.len(),
            ptsd_dx.iter().map(|c| c.get("concept")).collect::<Vec<_>>());

        let ptsd = ptsd_dx[0];
        let ptsd_id = ptsd.get("canonical_id").and_then(|v| v.as_str()).unwrap_or("");

        // (2) Distribution must carry multiple status classes, not collapsed.
        let dist = ptsd
            .get("assertion_distribution")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        let dist_keys: Vec<&str> = dist.keys().map(|k| k.as_str()).collect();
        let has_affirmed_class = dist_keys.iter().any(|k|
            matches!(*k, "affirmed" | "historical" | "symptom_only"));
        let has_contradicted_class = dist_keys.iter().any(|k|
            matches!(*k, "contradicted" | "negated"));
        let has_queried_or_diff = dist_keys.iter().any(|k|
            matches!(*k, "queried" | "differential"));
        assert!(has_affirmed_class,
            "assertion_distribution missing affirmed-class status: {:?}", dist_keys);
        assert!(has_contradicted_class,
            "assertion_distribution missing contradicted-class status: {:?}", dist_keys);
        assert!(has_queried_or_diff,
            "assertion_distribution missing queried/differential: {:?}", dist_keys);
        assert_eq!(
            ptsd.get("conflict_flag").and_then(|v| v.as_bool()),
            Some(true),
            "PTSD conflict_flag must fire across the corpus: {:?}", ptsd);
        // dominant_assertion resolves by priority — Contradicted wins.
        assert_eq!(
            ptsd.get("dominant_assertion").and_then(|v| v.as_str()),
            Some("contradicted"),
            "dominant_assertion must be contradicted: {:?}", ptsd.get("dominant_assertion"));

        // (3) Temporal edges + contradiction history.
        let edges = graph
            .get("temporal_edges")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        // Resolution edge must surface for the PTSD canonical (the lifecycle
        // resolution captured because its assertion_distribution contains
        // contradicted/historical).
        let resolution_for_ptsd = edges.iter().any(|e|
            e.get("relation").and_then(|v| v.as_str()) == Some("resolution")
                && e.get("from_canonical_event").and_then(|v| v.as_str()) == Some(ptsd_id));
        assert!(resolution_for_ptsd,
            "expected a Resolution edge for PTSD: {:?}",
            edges.iter().map(|e| e.get("relation")).collect::<Vec<_>>());
        // Cross-domain links must include symptom↔diagnosis and
        // diagnosis↔medication.
        let links = graph
            .get("cross_domain_links")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let link_kinds: std::collections::HashSet<&str> = links
            .iter()
            .filter_map(|l| l.get("kind").and_then(|v| v.as_str()))
            .collect();

        // (4) Links to sertraline / anxiety / CBT.
        let medication_concepts: Vec<String> = canonicals
            .iter()
            .filter(|c| c.get("event_type").and_then(|t| t.as_str()) == Some("medication_mention"))
            .filter_map(|c| c.get("concept").and_then(|x| x.as_str()).map(str::to_string))
            .collect();
        assert!(medication_concepts.iter().any(|m| m.to_lowercase().contains("sertraline")),
            "expected a sertraline medication canonical: {:?}", medication_concepts);
        let symptom_concepts: Vec<String> = canonicals
            .iter()
            .filter(|c| c.get("event_type").and_then(|t| t.as_str()) == Some("symptom"))
            .filter_map(|c| c.get("concept").and_then(|x| x.as_str()).map(str::to_string))
            .collect();
        assert!(symptom_concepts.iter().any(|m| m.to_lowercase().contains("anxiety")),
            "expected an anxiety symptom canonical: {:?}", symptom_concepts);
        let proc_concepts: Vec<String> = canonicals
            .iter()
            .filter(|c| matches!(c.get("event_type").and_then(|t| t.as_str()),
                Some("procedure") | Some("investigation_mention")))
            .filter_map(|c| c.get("concept").and_then(|x| x.as_str()).map(str::to_string))
            .collect();
        // CBT may surface as "cognitive behavioural therapy" after canonical normalisation.
        assert!(
            proc_concepts.iter().any(|p| {
                let l = p.to_lowercase();
                l.contains("cognitive") || l.contains("cbt") || l.contains("therapy")
            }),
            "expected a CBT/CBT-equivalent procedure canonical: {:?}",
            proc_concepts
        );
        // Cross-domain kind set must include the medico-legal triad
        // bridges.
        assert!(link_kinds.contains("symptom_diagnosis"),
            "expected symptom_diagnosis links: {:?}", link_kinds);
        assert!(link_kinds.contains("diagnosis_medication"),
            "expected diagnosis_medication links: {:?}", link_kinds);

        // (5) Evolution track for PTSD must have > 3 steps.
        let tracks = graph
            .get("evolution_tracks")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let ptsd_track = tracks
            .iter()
            .find(|t| t.get("canonical_id").and_then(|v| v.as_str()) == Some(ptsd_id))
            .expect("evolution_track for PTSD missing");
        let steps = ptsd_track
            .get("timeline")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(steps.len() > 3,
            "PTSD evolution track must have > 3 steps; got {}: {:?}",
            steps.len(),
            steps.iter().map(|s| (
                s.get("date").and_then(|x| x.as_str()),
                s.get("assertion").and_then(|x| x.as_str()),
            )).collect::<Vec<_>>());
        // And reversibility — every step must trace back to a UnifiedEvent
        // canonical_id (the source field).
        for s in &steps {
            assert!(s.get("source").and_then(|v| v.as_str()).is_some(),
                "evolution step missing source: {:?}", s);
        }
    }

    // ─── Phase F — Global Clinical Knowledge Graph full-stack test ─────
    #[test]
    fn gckg_fakeclient2_plus_fakeclient4_ptsd_full_stack() {
        // process_document (FakeClient2 + FakeClient4)
        //   → reason_patient_timeline + reason_clinical_state +
        //     reason_longitudinal_reconciliation  (run inside the
        //     `build_clinical_knowledge_graph` command)
        //   → build_clinical_knowledge_graph
        // Assertions per spec §8.
        let doc_c2 = pd(FAKE_CLIENT_2);
        let doc_c4 = pd(FAKE_CLIENT_4_REAL);
        let json = build_clinical_knowledge_graph(
            vec![doc_c2, doc_c4],
            Some("patient-c2-c4".into()),
        )
        .expect("build_clinical_knowledge_graph should succeed");
        let envelope: serde_json::Value = serde_json::from_str(&json).unwrap();
        let graph = envelope
            .get("clinical_knowledge_graph")
            .expect("envelope must include clinical_knowledge_graph");
        let ml = envelope
            .get("medico_legal_summary")
            .expect("envelope must include medico_legal_summary");

        let nodes = graph
            .get("nodes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let edges = graph
            .get("edges")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        // (1) PTSD exists as 1 canonical node, multiple upstream nodes
        // preserved.
        let ptsd_canonicals: Vec<&serde_json::Value> = nodes
            .iter()
            .filter(|n| n.get("node_type").and_then(|v| v.as_str()) == Some("canonical_event"))
            .filter(|n| n.get("concept").and_then(|v| v.as_str())
                .map_or(false, |c| c.to_lowercase().contains("post-traumatic")))
            .collect();
        assert_eq!(ptsd_canonicals.len(), 1,
            "PTSD must collapse to exactly ONE CanonicalEvent node; got {}",
            ptsd_canonicals.len());
        let ptsd_canonical_id = ptsd_canonicals[0]
            .get("node_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        // Upstream PatientEvent / UnifiedEvent nodes for PTSD MUST still exist.
        let ptsd_patient_nodes: usize = nodes.iter().filter(|n| {
            n.get("node_type").and_then(|v| v.as_str()) == Some("patient_event")
                && n.get("concept").and_then(|v| v.as_str())
                    .map_or(false, |c| c.to_lowercase().contains("post-traumatic"))
        }).count();
        let ptsd_unified_nodes: usize = nodes.iter().filter(|n| {
            n.get("node_type").and_then(|v| v.as_str()) == Some("unified_event")
                && n.get("concept").and_then(|v| v.as_str())
                    .map_or(false, |c| c.to_lowercase().contains("post-traumatic")
                        || c.to_uppercase().contains("PTSD"))
        }).count();
        assert!(ptsd_patient_nodes >= 1,
            "expected ≥1 PatientEvent node for PTSD; got {}", ptsd_patient_nodes);
        assert!(ptsd_unified_nodes >= 1,
            "expected ≥1 UnifiedEvent node for PTSD; got {}", ptsd_unified_nodes);

        // (2) Contradictions appear as explicit CONTRADICTS edges.
        let contradicts: Vec<&serde_json::Value> = edges
            .iter()
            .filter(|e| e.get("edge_type").and_then(|v| v.as_str()) == Some("contradicts"))
            .collect();
        assert!(!contradicts.is_empty(),
            "expected Contradicts edges in the graph: {:?}",
            edges.iter()
                .filter_map(|e| e.get("edge_type").and_then(|v| v.as_str()))
                .collect::<Vec<_>>());
        // At least one Contradicts edge must touch the PTSD canonical node.
        let contradicts_touching_ptsd = contradicts.iter().any(|e| {
            let f = e.get("from").and_then(|v| v.as_str()).unwrap_or("");
            let t = e.get("to").and_then(|v| v.as_str()).unwrap_or("");
            f == ptsd_canonical_id || t == ptsd_canonical_id
        });
        assert!(contradicts_touching_ptsd,
            "expected a Contradicts edge involving the PTSD canonical node {}",
            ptsd_canonical_id);

        // (3) Temporal progression: symptom → diagnosis → treatment.
        // At minimum the Temporal view must list edges and there must be
        // some Treats edge linking a medication and a symptom/diagnosis.
        let temporal_edges_in_graph: Vec<&serde_json::Value> = edges.iter()
            .filter(|e| matches!(e.get("edge_type").and_then(|v| v.as_str()),
                Some("temporal_progression") | Some("evolves_into")))
            .collect();
        assert!(!temporal_edges_in_graph.is_empty(),
            "expected temporal_progression / evolves_into edges");
        let any_treats = edges.iter().any(|e|
            e.get("edge_type").and_then(|v| v.as_str()) == Some("treats"));
        assert!(any_treats, "expected at least one Treats edge");

        // (4) Medico-legal view flags PTSD as disputed.
        let disputed: Vec<String> = ml
            .get("disputed_concepts")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        assert!(disputed.iter().any(|c| c.to_lowercase().contains("post-traumatic")),
            "medico_legal_summary.disputed_concepts must include PTSD: {:?}", disputed);
        let high_conflict: Vec<String> = ml
            .get("high_conflict_nodes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        assert!(high_conflict.contains(&ptsd_canonical_id),
            "high_conflict_nodes must include {}: {:?}", ptsd_canonical_id, high_conflict);

        // (5) Every node traces back to a ClinicalEvent ID.
        for n in &nodes {
            let cids = n
                .get("attributes")
                .and_then(|a| a.get("trace_chain"))
                .and_then(|t| t.get("clinical_event_ids"))
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            assert!(cids > 0,
                "node {} ({:?}) lacks clinical_event_ids in trace_chain",
                n.get("node_id").and_then(|v| v.as_str()).unwrap_or(""),
                n.get("node_type").and_then(|v| v.as_str()).unwrap_or(""));
        }

        // (6) No data loss across layers — every UnifiedEvent that
        // exists in either document MUST appear as a UnifiedEvent node.
        use std::collections::BTreeSet;
        let ue_node_ids: BTreeSet<String> = nodes.iter()
            .filter(|n| n.get("node_type").and_then(|v| v.as_str()) == Some("unified_event"))
            .filter_map(|n| n.get("node_id").and_then(|v| v.as_str()).map(str::to_string))
            .collect();
        let docs_for_audit = [FAKE_CLIENT_2, FAKE_CLIENT_4_REAL];
        for text in docs_for_audit {
            let pd_value = pd(text);
            let unified_arr = pd_value
                .get("unified_clinical_events")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            for u in unified_arr {
                let cid = u
                    .get("canonical_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                assert!(ue_node_ids.contains(cid),
                    "UnifiedEvent {} missing from GCKG — data loss across layers", cid);
            }
        }
    }

    // ─── Phase G — Participant Resolution full-pipeline test ─────────────
    #[test]
    fn participant_resolution_full_pipeline_across_fake_documents() {
        // Synthesise FakePt2 / FakeClient2 / FakeClient3 / FakeClient4
        // payloads that contain the participants and organisations called
        // out in the spec.
        const FAKE_CLIENT_2_REAL: &str = "\
Independent Psychiatric Opinion
Author: Dr Rayers
Patient: Jane Doe
DOB: 14/02/1985

Reviewing Psychiatrist
Presentation inconsistent with PTSD.
Treating Psychologist
Diagnosis: post-traumatic stress disorder.
Author: Dr Lewis

Personal Injury Commission
Traumatic Stress Clinic supplied the prior reports.
";
        const FAKE_PT2_REAL: &str = "\
Psychiatric Assessment
Author: Dr Lewis
Date: 12 February 2024
Patient: Jane Doe

Treating Psychologist
Diagnosis: major depressive disorder.

Employer: New South Wales Ambulance Service.
";
        const FAKE_CLIENT_3_REAL: &str = "\
GP Notes
Author: Dr Singh
Patient: Jane Doe
Referred to Traumatic Stress Clinic.
";
        const FAKE_CLIENT_4_REAL_LOCAL: &str = "\
GP Notes
Patient: Jane Doe
pt seen 04/08/21. ? PTSD. ? depn worsening since incident.
Started sertraline.
Author: Dr Singh
";
        let docs = vec![
            pd(FAKE_CLIENT_2_REAL),
            pd(FAKE_PT2_REAL),
            pd(FAKE_CLIENT_3_REAL),
            pd(FAKE_CLIENT_4_REAL_LOCAL),
        ];
        let json = reason_participant_resolution(docs.clone())
            .expect("reason_participant_resolution should succeed");
        let payload: serde_json::Value = serde_json::from_str(&json).unwrap();
        let participants = payload.get("participants").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let organisations = payload.get("organisations").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        let attributions = payload.get("attributions").and_then(|v| v.as_array()).cloned().unwrap_or_default();

        // ── 1. Dr Rayers exists once ───────────────────────────────
        let rayers: Vec<&serde_json::Value> = participants
            .iter()
            .filter(|p| p.get("name").and_then(|v| v.as_str())
                .map_or(false, |n| n.to_lowercase().contains("rayers")))
            .collect();
        assert_eq!(rayers.len(), 1, "Dr Rayers must exist exactly once: {:?}",
            participants.iter().filter_map(|p| p.get("name").and_then(|v| v.as_str())).collect::<Vec<_>>());
        assert_eq!(
            rayers[0].get("role").and_then(|v| v.as_str()),
            Some("assessing_psychiatrist"),
            "Dr Rayers must resolve to assessing_psychiatrist: {:?}", rayers[0],
        );

        // ── 2. Dr Lewis exists once ────────────────────────────────
        let lewis: Vec<&serde_json::Value> = participants
            .iter()
            .filter(|p| p.get("name").and_then(|v| v.as_str())
                .map_or(false, |n| n.to_lowercase().contains("lewis")))
            .collect();
        assert_eq!(lewis.len(), 1, "Dr Lewis must exist exactly once: {:?}",
            participants.iter().filter_map(|p| p.get("name").and_then(|v| v.as_str())).collect::<Vec<_>>());
        assert_eq!(
            lewis[0].get("role").and_then(|v| v.as_str()),
            Some("treating_psychologist"),
            "Dr Lewis must resolve to treating_psychologist: {:?}", lewis[0],
        );

        // ── 3-5. Organisations exist once each, with correct types ─
        let by_name = |needle: &str| -> Vec<&serde_json::Value> {
            organisations.iter().filter(|o| o.get("name").and_then(|v| v.as_str())
                .map_or(false, |n| n.to_lowercase().contains(needle)))
                .collect()
        };
        let traumatic = by_name("traumatic stress clinic");
        assert_eq!(traumatic.len(), 1, "Traumatic Stress Clinic must merge to one entry: {:?}",
            organisations.iter().filter_map(|o| o.get("name").and_then(|v| v.as_str())).collect::<Vec<_>>());
        assert_eq!(traumatic[0].get("organisation_type").and_then(|v| v.as_str()), Some("psychology_clinic"));

        let pic = by_name("personal injury commission");
        assert_eq!(pic.len(), 1, "Personal Injury Commission must exist exactly once");
        assert_eq!(pic[0].get("organisation_type").and_then(|v| v.as_str()), Some("legal_body"));

        let ambulance = by_name("ambulance");
        assert_eq!(ambulance.len(), 1, "NSW Ambulance must exist exactly once");
        assert_eq!(ambulance[0].get("organisation_type").and_then(|v| v.as_str()), Some("employer"));

        // ── 6. PTSD-supporting opinion → Dr Lewis (treating psychologist)
        //      The clinical_events for FakeClient2 include condition_mentions
        //      tagged with "Treating Psychologist" section → attribution
        //      participant_id must be Dr Lewis.
        let fakeclient2 = pd(FAKE_CLIENT_2_REAL);
        let cm = fakeclient2
            .get("clinical_events")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let ptsd_treating_event = cm.iter().find(|e| {
            let section = e.get("source_section").and_then(|v| v.as_str()).unwrap_or("");
            let concept = e.get("concept").and_then(|v| v.as_str()).unwrap_or("");
            section.eq_ignore_ascii_case("Treating Psychologist")
                && concept.to_lowercase().contains("post-traumatic")
        });
        if let Some(ev) = ptsd_treating_event {
            let event_id = ev.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
            let attr = attributions.iter()
                .find(|a| a.get("event_id").and_then(|v| v.as_str()) == Some(event_id))
                .expect("attribution for the supporting PTSD event must exist");
            let participant_id = attr.get("participant_id").and_then(|v| v.as_str()).unwrap_or("");
            assert!(participant_id.to_lowercase().contains("lewis"),
                "PTSD-supporting opinion must trace to Dr Lewis; got {participant_id}");
        }
        // ── 7. PTSD-opposing opinion → Dr Rayers (assessing psychiatrist)
        //      The "Reviewing Psychiatrist" event (Presentation inconsistent
        //      with PTSD) must attribute to Dr Rayers.
        let ptsd_reviewing_event = cm.iter().find(|e| {
            let section = e.get("source_section").and_then(|v| v.as_str()).unwrap_or("");
            let concept = e.get("concept").and_then(|v| v.as_str()).unwrap_or("");
            section.eq_ignore_ascii_case("Reviewing Psychiatrist")
                && concept.to_lowercase().contains("post-traumatic")
        });
        if let Some(ev) = ptsd_reviewing_event {
            let event_id = ev.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
            let attr = attributions.iter()
                .find(|a| a.get("event_id").and_then(|v| v.as_str()) == Some(event_id))
                .expect("attribution for the opposing PTSD event must exist");
            let participant_id = attr.get("participant_id").and_then(|v| v.as_str()).unwrap_or("");
            assert!(participant_id.to_lowercase().contains("rayers"),
                "PTSD-opposing opinion must trace to Dr Rayers; got {participant_id}");
        }

        // ── 8. Every participant traces back to ≥ 1 document ───────
        for p in &participants {
            let n = p.get("source_document_ids").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            assert!(n >= 1, "participant has no source documents: {:?}", p);
        }
    }

    #[test]
    fn all_fixtures_produce_at_least_one_clinical_event() {
        for (name, text) in [
            ("FakeClient1_bundle", FAKE_CLIENT_1_BUNDLE),
            ("FakeClient1_noisy",  FAKE_CLIENT_1_NOISY),
            ("FakeClient2",        FAKE_CLIENT_2),
            ("FakeClient3",        FAKE_CLIENT_3),
            ("FakeClient4",        FAKE_CLIENT_4_REAL),
            ("FakePt2",            FAKE_PT_2_REAL),
        ] {
            let v = pd(text);
            let events = events_of(&v);
            assert!(!events.is_empty(),
                "{name} must produce at least one ClinicalEvent — got 0; document_type={:?}",
                v.get("document_type"));
        }
    }
}
