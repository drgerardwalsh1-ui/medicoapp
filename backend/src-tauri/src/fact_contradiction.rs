//! Value-aware contradiction generation over `FactAssertion`s.
//!
//! Rule: for the same `(subject, attribute)`, **two or more distinct values**
//! constitute a contradiction — even when both are affirmed. This is orthogonal
//! to (and does not replace) the existing diagnosis/symptom *polarity* engine;
//! it produces additional `CaseContradiction`s that flow through the very same
//! `enrich_contradictions → graph` path.
//!
//! Payload reuse: we emit `CaseContradictionBody::Family(FamilyContradiction)` —
//! that body already carries a `canonical_value` + `alternatives` (competing
//! values), `conflict_flag`, provenance (`source_refs`), and free-form
//! `metadata`. Reusing it means ZERO change to the `CaseContradictionBody` enum
//! and ZERO breakage of existing exhaustive consumers (enrichment, export, graph
//! all already handle the `Family` arm).

#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::Serialize;

use crate::canonical_case::{CaseContradiction, CaseContradictionBody, ContradictionDomain};
use crate::fact_assertion::{attribute_contradiction_type, attribute_domain, FactAssertion};
use crate::family_graph::{FamilyConflictType, FamilyContradiction, FamilyValue, SourceRef};

/// The `conflict_label` every fact (value-disagreement) contradiction carries.
/// This is the single, stable discriminator used by the graph/enrichment layers
/// to recognise a fact contradiction WITHOUT needing a new
/// `CaseContradictionBody` variant.
pub const FACT_CONFLICT_LABEL: &str = "value_disagreement";

/// True iff `c` is a fact (value-disagreement) contradiction.
pub fn is_fact_contradiction(c: &CaseContradiction) -> bool {
    c.conflict_label == FACT_CONFLICT_LABEL
}

/// The graph namespace for a fact contradiction, e.g. `"fact:social"`.
/// Derived from the `fact:{fact_domain}:…` contradiction id. Never returns a
/// clinical (`diagnosis`/`symptom`) namespace. Callers should gate on
/// [`is_fact_contradiction`] first.
pub fn fact_namespace(c: &CaseContradiction) -> String {
    let mut parts = c.contradiction_id.splitn(3, ':');
    match (parts.next(), parts.next()) {
        (Some("fact"), Some(fact_domain)) => format!("fact:{fact_domain}"),
        _ => "fact".to_string(),
    }
}

/// Build value-disagreement contradictions from a batch of facts. Deterministic:
/// groups via `BTreeMap`, values ordered, output sorted by `contradiction_id`.
pub fn build_fact_contradictions(facts: Vec<FactAssertion>) -> Vec<CaseContradiction> {
    // Group by (subject, attribute) — BTreeMap ⇒ deterministic key order.
    let mut groups: BTreeMap<(String, String), Vec<FactAssertion>> = BTreeMap::new();
    for f in facts {
        groups
            .entry((f.subject.clone(), f.attribute.clone()))
            .or_default()
            .push(f);
    }

    let mut out: Vec<CaseContradiction> = Vec::new();
    for ((subject, attribute), mut members) in groups {
        // Deterministic member order: value, then first offset.
        members.sort_by(|a, b| {
            a.value
                .cmp(&b.value)
                .then(a.char_offset_start.cmp(&b.char_offset_start))
        });

        // Distinct values (first member per value), in value order.
        let mut distinct: Vec<&FactAssertion> = Vec::new();
        for f in &members {
            if !distinct.iter().any(|d| d.value == f.value) {
                distinct.push(f);
            }
        }
        if distinct.len() < 2 {
            continue; // no disagreement ⇒ no contradiction
        }

        out.push(make_contradiction(&subject, &attribute, &distinct, &members));
    }

    out.sort_by(|a, b| a.contradiction_id.cmp(&b.contradiction_id));
    out
}

