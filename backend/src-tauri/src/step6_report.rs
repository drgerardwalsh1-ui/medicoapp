//! Canonical STEP-6 report — the single, stable aggregation object that future
//! UI screens, PDF/report exports, REST APIs, and expert-witness summaries can
//! consume instead of rebuilding the graph/analytics/narrative layers.
//!
//! PURE AGGREGATION ONLY: it calls the existing builders in sequence and bundles
//! their outputs. No business logic, no recomputation, no mutation, no
//! alternative code paths. `Vec`-only outputs (inherited from the layers); no
//! `HashMap`/`HashSet`.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::step6_enrichment::Step6View;
use crate::step6_graph::{build_step6_graph, Step6Graph};
use crate::step6_graph_analysis::{analyze_graph, ClinicalSignificance, GraphAnalytics};
use crate::step6_graph_narrative::{build_graph_narrative, GraphNarrative};

// ── Report model ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step6Report {
    pub view: Step6View,
    pub graph: Step6Graph,
    pub analytics: GraphAnalytics,
    pub narrative: GraphNarrative,
}

// ── Builder (aggregation only) ──────────────────────────────────────────────

/// Assemble the canonical report from a `Step6View`: build the graph, analyse
/// it, narrate it, and bundle. No recomputation beyond the existing builders;
/// the input `view` is carried verbatim into the report.
pub fn build_step6_report(view: Step6View) -> Step6Report {
    let graph = build_step6_graph(&view);
    let analytics = analyze_graph(&graph);
    let narrative = build_graph_narrative(&graph, &analytics);
    Step6Report { view, graph, analytics, narrative }
}

// ── Pure queries ────────────────────────────────────────────────────────────

pub fn contradiction_count(report: &Step6Report) -> usize {
    report.view.enriched_contradictions.len()
}

pub fn cluster_count(report: &Step6Report) -> usize {
    report.analytics.cluster_metrics.len()
}

/// Clusters whose significance is Medium OR High.
pub fn significant_cluster_count(report: &Step6Report) -> usize {
    report
        .analytics
        .cluster_metrics
        .iter()
        .filter(|c| {
            matches!(
                c.significance,
                ClinicalSignificance::Medium | ClinicalSignificance::High
            )
        })
        .count()
}

// ── Validation (read-only) ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportIntegrity {
    pub contradiction_count_matches: bool,
    pub cluster_count_matches: bool,
    pub narrative_count_matches: bool,
}

