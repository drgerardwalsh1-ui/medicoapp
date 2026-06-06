//! STEP-6 forecast readiness — deterministic classification of whether a
//! contradiction has ENOUGH HISTORY to support future forecasting work.
//!
//! THIS MODULE DOES NOT FORECAST. It does not predict, estimate future
//! confidence, or extrapolate. It evaluates historical *sufficiency* only, using
//! fixed thresholds over already-computed history + trend facts. Identity is
//! exact `contradiction_id`. Outputs are deterministic sorted `Vec`s; no
//! `HashMap`/`HashSet` in outputs, no async, no I/O, no randomness, no UUIDs, no
//! scoring/weighting/ML/probabilities.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::step6_report_history::ReportHistory;
use crate::step6_report_trends::{ReportTrends, TrendDirection};

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForecastReadinessLevel {
    InsufficientHistory,
    LimitedHistory,
    Ready,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ForecastReadiness {
    pub contradiction_id: String,
    pub snapshot_count: usize,
    pub appearances: usize,
    pub presence_ratio: f64,
    pub confidence_range: f64,
    pub trend_direction: TrendDirection,
    pub readiness: ForecastReadinessLevel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForecastReadinessSummary {
    pub insufficient_count: usize,
    pub limited_count: usize,
    pub ready_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ForecastReadinessReport {
    pub items: Vec<ForecastReadiness>,
    pub summary: ForecastReadinessSummary,
}

// ── Classification (priority: Ready → Limited → Insufficient) ───────────────────

fn classify(
    snapshot_count: usize,
    appearances: usize,
    presence_ratio: f64,
) -> ForecastReadinessLevel {
    if snapshot_count >= 5 && appearances >= 4 && presence_ratio >= 0.75 {
        ForecastReadinessLevel::Ready
    } else if snapshot_count >= 3 && appearances >= 2 {
        ForecastReadinessLevel::LimitedHistory
    } else {
        ForecastReadinessLevel::InsufficientHistory
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Evaluate historical sufficiency per contradiction. Read-only; deterministic.
/// `history` supplies appearances + confidence range; `trends` supplies the
/// presence ratio + observed direction. NO forecasting is performed.
pub fn build_forecast_readiness(
    history: &ReportHistory,
    trends: &ReportTrends,
) -> ForecastReadinessReport {
    let snapshot_count = history.summary.snapshot_count;

    let mut items: Vec<ForecastReadiness> = Vec::new();
    let (mut insufficient, mut limited, mut ready) = (0, 0, 0);

    for ch in &history.contradictions {
        // Pair with the trend record (same id) for ratio + direction.
        let trend = match trends
            .trends
            .iter()
            .find(|t| t.contradiction_id == ch.contradiction_id)
        {
            Some(t) => t,
            None => continue, // defensive: history/trends disagree
        };

        let appearances = ch.appearances;
        let presence_ratio = trend.presence_ratio;
        let confidence_range = ch.confidence_max - ch.confidence_min;
        let readiness = classify(snapshot_count, appearances, presence_ratio);

        match readiness {
            ForecastReadinessLevel::InsufficientHistory => insufficient += 1,
            ForecastReadinessLevel::LimitedHistory => limited += 1,
            ForecastReadinessLevel::Ready => ready += 1,
        }

        items.push(ForecastReadiness {
            contradiction_id: ch.contradiction_id.clone(),
            snapshot_count,
            appearances,
            presence_ratio,
            confidence_range,
            trend_direction: trend.direction,
            readiness,
        });
    }

    // Stable ordering: appearances DESC, then contradiction_id ASC.
    items.sort_by(|a, b| {
        b.appearances
            .cmp(&a.appearances)
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });

    ForecastReadinessReport {
        items,
        summary: ForecastReadinessSummary {
            insufficient_count: insufficient,
            limited_count: limited,
            ready_count: ready,
        },
    }
}

/// Look up a single contradiction's readiness by exact id.
pub fn readiness_for(
    report: &ForecastReadinessReport,
    contradiction_id: &str,
) -> Option<ForecastReadiness> {
    report
        .items
        .iter()
        .find(|i| i.contradiction_id == contradiction_id)
        .cloned()
}

/// Ids classified `Ready`, sorted lexicographically.
pub fn ready_contradictions(report: &ForecastReadinessReport) -> Vec<String> {
    collect_sorted(report, ForecastReadinessLevel::Ready)
}

/// Ids classified `LimitedHistory`, sorted lexicographically.
pub fn limited_contradictions(report: &ForecastReadinessReport) -> Vec<String> {
    collect_sorted(report, ForecastReadinessLevel::LimitedHistory)
}

fn collect_sorted(report: &ForecastReadinessReport, level: ForecastReadinessLevel) -> Vec<String> {
    let mut v: Vec<String> = report
        .items
        .iter()
        .filter(|i| i.readiness == level)
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

    fn report_of(snaps: &[Step6ReportSnapshot]) -> ForecastReadinessReport {
        let h = build_report_history(snaps);
        let t = build_report_trends(snaps);
        build_forecast_readiness(&h, &t)
    }

    /// 5 snapshots: r=Ready(5/5), l=Limited(2/5), i=Insufficient(1/5).
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
    fn insufficient_history_detected() {
        let r = report_of(&[snap(&[("i1", "a", 0.5)], 1)]);
        assert_eq!(
            readiness_for(&r, "i1").unwrap().readiness,
            ForecastReadinessLevel::InsufficientHistory
        );
    }

    // 2.
    #[test]
    fn limited_history_detected() {
        // 3 snapshots, appears 2 ⇒ Limited.
        let snaps = vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i1", "a", 0.5)], 2),
            snap(&[("i2", "b", 0.5)], 3),
        ];
        let r = report_of(&snaps);
        assert_eq!(
            readiness_for(&r, "i1").unwrap().readiness,
            ForecastReadinessLevel::LimitedHistory
        );
    }

    // 3.
    #[test]
    fn ready_detected() {
        let r = report_of(&mixed());
        assert_eq!(
            readiness_for(&r, "r").unwrap().readiness,
            ForecastReadinessLevel::Ready
        );
    }

    // 4.
    #[test]
    fn readiness_priority_correct() {
        // "r" satisfies BOTH Ready and Limited thresholds ⇒ Ready wins.
        let r = report_of(&mixed());
        let item = readiness_for(&r, "r").unwrap();
        assert_eq!(item.appearances, 5);
        assert!(item.snapshot_count >= 3 && item.appearances >= 2); // Limited would also match
        assert_eq!(item.readiness, ForecastReadinessLevel::Ready);
    }

    // 5.
    #[test]
    fn confidence_range_correct() {
        // "r" confidences 0.4..0.8 ⇒ range 0.4.
        let r = report_of(&mixed());
        let item = readiness_for(&r, "r").unwrap();
        assert_eq!(item.confidence_range, (0.8_f32 as f64) - (0.4_f32 as f64));
    }

    // 6.
    #[test]
    fn trend_direction_preserved() {
        // "r" rises 0.4→0.8 contiguously ⇒ Increasing, carried into readiness.
        let r = report_of(&mixed());
        assert_eq!(readiness_for(&r, "r").unwrap().trend_direction, TrendDirection::Increasing);
    }

    // 7.
    #[test]
    fn readiness_lookup_works() {
        let r = report_of(&mixed());
        assert!(readiness_for(&r, "r").is_some());
        assert!(readiness_for(&r, "nope").is_none());
    }

    // 8.
    #[test]
    fn ready_contradictions_sorted() {
        // Two Ready contradictions present in all 5 snapshots.
        let snaps: Vec<Step6ReportSnapshot> = (1..=5)
            .map(|ts| snap(&[("zeta", "a", 0.5), ("alpha", "b", 0.5)], ts))
            .collect();
        let r = report_of(&snaps);
        assert_eq!(
            ready_contradictions(&r),
            vec!["alpha".to_string(), "zeta".to_string()]
        );
    }

    // 9.
    #[test]
    fn limited_contradictions_sorted() {
        // 3 snapshots; "m" and "a" each appear twice ⇒ Limited, sorted ASC.
        let snaps = vec![
            snap(&[("m", "x", 0.5), ("a", "y", 0.5)], 1),
            snap(&[("m", "x", 0.5), ("a", "y", 0.5)], 2),
            snap(&[("z", "w", 0.5)], 3),
        ];
        let r = report_of(&snaps);
        assert_eq!(limited_contradictions(&r), vec!["a".to_string(), "m".to_string()]);
    }

    // 10.
    #[test]
    fn deterministic_across_runs() {
        let snaps = mixed();
        assert_eq!(report_of(&snaps), report_of(&snaps));
    }

    // 11.
    #[test]
    fn report_summary_counts_correct() {
        let r = report_of(&mixed());
        assert_eq!(
            r.summary,
            ForecastReadinessSummary {
                insufficient_count: 1, // i
                limited_count: 1,      // l
                ready_count: 1,        // r
            }
        );
        assert_eq!(r.items.len(), 3);
        // items sorted appearances DESC: r(5), l(2), i(1).
        let ids: Vec<String> = r.items.iter().map(|i| i.contradiction_id.clone()).collect();
        assert_eq!(ids, vec!["r".to_string(), "l".to_string(), "i".to_string()]);
    }

    // 12.
    #[test]
    fn builder_does_not_modify_inputs() {
        let snaps = mixed();
        let h = build_report_history(&snaps);
        let t = build_report_trends(&snaps);
        let h_before = h.clone();
        let t_before = t.clone();
        let _ = build_forecast_readiness(&h, &t);
        assert_eq!(h, h_before);
        assert_eq!(t, t_before);
    }
}
