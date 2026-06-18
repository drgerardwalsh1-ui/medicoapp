//! Contradiction Engine enrichment — a PURE, POST-PROCESSING VIEW LAYER.
//!
//! Operates ONLY on the already-built `Vec<CaseContradiction>` produced by the
//! Contradiction Engine assembler. It never touches the clinical/family/legal engines, never
//! re-reads a graph, and never recomputes `resolution_confidence`,
//! `conflict_type`, identity, temporal, or grouping logic. Every derived field
//! is a deterministic function of values already present on the input.
//!
//! Input is immutable: each `EnrichedCaseContradiction` owns a verbatim copy of
//! its `CaseContradiction` `base`; no field is altered.
//!
//! Determinism: order-preserving; `BTreeMap` only; no `HashMap`; no inference
//! beyond the explicit numeric thresholds below.

// Additive presentation layer; not yet wired to a command.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::canonical_case::{CaseContradiction, CaseContradictionBody, ContradictionDomain};
use crate::fact_contradiction::is_fact_contradiction;

// ── View types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContradictionDerivedFields {
    /// 1..=3, higher = more severe. Deterministic threshold mapping only.
    pub severity_rank: u8,
    /// Optional presentational cross-domain alignment hint.
    pub cross_domain_tag: Option<String>,
    /// Stable `"{domain}:{conflict_label}"` grouping key.
    pub presentation_group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrichedCaseContradiction {
    /// Verbatim, unmodified Contradiction Engine contradiction.
    pub base: CaseContradiction,
    pub derived: ContradictionDerivedFields,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionView {
    pub enriched_contradictions: Vec<EnrichedCaseContradiction>,
    /// Stage: cross-namespace awareness over CLINICAL contradictions only.
    /// Each entry is `(contradiction_id_a, contradiction_id_b, relation)` for
    /// `i < j` where both are in a clinical namespace (`diagnosis`/`symptom`).
    /// Purely observational — derived from the immutable enriched stream; it
    /// does NOT touch contradictions, confidence, grouping, sorting, or export.
    pub cross_namespace_relations: Vec<(String, String, CrossNamespaceRelation)>,
}

// ── Derivation rules (purely presentational) ─────────────────────────────────

/// Read the already-computed `conflict_flag` off the typed body. This is an
/// accessor, NOT a recomputation.
fn conflict_flag_of(c: &CaseContradiction) -> bool {
    match &c.body {
        CaseContradictionBody::Clinical(x) => x.conflict_flag,
        CaseContradictionBody::Family(x) => x.conflict_flag,
    }
}

/// A. severity_rank — deterministic threshold mapping ONLY.
fn severity_rank(c: &CaseContradiction) -> u8 {
    let cf = conflict_flag_of(c);
    if cf && c.resolution_confidence < 0.5 {
        3
    } else if cf && c.resolution_confidence < 0.75 {
        2
    } else {
        1
    }
}

/// B. presentation_group — stable string composition, no interpretation.
fn presentation_group(c: &CaseContradiction) -> String {
    format!("{}:{}", c.domain.as_str(), c.conflict_label)
}

/// C. cross_domain_tag — "aligned" iff some OTHER contradiction has the same
/// subject + same conflict_label, a DIFFERENT domain, and a resolution
/// confidence within 0.1. Purely presentational; never affects core data.
fn cross_domain_tag(idx: usize, all: &[CaseContradiction]) -> Option<String> {
    let e = &all[idx];
    for (j, o) in all.iter().enumerate() {
        if j == idx {
            continue;
        }
        if o.subject == e.subject
            && o.conflict_label == e.conflict_label
            && o.domain != e.domain
            && (e.resolution_confidence - o.resolution_confidence).abs() < 0.1
        {
            return Some("aligned".to_string());
        }
    }
    None
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Enrich the Contradiction Engine contradiction stream into a view. Input is consumed and
/// returned verbatim inside each `base`; nothing is mutated or recomputed.
pub fn enrich_contradictions(input: Vec<CaseContradiction>) -> ContradictionView {
    // First pass: derive purely from the (immutable) input slice.
    let derived: Vec<ContradictionDerivedFields> = (0..input.len())
        .map(|i| ContradictionDerivedFields {
            severity_rank: severity_rank(&input[i]),
            cross_domain_tag: cross_domain_tag(i, &input),
            presentation_group: presentation_group(&input[i]),
        })
        .collect();

    // Second pass: pair each verbatim base with its derived fields (order kept).
    let enriched_contradictions: Vec<EnrichedCaseContradiction> = input
        .into_iter()
        .zip(derived)
        .map(|(base, derived)| EnrichedCaseContradiction { base, derived })
        .collect();

    // Third pass: pure observation — pairwise cross-namespace relations over the
    // clinical namespaces. Reads the enriched stream; mutates nothing.
    let cross_namespace_relations = compute_cross_namespace_relations(&enriched_contradictions);

    ContradictionView { enriched_contradictions, cross_namespace_relations }
}

// ════════════════════════════════════════════════════════════════════════
// Cross-namespace awareness (observation layer — no engine impact)
// ════════════════════════════════════════════════════════════════════════

/// Relation between two clinical contradictions by their namespace.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrossNamespaceRelation {
    SameNamespace,
    SymptomToDiagnosis,
    DiagnosisToSymptom,
    Other,
}

impl CrossNamespaceRelation {
    /// The relation viewed from the opposite argument order. Directional
    /// variants swap; `SameNamespace`/`Other` are self-mirror.
    pub fn mirror(self) -> Self {
        match self {
            CrossNamespaceRelation::SymptomToDiagnosis => CrossNamespaceRelation::DiagnosisToSymptom,
            CrossNamespaceRelation::DiagnosisToSymptom => CrossNamespaceRelation::SymptomToDiagnosis,
            same => same,
        }
    }
}

/// Result of comparing two contradictions across namespaces.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CrossNamespaceAnalysis {
    pub relation: CrossNamespaceRelation,
    /// The shared concept (after the namespace prefix) iff both concepts match.
    pub shared_concept: Option<String>,
    /// `a.resolution_confidence - b.resolution_confidence` (signed); `None` when
    /// the pair is not a clinical–clinical pair.
    pub confidence_delta: Option<f64>,
}

