//! STEP-6 snapshot persistence boundary — the repository CONTRACT that future
//! storage backends (SQLite, Postgres, filesystem JSON, cloud) can satisfy
//! without touching any report logic.
//!
//! This module defines the trait + a deterministic in-memory reference
//! implementation only. NO filesystem, NO database, NO REST, NO async, NO Tauri
//! commands. `BTreeMap`-backed (never `HashMap`) so iteration order — and hence
//! `list()` — is deterministic.

#![allow(dead_code)]

use std::collections::BTreeMap;

use crate::step6_report_snapshot::Step6ReportSnapshot;

// ── Repository contract ──────────────────────────────────────────────────────

/// Storage-technology-agnostic contract for persisting report snapshots,
/// keyed by `report_id`.
pub trait SnapshotRepository {
    /// Persist a snapshot. Overwrites any existing snapshot with the same id.
    fn save(&mut self, snapshot: Step6ReportSnapshot) -> Result<(), String>;

    /// Fetch a snapshot by its `report_id`, if present.
    fn get(&self, report_id: &str) -> Option<Step6ReportSnapshot>;

    /// Enumerate all stored `report_id`s (sorted, deterministic).
    fn list(&self) -> Vec<String>;

    /// Number of stored snapshots.
    fn count(&self) -> usize;
}

// ── In-memory reference implementation ───────────────────────────────────────

/// Deterministic, clone-safe, `BTreeMap`-backed repository. Reference
/// implementation for tests and for callers that do not (yet) need durable
/// storage.
#[derive(Debug, Clone, Default)]
pub struct InMemorySnapshotRepository {
    store: BTreeMap<String, Step6ReportSnapshot>,
}

impl InMemorySnapshotRepository {
    pub fn new() -> Self {
        Self { store: BTreeMap::new() }
    }
}

impl SnapshotRepository for InMemorySnapshotRepository {
    fn save(&mut self, snapshot: Step6ReportSnapshot) -> Result<(), String> {
        self.store.insert(snapshot.report_id.clone(), snapshot);
        Ok(())
    }

    fn get(&self, report_id: &str) -> Option<Step6ReportSnapshot> {
        self.store.get(report_id).cloned()
    }

    fn list(&self) -> Vec<String> {
        // BTreeMap keys are already in sorted order.
        self.store.keys().cloned().collect()
    }

    fn count(&self) -> usize {
        self.store.len()
    }
}

// ── Repository helpers (work against any backend via the trait) ───────────────

/// True iff a snapshot with `report_id` exists.
pub fn snapshot_exists(repo: &dyn SnapshotRepository, report_id: &str) -> bool {
    repo.get(report_id).is_some()
}

/// The "newest" snapshot: largest `created_at_epoch_ms`, ties broken by the
/// lexicographically largest `report_id`. Returns `None` for an empty repo.
pub fn newest_snapshot(repo: &dyn SnapshotRepository) -> Option<Step6ReportSnapshot> {
    repo.list()
        .into_iter()
        .filter_map(|id| repo.get(&id))
        .max_by(|a, b| {
            a.created_at_epoch_ms
                .cmp(&b.created_at_epoch_ms)
                .then(a.report_id.cmp(&b.report_id))
        })
}

// ── Integrity check (read-only) ──────────────────────────────────────────────

