//! STEP-6 monitoring dashboard — a deterministic, read-only AGGREGATION over an
//! existing `MonitoringQueue`. It bundles the queue verbatim with distribution
//! counts (priority / trend / readiness) for a single operational, UI-facing
//! summary.
//!
//! THIS MODULE DOES NOT FORECAST, reprioritise, reorder, filter, or reclassify.
//! Every count is derived purely by tallying the queue's existing items. No
//! `HashMap`/`HashSet`, no async, no I/O, no randomness, no UUIDs, no narrative
//! generation.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::step6_forecast_readiness::ForecastReadinessLevel;
use crate::step6_monitoring_queue::{MonitoringPriority, MonitoringQueue};
use crate::step6_report_trends::TrendDirection;

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitoringDashboard {
    pub queue: MonitoringQueue,
    pub summary: MonitoringDashboardSummary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitoringDashboardSummary {
    pub total_items: usize,

    pub high_priority_count: usize,
    pub medium_priority_count: usize,
    pub low_priority_count: usize,

    pub increasing_count: usize,
    pub decreasing_count: usize,
    pub stable_count: usize,
    pub intermittent_count: usize,

    pub ready_count: usize,
    pub limited_count: usize,
    pub insufficient_count: usize,
}

// ── Builder (aggregation only) ──────────────────────────────────────────────────

/// Build a dashboard from a queue. The queue is stored verbatim (no sort, no
/// filter, no transform); the summary is a pure tally of the queue's items.
pub fn build_monitoring_dashboard(queue: MonitoringQueue) -> MonitoringDashboard {
    let total_items = queue.items.len();

    let (mut high, mut medium, mut low) = (0, 0, 0);
    let (mut increasing, mut decreasing, mut stable, mut intermittent) = (0, 0, 0, 0);
    let (mut ready, mut limited, mut insufficient) = (0, 0, 0);

    for item in &queue.items {
        match item.priority {
            MonitoringPriority::High => high += 1,
            MonitoringPriority::Medium => medium += 1,
            MonitoringPriority::Low => low += 1,
        }
        match item.trend_direction {
            TrendDirection::Increasing => increasing += 1,
            TrendDirection::Decreasing => decreasing += 1,
            TrendDirection::Stable => stable += 1,
            TrendDirection::Intermittent => intermittent += 1,
        }
        match item.readiness {
            ForecastReadinessLevel::Ready => ready += 1,
            ForecastReadinessLevel::LimitedHistory => limited += 1,
            ForecastReadinessLevel::InsufficientHistory => insufficient += 1,
        }
    }

    let summary = MonitoringDashboardSummary {
        total_items,
        high_priority_count: high,
        medium_priority_count: medium,
        low_priority_count: low,
        increasing_count: increasing,
        decreasing_count: decreasing,
        stable_count: stable,
        intermittent_count: intermittent,
        ready_count: ready,
        limited_count: limited,
        insufficient_count: insufficient,
    };

    MonitoringDashboard { queue, summary }
}

/// Read-only validation: the three partitions each total `total_items`.
pub fn dashboard_is_consistent(dashboard: &MonitoringDashboard) -> bool {
    let s = &dashboard.summary;
    let priority_total = s.high_priority_count + s.medium_priority_count + s.low_priority_count;
    let readiness_total = s.ready_count + s.limited_count + s.insufficient_count;
    let trend_total =
        s.increasing_count + s.decreasing_count + s.stable_count + s.intermittent_count;

    s.total_items == priority_total
        && s.total_items == readiness_total
        && s.total_items == trend_total
}

/// Fixed-template operational summary line.
pub fn dashboard_summary_text(dashboard: &MonitoringDashboard) -> String {
    let s = &dashboard.summary;
    format!(
        "Monitoring dashboard contains {} contradictions: {} high priority, {} medium priority, {} low priority.",
        s.total_items, s.high_priority_count, s.medium_priority_count, s.low_priority_count
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
    use crate::step6_enrichment::enrich_step6;
    use crate::step6_forecast_readiness::build_forecast_readiness;
    use crate::step6_monitoring_queue::build_monitoring_queue;
    use crate::step6_report::build_step6_report;
    use crate::step6_report_history::build_report_history;
    use crate::step6_report_snapshot::{build_report_snapshot, Step6ReportSnapshot};
    use crate::step6_report_trends::build_report_trends;

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

    fn snap(items: &[(&str, &str, f32)], ts: u64) -> Step6ReportSnapshot {
        let ccs: Vec<CaseContradiction> = items.iter().map(|(id, s, c)| cc(id, s, *c)).collect();
        build_report_snapshot(build_step6_report(enrich_step6(ccs)), ts)
    }

    fn queue_of(snaps: &[Step6ReportSnapshot]) -> MonitoringQueue {
        let h = build_report_history(snaps);
        let t = build_report_trends(snaps);
        let r = build_forecast_readiness(&h, &t);
        build_monitoring_queue(&r)
    }

    // 5 snapshots: r=Ready/High/Increasing, l=Limited/Medium, i=Insufficient/Low.
    fn mixed() -> Vec<Step6ReportSnapshot> {
        vec![
            snap(&[("r", "a", 0.4), ("l", "b", 0.5), ("i", "c", 0.5)], 1),
            snap(&[("r", "a", 0.5), ("l", "b", 0.5)], 2),
            snap(&[("r", "a", 0.6)], 3),
            snap(&[("r", "a", 0.7)], 4),
            snap(&[("r", "a", 0.8)], 5),
        ]
    }

    fn dashboard() -> MonitoringDashboard {
        build_monitoring_dashboard(queue_of(&mixed()))
    }

    // 1.
    #[test]
    fn dashboard_contains_queue() {
        let q = queue_of(&mixed());
        let d = build_monitoring_dashboard(q.clone());
        // Queue stored verbatim — same items, same order.
        assert_eq!(d.queue, q);
    }

    // 2.
    #[test]
    fn priority_counts_correct() {
        let d = dashboard();
        assert_eq!(d.summary.high_priority_count, 1);
        assert_eq!(d.summary.medium_priority_count, 1);
        assert_eq!(d.summary.low_priority_count, 1);
    }

    // 3.
    #[test]
    fn readiness_counts_correct() {
        let d = dashboard();
        assert_eq!(d.summary.ready_count, 1);
        assert_eq!(d.summary.limited_count, 1);
        assert_eq!(d.summary.insufficient_count, 1);
    }

    // 4.
    #[test]
    fn trend_counts_correct() {
        let d = dashboard();
        // r rises 0.4→0.8 ⇒ Increasing; l flat present twice ⇒ Stable;
        // i present once, flat ⇒ Stable.
        assert_eq!(d.summary.increasing_count, 1);
        assert_eq!(d.summary.stable_count, 2);
        assert_eq!(d.summary.decreasing_count, 0);
        assert_eq!(d.summary.intermittent_count, 0);
    }

    // 5.
    #[test]
    fn consistency_success_case() {
        assert!(dashboard_is_consistent(&dashboard()));
    }

    // 6.
    #[test]
    fn consistency_detects_priority_mismatch() {
        let mut d = dashboard();
        d.summary.high_priority_count += 1; // breaks priority partition
        assert!(!dashboard_is_consistent(&d));
    }

    // 7.
    #[test]
    fn consistency_detects_readiness_mismatch() {
        let mut d = dashboard();
        d.summary.ready_count += 1; // breaks readiness partition
        assert!(!dashboard_is_consistent(&d));
    }

    // 8.
    #[test]
    fn consistency_detects_trend_mismatch() {
        let mut d = dashboard();
        d.summary.stable_count += 1; // breaks trend partition
        assert!(!dashboard_is_consistent(&d));
    }

    // 9.
    #[test]
    fn summary_text_exact() {
        let d = dashboard();
        assert_eq!(
            dashboard_summary_text(&d),
            "Monitoring dashboard contains 3 contradictions: 1 high priority, 1 medium priority, 1 low priority."
        );
    }

    // 10.
    #[test]
    fn dashboard_builder_does_not_modify_queue() {
        let q = queue_of(&mixed());
        let q_before = q.clone();
        let d = build_monitoring_dashboard(q);
        assert_eq!(d.queue, q_before);
    }

    // 11.
    #[test]
    fn deterministic_across_runs() {
        let d1 = build_monitoring_dashboard(queue_of(&mixed()));
        let d2 = build_monitoring_dashboard(queue_of(&mixed()));
        assert_eq!(d1, d2);
    }

    // 12.
    #[test]
    fn total_count_correct() {
        let d = dashboard();
        assert_eq!(d.summary.total_items, 3);
        assert_eq!(d.summary.total_items, d.queue.items.len());
    }

    // 13. (extra) empty queue ⇒ all zeros, consistent.
    #[test]
    fn empty_dashboard_is_consistent() {
        let d = build_monitoring_dashboard(queue_of(&[]));
        assert_eq!(d.summary.total_items, 0);
        assert!(dashboard_is_consistent(&d));
        assert_eq!(
            dashboard_summary_text(&d),
            "Monitoring dashboard contains 0 contradictions: 0 high priority, 0 medium priority, 0 low priority."
        );
    }
}
