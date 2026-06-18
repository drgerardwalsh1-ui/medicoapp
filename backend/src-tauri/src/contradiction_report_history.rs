//! Contradiction Engine longitudinal history — deterministic, read-only analysis across MANY
//! snapshots (the diff/evolution layers compare exactly two). Answers: when did
//! a contradiction first appear, when was it last seen, how many snapshots
//! contained it, is it persistent / resolved / recurring, and which have the
//! longest history.
//!
//! PURE DERIVATION: no engine, enrichment, graph, analytics, narrative, report,
//! snapshot, repository, diff, or evolution logic is touched or recomputed.
//! Identity is exact `contradiction_id` only. `BTreeMap`/`BTreeSet` are used as
//! temporary builders; all outputs are deterministic sorted `Vec`s. No
//! `HashMap`/`HashSet` in outputs, no async, no I/O, no timestamps generated, no
//! randomness, no UUIDs, no repository mutation.

#![allow(dead_code)]

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::contradiction_report_snapshot::ContradictionReportSnapshot;
use crate::contradiction_snapshot_repository::SnapshotRepository;

// ── Model ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContradictionHistory {
    pub contradiction_id: String,
    pub first_seen_report_id: String,
    pub last_seen_report_id: String,
    pub appearances: usize,
    pub currently_present: bool,
    pub confidence_min: f64,
    pub confidence_max: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HistorySummary {
    pub snapshot_count: usize,
    pub unique_contradiction_count: usize,
    pub persistent_contradiction_count: usize,
    pub resolved_contradiction_count: usize,
    pub recurring_contradiction_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReportHistory {
    pub contradictions: Vec<ContradictionHistory>,
    pub summary: HistorySummary,
}

// ── Builder ────────────────────────────────────────────────────────────────────

/// Build a longitudinal history over all `snapshots`. Read-only; deterministic.
///
/// Snapshots are ordered by `created_at_epoch_ms` ASC, then `report_id` ASC.
/// Identity is exact `contradiction_id`.
pub fn build_report_history(snapshots: &[ContradictionReportSnapshot]) -> ReportHistory {
    // 1. Deterministic chronological order.
    let mut ordered: Vec<&ContradictionReportSnapshot> = snapshots.iter().collect();
    ordered.sort_by(|a, b| {
        a.created_at_epoch_ms
            .cmp(&b.created_at_epoch_ms)
            .then(a.report_id.cmp(&b.report_id))
    });
    let snapshot_count = ordered.len();
    let newest_index = snapshot_count.checked_sub(1); // None when empty

    // 2. Per-id presence indices + observed confidence min/max.
    //    BTreeMap ⇒ deterministic id-ascending iteration.
    let mut presence: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut conf: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for (idx, s) in ordered.iter().enumerate() {
        for e in &s.report.view.enriched_contradictions {
            let id = &e.base.contradiction_id;
            let c = e.base.resolution_confidence as f64;
            let v = presence.entry(id.clone()).or_default();
            // Defensive: count a snapshot at most once per id.
            if v.last() != Some(&idx) {
                v.push(idx);
            }
            conf.entry(id.clone())
                .and_modify(|(mn, mx)| {
                    if c < *mn {
                        *mn = c;
                    }
                    if c > *mx {
                        *mx = c;
                    }
                })
                .or_insert((c, c));
        }
    }

    // 3. One ContradictionHistory per id.
    let mut contradictions: Vec<ContradictionHistory> = Vec::new();
    let mut persistent = 0usize;
    let mut resolved = 0usize;
    let mut recurring = 0usize;
    for (id, indices) in &presence {
        let appearances = indices.len();
        let first = indices[0];
        let last = *indices.last().unwrap();
        let currently_present = newest_index == Some(last);
        let (cmin, cmax) = conf.get(id).copied().unwrap_or((0.0, 0.0));

        // Persistent: appears in every snapshot.
        let is_persistent = snapshot_count > 0 && appearances == snapshot_count;
        // Resolved: appeared previously but absent from the latest snapshot.
        let is_resolved = !currently_present;
        // Recurring: present, then absent, then present again ⇒ a gap exists
        // between first and last appearance (span exceeds appearance count).
        let is_recurring = (last - first + 1) > appearances;

        if is_persistent {
            persistent += 1;
        }
        if is_resolved {
            resolved += 1;
        }
        if is_recurring {
            recurring += 1;
        }

        contradictions.push(ContradictionHistory {
            contradiction_id: id.clone(),
            first_seen_report_id: ordered[first].report_id.clone(),
            last_seen_report_id: ordered[last].report_id.clone(),
            appearances,
            currently_present,
            confidence_min: cmin,
            confidence_max: cmax,
        });
    }

    // 4. Stable ordering: appearances DESC, then contradiction_id ASC.
    contradictions.sort_by(|a, b| {
        b.appearances
            .cmp(&a.appearances)
            .then(a.contradiction_id.cmp(&b.contradiction_id))
    });

    let summary = HistorySummary {
        snapshot_count,
        unique_contradiction_count: contradictions.len(),
        persistent_contradiction_count: persistent,
        resolved_contradiction_count: resolved,
        recurring_contradiction_count: recurring,
    };

    ReportHistory { contradictions, summary }
}

/// Build a history from every snapshot in a repository. Read-only; the repo is
/// never mutated. Ordering is applied inside `build_report_history`.
pub fn build_history_from_repository(repo: &dyn SnapshotRepository) -> ReportHistory {
    let snapshots: Vec<ContradictionReportSnapshot> =
        repo.list().into_iter().filter_map(|id| repo.get(&id)).collect();
    build_report_history(&snapshots)
}

/// Look up a single contradiction's history by exact id.
pub fn contradiction_history(
    history: &ReportHistory,
    contradiction_id: &str,
) -> Option<ContradictionHistory> {
    history
        .contradictions
        .iter()
        .find(|c| c.contradiction_id == contradiction_id)
        .cloned()
}

/// The `n` longest-lived contradiction ids, in the history's canonical order
/// (appearances DESC, id ASC).
pub fn longest_lived_contradictions(history: &ReportHistory, n: usize) -> Vec<String> {
    history
        .contradictions
        .iter()
        .take(n)
        .map(|c| c.contradiction_id.clone())
        .collect()
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
    use crate::contradiction_snapshot_repository::InMemorySnapshotRepository;

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

    fn snap(items: &[(&str, &str, f32)], ts: u64) -> ContradictionReportSnapshot {
        let ccs: Vec<CaseContradiction> = items.iter().map(|(id, s, c)| cc(id, s, *c)).collect();
        build_report_snapshot(build_contradiction_report(enrich_contradictions(ccs)), ts)
    }

    // Growing fixture: s1{i1} → s2{i1,i2} → s3{i1,i2,i3}. Distinct report_ids.
    fn growing() -> Vec<ContradictionReportSnapshot> {
        vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i1", "a", 0.9), ("i2", "b", 0.6)], 2),
            snap(&[("i1", "a", 0.7), ("i2", "b", 0.6), ("i3", "c", 0.4)], 3),
        ]
    }

    // 1.
    #[test]
    fn empty_history() {
        let h = build_report_history(&[]);
        assert!(h.contradictions.is_empty());
        assert_eq!(
            h.summary,
            HistorySummary {
                snapshot_count: 0,
                unique_contradiction_count: 0,
                persistent_contradiction_count: 0,
                resolved_contradiction_count: 0,
                recurring_contradiction_count: 0,
            }
        );
    }

    // 2.
    #[test]
    fn single_snapshot_history() {
        let h = build_report_history(&[snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 1)]);
        assert_eq!(h.summary.snapshot_count, 1);
        assert_eq!(h.summary.unique_contradiction_count, 2);
        // Each appears in the only snapshot ⇒ persistent, present, none resolved.
        assert_eq!(h.summary.persistent_contradiction_count, 2);
        assert_eq!(h.summary.resolved_contradiction_count, 0);
        assert_eq!(h.summary.recurring_contradiction_count, 0);
    }

    // 3.
    #[test]
    fn first_seen_is_correct() {
        let h = build_report_history(&growing());
        let i1 = contradiction_history(&h, "i1").unwrap();
        let i2 = contradiction_history(&h, "i2").unwrap();
        assert_eq!(i1.first_seen_report_id, "step6:1:1:1:0");
        assert_eq!(i2.first_seen_report_id, "step6:2:1:2:1");
    }

    // 4.
    #[test]
    fn last_seen_is_correct() {
        let h = build_report_history(&growing());
        let i1 = contradiction_history(&h, "i1").unwrap();
        let i3 = contradiction_history(&h, "i3").unwrap();
        assert_eq!(i1.last_seen_report_id, "step6:3:1:3:3");
        assert_eq!(i3.last_seen_report_id, "step6:3:1:3:3");
    }

    // 5.
    #[test]
    fn appearances_count_is_correct() {
        let h = build_report_history(&growing());
        assert_eq!(contradiction_history(&h, "i1").unwrap().appearances, 3);
        assert_eq!(contradiction_history(&h, "i2").unwrap().appearances, 2);
        assert_eq!(contradiction_history(&h, "i3").unwrap().appearances, 1);
    }

    // 6.
    #[test]
    fn persistent_contradiction_detected() {
        let h = build_report_history(&growing());
        // Only i1 appears in all 3 snapshots.
        assert_eq!(h.summary.persistent_contradiction_count, 1);
        assert_eq!(contradiction_history(&h, "i1").unwrap().appearances, 3);
        assert!(contradiction_history(&h, "i1").unwrap().currently_present);
    }

    // 7.
    #[test]
    fn resolved_contradiction_detected() {
        // i1 in s1,s2 but not s3 (latest) ⇒ resolved.
        let snaps = vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 2),
            snap(&[("i2", "b", 0.5), ("i3", "c", 0.5)], 3),
        ];
        let h = build_report_history(&snaps);
        let i1 = contradiction_history(&h, "i1").unwrap();
        assert!(!i1.currently_present);
        assert_eq!(h.summary.resolved_contradiction_count, 1);
    }

    // 8.
    #[test]
    fn recurring_contradiction_detected() {
        // i1 present, absent, then present again.
        let snaps = vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i2", "b", 0.5)], 2),
            snap(&[("i1", "a", 0.7)], 3),
        ];
        let h = build_report_history(&snaps);
        let i1 = contradiction_history(&h, "i1").unwrap();
        assert_eq!(i1.appearances, 2);
        assert!(i1.currently_present);
        assert_eq!(h.summary.recurring_contradiction_count, 1);
        // i2 appeared only in the middle ⇒ not recurring, but resolved.
        assert_eq!(contradiction_history(&h, "i2").unwrap().appearances, 1);
    }

    // 9.
    #[test]
    fn confidence_min_max_correct() {
        let h = build_report_history(&growing());
        // i1 observed at 0.5, 0.9, 0.7.
        let i1 = contradiction_history(&h, "i1").unwrap();
        assert_eq!(i1.confidence_min, 0.5_f32 as f64);
        assert_eq!(i1.confidence_max, 0.9_f32 as f64);
    }

    // 10.
    #[test]
    fn longest_lived_ordering_is_deterministic() {
        // i3 and i4 tie at 1 appearance ⇒ id ASC tiebreak.
        let snaps = vec![
            snap(&[("i1", "a", 0.5)], 1),
            snap(&[("i1", "a", 0.5), ("i2", "b", 0.5)], 2),
            snap(
                &[("i1", "a", 0.5), ("i2", "b", 0.5), ("i3", "c", 0.5), ("i4", "d", 0.5)],
                3,
            ),
        ];
        let h = build_report_history(&snaps);
        assert_eq!(
            longest_lived_contradictions(&h, 4),
            vec!["i1".to_string(), "i2".to_string(), "i3".to_string(), "i4".to_string()]
        );
        // n larger than available is clamped by take().
        assert_eq!(longest_lived_contradictions(&h, 99).len(), 4);
        // Deterministic across runs.
        assert_eq!(build_report_history(&snaps), h);
    }

    // 11.
    #[test]
    fn repository_builder_matches_direct_builder() {
        let snaps = growing();
        let mut repo = InMemorySnapshotRepository::new();
        for s in &snaps {
            repo.save(s.clone()).unwrap();
        }
        let from_repo = build_history_from_repository(&repo);
        let direct = build_report_history(&snaps);
        assert_eq!(from_repo, direct);
    }

    // 12.
    #[test]
    fn history_builder_does_not_modify_inputs() {
        let snaps = growing();
        let before: Vec<String> =
            snaps.iter().map(|s| serde_json::to_string(s).unwrap()).collect();
        let _ = build_report_history(&snaps);
        let after: Vec<String> =
            snaps.iter().map(|s| serde_json::to_string(s).unwrap()).collect();
        assert_eq!(before, after);
    }

    // 13. (extra) ordering independent of input order.
    #[test]
    fn ordering_is_independent_of_input_order() {
        let mut shuffled = growing();
        shuffled.reverse(); // feed newest-first
        let h1 = build_report_history(&growing());
        let h2 = build_report_history(&shuffled);
        assert_eq!(h1, h2);
    }
}
