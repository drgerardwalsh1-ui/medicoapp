//! Contradiction Engine snapshot evolution analysis — deterministic, read-only derivation that
//! goes beyond add/remove (the diff layer) to detect *modifications* to
//! contradictions that persist across two snapshots, plus graph and narrative
//! evolution.
//!
//! PURE DERIVATION: no engine, enrichment, graph, analytics, narrative, report,
//! snapshot, repository, or diff logic is touched or recomputed. Identity is
//! exact `contradiction_id` only — never subject/confidence/graph/fuzzy. Set math
//! via `BTreeMap`/`BTreeSet`; outputs are sorted `Vec`s. No `HashMap`/`HashSet`,
//! no async, no I/O, no timestamps, no randomness.

#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use crate::contradiction_report_snapshot::ContradictionReportSnapshot;

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct ModifiedContradiction {
    pub contradiction_id: String,
    pub confidence_changed: bool,
    pub old_confidence: f64,
    pub new_confidence: f64,
    pub subject_changed: bool,
    pub old_subject: String,
    pub new_subject: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphEvolution {
    pub nodes_added: isize,
    pub nodes_removed: isize,
    pub edges_added: isize,
    pub edges_removed: isize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NarrativeEvolution {
    pub cluster_narratives_changed: usize,
    pub graph_summary_changed: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EvolutionAnalysis {
    pub added_contradictions: usize,
    pub removed_contradictions: usize,
    pub modified_contradictions: Vec<ModifiedContradiction>,
    pub graph_evolution: GraphEvolution,
    pub narrative_evolution: NarrativeEvolution,
}

// ── Internal helpers (read-only) ───────────────────────────────────────────────

/// `contradiction_id -> (confidence, subject)` for a snapshot. BTreeMap keeps
/// iteration deterministic; identity is the key only.
fn id_index(s: &ContradictionReportSnapshot) -> BTreeMap<String, (f64, String)> {
    s.report
        .view
        .enriched_contradictions
        .iter()
        .map(|e| {
            (
                e.base.contradiction_id.clone(),
                (e.base.resolution_confidence as f64, e.base.subject.clone()),
            )
        })
        .collect()
}

fn pos_delta(from: usize, to: usize) -> isize {
    if to > from {
        (to - from) as isize
    } else {
        0
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Deterministic evolution analysis `from → to`. Read-only; mutates nothing;
/// recomputes no report.
pub fn analyze_evolution(
    from: &ContradictionReportSnapshot,
    to: &ContradictionReportSnapshot,
) -> EvolutionAnalysis {
    let from_idx = id_index(from);
    let to_idx = id_index(to);

    let from_ids: BTreeSet<&String> = from_idx.keys().collect();
    let to_ids: BTreeSet<&String> = to_idx.keys().collect();

    let added_contradictions = to_ids.difference(&from_ids).count();
    let removed_contradictions = from_ids.difference(&to_ids).count();

    // Modifications: ids present in BOTH; compare confidence and subject.
    // Iterating from_idx (a BTreeMap) yields ids in sorted order ⇒ output sorted.
    let mut modified_contradictions: Vec<ModifiedContradiction> = Vec::new();
    for (id, (old_conf, old_subj)) in &from_idx {
        if let Some((new_conf, new_subj)) = to_idx.get(id) {
            let confidence_changed = old_conf != new_conf;
            let subject_changed = old_subj != new_subj;
            if confidence_changed || subject_changed {
                modified_contradictions.push(ModifiedContradiction {
                    contradiction_id: id.clone(),
                    confidence_changed,
                    old_confidence: *old_conf,
                    new_confidence: *new_conf,
                    subject_changed,
                    old_subject: old_subj.clone(),
                    new_subject: new_subj.clone(),
                });
            }
        }
    }

    let old_nodes = from.report.graph.nodes.len();
    let new_nodes = to.report.graph.nodes.len();
    let old_edges = from.report.graph.edges.len();
    let new_edges = to.report.graph.edges.len();
    let graph_evolution = GraphEvolution {
        nodes_added: pos_delta(old_nodes, new_nodes),
        nodes_removed: pos_delta(new_nodes, old_nodes),
        edges_added: pos_delta(old_edges, new_edges),
        edges_removed: pos_delta(new_edges, old_edges),
    };

    let from_nar = &from.report.narrative;
    let to_nar = &to.report.narrative;
    let graph_summary_changed = from_nar.graph_summary_text != to_nar.graph_summary_text;
    // Compare cluster narratives position-by-position (exact string equality).
    let cluster_narratives_changed = from_nar
        .cluster_narratives
        .iter()
        .zip(to_nar.cluster_narratives.iter())
        .filter(|(a, b)| a.summary != b.summary)
        .count();
    let narrative_evolution = NarrativeEvolution {
        cluster_narratives_changed,
        graph_summary_changed,
    };

    EvolutionAnalysis {
        added_contradictions,
        removed_contradictions,
        modified_contradictions,
        graph_evolution,
        narrative_evolution,
    }
}

/// True iff nothing changed at all.
pub fn evolution_is_empty(analysis: &EvolutionAnalysis) -> bool {
    analysis.added_contradictions == 0
        && analysis.removed_contradictions == 0
        && analysis.modified_contradictions.is_empty()
        && analysis.graph_evolution
            == GraphEvolution { nodes_added: 0, nodes_removed: 0, edges_added: 0, edges_removed: 0 }
        && !analysis.narrative_evolution.graph_summary_changed
        && analysis.narrative_evolution.cluster_narratives_changed == 0
}

/// Fixed-template headline. Exactly one of two strings.
pub fn evolution_headline(analysis: &EvolutionAnalysis) -> String {
    if evolution_is_empty(analysis) {
        "No report changes detected".to_string()
    } else {
        "Report evolution detected".to_string()
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
    use crate::contradiction_enrichment::enrich_contradictions;
    use crate::contradiction_report::build_contradiction_report;
    use crate::contradiction_report_snapshot::build_report_snapshot;

    /// Build a contradiction with an EXPLICIT id (so subject can change while id
    /// stays stable).
    fn cc(id: &str, subject: &str, conf: f32) -> CaseContradiction {
        let body = CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: "x".into(),
            conflict_type: FamilyConflictType::Relational,
            pair: ("a".into(), Some("b".into())),
            subject: subject.into(),
            canonical_value: FamilyValue {
                value: "v".into(),
                support_count: 1,
                confidence: conf,
                sources: vec![],
                edge_ids: vec![],
            },
            alternatives: vec![],
            conflict_flag: true,
            resolution_confidence: conf,
            source_refs: vec![],
            edge_ids: vec![],
            metadata: serde_json::json!({}),
        });
        CaseContradiction {
            domain: ContradictionDomain::Clinical,
            contradiction_id: id.into(),
            conflict_label: "assertion".into(),
            subject: subject.into(),
            resolution_confidence: conf,
            body,
        }
    }

    /// Snapshot from explicit (id, subject, confidence) triples.
    fn snap(items: &[(&str, &str, f32)], ts: u64) -> ContradictionReportSnapshot {
        let ccs: Vec<CaseContradiction> =
            items.iter().map(|(id, s, c)| cc(id, s, *c)).collect();
        let report = build_contradiction_report(enrich_contradictions(ccs));
        build_report_snapshot(report, ts)
    }

    // 1.
    #[test]
    fn identical_snapshots_have_no_evolution() {
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert!(evolution_is_empty(&e));
        assert_eq!(e.added_contradictions, 0);
        assert_eq!(e.removed_contradictions, 0);
        assert!(e.modified_contradictions.is_empty());
    }

    // 2.
    #[test]
    fn confidence_change_detected() {
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.9), ("i2", "b", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert_eq!(e.modified_contradictions.len(), 1);
        let m = &e.modified_contradictions[0];
        assert_eq!(m.contradiction_id, "i1");
        assert!(m.confidence_changed);
        assert!(!m.subject_changed);
        assert_eq!(m.old_confidence, 0.5_f32 as f64);
        assert_eq!(m.new_confidence, 0.9_f32 as f64);
    }

    // 3.
    #[test]
    fn subject_change_detected() {
        // Same id, different subject (id is explicit, decoupled from subject).
        let a = snap(&[("i1", "old", 0.5)], 1);
        let b = snap(&[("i1", "new", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert_eq!(e.modified_contradictions.len(), 1);
        let m = &e.modified_contradictions[0];
        assert!(m.subject_changed);
        assert!(!m.confidence_changed);
        assert_eq!(m.old_subject, "old");
        assert_eq!(m.new_subject, "new");
    }

    // 4.
    #[test]
    fn multiple_modifications_are_sorted() {
        let a = snap(&[("z", "a", 0.5), ("a", "a", 0.5), ("m", "a", 0.5)], 1);
        let b = snap(&[("z", "a", 0.9), ("a", "a", 0.9), ("m", "a", 0.9)], 2);
        let e = analyze_evolution(&a, &b);
        let ids: Vec<String> =
            e.modified_contradictions.iter().map(|m| m.contradiction_id.clone()).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
        assert_eq!(ids, vec!["a".to_string(), "m".to_string(), "z".to_string()]);
    }

    // 5.
    #[test]
    fn graph_node_change_detected() {
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert_eq!(e.graph_evolution.nodes_added, 1);
        assert_eq!(e.graph_evolution.nodes_removed, 0);
        assert_eq!(e.added_contradictions, 1);
    }

    // 6.
    #[test]
    fn graph_edge_change_detected() {
        // 2 clinical (1 edge) → 3 clinical (3 edges) ⇒ +2 edges.
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert_eq!(e.graph_evolution.edges_added, 2);
        assert_eq!(e.graph_evolution.edges_removed, 0);
        // Reverse direction ⇒ edges removed.
        let e2 = analyze_evolution(&b, &a);
        assert_eq!(e2.graph_evolution.edges_removed, 2);
        assert_eq!(e2.graph_evolution.nodes_removed, 1);
    }

    // 7.
    #[test]
    fn narrative_summary_change_detected() {
        // Different node/edge counts ⇒ graph_summary_text differs.
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert!(e.narrative_evolution.graph_summary_changed);
    }

    // 8.
    #[test]
    fn cluster_narrative_change_detected() {
        // Same counts (3 clinical, 1 cluster) but one confidence changes ⇒ the
        // cluster's average-confidence text changes; graph summary unchanged.
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.9), ("i2", "b", 0.5), ("i3", "c", 0.5)], 2);
        let e = analyze_evolution(&a, &b);
        assert_eq!(e.narrative_evolution.cluster_narratives_changed, 1);
        assert!(!e.narrative_evolution.graph_summary_changed); // counts identical
        // And the modification itself is captured.
        assert_eq!(e.modified_contradictions.len(), 1);
    }

    // 9.
    #[test]
    fn evolution_headline_is_stable() {
        let a = snap(&[("i1", "a", 0.5)], 1);
        let same = snap(&[("i1", "a", 0.5)], 2);
        assert_eq!(evolution_headline(&analyze_evolution(&a, &same)), "No report changes detected");

        let changed = snap(&[("i1", "a", 0.9)], 2);
        assert_eq!(
            evolution_headline(&analyze_evolution(&a, &changed)),
            "Report evolution detected"
        );
    }

    // 10.
    #[test]
    fn analysis_does_not_modify_inputs() {
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.9), ("i2", "b", 0.5), ("i3", "c", 0.5)], 2);
        let a_before = serde_json::to_string(&a).unwrap();
        let b_before = serde_json::to_string(&b).unwrap();
        let _ = analyze_evolution(&a, &b);
        assert_eq!(serde_json::to_string(&a).unwrap(), a_before);
        assert_eq!(serde_json::to_string(&b).unwrap(), b_before);
    }

    // 11. (extra) deterministic across runs.
    #[test]
    fn evolution_is_deterministic_across_runs() {
        let a = snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1);
        let b = snap(&[("i1", "a", 0.9), ("i3", "c", 0.5)], 2);
        let e1 = analyze_evolution(&a, &b);
        let e2 = analyze_evolution(&a, &b);
        assert_eq!(e1, e2);
        // i2 removed, i3 added, i1 modified.
        assert_eq!(e1.added_contradictions, 1);
        assert_eq!(e1.removed_contradictions, 1);
        assert_eq!(e1.modified_contradictions.len(), 1);
    }
}
