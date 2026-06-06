//! STEP-6 snapshot filesystem backend — the first concrete `SnapshotRepository`
//! implementation. Each snapshot is one JSON file named `{report_id}.json` under
//! a base directory.
//!
//! Deterministic, synchronous, std + serde only. NO async, NO database, NO
//! networking, NO caching, NO hidden state, NO hashing/UUIDs. Engine, graph,
//! analytics, narrative, report, snapshot, and the repository trait are
//! unchanged — this module only *satisfies* the existing contract.

#![allow(dead_code)]

use std::fs;
use std::path::Path;

use crate::step6_report_snapshot::Step6ReportSnapshot;
use crate::step6_snapshot_repository::SnapshotRepository;

// ── Structure ─────────────────────────────────────────────────────────────────

pub struct FileSnapshotRepository {
    pub base_path: String,
}

impl FileSnapshotRepository {
    pub fn new(base_path: impl Into<String>) -> Self {
        Self { base_path: base_path.into() }
    }
}

// ── Path / name helpers ───────────────────────────────────────────────────────

/// Deterministic file path for a snapshot: `{base_path}/{report_id}.json`.
pub fn snapshot_path(base_path: &str, report_id: &str) -> String {
    format!("{}/{}.json", base_path, report_id)
}

/// Filesystem-safety gate for a `report_id` used as a file stem.
/// Allows alphanumeric + ':' + '-' only — no slashes, no spaces, no other
/// path-significant characters.
pub fn is_valid_snapshot_file_name(report_id: &str) -> bool {
    !report_id.is_empty()
        && report_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ':' || c == '-')
}

// ── SnapshotRepository impl ────────────────────────────────────────────────────

impl SnapshotRepository for FileSnapshotRepository {
    fn save(&mut self, snapshot: Step6ReportSnapshot) -> Result<(), String> {
        if !is_valid_snapshot_file_name(&snapshot.report_id) {
            return Err("IO_ERROR".to_string());
        }
        // Ensure the directory exists on first save.
        fs::create_dir_all(&self.base_path).map_err(|_| "IO_ERROR".to_string())?;
        let json =
            serde_json::to_string(&snapshot).map_err(|_| "SERIALIZATION_ERROR".to_string())?;
        let path = snapshot_path(&self.base_path, &snapshot.report_id);
        fs::write(&path, json).map_err(|_| "IO_ERROR".to_string())?;
        Ok(())
    }

    fn get(&self, report_id: &str) -> Option<Step6ReportSnapshot> {
        if !is_valid_snapshot_file_name(report_id) {
            return None;
        }
        let path = snapshot_path(&self.base_path, report_id);
        let json = fs::read_to_string(&path).ok()?; // None if file missing
        serde_json::from_str(&json).ok() // None if invalid
    }

    fn list(&self) -> Vec<String> {
        let mut ids = read_snapshot_ids(&self.base_path);
        ids.sort();
        ids
    }

    fn count(&self) -> usize {
        read_snapshot_ids(&self.base_path).len()
    }
}

/// Read all `report_id`s present on disk (`*.json` stems). Unsorted; missing
/// directory yields an empty list. Internal helper — no hidden state.
fn read_snapshot_ids(base_path: &str) -> Vec<String> {
    let dir = match fs::read_dir(Path::new(base_path)) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    let mut ids = Vec::new();
    for entry in dir.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if let Some(stem) = name.strip_suffix(".json") {
            ids.push(stem.to_string());
        }
    }
    ids
}

// ── Optional utility ───────────────────────────────────────────────────────────

