//! Fact assertions — first-class, non-clinical factual statements lifted from a
//! document's `clean_text` so they can participate in contradiction detection
//! alongside diagnoses/symptoms.
//!
//! A `FactAssertion` is a structured `(subject, attribute, value)` triple with
//! polarity, optional temporal information, and provenance (source ids +
//! character offsets). It is deliberately small and serialisable so it can be
//! carried as an event envelope and persisted later if desired.
//!
//! This module is pure data + a couple of pure classifiers. No extraction logic
//! (see `fact_extract`), no contradiction logic (see `fact_contradiction`).

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Whether the assertion affirms or negates the `value`. Carried for provenance;
/// value-distinctness (not polarity) drives contradiction detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactPolarity {
    Affirmed,
    Negated,
}

impl FactPolarity {
    pub fn as_str(self) -> &'static str {
        match self {
            FactPolarity::Affirmed => "affirmed",
            FactPolarity::Negated => "negated",
        }
    }
}

/// One structured factual assertion extracted from text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactAssertion {
    /// Who/what the fact is about, e.g. `"patient"`, `"father"`, `"spouse"`.
    pub subject: String,
    /// The attribute axis, e.g. `"marital_status"`, `"smoking_history"`.
    pub attribute: String,
    /// First-class FACT domain identity (drives the `fact:*` graph namespace).
    pub fact_domain: FactDomain,
    /// The normalised value, e.g. `"divorced"`, `"never"`, `"2022-02-12"`.
    pub value: String,
    pub polarity: FactPolarity,
    /// Optional normalised temporal marker (ISO-ish: `YYYY`, `YYYY-MM`,
    /// `YYYY-MM-DD`). Present for date-bearing attributes.
    pub temporal: Option<String>,
    /// Provenance — originating document id(s).
    pub source_ids: Vec<String>,
    pub char_offset_start: usize,
    pub char_offset_end: usize,
    /// The verbatim matched snippet (provenance).
    pub raw_text: String,
    /// The full sentence containing the match (sentence-level provenance).
    /// Empty only for synthetic/test assertions constructed without text.
    #[serde(default)]
    pub sentence: String,
}

/// The contradiction domain an attribute belongs to. Relationship / vital-status
/// facts are `family`; everything else (health behaviour, function, occupation,
/// temporal) is `clinical`. Pure mapping, no inference.
pub fn attribute_domain(attribute: &str) -> &'static str {
    match attribute {
        "marital_status"
        | "father_vital_status"
        | "mother_vital_status"
        | "spouse_vital_status"
        | "children_count"
        | "sibling_count" => "family",
        _ => "clinical",
    }
}

/// First-class FACT domain identity. This is the dedicated namespace facts live
/// in — facts are NEVER classified into the clinical `diagnosis`/`symptom`
/// namespaces. It is intentionally distinct from `ContradictionDomain`
/// (Clinical/Family), which is only the coarse `CaseContradiction` header; the
/// Fact identity drives graph namespace + node-id semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactDomain {
    /// Medico-legally clinical facts that are NOT diagnoses (e.g. injury date).
    Clinical,
    /// Social-history facts (smoking, alcohol).
    Social,
    /// Functional / occupational facts (driving, function, work, RTW).
    Functional,
    /// Relationship / vital-status facts (marital, father/mother/spouse alive).
    Family,
}

impl FactDomain {
    /// Stable token used in the graph namespace + contradiction id.
    ///   Clinical → "clinical", Social → "social",
    ///   Functional → "functional", Family → "family".
    pub fn as_str(self) -> &'static str {
        match self {
            FactDomain::Clinical => "clinical",
            FactDomain::Social => "social",
            FactDomain::Functional => "functional",
            FactDomain::Family => "family",
        }
    }

    /// The graph namespace string, e.g. `"fact:social"`. Always prefixed
    /// `fact:` so it can never alias the clinical `diagnosis`/`symptom` labels.
    pub fn as_namespace(self) -> String {
        format!("fact:{}", self.as_str())
    }
}

/// Map an attribute to its FACT domain. Pure, total (defaults to Clinical).
/// This is the SOLE place a fact domain is decided — it runs at extraction time
/// and the result is stored on the `FactAssertion`; no downstream layer recomputes it.
pub fn fact_domain_of(attribute: &str) -> FactDomain {
    match attribute {
        "marital_status"
        | "father_vital_status"
        | "mother_vital_status"
        | "spouse_vital_status"
        | "children_count"
        | "sibling_count" => FactDomain::Family,
        "smoking_history" | "alcohol_history" => FactDomain::Social,
        "driving_ability" | "functional_status" | "work_status" | "return_to_work"
        | "mobility" => FactDomain::Functional,
        _ => FactDomain::Clinical,
    }
}

/// The contradiction "type" label for an attribute (presentational). Temporal
/// attributes are `temporal_value`; everything else `categorical_value`.
pub fn attribute_contradiction_type(attribute: &str) -> &'static str {
    match attribute {
        "injury_date" | "work_status" | "return_to_work" => "temporal_value",
        _ => "categorical_value",
    }
}
