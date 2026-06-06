//! STEP-6 trend analytics — deterministic, read-only classification of how each
//! contradiction's confidence moves across a snapshot series. Built ON TOP of the
//! history layer; it adds first/last confidence, delta, presence ratio, and a
//! direction label (Increasing / Decreasing / Stable / Intermittent).
//!
//! PURE DERIVATION: no engine, enrichment, graph, analytics, narrative, report,
//! snapshot, repository, diff, evolution, or history logic is modified. Identity
//! is exact `contradiction_id`. `BTreeMap` is a temporary builder only; outputs
//! are deterministic sorted `Vec`s. No `HashMap`/`HashSet`, no async, no I/O, no
//! timestamps generated, no randomness, no UUIDs, no statistics/regression/
//! forecasting.

#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::step6_report_history::{build_report_history, ReportHistory};
use crate::step6_report_snapshot::Step6ReportSnapshot;

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrendDirection {
    Increasing,
    Decreasing,
    Stable,
    Intermittent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionTrend {
    pub contradiction_id: String,
    pub appearances: usize,
    pub presence_ratio: f64,
    pub confidence_start: f64,
    pub confidence_end: f64,
    pub confidence_delta: f64,
    pub direction: TrendDirection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrendSummary {
    pub increasing_count: usize,
    pub decreasing_count: usize,
    pub stable_count: usize,
    pub intermittent_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportTrends {
    pub trends: Vec<ContradictionTrend>,
    pub summary: TrendSummary,
}

// ── Internal: ordered per-id confidence sequence ───────────────────────────────

/// `contradiction_id -> [(snapshot_index, confidence)]`, in chronological order
/// (`created_at_epoch_ms` ASC, then `report_id` ASC). Each snapshot contributes
/// at most one point per id.
fn confidence_sequences(
    snapshots: &[Step6ReportSnapshot],
) -> BTreeMap<String, Vec<(usize, f64)>> {
    let mut ordered: Vec<&Step6ReportSnapshot> = snapshots.iter().collect();
    ordered.sort_by(|a, b| {
        a.created_at_epoch_ms
            .cmp(&b.created_at_epoch_ms)
            .then(a.report_id.cmp(&b.report_id))
    });

    let mut seq: BTreeMap<String, Vec<(usize, f64)>> = BTreeMap::new();
    for (idx, s) in ordered.iter().enumerate() {
        for e in &s.report.view.enriched_contradictions {
            let id = e.base.contradiction_id.clone();
            let c = e.base.resolution_confidence as f64;
            let v = seq.entry(id).or_default();
            if v.last().map(|(i, _)| *i) != Some(idx) {
                v.push((idx, c));
            }
        }
    }
    seq
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Build trends directly from a snapshot series (builds the history internally).
pub fn build_report_trends(snapshots: &[Step6ReportSnapshot]) -> ReportTrends {
    let history = build_report_history(snapshots);
    build_trends_from_history(&history, snapshots)
}

/// Build trends from a precomputed `ReportHistory` plus the source snapshots.
/// `history` supplies appearances and snapshot_count; `snapshots` supply the
/// ordered confidence sequence. Read-only; deterministic.
pub fn build_trends_from_history(
    history: &ReportHistory,
    snapshots: &[Step6ReportSnapshot],
) -> ReportTrends {
    let seq = confidence_sequences(snapshots);
    let snapshot_count = history.summary.snapshot_count;

    let mut trends: Vec<ContradictionTrend> = Vec::new();
    let (mut increasing, mut decreasing, mut stable, mut intermittent) = (0, 0, 0, 0);

    for ch in &history.contradictions {
        let points = match seq.get(&ch.contradiction_id) {
            Some(p) if !p.is_empty() => p,
            _ => continue, // defensive: history/snapshots disagree
        };

        let appearances = ch.appearances;
        let presence_ratio = if snapshot_count > 0 {
            appearances as f64 / snapshot_count as f64
        } else {
            0.0
        };
        let confidence_start = points.first().unwrap().1;
        let confidence_end = points.last().unwrap().1;
        let confidence_delta = confidence_end - confidence_start;

        // Recurrence (gap between first and last appearance) — same rule the
        // history module uses for "recurring".
        let first = points.first().unwrap().0;
        let last = points.last().unwrap().0;
        let recurring = (last - first + 1) > appearances;

        // Priority: Intermittent → Increasing → Decreasing → Stable.
        let direction = if recurring {
            TrendDirection::Intermittent
        } else if confidence_delta > 0.0 {
            TrendDirection::Increasing
        } else if confidence_delta < 0.0 {
            TrendDirection::Decreasing
        } else {
            TrendDirection::Stable
        };
        match direction {
            TrendDirection::Increasing => increasing += 1,
            TrendDirection::Decreasing => decreasing += 1,
            TrendDirection::Stable => stable += 1,
            TrendDirection::Intermittent => intermittent += 1,
        }

        trends.push(ContradictionTrend {
            contradiction_id: ch.contradiction_id.clone(),
            appearances,
            presence_ratio,
            confidence_start,
            confidence_end,
            confidence_delta,
            direction,
        });
    }

    // Stable ordering: appearances DESC, then contradiction_id ASC.
    trends.sort_by(|a, b| {
        b.appearances
            .cmp(&a.appearances)
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });

    ReportTrends {
        trends,
        summary: TrendSummary {
            increasing_count: increasing,
            decreasing_count: decreasing,
            stable_count: stable,
            intermittent_count: intermittent,
        },
    }
}

/// Look up a single contradiction's trend by exact id.
pub fn trend_for(trends: &ReportTrends, contradiction_id: &str) -> Option<ContradictionTrend> {
    trends
        .trends
        .iter()
        .find(|t| t.contradiction_id == contradiction_id)
        .cloned()
}

/// Strengthening contradictions (positive delta), ordered by
/// `confidence_delta` DESC, then `contradiction_id` ASC.
pub fn top_increasing(trends: &ReportTrends, n: usize) -> Vec<String> {
    let mut v: Vec<&ContradictionTrend> =
        trends.trends.iter().filter(|t| t.confidence_delta > 0.0).collect();
    v.sort_by(|a, b| {
        b.confidence_delta
            .partial_cmp(&a.confidence_delta)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });
    v.into_iter().take(n).map(|t| t.contradiction_id.clone()).collect()
}

/// Weakening contradictions (negative delta), ordered by
/// `confidence_delta` ASC, then `contradiction_id` ASC.
pub fn top_decreasing(trends: &ReportTrends, n: usize) -> Vec<String> {
    let mut v: Vec<&ContradictionTrend> =
        trends.trends.iter().filter(|t| t.confidence_delta < 0.0).collect();
    v.sort_by(|a, b| {
        a.confidence_delta
            .partial_cmp(&b.confidence_delta)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });
    v.into_iter().take(n).map(|t| t.contradiction_id.clone()).collect()
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

    // 1.
    #[test]
    fn empty_trends() {
        let t = build_report_trends(&[]);
        assert!(t.trends.is_empty());
        assert_eq!(
            t.summary,
            TrendSummary {
                increasing_count: 0,
                decreasing_count: 0,
                stable_count: 0,
                intermittent_count: 0,
            }
        );
    }

    // 2.
    #[test]
    fn stable_trend_detected() {
        // Present in every snapshot, identical confidence ⇒ Stable.
        let snaps = vec![snap(&[("i1", "a", 0.5)], 1), snap(&[("i1", "a", 0.5)], 2)];
        let t = build_report_trends(&snaps);
        assert_eq!(trend_for(&t, "i1").unwrap().direction, TrendDirection::Stable);
        assert_eq!(t.summary.stable_count, 1);
    }

    // 3.
    #[test]
    fn increasing_trend_detected() {
        let snaps = vec![snap(&[("i1", "a", 0.3)], 1), snap(&[("i1", "a", 0.7)], 2)];
        let t = build_report_trends(&snaps);
        let tr = trend_for(&t, "i1").unwrap();
        assert_eq!(tr.direction, TrendDirection::Increasing);
        assert!(tr.confidence_delta > 0.0);
        assert_eq!(t.summary.increasing_count, 1);
    }

    // 4.
    #[test]
    fn decreasing_trend_detected() {
        let snaps = vec![snap(&[("i1", "a", 0.8)], 1), snap(&[("i1", "a", 0.4)], 2)];
        let t = build_report_trends(&snaps);
        let tr = trend_for(&t, "i1").unwrap();
        assert_eq!(tr.direction, TrendDirection::Decreasing);
        assert!(tr.confidence_delta < 0.0);
        assert_eq!(t.summary.decreasing_count, 1);
    }

    // 5.
    #[test]
    fn intermittent_trend_detected() {
        // Present, absent, present ⇒ recurring ⇒ Intermittent (even though the
        // confidence rises, Intermittent has priority).
        let snaps = vec![
            snap(&[("i1", "a", 0.4)], 1),
            snap(&[("i2", "b", 0.5)], 2),
            snap(&[("i1", "a", 0.9)], 3),
        ];
        let t = build_report_trends(&snaps);
        assert_eq!(trend_for(&t, "i1").unwrap().direction, TrendDirection::Intermittent);
        assert_eq!(t.summary.intermittent_count, 1);
    }

    // 6.
    #[test]
    fn presence_ratio_correct() {
        // i1 in 3/3, i2 in 2/3, i3 in 1/3.
        let snaps = vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 2),
            snap(&[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5)], 3),
        ];
        let t = build_report_trends(&snaps);
        assert_eq!(trend_for(&t, "i1").unwrap().presence_ratio, 3.0 / 3.0);
        assert_eq!(trend_for(&t, "i2").unwrap().presence_ratio, 2.0 / 3.0);
        assert_eq!(trend_for(&t, "i3").unwrap().presence_ratio, 1.0 / 3.0);
    }

    // 7.
    #[test]
    fn confidence_delta_correct() {
        let snaps = vec![snap(&[("i1", "a", 0.2)], 1), snap(&[("i1", "a", 0.6)], 2)];
        let t = build_report_trends(&snaps);
        let tr = trend_for(&t, "i1").unwrap();
        assert_eq!(tr.confidence_start, 0.2_f32 as f64);
        assert_eq!(tr.confidence_end, 0.6_f32 as f64);
        assert_eq!(tr.confidence_delta, (0.6_f32 as f64) - (0.2_f32 as f64));
    }

    // 8.
    #[test]
    fn top_increasing_ordering() {
        // a: +0.8, b: +0.2 ⇒ delta DESC ⇒ [a, b].
        let snaps = vec![
            snap(&[("a", "x", 0.1), ("b", "y", 0.2)], 1),
            snap(&[("a", "x", 0.9), ("b", "y", 0.4)], 2),
        ];
        let t = build_report_trends(&snaps);
        assert_eq!(top_increasing(&t, 5), vec!["a".to_string(), "b".to_string()]);
    }

    // 9.
    #[test]
    fn top_decreasing_ordering() {
        // a: -0.8, b: -0.3 ⇒ delta ASC (most negative first) ⇒ [a, b].
        let snaps = vec![
            snap(&[("a", "x", 0.9), ("b", "y", 0.8)], 1),
            snap(&[("a", "x", 0.1), ("b", "y", 0.5)], 2),
        ];
        let t = build_report_trends(&snaps);
        assert_eq!(top_decreasing(&t, 5), vec!["a".to_string(), "b".to_string()]);
        // Increasing list excludes weakening contradictions.
        assert!(top_increasing(&t, 5).is_empty());
    }

    // 10.
    #[test]
    fn trend_lookup_works() {
        let snaps = vec![snap(&[("i1", "a", 0.5)], 1)];
        let t = build_report_trends(&snaps);
        assert!(trend_for(&t, "i1").is_some());
        assert!(trend_for(&t, "missing").is_none());
    }

    // 11.
    #[test]
    fn deterministic_across_runs() {
        let snaps = vec![
            snap(&[("i1", "a", 0.3)], 1),
            snap(&[("i1", "a", 0.7), ("i2", "b", 0.5)], 2),
        ];
        assert_eq!(build_report_trends(&snaps), build_report_trends(&snaps));
        // build_from_history matches build_report_trends.
        let h = build_report_history(&snaps);
        assert_eq!(build_trends_from_history(&h, &snaps), build_report_trends(&snaps));
    }

    // 12.
    #[test]
    fn builder_does_not_modify_inputs() {
        let snaps = vec![
            snap(&[("i1", "a", 0.3)], 1),
            snap(&[("i1", "a", 0.7), ("i2", "b", 0.5)], 2),
        ];
        let before: Vec<String> =
            snaps.iter().map(|s| serde_json::to_string(s).unwrap()).collect();
        let _ = build_report_trends(&snaps);
        let after: Vec<String> =
            snaps.iter().map(|s| serde_json::to_string(s).unwrap()).collect();
        assert_eq!(before, after);
    }

    // 13. (extra) trends sorted by appearances DESC, id ASC.
    #[test]
    fn trends_are_sorted_by_appearances() {
        let snaps = vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 2),
            snap(&[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5)], 3),
        ];
        let t = build_report_trends(&snaps);
        let ids: Vec<String> = t.trends.iter().map(|x| x.contradiction_id.clone()).collect();
        assert_eq!(ids, vec!["i1".to_string(), "i2".to_string(), "i3".to_string()]);
    }
}