/// Load every valid snapshot under `base_path`, sorted by `report_id`.
/// Corrupted/undeserializable files are skipped rather than failing.
pub fn load_all_snapshots(base_path: &str) -> Vec<Step6ReportSnapshot> {
    let repo = FileSnapshotRepository::new(base_path.to_string());
    repo.list().into_iter().filter_map(|id| repo.get(&id)).collect()
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
    use std::path::PathBuf;

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

    /// Snapshot with `n` fully-connected clinical contradictions → distinct
    /// deterministic report_id per `n`.
    fn snap(n: usize, ts: u64) -> Step6ReportSnapshot {
        let mut ccs = Vec::new();
        for i in 0..n {
            ccs.push(cc(ContradictionDomain::Clinical, "assertion", &format!("c{i}"), 0.50));
        }
        let report = build_step6_report(enrich_step6(ccs));
        build_report_snapshot(report, ts)
    }

    /// Fresh, isolated temp directory per test (deterministic name, cleaned up).
    fn temp_dir(name: &str) -> String {
        let mut p: PathBuf = std::env::temp_dir();
        p.push(format!("step6_file_repo_test_{name}"));
        let s = p.to_string_lossy().to_string();
        let _ = fs::remove_dir_all(&s);
        s
    }

    // 1.
    #[test]
    fn file_save_creates_snapshot() {
        let dir = temp_dir("save_creates");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        let s = snap(3, 1);
        let id = s.report_id.clone();
        repo.save(s).unwrap();
        assert!(Path::new(&snapshot_path(&dir, &id)).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    // 2.
    #[test]
    fn file_get_roundtrip_is_lossless() {
        let dir = temp_dir("roundtrip");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        let s = snap(3, 42);
        let before = serde_json::to_string(&s).unwrap();
        let id = s.report_id.clone();
        repo.save(s).unwrap();
        let got = repo.get(&id).expect("present");
        assert_eq!(serde_json::to_string(&got).unwrap(), before);
        let _ = fs::remove_dir_all(&dir);
    }

    // 3.
    #[test]
    fn file_list_is_deterministic() {
        let dir = temp_dir("list_det");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        repo.save(snap(4, 1)).unwrap();
        repo.save(snap(2, 1)).unwrap();
        repo.save(snap(3, 1)).unwrap();
        let ids = repo.list();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
        assert_eq!(repo.list(), repo.list());
        let _ = fs::remove_dir_all(&dir);
    }

    // 4.
    #[test]
    fn file_count_matches_disk() {
        let dir = temp_dir("count");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        assert_eq!(repo.count(), 0);
        repo.save(snap(2, 1)).unwrap();
        repo.save(snap(3, 1)).unwrap();
        assert_eq!(repo.count(), 2);
        // Overwrite same id ⇒ still 2 files.
        repo.save(snap(3, 9)).unwrap();
        assert_eq!(repo.count(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    // 5.
    #[test]
    fn missing_file_returns_none() {
        let dir = temp_dir("missing");
        let repo = FileSnapshotRepository::new(dir.clone());
        assert!(repo.get("step6:1:1:1:0").is_none());
        // Invalid name is also None.
        assert!(repo.get("../etc/passwd").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    // 6.
    #[test]
    fn corrupted_file_is_handled_gracefully() {
        let dir = temp_dir("corrupt");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        repo.save(snap(2, 1)).unwrap();
        // Write a corrupt .json file directly.
        let bad = snapshot_path(&dir, "step6:9:9:9:9");
        fs::write(&bad, "{ not valid json ").unwrap();
        // get() on the corrupt id returns None, not an error.
        assert!(repo.get("step6:9:9:9:9").is_none());
        // load_all_snapshots skips it but keeps the good one.
        let all = load_all_snapshots(&dir);
        assert_eq!(all.len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    // 7.
    #[test]
    fn overwrite_is_deterministic() {
        let dir = temp_dir("overwrite");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        repo.save(snap(3, 100)).unwrap();
        repo.save(snap(3, 200)).unwrap(); // same report_id, newer ts
        let got = repo.get(&snap(3, 0).report_id).unwrap();
        assert_eq!(got.created_at_epoch_ms, 200);
        assert_eq!(repo.count(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    // 8.
    #[test]
    fn report_id_is_valid_filename() {
        assert!(is_valid_snapshot_file_name("step6:4:2:7:9"));
        assert!(is_valid_snapshot_file_name("step6:0:0:0:0"));
        assert!(!is_valid_snapshot_file_name("step6/4"));
        assert!(!is_valid_snapshot_file_name("step6 4"));
        assert!(!is_valid_snapshot_file_name(""));
        assert!(!is_valid_snapshot_file_name("../escape"));
        // A real snapshot's id passes the gate.
        assert!(is_valid_snapshot_file_name(&snap(4, 1).report_id));
    }

    // 9.
    #[test]
    fn load_all_snapshots_is_sorted() {
        let dir = temp_dir("load_all");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        repo.save(snap(5, 1)).unwrap();
        repo.save(snap(2, 1)).unwrap();
        repo.save(snap(3, 1)).unwrap();
        let all = load_all_snapshots(&dir);
        let ids: Vec<String> = all.iter().map(|s| s.report_id.clone()).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        assert_eq!(ids, sorted);
        assert_eq!(all.len(), 3);
        let _ = fs::remove_dir_all(&dir);
    }

    // 10.
    #[test]
    fn repository_interface_compliance_with_file_backend() {
        // Exercise the FileSnapshotRepository purely through the trait object,
        // proving it is a drop-in SnapshotRepository.
        let dir = temp_dir("iface");
        let mut repo = FileSnapshotRepository::new(dir.clone());
        {
            let r: &mut dyn SnapshotRepository = &mut repo;
            r.save(snap(2, 1)).unwrap();
            r.save(snap(3, 1)).unwrap();
            assert_eq!(r.count(), 2);
            assert_eq!(r.list().len(), 2);
            let first = r.list()[0].clone();
            assert!(r.get(&first).is_some());
        }
        // Shared-ref trait helpers also work against the file backend.
        use crate::step6_snapshot_repository::{newest_snapshot, repository_is_consistent, snapshot_exists};
        let r: &dyn SnapshotRepository = &repo;
        assert!(repository_is_consistent(r));
        assert!(snapshot_exists(r, &r.list()[0]));
        assert!(newest_snapshot(r).is_some());
        let _ = fs::remove_dir_all(&dir);
    }
}
