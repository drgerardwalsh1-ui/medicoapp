//! Structured medico-legal fact schema (the durable data contract).
//!
//! This is the smallest extensible model that supports five domains —
//! medications, symptoms, injuries/incidents, treatments, functional impacts —
//! while guaranteeing the four cross-cutting invariants demanded of every fact:
//!
//!   1. TRACEABILITY  — every fact carries an [`Evidence`] (document id + snippet
//!      + optional char offsets) back to the source text.
//!   2. CONFIDENCE    — every fact carries a `confidence` in `0.0..=1.0`.
//!   3. SNIPPET       — the verbatim source snippet is preserved on the evidence.
//!   4. UNCERTAINTY   — every domain-specific attribute is `Option`/`Vec`; an
//!      absent value means "not stated", never a forced default. Enums carry an
//!      explicit `Unknown` variant for the same reason.
//!
//! Design: a uniform [`StructuredFact`] envelope (id, domain, entity, confidence,
//! evidence, optional date span) plus a typed [`FactDetails`] payload — one
//! variant per domain. The envelope gives later layers (reporting, contradiction
//! detection, timelines, forecasting) a single shape to iterate; the typed
//! payload keeps each domain's fields strongly named.
//!
//! Determinism: `Vec`-only collections, no `HashMap`/`HashSet`; ids are
//! offset-derived (no hashing, no UUIDs, no timestamps). Purely additive — it
//! touches no existing type and changes no existing output.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

// ── Cross-cutting value types ───────────────────────────────────────────────

/// Which structured domain a fact belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactDomainKind {
    Medication,
    Symptom,
    Injury,
    Treatment,
    FunctionalImpact,
}

impl FactDomainKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FactDomainKind::Medication => "medication",
            FactDomainKind::Symptom => "symptom",
            FactDomainKind::Injury => "injury",
            FactDomainKind::Treatment => "treatment",
            FactDomainKind::FunctionalImpact => "functional_impact",
        }
    }
}

/// Provenance for a single fact. Offsets are `Option` because some upstream
/// surfaces (e.g. cross-document inference) may not carry them; the snippet and
/// document id are always present.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Evidence {
    pub document_id: String,
    /// Verbatim matched snippet from the source `clean_text`.
    pub snippet: String,
    pub char_offset_start: Option<usize>,
    pub char_offset_end: Option<usize>,
}

impl Evidence {
    pub fn new(document_id: &str, snippet: &str, start: usize, end: usize) -> Self {
        Evidence {
            document_id: document_id.to_string(),
            snippet: snippet.to_string(),
            char_offset_start: Some(start),
            char_offset_end: Some(end),
        }
    }
}

/// A date or date-range, ISO-ish (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`). Either bound
/// may be absent — `{start: Some, end: None}` is an open-ended "from" period;
/// `{start: None, end: Some}` an "until" period. The whole field is `Option` on
/// the fact, so "no date stated" is distinct from "open range".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DateSpan {
    pub start: Option<String>,
    pub end: Option<String>,
}

impl DateSpan {
    pub fn on(date: &str) -> Self {
        DateSpan { start: Some(date.to_string()), end: Some(date.to_string()) }
    }
    pub fn from(date: &str) -> Self {
        DateSpan { start: Some(date.to_string()), end: None }
    }
    pub fn until(date: &str) -> Self {
        DateSpan { start: None, end: Some(date.to_string()) }
    }
}

/// Confidence band — clamps to `0.0..=1.0`. Helper so extractors stay consistent.
pub fn clamp_confidence(c: f32) -> f32 {
    c.clamp(0.0, 1.0)
}

/// Explicit polarity of an extracted assertion. Distinct from the `fact_assertion`
/// two-state polarity: here a fact may be affirmed, explicitly denied, asserted
/// absent, or uncertain/queried. Defaults to `Affirmed` so existing producers and
/// deserialised legacy data are unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactPolarity {
    Affirmed,
    Denied,
    Absent,
    Uncertain,
}

impl Default for FactPolarity {
    fn default() -> Self {
        FactPolarity::Affirmed
    }
}

/// Lightweight source attribution: who reported the fact and what kind of source.
/// Both `Option` — absent means "not stated" (uncertainty preserved).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Attribution {
    /// e.g. "claimant", "gp", "psychiatrist", "orthopaedic_surgeon", "surveillance".
    pub reported_by: Option<String>,
    /// e.g. "self_report", "gp", "specialist", "surveillance", "pharmacy_records".
    pub source_type: Option<String>,
}

impl Attribution {
    pub fn new(reported_by: &str, source_type: &str) -> Self {
        Attribution {
            reported_by: Some(reported_by.to_string()),
            source_type: Some(source_type.to_string()),
        }
    }
    pub fn is_empty(&self) -> bool {
        self.reported_by.is_none() && self.source_type.is_none()
    }
}