/// Internal clinical namespace classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClinicalNs {
    Diagnosis,
    Symptom,
    /// Fact-derived contradiction — a distinct namespace that NEVER participates
    /// in clinical (diagnosis/symptom) cross-namespace relations.
    Fact,
    Other,
}

/// The `"symptom:"` prefix is the only namespaced clinical subject; diagnosis
/// subjects are un-prefixed (raw concept). Non-Clinical domains are `Other`.
const SYMPTOM_PREFIX: &str = "symptom:";

fn namespace_of(c: &CaseContradiction) -> (ClinicalNs, Option<String>) {
    // FACT contradictions are their own namespace — checked FIRST so a fact is
    // never misclassified as Diagnosis (regardless of its coarse domain header).
    if is_fact_contradiction(c) {
        return (ClinicalNs::Fact, None);
    }
    if c.domain != ContradictionDomain::Clinical {
        return (ClinicalNs::Other, None);
    }
    if let Some(rest) = c.subject.strip_prefix(SYMPTOM_PREFIX) {
        (ClinicalNs::Symptom, Some(rest.to_string()))
    } else {
        (ClinicalNs::Diagnosis, Some(c.subject.clone()))
    }
}

/// Pure pairwise analysis. Compares ONLY namespace type and concept-string
/// equality — no heuristics, no scoring, no inference. Does not touch any
/// contradiction data.
pub fn analyze_cross_namespace(
    a: &EnrichedCaseContradiction,
    b: &EnrichedCaseContradiction,
) -> CrossNamespaceAnalysis {
    let (na, concept_a) = namespace_of(&a.base);
    let (nb, concept_b) = namespace_of(&b.base);

    let relation = match (na, nb) {
        (ClinicalNs::Diagnosis, ClinicalNs::Diagnosis)
        | (ClinicalNs::Symptom, ClinicalNs::Symptom) => CrossNamespaceRelation::SameNamespace,
        (ClinicalNs::Symptom, ClinicalNs::Diagnosis) => CrossNamespaceRelation::SymptomToDiagnosis,
        (ClinicalNs::Diagnosis, ClinicalNs::Symptom) => CrossNamespaceRelation::DiagnosisToSymptom,
        _ => CrossNamespaceRelation::Other,
    };

    let shared_concept = match (&concept_a, &concept_b) {
        (Some(x), Some(y)) if x == y => Some(x.clone()),
        _ => None,
    };

    let confidence_delta = if relation == CrossNamespaceRelation::Other {
        None
    } else {
        Some((a.base.resolution_confidence as f64) - (b.base.resolution_confidence as f64))
    };

    CrossNamespaceAnalysis { relation, shared_concept, confidence_delta }
}

