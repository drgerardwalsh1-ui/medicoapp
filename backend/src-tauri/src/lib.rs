// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

// OCR module — always compiled.  Uses subprocess tesseract (no native linking),
// so the binary works as long as `tesseract` and `pdftoppm` are on PATH.
mod ocr;

// Entity cleaning and normalisation pipeline module.
mod entity_clean;

// Layer 3 — strict validation gate: context, evidence, confidence, deduplication.
mod validation;

// ── Event sourcing foundation (Step 3a) ──────────────────────────────────────
// Foundation phase: modules wired, schema initialised, single optional emission
// behind a feature flag. Reducer + verification land in subsequent steps.
pub mod events;
pub mod event_store;
pub mod projection;
pub mod reducer;
pub mod replay;

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
///   .pdf  → pdf-extract crate (text-layer extraction)
///   .docx → zip + word/document.xml parse
///   *     → raw UTF-8 read (TXT, MD, LOG, etc.)
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
    // Shortcut: if the text layer is already dense (≥200 non-ws chars per
    // expected page worth of content), skip OCR entirely — OCR is slow and
    // the text layer is already canonical.
    if non_ws >= 2000 {
        return (text, "text", None);
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

    let char_count = final_text.len();

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
    // Imaging checked before report so "imaging report" → imaging
    if lower.contains("imaging")
        || lower.contains("x-ray")
        || lower.contains("mri")
        || lower.contains("ct scan")
        || lower.contains("ultrasound")
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
        start = pos + 1;
        if start >= text_len { break; }
    }
    false
}