/// Cross-check the layers for internal consistency. Read-only; no repair.
pub fn validate_report(report: &Step6Report) -> ReportIntegrity {
    ReportIntegrity {
        // 1. analytics node_count == graph.nodes.len()
        contradiction_count_matches: report.analytics.graph_summary.node_count
            == report.graph.nodes.len(),
        // 2. analytics cluster_count == cluster_metrics.len()
        cluster_count_matches: report.analytics.graph_summary.cluster_count
            == report.analytics.cluster_metrics.len(),
        // 3. narrative cluster count == cluster_metrics.len()
        narrative_count_matches: report.narrative.cluster_narratives.len()
            == report.analytics.cluster_metrics.len(),
    }
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::{CaseContradiction, CaseContradictionBody, ContradictionDomain};
    use crate::family_graph::{FamilyConflictType, FamilyContradiction, FamilyValue};
    use crate::step6_enrichment::enrich_step6;

    fn cc(domain: ContradictionDomain, label: &str, subject: &str, rc: f32) -> CaseContradiction {
        let body = CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: "x".into(),
            conflict_type: FamilyConflictType::Relational,
            pair: ("a".into(), Some("b".into())),
            subject: subject.into(),
            canonical_value: FamilyValue {
                value: "v".into(),
                support_count: 1,
                confidence: rc,
                sources: vec![],
                edge_ids: vec![],
            },
            alternatives: vec![],
            conflict_flag: true,
            resolution_confidence: rc,
            source_refs: vec![],
            edge_ids: vec![],
            metadata: serde_json::json!({}),
        });
        CaseContradiction {
            domain,
            contradiction_id: format!("{}:{}:{}", domain.as_str(), label, subject),
            conflict_label: label.into(),
            subject: subject.into(),
            resolution_confidence: rc,
            body,
        }
    }

    // 3 clinical contradictions (fully connected ⇒ one Medium cluster of size 3)
    // + 1 isolated family contradiction (Low singleton).
    fn sample_view() -> Step6View {
        enrich_step6(vec![
            cc(ContradictionDomain::Clinical, "assertion", "fatigue", 0.50),
            cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.50),
            cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.50),
            cc(ContradictionDomain::Family, "relational", "a↔b", 0.40),
        ])
    }

    // 1.
    #[test]
    fn report_build_is_deterministic() {
        let r1 = build_step6_report(sample_view());
        let r2 = build_step6_report(sample_view());
        assert_eq!(
            serde_json::to_string(&r1).unwrap(),
            serde_json::to_string(&r2).unwrap()
        );
    }

    // 2.
    #[test]
    fn report_contains_all_layers() {
        let r = build_step6_report(sample_view());
        assert_eq!(r.view.enriched_contradictions.len(), 4);
        assert_eq!(r.graph.nodes.len(), 4);
        assert!(!r.analytics.cluster_metrics.is_empty());
        assert_eq!(
            r.narrative.cluster_narratives.len(),
            r.analytics.cluster_metrics.len()
        );
        assert!(r.narrative.graph_summary_text.starts_with("Graph contains 4 nodes"));
    }

    // 3.
    #[test]
    fn contradiction_count_matches_view() {
        let r = build_step6_report(sample_view());
        assert_eq!(contradiction_count(&r), r.view.enriched_contradictions.len());
        assert_eq!(contradiction_count(&r), 4);
    }

    // 4.
    #[test]
    fn cluster_count_matches_analytics() {
        let r = build_step6_report(sample_view());
        assert_eq!(cluster_count(&r), r.analytics.cluster_metrics.len());
        // clinical cluster {3 nodes} + family singleton = 2 clusters.
        assert_eq!(cluster_count(&r), 2);
    }

    // 5.
    #[test]
    fn significant_cluster_count_is_correct() {
        let r = build_step6_report(sample_view());
        // One Medium cluster (size 3); the family singleton is Low.
        assert_eq!(significant_cluster_count(&r), 1);
    }

    // 6.
    #[test]
    fn validate_report_success_case() {
        let r = build_step6_report(sample_view());
        let integ = validate_report(&r);
        assert_eq!(
            integ,
            ReportIntegrity {
                contradiction_count_matches: true,
                cluster_count_matches: true,
                narrative_count_matches: true,
            }
        );
    }

    // 7.
    #[test]
    fn validate_report_detects_mismatch() {
        let mut r = build_step6_report(sample_view());
        // Tamper the narrative layer (drop a narrative) ⇒ mismatch detected.
        r.narrative.cluster_narratives.pop();
        let integ = validate_report(&r);
        assert!(!integ.narrative_count_matches);
        // The other invariants are still intact.
        assert!(integ.contradiction_count_matches);
        assert!(integ.cluster_count_matches);

        // Tamper the graph (drop a node) ⇒ contradiction/node mismatch.
        let mut r2 = build_step6_report(sample_view());
        r2.graph.nodes.pop();
        assert!(!validate_report(&r2).contradiction_count_matches);
    }

    // 8.
    #[test]
    fn report_builder_does_not_modify_view() {
        let view = sample_view();
        let snapshot = serde_json::to_string(&view).unwrap();
        let r = build_step6_report(view);
        // The view is carried verbatim into the report (no mutation).
        assert_eq!(serde_json::to_string(&r.view).unwrap(), snapshot);
    }
}
