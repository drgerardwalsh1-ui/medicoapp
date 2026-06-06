//! STEP-6 snapshot diff — deterministic, read-only comparison of two
//! `Step6ReportSnapshot`s. Answers "what changed between two reports?" using
//! exact `contradiction_id` identity only.
//!
//! PURE DERIVATION: no report generation, graph construction, analytics,
//! narrative, repository, or persistence logic is touched or recomputed. Only
//! already-computed snapshot data is compared. `BTreeSet` used internally for
//! deterministic set math; all output collections are sorted `Vec`s. No
//! `HashMap`/`HashSet`, no async, no I/O.

#![allow(dead_code)]

use std::collections::BTreeSet;

use crate::step6_report_snapshot::Step6ReportSnapshot;
use crate::step6_snapshot_repository::{newest_snapshot, SnapshotRepository};

// ── Diff model ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotDiff {
    pub from_report_id: String,
    pub to_report_id: String,

    pub contradiction_count_delta: isize,
    pub cluster_count_delta: isize,
    pub node_count_delta: isize,
    pub edge_count_delta: isize,

    pub added_contradictions: Vec<String>,
    pub removed_contradictions: Vec<String>,

    pub added_clusters: usize,
    pub removed_clusters: usize,
}

// ── Internal helpers (read-only) ───────────────────────────────────────────────

/// Sorted, de-duplicated set of contradiction ids in a snapshot.
fn contradiction_ids(snapshot: &Step6ReportSnapshot) -> BTreeSet<String> {
    snapshot
        .report
        .view
        .enriched_contradictions
        .iter()
        .map(|e| e.base.contradiction_id.clone())
        .collect()
}

fn cluster_len(s: &Step6ReportSnapshot) -> usize {
    s.report.analytics.cluster_metrics.len()
}
fn contradiction_len(s: &Step6ReportSnapshot) -> usize {
    s.report.view.enriched_contradictions.len()
}
fn node_len(s: &Step6ReportSnapshot) -> usize {
    s.report.graph.nodes.len()
}
fn edge_len(s: &Step6ReportSnapshot) -> usize {
    s.report.graph.edges.len()
}

fn delta(from: usize, to: usize) -> isize {
    to as isize - from as isize
}

// ── Diff builder ───────────────────────────────────────────────────────────────

/// Build a deterministic diff `from → to`. Read-only; mutates nothing;
/// recomputes no report. Contradiction identity is exact `contradiction_id`.
pub fn build_snapshot_diff(
    from: &Step6ReportSnapshot,
    to: &Step6ReportSnapshot,
) -> SnapshotDiff {
    let from_ids = contradiction_ids(from);
    let to_ids = contradiction_ids(to);

    // Present in `to` but not `from` ⇒ added; present in `from` not `to` ⇒ removed.
    // BTreeSet iteration is already sorted ⇒ output Vecs are sorted.
    let added_contradictions: Vec<String> =
        to_ids.difference(&from_ids).cloned().collect();
    let removed_contradictions: Vec<String> =
        from_ids.difference(&to_ids).cloned().collect();

    let cluster_count_delta = delta(cluster_len(from), cluster_len(to));
    let added_clusters = if cluster_count_delta > 0 {
        cluster_count_delta as usize
    } else {
        0
    };
    let removed_clusters = if cluster_count_delta < 0 {
        (-cluster_count_delta) as usize
    } else {
        0
    };

    SnapshotDiff {
        from_report_id: from.report_id.clone(),
        to_report_id: to.report_id.clone(),
        contradiction_count_delta: delta(contradiction_len(from), contradiction_len(to)),
        cluster_count_delta,
        node_count_delta: delta(node_len(from), node_len(to)),
        edge_count_delta: delta(edge_len(from), edge_len(to)),
        added_contradictions,
        removed_contradictions,
        added_clusters,
        removed_clusters,
    }
}

// ── Change summary (fixed-template) ────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotChangeSummary {
    pub headline: String,
    pub summary: String,
}

