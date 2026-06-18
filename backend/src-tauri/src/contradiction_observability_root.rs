//! Contradiction Engine observability root — a COMPOSITION-ONLY layer that bundles every
//! derived Contradiction Engine view (history, trends, readiness, queue, dashboard) for a
//! single snapshot into one inspectable object.
//!
//! PURE AGGREGATOR: it computes NOTHING new. It calls the existing builders in
//! strict order and stores their outputs verbatim. No re-derivation, no
//! reordering, no mutation, no scoring/classification, no forecasting, no
//! repository access. Identity, ordering, and determinism are inherited from the
//! layers it composes. No `HashMap`/`HashSet` in outputs (`BTreeSet` used only
//! internally), no async, no concurrency.

#![allow(dead_code)]

use std::collections::BTreeSet;

use serde::Serialize;

use crate::contradiction_forecast_readiness::{build_forecast_readiness, ForecastReadinessReport};
use crate::contradiction_monitoring_dashboard::{build_monitoring_dashboard, MonitoringDashboard};
use crate::contradiction_monitoring_queue::{build_monitoring_queue, MonitoringQueue};
use crate::contradiction_report::{build_contradiction_report, cluster_count, contradiction_count};
use crate::contradiction_report_history::{build_report_history, ReportHistory};
use crate::contradiction_report_snapshot::ContradictionReportSnapshot;
use crate::contradiction_report_trends::{build_report_trends, ReportTrends};

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ContradictionObservabilityRoot {
    pub snapshot: ContradictionReportSnapshot,

    pub history: ReportHistory,
    pub trends: ReportTrends,
    pub readiness: ForecastReadinessReport,

    pub queue: MonitoringQueue,
    pub dashboard: MonitoringDashboard,
}

// ── Builder (composition only) ──────────────────────────────────────────────────

/// Compose every derived view for a single snapshot, in strict order:
/// snapshot → history → trends → readiness → queue → dashboard.
/// Each step calls only the existing builder for that layer. No recomputation.
pub fn build_observability_root(snapshot: ContradictionReportSnapshot) -> ContradictionObservabilityRoot {
    // The longitudinal layers operate over a snapshot series; here the series is
    // this single snapshot. Built once, reused — no duplication.
    let series = [snapshot.clone()];

    let history = build_report_history(&series);
    let trends = build_report_trends(&series);
    let readiness = build_forecast_readiness(&history, &trends);
    let queue = build_monitoring_queue(&readiness);
    let dashboard = build_monitoring_dashboard(queue.clone());

    ContradictionObservabilityRoot {
        snapshot,
        history,
        trends,
        readiness,
        queue,
        dashboard,
    }
}

// ── Consistency (read-only) ──────────────────────────────────────────────────────

/// Verify the composed layers agree. Read-only; no repair.
pub fn observability_root_is_consistent(root: &ContradictionObservabilityRoot) -> bool {
    // 1. snapshot.report reconstructs from its own view (no recomputation drift).
    let rebuilt = build_contradiction_report(root.snapshot.report.view.clone());
    let report_ok =
        serde_json::to_string(&rebuilt).ok() == serde_json::to_string(&root.snapshot.report).ok();

    // 2. history covers exactly this one snapshot.
    let history_ok = root.history.summary.snapshot_count == 1;

    // 3. one trend per history contradiction.
    let trends_ok = root.trends.trends.len() == root.history.contradictions.len();

    // 4. readiness ids == history ids (set equality).
    let hist_ids: BTreeSet<&str> = root
        .history
        .contradictions
        .iter()
        .map(|c| c.contradiction_id.as_str())
        .collect();
    let ready_ids: BTreeSet<&str> = root
        .readiness
        .items
        .iter()
        .map(|i| i.contradiction_id.as_str())
        .collect();
    let readiness_ok = hist_ids == ready_ids;

    // 5. queue ids == readiness ids (set equality).
    let queue_ids: BTreeSet<&str> = root
        .queue
        .items
        .iter()
        .map(|i| i.contradiction_id.as_str())
        .collect();
    let queue_ok = queue_ids == ready_ids;

    // 6. dashboard counts == queue counts.
    let s = &root.dashboard.summary;
    let dash_ok = s.high_priority_count == root.queue.high_priority_count
        && s.medium_priority_count == root.queue.medium_priority_count
        && s.low_priority_count == root.queue.low_priority_count
        && s.total_items == root.queue.items.len();

    report_ok && history_ok && trends_ok && readiness_ok && queue_ok && dash_ok
}

// ── Derived helpers ───────────────────────────────────────────────────────────────

/// Sorted, de-duplicated union of all contradiction ids seen in history OR
/// readiness. Deterministic.
pub fn all_contradiction_ids(root: &ContradictionObservabilityRoot) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for c in &root.history.contradictions {
        set.insert(c.contradiction_id.clone());
    }
    for i in &root.readiness.items {
        set.insert(i.contradiction_id.clone());
    }
    set.into_iter().collect()
}