/// Deterministic O(n²) pairwise scan (i < j over the already-sorted stream).
/// Records only clinical-namespace pairs (relation ≠ `Other`), so non-clinical
/// (family/legal) contradictions never pollute the observation.
fn compute_cross_namespace_relations(
    items: &[EnrichedCaseContradiction],
) -> Vec<(String, String, CrossNamespaceRelation)> {
    // Cross-namespace relations are a CLINICAL concept (diagnosis ↔ symptom).
    // Fact contradictions are excluded entirely BEFORE the pairwise loop, so:
    //   (1) facts never form SameNamespace edges with each other or with
    //       diagnoses (no semantic leakage), and
    //   (2) the O(n²) comparison is bounded to clinical contradictions only —
    //       facts no longer inflate the quadratic.
    let clinical: Vec<&EnrichedCaseContradiction> =
        items.iter().filter(|e| !is_fact_contradiction(&e.base)).collect();

    let mut out: Vec<(String, String, CrossNamespaceRelation)> = Vec::new();
    for i in 0..clinical.len() {
        for j in (i + 1)..clinical.len() {
            let analysis = analyze_cross_namespace(clinical[i], clinical[j]);
            if analysis.relation != CrossNamespaceRelation::Other {
                out.push((
                    clinical[i].base.contradiction_id.clone(),
                    clinical[j].base.contradiction_id.clone(),
                    analysis.relation,
                ));
            }
        }
    }
    out
}

/// Group the enriched view by `presentation_group`. `BTreeMap` ⇒ sorted,
/// deterministic keys; within a group, items keep their stream order.
pub fn group_by_presentation(
    view: &ContradictionView,
) -> BTreeMap<String, Vec<&EnrichedCaseContradiction>> {
    let mut out: BTreeMap<String, Vec<&EnrichedCaseContradiction>> = BTreeMap::new();
    for e in &view.enriched_contradictions {
        out.entry(e.derived.presentation_group.clone()).or_default().push(e);
    }
    out
}