/// Deterministic, fixed-template summary. No interpretation, no inference.
pub fn summarize_snapshot_diff(diff: &SnapshotDiff) -> SnapshotChangeSummary {
    SnapshotChangeSummary {
        headline: "Report evolution summary".to_string(),
        summary: format!(
            "Contradictions: {}, Clusters: {}, Nodes: {}, Edges: {}. \
             Added contradictions: {}. Removed contradictions: {}.",
            diff.contradiction_count_delta,
            diff.cluster_count_delta,
            diff.node_count_delta,
            diff.edge_count_delta,
            diff.added_contradictions.len(),
            diff.removed_contradictions.len(),
        ),
    }
}

// ── History helper ─────────────────────────────────────────────────────────────

/// Compare the second-newest snapshot → newest snapshot in a repository.
/// Returns `None` if fewer than two snapshots exist. Read-only.
pub fn compare_latest_two(repo: &dyn SnapshotRepository) -> Option<SnapshotDiff> {
    let newest = newest_snapshot(repo)?;
    // Second-newest = newest among the rest, by the same ordering
    // (created_at_epoch_ms, then report_id) used by newest_snapshot.
    let second = repo
        .list()
        .into_iter()
        .filter(|id| *id != newest.report_id)
        .filter_map(|id| repo.get(&id))
        .max_by(|a, b| {
            a.created_at_epoch_ms
                .cmp(&b.created_at_epoch_ms)
                .then(a.report_id.cmp(&b.report_id))
        })?;
    Some(build_snapshot_diff(&second, &newest))
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
    use crate::step6_report::build_step6_report;
    use crate::step6_report_snapshot::build_report_snapshot;
    use crate::step6_snapshot_repository::InMemorySnapshotRepository;

    fn cc(subject: &str) -> CaseContradiction {
        let body = CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: "x".into(),
            conflict_type: FamilyConflictType::Relational,
            pair: ("a".into(), Some("b".into())),
            subject: subject.into(),
            canonical_value: FamilyValue {
                value: "v".into(),
                support_count: 1,
                confidence: 0.5,
                sources: vec![],
                edge_ids: vec![],
            },
            alternatives: vec![],
            conflict_flag: true,
            resolution_confidence: 0.5,
            source_refs: vec![],
            edge_ids: vec![],
            metadata: serde_json::json!({}),
        });
        CaseContradiction {
            domain: ContradictionDomain::Clinical,
            contradiction_id: format!("clinical:assertion:{subject}"),
            conflict_label: "assertion".into(),
            subject: subject.into(),
            resolution_confidence: 0.5,
            body,
        }
    }

    /// Snapshot from a set of subject names (fully-connected clinical graph).
    fn snap(subjects: &[&str], ts: u64) -> Step6ReportSnapshot {
        let ccs: Vec<CaseContradiction> = subjects.iter().map(|s| cc(s)).collect();
        let report = build_step6_report(enrich_step6(ccs));
        build_report_snapshot(report, ts)
    }

    // 1.
    #[test]
    fn identical_snapshots_produce_zero_diff() {
        let a = snap(&["fatigue", "ptsd", "pain"], 1);
        let b = snap(&["fatigue", "ptsd", "pain"], 2);
        let d = build_snapshot_diff(&a, &b);
        assert_eq!(d.contradiction_count_delta, 0);
        assert_eq!(d.cluster_count_delta, 0);
        assert_eq!(d.node_count_delta, 0);
        assert_eq!(d.edge_count_delta, 0);
        assert!(d.added_contradictions.is_empty());
        assert!(d.removed_contradictions.is_empty());
        assert_eq!(d.added_clusters, 0);
        assert_eq!(d.removed_clusters, 0);
    }

    // 2.
    #[test]
    fn contradiction_addition_detected() {
        let a = snap(&["fatigue", "ptsd"], 1);
        let b = snap(&["fatigue", "ptsd", "pain"], 2);
        let d = build_snapshot_diff(&a, &b);
        assert_eq!(d.added_contradictions, vec!["clinical:assertion:pain".to_string()]);
        assert!(d.removed_contradictions.is_empty());
        assert_eq!(d.contradiction_count_delta, 1);
        assert_eq!(d.node_count_delta, 1);
    }

    // 3.
    #[test]
    fn contradiction_removal_detected() {
        let a = snap(&["fatigue", "ptsd", "pain"], 1);
        let b = snap(&["fatigue", "ptsd"], 2);
        let d = build_snapshot_diff(&a, &b);
        assert_eq!(d.removed_contradictions, vec!["clinical:assertion:pain".to_string()]);
        assert!(d.added_contradictions.is_empty());
        assert_eq!(d.contradiction_count_delta, -1);
        assert_eq!(d.node_count_delta, -1);
    }

    // 4.
    #[test]
    fn contradiction_lists_are_sorted() {
        let a = snap(&["b"], 1);
        let b = snap(&["b", "z", "a", "m"], 2);
        let d = build_snapshot_diff(&a, &b);
        let mut sorted = d.added_contradictions.clone();
        sorted.sort();
        assert_eq!(d.added_contradictions, sorted);
        assert_eq!(
            d.added_contradictions,
            vec![
                "clinical:assertion:a".to_string(),
                "clinical:assertion:m".to_string(),
                "clinical:assertion:z".to_string(),
            ]
        );
    }

    // 5.
    #[test]
    fn count_deltas_are_correct() {
        // 2 clinical (1 edge, 1 cluster) → 4 clinical (6 edges, 1 cluster).
        let a = snap(&["a", "b"], 1);
        let b = snap(&["a", "b", "c", "d"], 2);
        let d = build_snapshot_diff(&a, &b);
        assert_eq!(d.contradiction_count_delta, 2);
        assert_eq!(d.node_count_delta, 2);
        assert_eq!(d.edge_count_delta, 6 - 1); // C(4,2)=6 minus C(2,2)=1
        assert_eq!(d.cluster_count_delta, 0); // both fully connected ⇒ 1 cluster
    }

    // 6.
    #[test]
    fn summary_format_is_stable() {
        let a = snap(&["a", "b"], 1);
        let b = snap(&["a", "b", "c"], 2);
        let d = build_snapshot_diff(&a, &b);
        let s = summarize_snapshot_diff(&d);
        assert_eq!(s.headline, "Report evolution summary");
        assert_eq!(
            s.summary,
            "Contradictions: 1, Clusters: 0, Nodes: 1, Edges: 2. \
             Added contradictions: 1. Removed contradictions: 0."
        );
    }

    // 7.
    #[test]
    fn compare_latest_two_works() {
        let mut repo = InMemorySnapshotRepository::new();
        repo.save(snap(&["a", "b"], 100)).unwrap();
        repo.save(snap(&["a", "b", "c"], 200)).unwrap(); // newest
        let d = compare_latest_two(&repo).expect("two present");
        // second-newest (ts100, 2 contradictions) → newest (ts200, 3).
        assert_eq!(d.contradiction_count_delta, 1);
        assert_eq!(d.added_contradictions, vec!["clinical:assertion:c".to_string()]);
    }

    // 8.
    #[test]
    fn compare_latest_two_requires_two_snapshots() {
        let mut repo = InMemorySnapshotRepository::new();
        assert!(compare_latest_two(&repo).is_none());
        repo.save(snap(&["a", "b"], 1)).unwrap();
        assert!(compare_latest_two(&repo).is_none());
    }

    // 9.
    #[test]
    fn diff_is_deterministic_across_runs() {
        let a = snap(&["a", "b"], 1);
        let b = snap(&["a", "c", "d"], 2);
        let d1 = build_snapshot_diff(&a, &b);
        let d2 = build_snapshot_diff(&a, &b);
        assert_eq!(d1, d2);
    }

    // 10.
    #[test]
    fn diff_builder_does_not_modify_inputs() {
        let a = snap(&["a", "b"], 1);
        let b = snap(&["a", "b", "c"], 2);
        let a_before = serde_json::to_string(&a).unwrap();
        let b_before = serde_json::to_string(&b).unwrap();
        let _ = build_snapshot_diff(&a, &b);
        assert_eq!(serde_json::to_string(&a).unwrap(), a_before);
        assert_eq!(serde_json::to_string(&b).unwrap(), b_before);
    }
}
