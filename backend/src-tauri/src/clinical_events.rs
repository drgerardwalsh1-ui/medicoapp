//! Canonical Clinical Event Layer.
//!
//! `ClinicalEvent` is the additive substrate future reasoning (timeline,
//! conflict detection, summary, medico-legal report generation) will
//! consume. Built alongside the existing extraction outputs — never
//! replacing them — so the rest of the system stays untouched while the
//! new model is validated.
//!
//! Boundaries deliberately drawn for this phase:
//!   - No medication lifecycle inference (MedicationStarted/Stopped).
//!     `MedicationMention` only.
//!   - No diagnosis synthesis. Each `ClinicalEvent` represents exactly
//!     one extracted mention.
//!   - Confidence is OPTIONAL and lands inside `metadata` rather than
//!     becoming a reasoning input, because today's confidence values
//!     come only from static keyword constants.
//!   - Section attribution is deterministic (see `detect_sections` /
//!     `section_for_offset`). No AI / no model.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

// ── Enums ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    /// A condition / diagnosis mention. Status is required (Affirmed,
    /// Queried, Negated, Contradicted, Differential, Historical).
    Diagnosis,
    /// A symptom or complaint mention. Status defaults to SymptomOnly
    /// unless the extractor pinned it to something more specific.
    Symptom,
    /// A medication name mention. We do NOT distinguish started/stopped
    /// /ongoing in this phase — see module docs.
    MedicationMention,
    /// A treatment or therapy. CBT, physiotherapy, etc.
    Procedure,
    /// An investigation or imaging study (MRI, x-ray, …).
    InvestigationMention,
    /// An organisation mentioned in the document.
    Organisation,
    /// A person mentioned (clinician, patient, claimant, …).
    Person,
    /// A standalone date observation (calendar marker — useful for the
    /// timeline reasoner once we wire it up).
    DocumentDate,
}

impl EventType {
    pub fn as_str(self) -> &'static str {
        match self {
            EventType::Diagnosis            => "diagnosis",
            EventType::Symptom              => "symptom",
            EventType::MedicationMention    => "medication_mention",
            EventType::Procedure            => "procedure",
            EventType::InvestigationMention => "investigation_mention",
            EventType::Organisation         => "organisation",
            EventType::Person               => "person",
            EventType::DocumentDate         => "document_date",
        }
    }
}

/// Assertion / status for clinical events. Mirrors `assertion::AssertionStatus`
/// (kept independent so the event model never leaks classifier internals).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssertionStatus {
    Affirmed,
    Queried,
    Negated,
    Contradicted,
    Differential,
    SymptomOnly,
    Historical,
}