/// Fixed-template one-line observability summary.
pub fn observability_summary(root: &ContradictionObservabilityRoot) -> String {
    format!(
        "STEP6 OBSERVABILITY: {} snapshots, {} contradictions, {} clusters",
        root.history.summary.snapshot_count,
        contradiction_count(&root.snapshot.report),
        cluster_count(&root.snapshot.report),
    )
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
    use crate::contradiction_report_snapshot::build_report_snapshot;

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

    // 3 fully-connected clinical contradictions ⇒ 3 contradictions, 1 cluster.
    fn snapshot() -> ContradictionReportSnapshot {
        let ccs = vec![
            cc("i1", "a", 0.5),
            cc("i2", "b", 0.5),
            cc("i3", "c", 0.5),
        ];
        build_report_snapshot(build_contradiction_report(enrich_contradictions(ccs)), 1_000)
    }

    // 1.
    #[test]
    fn root_build_is_deterministic() {
        let r1 = build_observability_root(snapshot());
        let r2 = build_observability_root(snapshot());
        assert_eq!(r1.history, r2.history);
        assert_eq!(r1.trends, r2.trends);
        assert_eq!(r1.readiness, r2.readiness);
        assert_eq!(r1.queue, r2.queue);
        assert_eq!(r1.dashboard, r2.dashboard);
        assert_eq!(
            serde_json::to_string(&r1.snapshot).unwrap(),
            serde_json::to_string(&r2.snapshot).unwrap()
        );
    }

    // 2.
    #[test]
    fn snapshot_is_preserved() {
        let s = snapshot();
        let before = serde_json::to_string(&s).unwrap();
        let r = build_observability_root(s);
        assert_eq!(serde_json::to_string(&r.snapshot).unwrap(), before);
    }

    // 3.
    #[test]
    fn history_matches_snapshot() {
        let s = snapshot();
        let r = build_observability_root(s.clone());
        assert_eq!(r.history, build_report_history(&[s]));
        assert_eq!(r.history.summary.snapshot_count, 1);
    }

    // 4.
    #[test]
    fn trends_match_history() {
        let s = snapshot();
        let r = build_observability_root(s.clone());
        assert_eq!(r.trends, build_report_trends(&[s]));
        assert_eq!(r.trends.trends.len(), r.history.contradictions.len());
    }

    // 5.
    #[test]
    fn readiness_matches_trends() {
        let r = build_observability_root(snapshot());
        assert_eq!(r.readiness, build_forecast_readiness(&r.history, &r.trends));
    }

    // 6.
    #[test]
    fn queue_matches_readiness() {
        let r = build_observability_root(snapshot());
        assert_eq!(r.queue, build_monitoring_queue(&r.readiness));
    }

    // 7.
    #[test]
    fn dashboard_matches_queue() {
        let r = build_observability_root(snapshot());
        assert_eq!(r.dashboard, build_monitoring_dashboard(r.queue.clone()));
        assert_eq!(r.dashboard.queue, r.queue);
    }

    // 8.
    #[test]
    fn consistency_check_passes() {
        assert!(observability_root_is_consistent(&build_observability_root(snapshot())));
    }

    // 9.
    #[test]
    fn consistency_detects_missing_history() {
        let mut r = build_observability_root(snapshot());
        r.history.contradictions.pop(); // history no longer covers all ids
        assert!(!observability_root_is_consistent(&r));
    }

    // 10.
    #[test]
    fn consistency_detects_queue_mismatch() {
        let mut r = build_observability_root(snapshot());
        r.queue.items.pop(); // queue ids no longer match readiness ids
        assert!(!observability_root_is_consistent(&r));
    }

    // 11.
    #[test]
    fn id_union_is_sorted() {
        let r = build_observability_root(snapshot());
        let ids = all_contradiction_ids(&r);
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
        assert_eq!(ids, vec!["i1".to_string(), "i2".to_string(), "i3".to_string()]);
    }

    // 12.
    #[test]
    fn summary_format_is_exact() {
        let r = build_observability_root(snapshot());
        assert_eq!(
            observability_summary(&r),
            "STEP6 OBSERVABILITY: 1 snapshots, 3 contradictions, 1 clusters"
        );
    }

    // 13.
    #[test]
    fn no_layer_recomputation() {
        // Each stored layer is byte-identical to an independent build from the
        // same snapshot ⇒ the root only composes, never diverges.
        let s = snapshot();
        let r = build_observability_root(s.clone());
        let history = build_report_history(&[s.clone()]);
        let trends = build_report_trends(&[s]);
        let readiness = build_forecast_readiness(&history, &trends);
        let queue = build_monitoring_queue(&readiness);
        let dashboard = build_monitoring_dashboard(queue.clone());
        assert_eq!(r.history, history);
        assert_eq!(r.trends, trends);
        assert_eq!(r.readiness, readiness);
        assert_eq!(r.queue, queue);
        assert_eq!(r.dashboard, dashboard);
    }

    // 14.
    #[test]
    fn build_does_not_mutate_inputs() {
        let s = snapshot();
        let before = serde_json::to_string(&s).unwrap();
        let r = build_observability_root(s); // moved in
        // The snapshot is carried verbatim into the root (no mutation).
        assert_eq!(serde_json::to_string(&r.snapshot).unwrap(), before);
    }

    // 15. (extra) all five layers present and non-empty for a 3-contradiction snapshot.
    #[test]
    fn all_layers_present() {
        let r = build_observability_root(snapshot());
        assert_eq!(r.history.contradictions.len(), 3);
        assert_eq!(r.trends.trends.len(), 3);
        assert_eq!(r.readiness.items.len(), 3);
        assert_eq!(r.queue.items.len(), 3);
        assert_eq!(r.dashboard.summary.total_items, 3);
    }
}