/// Verify internal consistency: every listed id is fetchable, and `count()`
/// matches the length of `list()`. Read-only; performs no repair.
pub fn repository_is_consistent(repo: &dyn SnapshotRepository) -> bool {
    let ids = repo.list();
    if repo.count() != ids.len() {
        return false;
    }
    ids.iter().all(|id| repo.get(id).is_some())
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

    /// Snapshot with `n` clinical contradictions (fully connected) + caller ts.
    /// Distinct `n` yields a distinct deterministic report_id.
    fn snap(n: usize, ts: u64) -> Step6ReportSnapshot {
        let mut ccs = Vec::new();
        for i in 0..n {
            ccs.push(cc(
                ContradictionDomain::Clinical,
                "assertion",
                &format!("c{i}"),
                0.50,
            ));
        }
        let report = build_step6_report(enrich_step6(ccs));
        build_report_snapshot(report, ts)
    }

    // 1.
    #[test]
    fn save_and_get_snapshot() {
        let mut repo = InMemorySnapshotRepository::new();
        let s = snap(3, 1000);
        let id = s.report_id.clone();
        repo.save(s).unwrap();
        let got = repo.get(&id).expect("snapshot present");
        assert_eq!(got.report_id, id);
        assert!(repo.get("does-not-exist").is_none());
    }

    // 2.
    #[test]
    fn repository_count_is_correct() {
        let mut repo = InMemorySnapshotRepository::new();
        assert_eq!(repo.count(), 0);
        repo.save(snap(2, 10)).unwrap();
        repo.save(snap(3, 20)).unwrap();
        assert_eq!(repo.count(), 2);
        // Same report_id (same counts) overwrites rather than grows.
        repo.save(snap(3, 99)).unwrap();
        assert_eq!(repo.count(), 2);
    }

    // 3.
    #[test]
    fn list_is_sorted_and_deterministic() {
        let mut repo = InMemorySnapshotRepository::new();
        // Insert out of order.
        repo.save(snap(4, 1)).unwrap();
        repo.save(snap(2, 1)).unwrap();
        repo.save(snap(3, 1)).unwrap();
        let ids = repo.list();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
        assert_eq!(repo.list(), repo.list());
    }

    // 4.
    #[test]
    fn snapshot_exists_works() {
        let mut repo = InMemorySnapshotRepository::new();
        let s = snap(3, 1);
        let id = s.report_id.clone();
        assert!(!snapshot_exists(&repo, &id));
        repo.save(s).unwrap();
        assert!(snapshot_exists(&repo, &id));
        assert!(!snapshot_exists(&repo, "nope"));
    }

    // 5.
    #[test]
    fn newest_snapshot_selection_is_correct() {
        let mut repo = InMemorySnapshotRepository::new();
        repo.save(snap(2, 100)).unwrap();
        repo.save(snap(3, 300)).unwrap(); // newest by ts
        repo.save(snap(4, 200)).unwrap();
        let newest = newest_snapshot(&repo).unwrap();
        assert_eq!(newest.created_at_epoch_ms, 300);
        assert!(newest_snapshot(&InMemorySnapshotRepository::new()).is_none());
    }

    // 6.
    #[test]
    fn newest_snapshot_tiebreak_is_stable() {
        let mut repo = InMemorySnapshotRepository::new();
        // Equal timestamps ⇒ lexicographically largest report_id wins.
        let a = snap(2, 500); // step6:2:...
        let b = snap(7, 500); // step6:7:... (lexicographically larger)
        let expected = a.report_id.clone().max(b.report_id.clone());
        repo.save(a).unwrap();
        repo.save(b).unwrap();
        let newest = newest_snapshot(&repo).unwrap();
        assert_eq!(newest.created_at_epoch_ms, 500);
        assert_eq!(newest.report_id, expected);
    }

    // 7.
    #[test]
    fn repository_consistency_success_case() {
        let mut repo = InMemorySnapshotRepository::new();
        repo.save(snap(2, 1)).unwrap();
        repo.save(snap(3, 2)).unwrap();
        assert!(repository_is_consistent(&repo));
    }

    // 8.
    #[test]
    fn repository_consistency_detects_manual_corruption() {
        // A backend whose count() disagrees with list() is inconsistent.
        struct Corrupt;
        impl SnapshotRepository for Corrupt {
            fn save(&mut self, _s: Step6ReportSnapshot) -> Result<(), String> {
                Ok(())
            }
            fn get(&self, _id: &str) -> Option<Step6ReportSnapshot> {
                None // claims an id but cannot produce it
            }
            fn list(&self) -> Vec<String> {
                vec!["step6:1:1:1:0".into()]
            }
            fn count(&self) -> usize {
                5 // disagrees with list().len()
            }
        }
        assert!(!repository_is_consistent(&Corrupt));

        // Also: count matches but a listed id is unfetchable.
        struct Phantom;
        impl SnapshotRepository for Phantom {
            fn save(&mut self, _s: Step6ReportSnapshot) -> Result<(), String> {
                Ok(())
            }
            fn get(&self, _id: &str) -> Option<Step6ReportSnapshot> {
                None
            }
            fn list(&self) -> Vec<String> {
                vec!["ghost".into()]
            }
            fn count(&self) -> usize {
                1
            }
        }
        assert!(!repository_is_consistent(&Phantom));
    }

    // 9.
    #[test]
    fn repository_is_deterministic_across_runs() {
        let build = || {
            let mut repo = InMemorySnapshotRepository::new();
            repo.save(snap(4, 3)).unwrap();
            repo.save(snap(2, 1)).unwrap();
            repo.save(snap(3, 2)).unwrap();
            repo
        };
        let r1 = build();
        let r2 = build();
        assert_eq!(r1.list(), r2.list());
        assert_eq!(r1.count(), r2.count());
        // Clone-safe: a clone enumerates identically.
        let cloned = r1.clone();
        assert_eq!(r1.list(), cloned.list());
        assert_eq!(
            newest_snapshot(&r1).unwrap().report_id,
            newest_snapshot(&r2).unwrap().report_id
        );
    }
}