impl AssertionStatus {
    #[allow(dead_code)] // Public surface; downstream consumers will pick this up.
    pub fn as_str(self) -> &'static str {
        match self {
            AssertionStatus::Affirmed     => "affirmed",
            AssertionStatus::Queried      => "queried",
            AssertionStatus::Negated      => "negated",
            AssertionStatus::Contradicted => "contradicted",
            AssertionStatus::Differential => "differential",
            AssertionStatus::SymptomOnly  => "symptom_only",
            AssertionStatus::Historical   => "historical",
        }
    }

    /// Parse from the string form emitted by `assertion::AssertionStatus::as_str`.
    pub fn parse(s: &str) -> Option<AssertionStatus> {
        Some(match s {
            "affirmed"     => AssertionStatus::Affirmed,
            "queried"      => AssertionStatus::Queried,
            "negated"      => AssertionStatus::Negated,
            "contradicted" => AssertionStatus::Contradicted,
            "differential" => AssertionStatus::Differential,
            "symptom_only" => AssertionStatus::SymptomOnly,
            "historical"   => AssertionStatus::Historical,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatePrecision {
    Day,
    Month,
    Year,
}

// ── Participants ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventParticipant {
    /// Role string ("doctor" / "patient" / "author" / "psychologist" / …).
    pub role: String,
    /// Display name as extracted.
    pub name: String,
}

// ── ClinicalEvent ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClinicalEvent {
    /// Stable id of the form `{doc_id}#{event_type}#{index}`. Deterministic
    /// so downstream consumers can dedupe across re-runs.
    pub event_id: String,
    pub event_type: EventType,
    /// Canonical concept name ("post-traumatic stress disorder",
    /// "sertraline", "physiotherapy", …).
    pub concept: String,
    /// Pre-normalisation surface form as it appeared in the source. For
    /// concepts emitted by `entity_clean::normalise` the canonical form
    /// lives in `concept`; `raw_concept` holds the original spelling so
    /// the medico-legal audit trail can show what the system actually
    /// saw before normalisation. Defaults to the same value as `concept`
    /// when no separate raw form is available.
    #[serde(default)]
    pub raw_concept: String,
    /// ISO date string at the indicated precision. None when the event
    /// is undated.
    pub date: Option<String>,
    pub date_precision: Option<DatePrecision>,
    pub assertion_status: Option<AssertionStatus>,
    pub source_document_id: String,
    /// Section identifier within the document (e.g. "SOURCE A",
    /// "Treating Psychologist"). None when no section was detectable.
    pub source_section: Option<String>,
    /// Up to ~200 chars of supporting text. Required to be byte-equal to
    /// `clean_text[char_offset_start..char_offset_end]` per the medico-
    /// legal persistence boundary's snippet-integrity rule (verified at
    /// projection write time by `snippet_integrity::verify`).
    pub source_snippet: String,
    /// Byte offset of the start of `source_snippet` in the document's
    /// `clean_text`. Used both for re-locating the snippet at audit time
    /// and for the integrity rule's byte-equality check.
    #[serde(default)]
    pub char_offset_start: usize,
    /// Byte offset just past the end of `source_snippet` in `clean_text`.
    #[serde(default)]
    pub char_offset_end: usize,
    /// Page number when known. Currently `None` — we have not threaded
    /// page metadata through OCR concatenation yet.
    pub page: Option<u32>,
    /// Roles relevant to this event (e.g. the diagnosing clinician).
    pub participants: Vec<EventParticipant>,
    /// Free-form metadata bag. Confidence and extractor provenance live
    /// here so they don't pollute the typed contract.
    pub metadata: JsonValue,
}

impl ClinicalEvent {
    /// Legacy human-readable id formula. Used as the FIRST half of the
    /// new content-addressed `stable_id` so existing test-harness greps
    /// and log messages keep working. NOT globally unique on its own —
    /// two documents sharing `doc_id` (e.g. test fixtures hard-coded to
    /// "fixture") would collide here. Per RC4 the full `stable_id`
    /// salts this with a SHA-256 of the event's content so the final
    /// `event_id` is globally unique by construction.
    pub fn legacy_prefix(doc_id: &str, event_type: EventType, index: usize) -> String {
        format!("{doc_id}#{}#{index}", event_type.as_str())
    }

    /// **Globally unique** content-addressed event id (RC4).
    ///
    /// Format: `{legacy_prefix}#{sha256[:16]}` where the sha256 input
    /// is the canonical concatenation:
    ///   `doc_id || '\0' || type || '\0' || index || '\0' || concept || '\0' || snippet || '\0' || start || '\0' || end`
    ///
    /// Properties:
    ///   - Deterministic: same content ⇒ same id (audit-friendly).
    ///   - Globally unique by construction: two ClinicalEvents that
    ///     would have collided under the legacy formula now disambiguate
    ///     on their content (concept, snippet, offsets). The only way
    ///     to get a real collision is to produce two physically
    ///     identical events — which is fine, they ARE the same event.
    ///   - Readable prefix preserved: an audit log line still shows
    ///     "{doc}#diagnosis#0" so humans can scan it; the 16-char
    ///     suffix is the disambiguator.
    ///
    /// Use this instead of `legacy_prefix` for any value written to
    /// `events.db` or `projection.db`. The legacy form is retained as a
    /// non-unique label only.
    pub fn content_addressed_id(
        doc_id: &str,
        event_type: EventType,
        index: usize,
        concept: &str,
        snippet: &str,
        start: usize,
        end: usize,
    ) -> String {
        let prefix = Self::legacy_prefix(doc_id, event_type, index);
        let canonical = format!(
            "{doc_id}\0{}\0{index}\0{concept}\0{snippet}\0{start}\0{end}",
            event_type.as_str()
        );
        let digest = crate::sha256_hex(canonical.as_bytes());
        // First 16 hex chars = 64 bits of disambiguation. Cryptographic
        // collision resistance well in excess of the audit corpus size.
        format!("{prefix}#{}", &digest[..16])
    }

    /// Backwards-compatible alias kept so older call sites (test
    /// fixtures, debug helpers) keep building. Returns the legacy
    /// non-unique form.
    #[deprecated(
        note = "Use content_addressed_id; the bare prefix is NOT globally unique."
    )]
    pub fn stable_id(doc_id: &str, event_type: EventType, index: usize) -> String {
        Self::legacy_prefix(doc_id, event_type, index)
    }
}