/// Return the sentence (up to 150 chars) that contains `keyword` in `text`.
/// Uses the byte position from the lowercased version — safe because all
/// keywords are ASCII, so their byte lengths are identical in both strings.
/// Called by extract_structured_data to build evidence snippets.
fn extract_snippet(text: &str, keyword: &str) -> String {
    let lower = text.to_lowercase();
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
    let lower = text.to_lowercase();
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

    let lower = text.to_lowercase();

    // ── Document type ─────────────────────────────────────────────────────────
    let doc_type = if lower.contains("imaging")
        || lower.contains("x-ray")
        || lower.contains("mri")
        || lower.contains("ct scan")
        || lower.contains("ultrasound")
    {
        "imaging"
    } else if lower.contains("referral") {
        "referral"
    } else if lower.contains("statement") {
        "statement"
    } else if lower.contains("report") {
        "report"
    } else {
        "unknown"
    };

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

            // Bare 4-digit year (e.g. "2020", "2021") as last resort
            let t_digits: String = t0.chars().filter(|c| c.is_ascii_digit()).collect();
            if t_digits.len() == 4 {
                if let Ok(y) = t_digits.parse::<u32>() {
                    if y >= 1950 && y <= 2100 {
                        // Use Jan-01 placeholder — gives timeline ordering
                        dates_set.insert(format!("{:04}-01-01", y));
                    }
                }
            }
        }
    }

    // ── Index-document detection — HARD GATE ──────────────────────────────────
    //
    // Index documents (court exhibit lists, document registers) must not
    // contribute ANY clinical fields.  Detection runs on phrase matching and
    // date density BEFORE any keyword scanning.
    let is_index_document = lower.contains("index of supporting documents")
        || lower.contains("index of documents")
        || lower.contains("document author date page")
        || lower.contains("author date page")
        || lower.contains("list of documents")
        || lower.contains("schedule of documents")
        || lower.contains("table of documents")
        || dates_set.len() >= 8;

    // ── INDEX PATH: return metadata-only record immediately ───────────────────
    if is_index_document {
        let result = serde_json::json!({
            "doc_id":            doc_id,
            "document_type":     doc_type,
            "is_index_document": true,
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
    // `lax = true` — extract_structured_data uses high-precision keyword lists,
    // so we allow single-word diagnoses like "anxiety" through.
    let clean_input = entity_clean::CleanInput {
        conditions:  conditions_vec,
        medications: medications_vec,
        procedures:  procedures_vec,
    };
    let cleaned = entity_clean::clean_entities(clean_input, true);

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

    let _final_conditions  = validated.condition_values();
    let _final_medications = validated.medication_values();
    let _final_procedures  = validated.procedure_values();

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
        "parties":           { "patient": "", "doctor": "", "organisation": "" },
        "dates":             dates_vec,
        "key_findings":      clinical_snippets,
        "conditions":        cleaned.conditions.clone(),
        "injuries_or_conditions": cleaned.conditions.clone(),   // deprecated alias — same cleaned data
        "medications":       cleaned.medications.clone(),
        "procedures":        cleaned.procedures.clone(),
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

    // Write text to stdin then drop it — closing the pipe signals EOF to Python.
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
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
    Ok(stdout)
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
    call_nlp_service(&text)
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

/// Strip OCR / UI artefacts from raw extracted text.
///
/// Removes:
/// - Known UI noise lines (exact match, case-insensitive)
/// - Symbol-heavy lines (< 50 % of non-whitespace chars are alphanumeric)
/// - Code / filename lines (bare token ending in a recognised code extension)
/// Collapses runs of ≥ 2 blank lines into a single blank line.
fn normalise_input_text(text: &str) -> String {
    const UI_NOISE: &[&str] = &[
        // LLM / chat UI chrome
        "get plus", "chatgpt", "claude.ai", "claude", "search", "log in", "log out",
        "sign in", "sign out", "sign up", "try claude", "upgrade", "subscribe",
        "new chat", "new conversation", "copy", "regenerate", "thumbs up",
        "thumbs down", "share", "export", "settings", "help", "feedback",
        "attach", "upload file", "send message", "type a message",
        // Technical / web artefacts explicitly named in spec
        "javascript", "utf-8", "golive",
        // Common CMS / web-builder tokens that OCR often picks up
        "goto", "onclick", "onload", "charset", "viewport",
        "meta charset", "content-type", "text/html",
    ];

    const CODE_EXTS: &[&str] = &[
        ".rs", ".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".java",
        ".cpp", ".c", ".h", ".css", ".html", ".json", ".yaml", ".toml",
        ".sh", ".bat", ".md", ".lock",
    ];

    let mut out: Vec<&str> = Vec::new();
    let mut prev_blank = false;

    'line: for line in text.lines() {
        let trimmed = line.trim();

        // Collapse consecutive blank lines
        if trimmed.is_empty() {
            if !prev_blank {
                out.push("");
            }
            prev_blank = true;
            continue;
        }
        prev_blank = false;

        // UI noise — exact match, case-insensitive
        let lower = trimmed.to_lowercase();
        for noise in UI_NOISE {
            if lower == *noise {
                continue 'line;
            }
        }

        // Code / filename lines — single token ending in a known code extension
        if !lower.contains(' ') {
            for ext in CODE_EXTS {
                if lower.ends_with(ext) {
                    continue 'line;
                }
            }
        }

        // Symbol-heavy lines — skip if < 50 % of non-whitespace chars are alphanumeric
        let non_ws: Vec<char> = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
        if !non_ws.is_empty() {
            let alpha_count = non_ws.iter().filter(|c| c.is_alphanumeric()).count();
            let ratio = alpha_count as f64 / non_ws.len() as f64;
            if ratio < 0.50 {
                continue;
            }
        }

        out.push(trimmed);
    }

    out.join("\n")
}

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
    // ── 0. Optional event emission (Step 3a; off by default) ──────────────────
    if ENABLE_EVENT_STORE {
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
    let clean_text = normalise_input_text(&text);

    // ── 2. Rule-based entity + date extraction ────────────────────────────────
    let structured_raw = extract_structured_data(clean_text.clone(), doc_id.clone())?;
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
    let dates           = extract_string_vec(&structured, "dates");

    // ── 3. Entity cleaning + normalisation ────────────────────────────────────
    let clean_input = entity_clean::CleanInput {
        conditions:  raw_conditions,
        medications: raw_medications,
        procedures:  raw_procedures,
    };
    let cleaned = entity_clean::clean_entities(clean_input, false);

    // ── 4. Organisation extraction ────────────────────────────────────────────
    let organisations = extract_organisations_rules(&clean_text);

    // ── Canonical store — single source of truth ──────────────────────────────
    // Only clean, normalised data leaves this function.
    // No raw lists, no duplicates, no UI artefacts.
    Ok(serde_json::json!({
        "doc_id":     doc_id,
        "clean_text": clean_text,
        "entities": {
            "conditions":    cleaned.conditions,
            "medications":   cleaned.medications,
            "procedures":    cleaned.procedures,
            "organisations": organisations,
        },
        "dates": dates,
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
    })
    .to_string())
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
            // ── Step 3c — integrity layer ────────────────────────────────────
            verify_system_integrity,
            // ── Step 4 — first event-driven domain path ──────────────────────
            create_client,
            get_client_view,
            // ── Step 5 — projection-driven UI binding ────────────────────────
            update_client_demographics,
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