fn make_contradiction(
    subject: &str,
    attribute: &str,
    distinct: &[&FactAssertion],
    all_members: &[FactAssertion],
) -> CaseContradiction {
    let domain = match attribute_domain(attribute) {
        "family" => ContradictionDomain::Family,
        _ => ContradictionDomain::Clinical,
    };
    let contradiction_type = attribute_contradiction_type(attribute);

    // Evidence-distribution confidence (NOT a heuristic): each value's
    // confidence is its share of ALL observations of this (subject, attribute);
    // the canonical value is the best-supported one. Multi-source resolution:
    // every observation of a value becomes a SourceRef on that value.
    let total = all_members.len().max(1) as f32;
    let sentence_or_raw = |f: &FactAssertion| {
        if f.sentence.is_empty() { f.raw_text.clone() } else { f.sentence.clone() }
    };
    let to_source = |f: &FactAssertion| SourceRef {
        source: f.source_ids.first().cloned().unwrap_or_default(),
        date: f.temporal.clone(),
        context: sentence_or_raw(f),
    };
    let to_value = |d: &FactAssertion| {
        let members: Vec<&FactAssertion> =
            all_members.iter().filter(|m| m.value == d.value).collect();
        FamilyValue {
            value: d.value.clone(),
            support_count: members.len() as u32,
            confidence: members.len() as f32 / total,
            sources: members.iter().map(|m| to_source(m)).collect(),
            edge_ids: vec![],
        }
    };

    // Canonical = highest support; ties break on the existing deterministic
    // member order (value asc). `distinct` is value-ordered, so a stable
    // max-by over support keeps determinism.
    let mut ordered: Vec<&FactAssertion> = distinct.to_vec();
    ordered.sort_by(|a, b| {
        let sa = all_members.iter().filter(|m| m.value == a.value).count();
        let sb = all_members.iter().filter(|m| m.value == b.value).count();
        sb.cmp(&sa).then(a.value.cmp(&b.value))
    });
    let canonical_value = to_value(ordered[0]);
    let alternatives: Vec<FamilyValue> = ordered[1..].iter().map(|f| to_value(f)).collect();
    let resolution_confidence = canonical_value.confidence;

    let source_refs: Vec<SourceRef> = all_members.iter().map(|f| to_source(f)).collect();

    let values: Vec<&str> = ordered.iter().map(|f| f.value.as_str()).collect();

    // Per-value provenance for the graph layer: polarity (explicit negation
    // state), text span, and sentence — keyed by value.
    let value_provenance: Vec<serde_json::Value> = ordered
        .iter()
        .map(|f| {
            serde_json::json!({
                "value": f.value,
                "polarity": f.polarity.as_str(),
                "char_offset_start": f.char_offset_start,
                "char_offset_end": f.char_offset_end,
                "sentence": sentence_or_raw(f),
            })
        })
        .collect();
    let conflict_type = match contradiction_type {
        "temporal_value" => FamilyConflictType::Temporal,
        _ => FamilyConflictType::Relational,
    };

    // FACT domain identity — read from the FactAssertion, where it was assigned
    // at EXTRACTION time. It is NOT re-derived here (no downstream inference).
    // All members of a (subject, attribute) group share the same domain.
    let fact_domain = distinct[0].fact_domain;

    let metadata = serde_json::json!({
        "origin": "fact_extraction",
        "contradiction_type": contradiction_type,
        "fact_domain": fact_domain.as_str(),
        "attribute": attribute,
        "fact_subject": subject,
        "values": values,
        "value_provenance": value_provenance,
    });

    let display_subject = format!("{subject}:{attribute}");
    // Node-id / contradiction-id semantics: `fact:{fact_domain}:{attribute}:{subject}`.
    // The `fact:` prefix guarantees no collision with clinical/family ids.
    let contradiction_id = format!("fact:{}:{}:{}", fact_domain.as_str(), attribute, subject);

    let body = CaseContradictionBody::Family(FamilyContradiction {
        contradiction_id: contradiction_id.clone(),
        conflict_type,
        pair: (subject.to_string(), None),
        subject: display_subject.clone(),
        canonical_value,
        alternatives,
        conflict_flag: true,
        resolution_confidence,
        source_refs,
        edge_ids: vec![],
        metadata,
    });

    CaseContradiction {
        domain,
        contradiction_id,
        conflict_label: "value_disagreement".to_string(),
        subject: display_subject,
        resolution_confidence,
        body,
    }
}

/// Convenience: extract facts from a document's clean text and build the
/// value-disagreement contradictions in one call. (Single-document; for
/// cross-document disagreement, collect facts across documents first and call
/// [`build_fact_contradictions`].)
pub fn fact_contradictions_from_text(clean_text: &str, doc_id: &str) -> Vec<CaseContradiction> {
    build_fact_contradictions(crate::fact_extract::extract_facts(clean_text, doc_id))
}

/// Serialisable, human-readable projection of a fact contradiction (for
/// diagnostics / API). Pure read of the `Family` body.
#[derive(Debug, Clone, Serialize)]
pub struct FactContradictionView {
    pub contradiction_id: String,
    pub domain: String,
    pub attribute: String,
    pub subject: String,
    pub contradiction_type: String,
    pub canonical_value: String,
    pub competing_values: Vec<String>,
    pub resolution_confidence: f32,
}