// ── Shared enums (each has an explicit Unknown to preserve uncertainty) ──────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MedicationStatus {
    Current,
    Ceased,
    /// Ceased and later restarted (recommenced after cessation).
    Recommenced,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Progression {
    Improving,
    Worsening,
    Stable,
    Fluctuating,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Mild,
    Moderate,
    Severe,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentStatus {
    Ongoing,
    Ceased,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Effectiveness {
    Effective,
    PartiallyEffective,
    Ineffective,
    Unknown,
}

/// How an injury mention relates to the index event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InjuryEventKind {
    Initial,
    Prior,
    Subsequent,
    Recurrence,
    Exacerbation,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trend {
    Improving,
    Deteriorating,
    Stable,
    Fluctuating,
    Unknown,
}

/// The functional area an impact concerns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FunctionalArea {
    Work,
    Driving,
    Household,
    Exercise,
    Sleep,
    Social,
    /// Activities of daily living (washing, dressing, self-care).
    Adls,
    /// Mobility / ambulation (walking aids, walking distance, carrying).
    Mobility,
    Other,
}

// ── Per-domain detail payloads (every attribute Option/Vec) ──────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct MedicationFact {
    pub indication: Option<String>,
    pub dosage: Option<String>,
    pub frequency: Option<String>,
    pub route: Option<String>,
    pub start_date: Option<String>,
    pub stop_date: Option<String>,
    pub status: Option<MedicationStatus>,
    /// `Some(true)` iff the text states the drug was restarted after stopping.
    pub recommenced_after_cessation: Option<bool>,
    pub effectiveness: Option<Effectiveness>,
    pub side_effects: Vec<String>,
    pub reason_ceased: Option<String>,
    pub prescriber: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SymptomFact {
    pub onset_date: Option<String>,
    pub duration: Option<String>,
    pub severity: Option<Severity>,
    pub progression: Option<Progression>,
    pub aggravating_factors: Vec<String>,
    pub relieving_factors: Vec<String>,
    pub treatment_response: Option<Effectiveness>,
    pub current_status: Option<String>,
    /// `Some(true)` when the mention is historical / first-documented / recurrent
    /// (e.g. "GP records from 2017 document …", "chronic", "long-standing") rather
    /// than a stated onset. Keeps "first documented evidence" distinct from
    /// "symptom onset". `None` = not characterised.
    #[serde(default)]
    pub prior_history: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct InjuryFact {
    pub incident_date: Option<String>,
    pub mechanism: Option<String>,
    pub body_region: Option<String>,
    pub immediate_symptoms: Vec<String>,
    /// `Some(true)` work-related, `Some(false)` explicitly non-work, `None` unstated.
    pub work_related: Option<bool>,
    pub event_kind: Option<InjuryEventKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TreatmentFact {
    pub provider_type: Option<String>,
    pub specialty: Option<String>,
    pub outcome: Option<String>,
    pub effectiveness: Option<Effectiveness>,
    pub status: Option<TreatmentStatus>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct FunctionalImpactFact {
    pub area: Option<FunctionalArea>,
    pub capacity: Option<String>,
    pub restriction: Option<String>,
    pub trend: Option<Trend>,
}

/// Typed per-domain payload carried by a [`StructuredFact`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FactDetails {
    Medication(MedicationFact),
    Symptom(SymptomFact),
    Injury(InjuryFact),
    Treatment(TreatmentFact),
    FunctionalImpact(FunctionalImpactFact),
}

impl FactDetails {
    pub fn domain(&self) -> FactDomainKind {
        match self {
            FactDetails::Medication(_) => FactDomainKind::Medication,
            FactDetails::Symptom(_) => FactDomainKind::Symptom,
            FactDetails::Injury(_) => FactDomainKind::Injury,
            FactDetails::Treatment(_) => FactDomainKind::Treatment,
            FactDetails::FunctionalImpact(_) => FactDomainKind::FunctionalImpact,
        }
    }
}

// ── The fact envelope ───────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StructuredFact {
    /// Deterministic id: `"{domain}:{entity}:{offset_start}"` (offset-derived,
    /// no hashing/UUID/timestamp).
    pub fact_id: String,
    pub domain: FactDomainKind,
    /// Canonical head term: drug name / symptom / injury type / treatment /
    /// functional area label.
    pub entity: String,
    pub confidence: f32,
    /// Explicit polarity of the assertion. Defaults to `Affirmed`; legacy data
    /// without this field deserialises as `Affirmed`.
    #[serde(default)]
    pub polarity: FactPolarity,
    pub evidence: Evidence,
    /// Who reported the fact + the kind of source. Empty when not stated.
    #[serde(default)]
    pub attribution: Attribution,
    /// Extracted date or date-range when available; `None` = no date stated.
    pub date: Option<DateSpan>,
    pub details: FactDetails,
}

impl StructuredFact {
    /// Construct a fact, deriving id + domain from the details and clamping
    /// confidence. Polarity defaults to `Affirmed` and attribution to empty —
    /// use [`with_polarity`](Self::with_polarity) / [`with_attribution`](Self::with_attribution)
    /// to set them. Keeps the envelope/payload domains consistent by construction.
    pub fn new(
        entity: &str,
        confidence: f32,
        evidence: Evidence,
        date: Option<DateSpan>,
        details: FactDetails,
    ) -> Self {
        let domain = details.domain();
        let off = evidence.char_offset_start.unwrap_or(0);
        StructuredFact {
            fact_id: format!("{}:{}:{}", domain.as_str(), entity, off),
            domain,
            entity: entity.to_string(),
            confidence: clamp_confidence(confidence),
            polarity: FactPolarity::Affirmed,
            evidence,
            attribution: Attribution::default(),
            date,
            details,
        }
    }

    /// Builder: set polarity.
    pub fn with_polarity(mut self, p: FactPolarity) -> Self {
        self.polarity = p;
        self
    }

    /// Builder: set source attribution.
    pub fn with_attribution(mut self, a: Attribution) -> Self {
        self.attribution = a;
        self
    }
}

/// A document's structured fact set — the additive output unit. Carried as one
/// JSON object on the canonical store under `structured_facts`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StructuredFactSet {
    pub document_id: String,
    pub facts: Vec<StructuredFact>,
}

impl StructuredFactSet {
    /// Deterministic ordering: domain, then entity, then offset. Lets later
    /// layers rely on a stable order without re-sorting.
    pub fn sorted(document_id: &str, mut facts: Vec<StructuredFact>) -> Self {
        facts.sort_by(|a, b| {
            a.domain
                .as_str()
                .cmp(b.domain.as_str())
                .then(a.entity.cmp(&b.entity))
                .then(
                    a.evidence
                        .char_offset_start
                        .cmp(&b.evidence.char_offset_start),
                )
        });
        StructuredFactSet { document_id: document_id.to_string(), facts }
    }

    pub fn in_domain(&self, d: FactDomainKind) -> Vec<&StructuredFact> {
        self.facts.iter().filter(|f| f.domain == d).collect()
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests — schema invariants only (extraction is tested in structured_extract).
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn ev() -> Evidence {
        Evidence::new("docA", "pregabalin", 10, 20)
    }

    #[test]
    fn new_derives_id_domain_and_clamps_confidence() {
        let f = StructuredFact::new(
            "pregabalin",
            1.7, // out of range — must clamp
            ev(),
            Some(DateSpan::from("2022-03")),
            FactDetails::Medication(MedicationFact {
                status: Some(MedicationStatus::Current),
                ..Default::default()
            }),
        );
        assert_eq!(f.fact_id, "medication:pregabalin:10");
        assert_eq!(f.domain, FactDomainKind::Medication);
        assert_eq!(f.confidence, 1.0); // clamped
        assert_eq!(f.evidence.snippet, "pregabalin");
    }

    #[test]
    fn uncertainty_is_preserved_as_none() {
        // A bare symptom with nothing else stated must leave every attribute None,
        // not a forced default.
        let f = StructuredFact::new(
            "low back pain",
            0.6,
            Evidence::new("docA", "low back pain", 0, 13),
            None,
            FactDetails::Symptom(SymptomFact::default()),
        );
        if let FactDetails::Symptom(s) = &f.details {
            assert!(s.onset_date.is_none());
            assert!(s.severity.is_none());
            assert!(s.progression.is_none());
            assert!(s.aggravating_factors.is_empty());
        } else {
            panic!("wrong variant");
        }
        assert!(f.date.is_none());
    }

    #[test]
    fn set_is_sorted_deterministically() {
        let a = StructuredFact::new(
            "physiotherapy",
            0.8,
            Evidence::new("docA", "physiotherapy", 50, 63),
            None,
            FactDetails::Treatment(TreatmentFact::default()),
        );
        let b = StructuredFact::new(
            "pregabalin",
            0.8,
            Evidence::new("docA", "pregabalin", 5, 15),
            None,
            FactDetails::Medication(MedicationFact::default()),
        );
        let set = StructuredFactSet::sorted("docA", vec![a, b]);
        // medication sorts before treatment.
        assert_eq!(set.facts[0].domain, FactDomainKind::Medication);
        assert_eq!(set.facts[1].domain, FactDomainKind::Treatment);
        // round-trips through JSON.
        let s = serde_json::to_string(&set).unwrap();
        let back: StructuredFactSet = serde_json::from_str(&s).unwrap();
        assert_eq!(set, back);
    }

    #[test]
    fn json_tags_domain_and_kind() {
        let f = StructuredFact::new(
            "driving",
            0.7,
            Evidence::new("docA", "unable to drive", 0, 15),
            None,
            FactDetails::FunctionalImpact(FunctionalImpactFact {
                area: Some(FunctionalArea::Driving),
                trend: Some(Trend::Deteriorating),
                ..Default::default()
            }),
        );
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v["domain"], "functional_impact");
        assert_eq!(v["details"]["kind"], "functional_impact");
        assert_eq!(v["details"]["area"], "driving");
        assert_eq!(v["details"]["trend"], "deteriorating");
    }
}
