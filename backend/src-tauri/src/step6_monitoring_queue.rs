//! STEP-6 monitoring queue — deterministic organisation of contradictions for
//! OBSERVATION, derived directly from forecast-readiness levels.
//!
//! THIS MODULE DOES NOT FORECAST, predict future confidence, or estimate
//! outcomes. It only buckets and orders contradictions into a watchlist:
//! Ready → High, LimitedHistory → Medium, InsufficientHistory → Low. Identity is
//! exact `contradiction_id`. Outputs are deterministic sorted `Vec`s; no
//! `HashMap`/`HashSet` in outputs, no async, no I/O, no randomness, no UUIDs, no
//! weighting/scores/probabilities/ranking formulas.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::step6_forecast_readiness::{ForecastReadinessLevel, ForecastReadinessReport};
use crate::step6_report_trends::TrendDirection;

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MonitoringPriority {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitoringItem {
    pub contradiction_id: String,
    pub readiness: ForecastReadinessLevel,
    pub trend_direction: TrendDirection,
    pub appearances: usize,
    pub priority: MonitoringPriority,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MonitoringQueue {
    pub items: Vec<MonitoringItem>,
    pub high_priority_count: usize,
    pub medium_priority_count: usize,
    pub low_priority_count: usize,
}

// ── Classification ─────────────────────────────────────────────────────────────

fn priority_of(level: ForecastReadinessLevel) -> MonitoringPriority {
    match level {
        ForecastReadinessLevel::Ready => MonitoringPriority::High,
        ForecastReadinessLevel::LimitedHistory => MonitoringPriority::Medium,
        ForecastReadinessLevel::InsufficientHistory => MonitoringPriority::Low,
    }
}

/// Sort rank for priority: High (0) before Medium (1) before Low (2).
fn priority_rank(p: MonitoringPriority) -> u8 {
    match p {
        MonitoringPriority::High => 0,
        MonitoringPriority::Medium => 1,
        MonitoringPriority::Low => 2,
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Build a monitoring queue from a forecast-readiness report. Read-only;
/// deterministic. NO forecasting/prediction is performed.
pub fn build_monitoring_queue(readiness: &ForecastReadinessReport) -> MonitoringQueue {
    let mut items: Vec<MonitoringItem> = readiness
        .items
        .iter()
        .map(|r| {
            let priority = priority_of(r.readiness);
            MonitoringItem {
                contradiction_id: r.contradiction_id.clone(),
                readiness: r.readiness,
                trend_direction: r.trend_direction,
                appearances: r.appearances,
                priority,
            }
        })
        .collect();

    // Ordering: priority (High→Medium→Low), then appearances DESC, then id ASC.
    items.sort_by(|a, b| {
        priority_rank(a.priority)
            .cmp(&priority_rank(b.priority))
            .then(b.appearances.cmp(&a.appearances))
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });

    let high = items.iter().filter(|i| i.priority == MonitoringPriority::High).count();
    let medium = items.iter().filter(|i| i.priority == MonitoringPriority::Medium).count();
    let low = items.iter().filter(|i| i.priority == MonitoringPriority::Low).count();

    MonitoringQueue {
        items,
        high_priority_count: high,
        medium_priority_count: medium,
        low_priority_count: low,
    }
}

/// High-priority ids, sorted lexicographically.
pub fn high_priority_items(queue: &MonitoringQueue) -> Vec<String> {
    collect_sorted(queue, MonitoringPriority::High)
}

/// Medium-priority ids, sorted lexicographically.
pub fn medium_priority_items(queue: &MonitoringQueue) -> Vec<String> {
    collect_sorted(queue, MonitoringPriority::Medium)
}

/// Low-priority ids, sorted lexicographically.
pub fn low_priority_items(queue: &MonitoringQueue) -> Vec<String> {
    collect_sorted(queue, MonitoringPriority::Low)
}

/// Look up a single monitoring item by exact id.
pub fn monitoring_item(queue: &MonitoringQueue, contradiction_id: &str) -> Option<MonitoringItem> {
    queue
        .items
        .iter()
        .find(|i| i.contradiction_id == contradiction_id)
        .cloned()
}

fn collect_sorted(queue: &MonitoringQueue, priority: MonitoringPriority) -> Vec<String> {
    let mut v: Vec<String> = queue
        .items
        .iter()
        .filter(|i| i.priority == priority)
        .map(|i| i.contradiction_id.clone())
        .collect();
    v.sort();
    v
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

    /// 5 snapshots: r=Ready→High(5/5), l=Limited→Medium(2/5), i=Insufficient→Low(1/5).
    fn mixed() -> Vec<Step6ReportSnapshot> {
        vec![
            snap(&[("r", "a", 0.4), ("l", "b", 0.5), ("i", "c", 0.5)], 1),
            snap(&[("r", "a", 0.5), ("l", "b", 0.5)], 2),
            snap(&[("r", "a", 0.6)], 3),
            snap(&[("r", "a", 0.7)], 4),
            snap(&[("r", "a", 0.8)], 5),
        ]
    }

    // 1.
    #[test]
    fn ready_becomes_high_priority() {
        let q = queue_of(&mixed());
        assert_eq!(monitoring_item(&q, "r").unwrap().priority, MonitoringPriority::High);
    }

    // 2.
    #[test]
    fn limited_becomes_medium_priority() {
        let q = queue_of(&mixed());
        assert_eq!(monitoring_item(&q, "l").unwrap().priority, MonitoringPriority::Medium);
    }

    // 3.
    #[test]
    fn insufficient_becomes_low_priority() {
        let q = queue_of(&mixed());
        assert_eq!(monitoring_item(&q, "i").unwrap().priority, MonitoringPriority::Low);
    }

    // 4.
    #[test]
    fn queue_ordering_is_correct() {
        let q = queue_of(&mixed());
        let ids: Vec<String> = q.items.iter().map(|i| i.contradiction_id.clone()).collect();
        // High(r) → Medium(l) → Low(i).
        assert_eq!(ids, vec!["r".to_string(), "l".to_string(), "i".to_string()]);
    }

    // 5.
    #[test]
    fn lookup_works() {
        let q = queue_of(&mixed());
        assert!(monitoring_item(&q, "r").is_some());
        assert!(monitoring_item(&q, "missing").is_none());
    }

    // 6.
    #[test]
    fn high_priority_query_sorted() {
        // Two Ready (High) contradictions present in all 5 snapshots.
        let snaps: Vec<Step6ReportSnapshot> = (1..=5)
            .map(|ts| snap(&[("zeta", "a", 0.5), ("alpha", "b", 0.5)], ts))
            .collect();
        let q = queue_of(&snaps);
        assert_eq!(high_priority_items(&q), vec!["alpha".to_string(), "zeta".to_string()]);
    }

    // 7.
    #[test]
    fn medium_priority_query_sorted() {
        // 3 snapshots; "m" and "a" appear twice ⇒ Limited ⇒ Medium.
        let snaps = vec![
            snap(&[("m", "x", 0.5), ("a", "y", 0.5)], 1),
            snap(&[("m", "x", 0.5), ("a", "y", 0.5)], 2),
            snap(&[("z", "w", 0.5)], 3),
        ];
        let q = queue_of(&snaps);
        assert_eq!(medium_priority_items(&q), vec!["a".to_string(), "m".to_string()]);
    }

    // 8.
    #[test]
    fn low_priority_query_sorted() {
        // 3 snapshots; "p" and "b" appear once each ⇒ Insufficient ⇒ Low.
        let snaps = vec![
            snap(&[("p", "x", 0.5)], 1),
            snap(&[("b", "y", 0.5)], 2),
            snap(&[("k", "w", 0.5), ("j", "u", 0.5)], 3),
        ];
        let q = queue_of(&snaps);
        // All four appear once ⇒ all Low; lexicographic order.
        assert_eq!(
            low_priority_items(&q),
            vec!["b".to_string(), "j".to_string(), "k".to_string(), "p".to_string()]
        );
    }

    // 9.
    #[test]
    fn counts_are_correct() {
        let q = queue_of(&mixed());
        assert_eq!(q.high_priority_count, 1);
        assert_eq!(q.medium_priority_count, 1);
        assert_eq!(q.low_priority_count, 1);
        assert_eq!(q.items.len(), 3);
    }

    // 10.
    #[test]
    fn deterministic_across_runs() {
        let snaps = mixed();
        assert_eq!(queue_of(&snaps), queue_of(&snaps));
    }

    // 11.
    #[test]
    fn queue_builder_does_not_modify_input() {
        let snaps = mixed();
        let h = build_report_history(&snaps);
        let t = build_report_trends(&snaps);
        let r = build_forecast_readiness(&h, &t);
        let r_before = r.clone();
        let _ = build_monitoring_queue(&r);
        assert_eq!(r, r_before);
    }

    // 12.
    #[test]
    fn priorities_are_exclusive() {
        let q = queue_of(&mixed());
        // Counts partition the queue exactly once.
        assert_eq!(
            q.high_priority_count + q.medium_priority_count + q.low_priority_count,
            q.items.len()
        );
        // No id appears in more than one priority bucket.
        let h = high_priority_items(&q);
        let m = medium_priority_items(&q);
        let l = low_priority_items(&q);
        for id in &h {
            assert!(!m.contains(id) && !l.contains(id));
        }
        for id in &m {
            assert!(!h.contains(id) && !l.contains(id));
        }
    }

    // 13. (extra) ordering within a priority: appearances DESC then id ASC.
    #[test]
    fn ordering_within_priority_is_correct() {
        // Three Low (each appears once) across distinct single-contradiction
        // snapshots ⇒ same appearances ⇒ id ASC.
        let snaps = vec![
            snap(&[("c", "x", 0.5)], 1),
            snap(&[("a", "y", 0.5)], 2),
            snap(&[("b", "z", 0.5)], 3),
        ];
        let q = queue_of(&snaps);
        let ids: Vec<String> = q.items.iter().map(|i| i.contradiction_id.clone()).collect();
        assert_eq!(ids, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }
}