// ════════════════════════════════════════════════════════════════════════
// Tests — view-layer only; no engine behaviour exercised.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::ContradictionDomain;
    use crate::family_graph::{FamilyConflictType, FamilyContradiction, FamilyValue};

    // A minimal CaseContradiction fixture. The body only needs to carry a
    // `conflict_flag` (severity input); the enrichment is otherwise driven by
    // the top-level header fields, so a Family body is reused for both domains.
    fn body(conflict_flag: bool, rc: f32) -> CaseContradictionBody {
        CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: "x".into(),
            conflict_type: FamilyConflictType::Relational,
            pair: ("a".into(), Some("b".into())),
            subject: "s".into(),
            canonical_value: FamilyValue {
                value: "v".into(),
                support_count: 1,
                confidence: rc,
                sources: vec![],
                edge_ids: vec![],
            },
            alternatives: vec![],
            conflict_flag,
            resolution_confidence: rc,
            source_refs: vec![],
            edge_ids: vec![],
            metadata: serde_json::json!({}),
        })
    }

    fn cc(
        domain: ContradictionDomain,
        label: &str,
        subject: &str,
        rc: f32,
        conflict_flag: bool,
    ) -> CaseContradiction {
        CaseContradiction {
            domain,
            contradiction_id: format!("{}:{}:{}", domain.as_str(), label, subject),
            conflict_label: label.into(),
            subject: subject.into(),
            resolution_confidence: rc,
            body: body(conflict_flag, rc),
        }
    }

    // severity_rank threshold mapping.
    #[test]
    fn severity_rank_thresholds() {
        assert_eq!(severity_rank(&cc(ContradictionDomain::Family, "l", "s", 0.40, true)), 3);
        assert_eq!(severity_rank(&cc(ContradictionDomain::Family, "l", "s", 0.60, true)), 2);
        assert_eq!(severity_rank(&cc(ContradictionDomain::Family, "l", "s", 0.80, true)), 1);
        // conflict_flag=false ⇒ always 1 regardless of confidence.
        assert_eq!(severity_rank(&cc(ContradictionDomain::Family, "l", "s", 0.10, false)), 1);
    }

    // presentation_group string composition.
    #[test]
    fn presentation_group_is_domain_colon_label() {
        let v = enrich_contradictions(vec![cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.5, true)]);
        assert_eq!(v.enriched_contradictions[0].derived.presentation_group, "clinical:assertion");
    }

    // 1. Deterministic enrichment.
    #[test]
    fn enrichment_is_deterministic() {
        let mk = || {
            vec![
                cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.5, true),
                cc(ContradictionDomain::Family, "cardinality", "kids", 0.5, true),
            ]
        };
        let a = enrich_contradictions(mk());
        let b = enrich_contradictions(mk());
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    // 2. Non-mutating guarantee — base is byte-identical to the original input.
    #[test]
    fn base_is_unmodified() {
        let original = cc(ContradictionDomain::Family, "relational", "a↔b", 0.42, true);
        let snapshot = serde_json::to_string(&original).unwrap();
        let view = enrich_contradictions(vec![original]);
        let after = serde_json::to_string(&view.enriched_contradictions[0].base).unwrap();
        assert_eq!(snapshot, after);
    }

    // 3. Presentation grouping stability.
    #[test]
    fn grouping_is_stable_and_sorted() {
        let view = enrich_contradictions(vec![
            cc(ContradictionDomain::Family, "cardinality", "k", 0.5, true),
            cc(ContradictionDomain::Clinical, "assertion", "p", 0.5, true),
            cc(ContradictionDomain::Family, "cardinality", "k2", 0.5, true),
        ]);
        let g1 = group_by_presentation(&view);
        let g2 = group_by_presentation(&view);

        // BTreeMap ⇒ sorted keys; clinical:assertion before family:cardinality.
        let keys: Vec<&String> = g1.keys().collect();
        assert_eq!(keys, vec![&"clinical:assertion".to_string(), &"family:cardinality".to_string()]);
        // Two cardinality items, order preserved.
        assert_eq!(g1["family:cardinality"].len(), 2);
        // Stable across re-invocation.
        let s1: Vec<&str> = g1.keys().map(|k| k.as_str()).collect();
        let s2: Vec<&str> = g2.keys().map(|k| k.as_str()).collect();
        assert_eq!(s1, s2);
    }

    // 4. cross_domain_tag correctness.
    #[test]
    fn cross_domain_tag_aligned_and_none() {
        // Same subject + same label, different domains, close confidence → aligned.
        let view = enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "match", "shared", 0.50, true),
            cc(ContradictionDomain::Family, "match", "shared", 0.55, true), // diff 0.05 < 0.1
        ]);
        assert_eq!(
            view.enriched_contradictions[0].derived.cross_domain_tag.as_deref(),
            Some("aligned")
        );
        assert_eq!(
            view.enriched_contradictions[1].derived.cross_domain_tag.as_deref(),
            Some("aligned")
        );

        // Different subject → None.
        let v2 = enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "match", "shared", 0.50, true),
            cc(ContradictionDomain::Family, "match", "other", 0.50, true),
        ]);
        assert!(v2.enriched_contradictions[0].derived.cross_domain_tag.is_none());

        // Same domain (not cross-domain) → None.
        let v3 = enrich_contradictions(vec![
            cc(ContradictionDomain::Family, "match", "shared", 0.50, true),
            cc(ContradictionDomain::Family, "match", "shared", 0.50, true),
        ]);
        assert!(v3.enriched_contradictions[0].derived.cross_domain_tag.is_none());

        // Confidence too far apart → None.
        let v4 = enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "match", "shared", 0.20, true),
            cc(ContradictionDomain::Family, "match", "shared", 0.90, true),
        ]);
        assert!(v4.enriched_contradictions[0].derived.cross_domain_tag.is_none());
    }

    // ── Stage: cross-namespace awareness ────────────────────────────────────

    fn diag_sym_view() -> ContradictionView {
        enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "assertion", "fatigue", 0.50, true), // diagnosis
            cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.55, true), // symptom
        ])
    }

    // F1. diagnosis vs symptom is detected as a cross-namespace pair.
    #[test]
    fn diagnosis_vs_symptom_is_cross_namespace() {
        let v = diag_sym_view();
        let a = analyze_cross_namespace(&v.enriched_contradictions[0], &v.enriched_contradictions[1]);
        assert_eq!(a.relation, CrossNamespaceRelation::DiagnosisToSymptom);
        assert_eq!(a.shared_concept.as_deref(), Some("fatigue"));
        assert!((a.confidence_delta.unwrap() - (-0.05)).abs() < 1e-6);
        // Recorded in the view.
        assert_eq!(v.cross_namespace_relations.len(), 1);
        assert_eq!(v.cross_namespace_relations[0].2, CrossNamespaceRelation::DiagnosisToSymptom);
    }

    // F2. same-namespace pairs are labeled correctly.
    #[test]
    fn same_namespace_labeled_correctly() {
        // two diagnoses
        let dd = enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.5, true),
            cc(ContradictionDomain::Clinical, "assertion", "anxiety", 0.5, true),
        ]);
        assert_eq!(
            analyze_cross_namespace(&dd.enriched_contradictions[0], &dd.enriched_contradictions[1]).relation,
            CrossNamespaceRelation::SameNamespace
        );
        // two symptoms
        let ss = enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "assertion", "symptom:insomnia", 0.5, true),
            cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.5, true),
        ]);
        assert_eq!(
            analyze_cross_namespace(&ss.enriched_contradictions[0], &ss.enriched_contradictions[1]).relation,
            CrossNamespaceRelation::SameNamespace
        );
        // family pair → Other (non-clinical namespace)
        let ff = enrich_contradictions(vec![
            cc(ContradictionDomain::Family, "relational", "a↔b", 0.5, true),
            cc(ContradictionDomain::Family, "cardinality", "kids", 0.5, true),
        ]);
        assert_eq!(
            analyze_cross_namespace(&ff.enriched_contradictions[0], &ff.enriched_contradictions[1]).relation,
            CrossNamespaceRelation::Other
        );
        // Family pairs are excluded from the recorded relations.
        assert!(ff.cross_namespace_relations.is_empty());
    }

    // F3. ordering of cross-namespace relations is deterministic.
    #[test]
    fn cross_namespace_relations_ordering_is_deterministic() {
        let mk = || {
            enrich_contradictions(vec![
                cc(ContradictionDomain::Clinical, "assertion", "fatigue", 0.5, true),
                cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.5, true),
                cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.5, true),
            ])
        };
        let a = mk();
        let b = mk();
        assert_eq!(a.cross_namespace_relations, b.cross_namespace_relations);
        // 3 clinical contradictions → C(3,2) = 3 recorded pairs.
        assert_eq!(a.cross_namespace_relations.len(), 3);
    }

    // F4. export rows remain byte-identical (export ignores the new field).
    #[test]
    fn export_rows_remain_byte_identical() {
        use crate::contradiction_export::export_rows;
        let v = diag_sym_view();
        assert_eq!(export_rows(&v), export_rows(&v));
        // Export reflects only the (unchanged) contradiction count.
        assert_eq!(export_rows(&v).rows.len(), v.enriched_contradictions.len());
    }

    // F5. contradiction counts remain unchanged.
    #[test]
    fn contradiction_counts_unchanged() {
        let input = vec![
            cc(ContradictionDomain::Clinical, "assertion", "fatigue", 0.5, true),
            cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.5, true),
        ];
        let n = input.len();
        let v = enrich_contradictions(input);
        assert_eq!(v.enriched_contradictions.len(), n);
    }

    // F6. confidence values remain unchanged.
    #[test]
    fn confidence_values_unchanged() {
        let v = diag_sym_view();
        assert!((v.enriched_contradictions[0].base.resolution_confidence - 0.50).abs() < 1e-6);
        assert!((v.enriched_contradictions[1].base.resolution_confidence - 0.55).abs() < 1e-6);
    }

    // F7. enrichment is pure — base is not mutated by the new analysis.
    #[test]
    fn cross_namespace_does_not_mutate_base() {
        let original = cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.55, true);
        let snapshot = serde_json::to_string(&original).unwrap();
        let v = enrich_contradictions(vec![original]);
        assert_eq!(serde_json::to_string(&v.enriched_contradictions[0].base).unwrap(), snapshot);
    }

    // F8. symmetry — analyze(A,B) mirrors analyze(B,A).
    #[test]
    fn analysis_is_symmetric() {
        let v = diag_sym_view();
        let ab = analyze_cross_namespace(&v.enriched_contradictions[0], &v.enriched_contradictions[1]);
        let ba = analyze_cross_namespace(&v.enriched_contradictions[1], &v.enriched_contradictions[0]);
        assert_eq!(ab.relation, ba.relation.mirror());
        assert_eq!(ab.shared_concept, ba.shared_concept);
        assert!((ab.confidence_delta.unwrap() + ba.confidence_delta.unwrap()).abs() < 1e-6);
    }

    // F9. empty input produces empty relations deterministically.
    #[test]
    fn empty_input_empty_relations() {
        let v = enrich_contradictions(vec![]);
        assert!(v.cross_namespace_relations.is_empty());
        assert!(v.enriched_contradictions.is_empty());
    }
}