// ── Section detection ────────────────────────────────────────────────────

/// A detected section: label and the byte range in the source text it
/// covers (start inclusive, end exclusive). Sections never overlap and
/// always span up to the next section's start (or text end).
#[derive(Debug, Clone)]
pub struct DetectedSection {
    pub label: String,
    pub start: usize,
    pub end: usize,
}

/// Walk the text looking for section-heading lines. Deterministic; no
/// AI. Recognises:
///   - `SOURCE A:` / `SOURCE B: …` (and any single letter A-Z)
///   - `Treating Psychologist`, `Treating Psychiatrist`,
///     `Treating Doctor`, `Treating GP`
///   - `Reviewing Psychiatrist`, `Reviewing Psychologist`
///   - `Emergency Department`, `Radiology Report`, `GP Notes`,
///     `Psychiatric Assessment`, `Psychological Report`
///   - `Author: …` (the author line itself, useful for attribution)
pub fn detect_sections(text: &str) -> Vec<DetectedSection> {
    let mut hits: Vec<(usize, String)> = Vec::new();
    let mut line_start: usize = 0;
    for raw_line in text.split_inclusive('\n') {
        let trimmed = raw_line.trim_end_matches('\n').trim();
        if !trimmed.is_empty() {
            if let Some(label) = classify_section_label(trimmed) {
                hits.push((line_start, label));
            }
        }
        line_start += raw_line.len();
    }
    if hits.is_empty() {
        return Vec::new();
    }
    let text_len = text.len();
    let mut sections = Vec::with_capacity(hits.len());
    for i in 0..hits.len() {
        let (start, label) = (hits[i].0, hits[i].1.clone());
        let end = hits.get(i + 1).map(|(s, _)| *s).unwrap_or(text_len);
        sections.push(DetectedSection { label, start, end });
    }
    sections
}

/// Return the section label that contains byte offset `pos`, if any.
pub fn section_for_offset(sections: &[DetectedSection], pos: usize) -> Option<String> {
    for s in sections {
        if pos >= s.start && pos < s.end {
            return Some(s.label.clone());
        }
    }
    None
}

/// Return the section label that contains `snippet` (the first occurrence
/// in the text), if any.
pub fn section_for_snippet(sections: &[DetectedSection], text: &str, snippet: &str) -> Option<String> {
    if snippet.is_empty() {
        return None;
    }
    let trimmed = snippet.trim();
    if let Some(pos) = text.find(trimmed) {
        return section_for_offset(sections, pos);
    }
    // Snippets are stored normalised; if the literal isn't found, take
    // the first 40 chars as a probe.
    let probe: String = trimmed.chars().take(40).collect();
    if probe.len() >= 8 {
        if let Some(pos) = text.find(probe.as_str()) {
            return section_for_offset(sections, pos);
        }
    }
    None
}

/// Recognise a section heading from a single trimmed line.
fn classify_section_label(line: &str) -> Option<String> {
    let lower = line.to_lowercase();

    // SOURCE X — capture letter
    let lower_start = lower.trim_start();
    if let Some(rest) = lower_start.strip_prefix("source ") {
        if let Some(c) = rest.chars().next() {
            if c.is_ascii_alphabetic() {
                let letter = c.to_ascii_uppercase();
                return Some(format!("SOURCE {letter}"));
            }
        }
    }

    for prefix in SECTION_PREFIXES {
        if lower_start.starts_with(prefix) {
            // Pretty-case the prefix.
            let mut display = String::new();
            for (i, word) in prefix.split_whitespace().enumerate() {
                if i > 0 { display.push(' '); }
                let mut chars = word.chars();
                if let Some(c) = chars.next() {
                    display.extend(c.to_uppercase());
                    display.push_str(&chars.as_str().to_lowercase());
                }
            }
            return Some(display);
        }
    }
    None
}

// ── Builder ──────────────────────────────────────────────────────────────