/// Project the fact contradictions in a stream into the diagnostic view.
pub fn fact_contradiction_views(contradictions: &[CaseContradiction]) -> Vec<FactContradictionView> {
    contradictions
        .iter()
        .filter_map(|c| {
            let CaseContradictionBody::Family(f) = &c.body else {
                return None;
            };
            // Only our fact-origin contradictions.
            let ct = f
                .metadata
                .get("contradiction_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if f.metadata.get("origin").and_then(|v| v.as_str()) != Some("fact_extraction") {
                return None;
            }
            let attribute = f
                .metadata
                .get("attribute")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some(FactContradictionView {
                contradiction_id: c.contradiction_id.clone(),
                domain: c.domain.as_str().to_string(),
                attribute,
                subject: c.subject.clone(),
                contradiction_type: ct.to_string(),
                canonical_value: f.canonical_value.value.clone(),
                competing_values: f.alternatives.iter().map(|a| a.value.clone()).collect(),
                resolution_confidence: c.resolution_confidence,
            })
        })
        .collect()
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fact_assertion::{fact_domain_of, FactPolarity};

    fn fact(subject: &str, attribute: &str, value: &str, off: usize) -> FactAssertion {
        FactAssertion {
            subject: subject.into(),
            attribute: attribute.into(),
            fact_domain: fact_domain_of(attribute),
            value: value.into(),
            polarity: FactPolarity::Affirmed,
            temporal: None,
            source_ids: vec!["docA".into()],
            char_offset_start: off,
            char_offset_end: off + value.len(),
            raw_text: value.into(),
            sentence: String::new(),
        }
    }

    #[test]
    fn two_distinct_values_make_a_contradiction() {
        let c = build_fact_contradictions(vec![
            fact("patient", "marital_status", "married", 10),
            fact("patient", "marital_status", "divorced", 80),
        ]);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].contradiction_id, "fact:family:marital_status:patient");
        assert_eq!(c[0].conflict_label, "value_disagreement");
        assert!(is_fact_contradiction(&c[0]));
        assert_eq!(fact_namespace(&c[0]), "fact:family");
        let v = fact_contradiction_views(&c);
        assert_eq!(v[0].canonical_value, "divorced"); // value-sorted ⇒ d < m
        assert_eq!(v[0].competing_values, vec!["married"]);
    }

    #[test]
    fn single_value_no_contradiction() {
        let c = build_fact_contradictions(vec![fact("patient", "marital_status", "married", 1)]);
        assert!(c.is_empty());
    }

    #[test]
    fn duplicate_same_value_no_contradiction() {
        let c = build_fact_contradictions(vec![
            fact("patient", "smoking_history", "never", 1),
            fact("patient", "smoking_history", "never", 50),
        ]);
        assert!(c.is_empty());
    }

    #[test]
    fn both_affirmed_still_contradicts() {
        // father alive vs deceased — both affirmed assertions.
        let c = build_fact_contradictions(vec![
            fact("father", "father_vital_status", "alive", 5),
            fact("father", "father_vital_status", "deceased", 60),
        ]);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].domain, ContradictionDomain::Family);
        let v = &fact_contradiction_views(&c)[0];
        assert_eq!(v.contradiction_type, "categorical_value");
        assert_eq!(v.canonical_value, "alive");
        assert_eq!(v.competing_values, vec!["deceased"]);
    }

    #[test]
    fn temporal_attribute_marked_temporal() {
        let c = build_fact_contradictions(vec![
            fact("patient", "injury_date", "2022-02-12", 5),
            fact("patient", "injury_date", "2022-02-18", 60),
        ]);
        let v = &fact_contradiction_views(&c)[0];
        assert_eq!(v.contradiction_type, "temporal_value");
        assert_eq!(v.domain, "clinical");
    }

    #[test]
    fn three_values_lower_confidence() {
        let c = build_fact_contradictions(vec![
            fact("patient", "marital_status", "married", 1),
            fact("patient", "marital_status", "divorced", 20),
            fact("patient", "marital_status", "separated", 40),
        ]);
        assert!((c[0].resolution_confidence - (1.0 / 3.0)).abs() < 1e-6);
        assert_eq!(fact_contradiction_views(&c)[0].competing_values.len(), 2);
    }

    #[test]
    fn from_text_end_to_end() {
        let t = "The patient is divorced. The later note says she is married.";
        let c = fact_contradictions_from_text(t, "docA");
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].contradiction_id, "fact:family:marital_status:patient");
    }
}