/// Inputs to `build_events`. Strings + structs only — no model objects,
/// so the builder can be called from anywhere in the pipeline.
pub struct EventBuildInput<'a> {
    pub doc_id: &'a str,
    pub clean_text: &'a str,
    pub condition_mentions: Vec<RawConditionMention>,
    pub symptoms: Vec<String>,
    pub medications: Vec<String>,
    pub procedures: Vec<String>,
    pub people: Vec<RawPerson>,
    pub dates: Vec<RawDate>,
}

#[derive(Debug, Clone)]
pub struct RawConditionMention {
    pub term: String,
    pub status: String, // string form from assertion::AssertionStatus
    pub snippet: String,
    /// Byte offset of `snippet` in `clean_text`. When the upstream
    /// extractor didn't supply offsets (e.g. the unanchored "last-ditch"
    /// affirmed mention emitted by `process_document` when the canonical
    /// term wasn't located in the cleaned text) the offsets are both 0
    /// and `snippet` is empty — the integrity check then trivially holds
    /// (`clean_text[0..0] == ""`).
    pub start: usize,
    pub end: usize,
    /// Pre-normalisation surface form (the literal text that triggered
    /// this mention, e.g. "PTSD" before it canonicalised to
    /// "post-traumatic stress disorder"). Optional; defaults to `term`
    /// when no separate raw form is available.
    pub raw_term: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RawPerson {
    pub name: String,
    pub role: String,
    pub snippet: String,
    pub snippet_start: usize,
    pub snippet_end: usize,
    pub confidence: f32,
}

#[derive(Debug, Clone)]
pub struct RawDate {
    pub raw: String,
    pub value: String,
    pub precision: DatePrecision,
    pub start: usize,
    pub end: usize,
}

/// Vocabulary used to split procedure-vs-investigation. Conservative;
/// anything not in this list stays as a Procedure.
const INVESTIGATION_VOCAB: &[&str] = &[
    "mri", "magnetic resonance imaging",
    "ct scan", "ct",
    "x-ray", "xray",
    "ultrasound", "ultrasonography",
    "ecg", "ekg", "electrocardiogram",
    "eeg", "electroencephalogram",
    "emg", "electromyography",
    "pet scan", "pet-ct",
    "bone scan", "dexa scan",
    "nerve conduction study",
    "imaging",
];

fn classify_procedure_event(term: &str) -> EventType {
    let lower = term.to_lowercase();
    for kw in INVESTIGATION_VOCAB {
        if lower == *kw || lower.contains(kw) {
            return EventType::InvestigationMention;
        }
    }
    EventType::Procedure
}

/// Translate the extraction-stage outputs into `ClinicalEvent` records.
/// Additive: the caller is expected to continue producing every existing
/// field. Events are stable-id'd by (doc_id, event_type, per-type index).
pub fn build_events(input: EventBuildInput<'_>) -> Vec<ClinicalEvent> {
    let sections = detect_sections(input.clean_text);
    let mut out: Vec<ClinicalEvent> = Vec::new();
    let doc_id = input.doc_id;

    // ── Diagnoses (one per condition_mention) ───────────────────────────
    for (i, m) in input.condition_mentions.iter().enumerate() {
        let status = AssertionStatus::parse(&m.status);
        // Symptom-only condition mentions are treated as Symptom events
        // so reasoning can group them together; this also fits the
        // entity_clean routing.
        let event_type = if status == Some(AssertionStatus::SymptomOnly) {
            EventType::Symptom
        } else {
            EventType::Diagnosis
        };
        let section = section_for_offset(&sections, m.start);
        out.push(ClinicalEvent {
            event_id: ClinicalEvent::content_addressed_id(
                doc_id, event_type, i, &m.term, &m.snippet, m.start, m.end,
            ),
            event_type,
            concept: m.term.clone(),
            raw_concept: m.raw_term.clone().unwrap_or_else(|| m.term.clone()),
            date: None,
            date_precision: None,
            assertion_status: status,
            source_document_id: doc_id.to_string(),
            source_section: section,
            source_snippet: m.snippet.clone(),
            char_offset_start: m.start,
            char_offset_end: m.end,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({ "source": "condition_mentions" }),
        });
    }

    // ── Symptoms (one per symptom string) ───────────────────────────────
    for (i, sym) in input.symptoms.iter().enumerate() {
        // Find a representative snippet by walking the text for the
        // first occurrence of the symptom phrase.
        let snip = snippet_for_term(input.clean_text, sym);
        let (snippet, snip_start, snip_end) = snip
            .map(|(s, st, en)| (s, st, en))
            .unwrap_or_default();
        let section = section_for_offset(&sections, snip_start);
        out.push(ClinicalEvent {
            event_id: ClinicalEvent::content_addressed_id(
                doc_id, EventType::Symptom, i, sym, &snippet, snip_start, snip_end,
            ),
            event_type: EventType::Symptom,
            concept: sym.clone(),
            raw_concept: sym.clone(),
            date: None,
            date_precision: None,
            assertion_status: Some(AssertionStatus::SymptomOnly),
            source_document_id: doc_id.to_string(),
            source_section: section,
            source_snippet: snippet,
            char_offset_start: snip_start,
            char_offset_end: snip_end,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({ "source": "entities.symptoms" }),
        });
    }

    // ── Medications (MedicationMention only — no lifecycle inference) ──
    for (i, med) in input.medications.iter().enumerate() {
        // Classify assertion from sentence context instead of hardcoding
        // Affirmed. Production data showed "Emma denied taking opioid
        // medication" persisted as an AFFIRMED medication_mention — the
        // negation was silently inverted at the event layer.
        let (status, snippet, snip_start, snip_end) =
            classify_term_mention(input.clean_text, med);
        let section = section_for_offset(&sections, snip_start);
        out.push(ClinicalEvent {
            event_id: ClinicalEvent::content_addressed_id(
                doc_id, EventType::MedicationMention, i, med, &snippet, snip_start, snip_end,
            ),
            event_type: EventType::MedicationMention,
            concept: med.clone(),
            raw_concept: med.clone(),
            date: None,
            date_precision: None,
            assertion_status: Some(status),
            source_document_id: doc_id.to_string(),
            source_section: section,
            source_snippet: snippet,
            char_offset_start: snip_start,
            char_offset_end: snip_end,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({ "source": "entities.medications" }),
        });
    }

    // ── Procedures + investigations ─────────────────────────────────────
    for (i, proc) in input.procedures.iter().enumerate() {
        let event_type = classify_procedure_event(proc);
        // Context-classified for the same reason as medications: a denied
        // or queried procedure must not persist as affirmed.
        let (status, snippet, snip_start, snip_end) =
            classify_term_mention(input.clean_text, proc);
        let section = section_for_offset(&sections, snip_start);
        out.push(ClinicalEvent {
            event_id: ClinicalEvent::content_addressed_id(
                doc_id, event_type, i, proc, &snippet, snip_start, snip_end,
            ),
            event_type,
            concept: proc.clone(),
            raw_concept: proc.clone(),
            date: None,
            date_precision: None,
            assertion_status: Some(status),
            source_document_id: doc_id.to_string(),
            source_section: section,
            source_snippet: snippet,
            char_offset_start: snip_start,
            char_offset_end: snip_end,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({ "source": "entities.procedures" }),
        });
    }

    // ── People ──────────────────────────────────────────────────────────
    for (i, p) in input.people.iter().enumerate() {
        let section = section_for_offset(&sections, p.snippet_start);
        out.push(ClinicalEvent {
            event_id: ClinicalEvent::content_addressed_id(
                doc_id,
                EventType::Person,
                i,
                &p.name,
                &p.snippet,
                p.snippet_start,
                p.snippet_end,
            ),
            event_type: EventType::Person,
            concept: p.name.clone(),
            raw_concept: p.name.clone(),
            date: None,
            date_precision: None,
            assertion_status: None,
            source_document_id: doc_id.to_string(),
            source_section: section,
            source_snippet: p.snippet.clone(),
            char_offset_start: p.snippet_start,
            char_offset_end: p.snippet_end,
            page: None,
            participants: vec![EventParticipant {
                role: p.role.clone(),
                name: p.name.clone(),
            }],
            metadata: serde_json::json!({
                "source": "people",
                "confidence": p.confidence,
            }),
        });
    }

    // ── Dates (DocumentDate events for the timeline reasoner) ───────────
    for (i, d) in input.dates.iter().enumerate() {
        out.push(ClinicalEvent {
            event_id: ClinicalEvent::content_addressed_id(
                doc_id,
                EventType::DocumentDate,
                i,
                &d.value,
                &d.raw,
                d.start,
                d.end,
            ),
            event_type: EventType::DocumentDate,
            concept: d.value.clone(),
            raw_concept: d.raw.clone(),
            date: Some(d.value.clone()),
            date_precision: Some(d.precision),
            assertion_status: None,
            source_document_id: doc_id.to_string(),
            source_section: section_for_offset(&sections, d.start),
            source_snippet: d.raw.clone(),
            char_offset_start: d.start,
            char_offset_end: d.end,
            page: None,
            participants: Vec::new(),
            metadata: serde_json::json!({ "source": "dates_struct" }),
        });
    }

    // Debug-mode integrity check: every event with a non-empty snippet
    // must satisfy clean_text[start..end] == source_snippet. Catches
    // offset/snippet drift as soon as it appears in test builds.
    debug_assert!(
        out.iter().all(|ev| crate::snippet_integrity::ok(ev, input.clean_text)),
        "build_events emitted ClinicalEvent whose snippet does not match clean_text[start..end]"
    );

    out
}

/// First occurrence of `term` in `text` returned as a ~200-char snippet
/// around the hit (whole line if shorter). Case-insensitive search; the
/// returned snippet preserves the original casing.
///
/// Returns `(snippet, start, end)` where the invariant
/// `text[start..end] == snippet` holds. This is the byte-equality rule
/// enforced by the persistence boundary's snippet-integrity check.
/// Classify the first mention of `term` in `clean_text` via the shared
/// assertion classifier, returning (status, snippet, start, end).
///
/// Used for medication / procedure events so that negated or contradicted
/// mentions ("denied taking opioid medication") are persisted with their
/// real assertion status instead of a hardcoded Affirmed. `SymptomOnly` is
/// mapped back to Affirmed — symptom-verb framing ("reports taking X") is
/// normal for medications and carries no doubt about the mention itself.
///
/// Falls back to `snippet_for_term` + Affirmed when the classifier finds
/// no mention (e.g. canonical med name absent from text after synonym
/// expansion), preserving the previous snippet behaviour.
fn classify_term_mention(
    clean_text: &str,
    term: &str,
) -> (AssertionStatus, String, usize, usize) {
    if let Some(m) = crate::assertion::classify_all_mentions(clean_text, term, false)
        .into_iter()
        .next()
    {
        let status = match m.status {
            crate::assertion::AssertionStatus::SymptomOnly => AssertionStatus::Affirmed,
            other => AssertionStatus::parse(other.as_str()).unwrap_or(AssertionStatus::Affirmed),
        };
        return (status, m.snippet, m.start, m.end);
    }
    let (snippet, start, end) =
        snippet_for_term(clean_text, term).unwrap_or_default();
    (AssertionStatus::Affirmed, snippet, start, end)
}

fn snippet_for_term(text: &str, term: &str) -> Option<(String, usize, usize)> {
    if term.is_empty() {
        return None;
    }
    // ASCII-only lowercase: byte-length-preserving, so `pos` is a valid
    // offset into `text` even when the document contains non-ASCII
    // characters whose Unicode lowercase has a different byte length.
    let lower_text = text.to_ascii_lowercase();
    let lower_term = term.to_ascii_lowercase();
    let pos = lower_text.find(&lower_term)?;
    let line_byte_start = text[..pos].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_byte_end = text[pos..].find('\n').map(|i| pos + i).unwrap_or(text.len());
    // Trim leading/trailing ASCII whitespace WITHIN the line so the
    // snippet is the substring shown to the human reader.
    let bytes = text.as_bytes();
    let mut s = line_byte_start;
    let mut e = line_byte_end;
    while s < e && bytes[s].is_ascii_whitespace() {
        s += 1;
    }
    while e > s && bytes[e - 1].is_ascii_whitespace() {
        e -= 1;
    }
    if s >= e {
        return None;
    }
    let slice = &text[s..e];
    if slice.chars().count() <= 200 {
        return Some((slice.to_string(), s, e));
    }
    // Cap at 200 chars from `s`, preserving UTF-8 boundaries.
    let cut = slice
        .char_indices()
        .nth(200)
        .map(|(i, _)| i)
        .unwrap_or(slice.len());
    let new_end = s + cut;
    Some((text[s..new_end].to_string(), s, new_end))
}

const SECTION_PREFIXES: &[&str] = &[
    "treating psychologist",
    "treating psychiatrist",
    "treating doctor",
    "treating physician",
    "treating clinician",
    "treating gp",
    "reviewing psychiatrist",
    "reviewing psychologist",
    "emergency department",
    "radiology report",
    "imaging report",
    "gp notes",
    "gp note",
    "consult note",
    "psychiatric assessment",
    "psychological report",
    "psychology report",
    "neuropsychological assessment",
];

// ── Tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_source_a_b_c_sections() {
        let text = "\
SOURCE A: Emergency Department Note
Findings: lower back pain.

SOURCE B: Radiology Report
MRI lumbar spine.

SOURCE C: GP Notes
Discussed pain management.
";
        let s = detect_sections(text);
        let labels: Vec<&str> = s.iter().map(|x| x.label.as_str()).collect();
        assert_eq!(labels, ["SOURCE A", "SOURCE B", "SOURCE C"]);
    }

    #[test]
    fn detects_treating_clinician_sections() {
        let text = "\
Patient seen.

Treating Psychologist
Diagnosis: post-traumatic stress disorder.

Reviewing Psychiatrist
Presentation inconsistent with PTSD.
";
        let s = detect_sections(text);
        assert!(s.iter().any(|x| x.label == "Treating Psychologist"));
        assert!(s.iter().any(|x| x.label == "Reviewing Psychiatrist"));
    }

    #[test]
    fn section_for_snippet_resolves_to_correct_source() {
        let text = "\
SOURCE A: Emergency Department Note
Patient seen post-MVA.

SOURCE B: Radiology Report
Findings: L4/5 disc herniation.
";
        let s = detect_sections(text);
        let label = section_for_snippet(&s, text, "Findings: L4/5 disc herniation.").unwrap();
        assert_eq!(label, "SOURCE B");
        let label2 = section_for_snippet(&s, text, "Patient seen post-MVA.").unwrap();
        assert_eq!(label2, "SOURCE A");
    }

    #[test]
    fn assertion_status_round_trips_via_string() {
        for s in ["affirmed", "queried", "negated", "contradicted", "differential", "symptom_only", "historical"] {
            assert_eq!(AssertionStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(AssertionStatus::parse("nope").is_none());
    }

    #[test]
    fn legacy_prefix_is_deterministic() {
        let a = ClinicalEvent::legacy_prefix("doc1", EventType::Diagnosis, 0);
        let b = ClinicalEvent::legacy_prefix("doc1", EventType::Diagnosis, 0);
        assert_eq!(a, b);
        assert_eq!(a, "doc1#diagnosis#0");
        assert_ne!(ClinicalEvent::legacy_prefix("doc1", EventType::Symptom, 0), a);
    }

    #[test]
    fn content_addressed_id_is_deterministic_and_unique() {
        // Same content ⇒ same id.
        let a = ClinicalEvent::content_addressed_id(
            "doc1", EventType::Diagnosis, 0, "ptsd", "Diagnosis: PTSD", 0, 15,
        );
        let b = ClinicalEvent::content_addressed_id(
            "doc1", EventType::Diagnosis, 0, "ptsd", "Diagnosis: PTSD", 0, 15,
        );
        assert_eq!(a, b);
        assert!(a.starts_with("doc1#diagnosis#0#"));

        // Different content with the SAME legacy prefix must yield
        // different ids — this is the RC4 guarantee that uniqueness
        // does not depend on doc_id alone.
        let c = ClinicalEvent::content_addressed_id(
            "doc1", EventType::Diagnosis, 0, "mdd", "Diagnosis: MDD", 0, 14,
        );
        assert_ne!(a, c);

        // Even more critically: two DIFFERENT documents that happen to
        // collide on `doc_id` (e.g. the test-fixture `pd()` hard-coded
        // "fixture") must NOT collide on the final event_id when they
        // carry different content.
        let d = ClinicalEvent::content_addressed_id(
            "fixture", EventType::Diagnosis, 0, "ptsd",
            "Presentation inconsistent with PTSD", 100, 134,
        );
        let e = ClinicalEvent::content_addressed_id(
            "fixture", EventType::Diagnosis, 0, "ptsd",
            "Diagnosis: post-traumatic stress disorder", 0, 41,
        );
        assert_ne!(
            d, e,
            "two PTSD ClinicalEvents from different snippets in the same fixture must disambiguate"
        );
    }
}
