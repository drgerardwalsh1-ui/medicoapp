//! Durable Contradiction Engine report snapshot — a versioned, serializable artifact wrapping
//! the canonical `ContradictionReport` so persistence, APIs, caching, PDF generation,
//! and audit storage all consume the same object.
//!
//! PURE WRAPPING ONLY: it adds a schema version, a deterministic id, and a
//! caller-supplied timestamp around an existing `ContradictionReport`. No engine, graph,
//! analytics, narrative, or report logic is changed; no hashing, no UUIDs, no
//! internally-generated timestamps; metrics are read (len()), never recomputed.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::contradiction_report::{cluster_count, contradiction_count, ContradictionReport};

/// Bumped only on a breaking change to the snapshot/report schema.
pub const CONTRADICTION_REPORT_SCHEMA_VERSION: &str = "1.0";

// ── Snapshot model ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionReportSnapshot {
    pub schema_version: String,
    pub report_id: String,
    /// Caller-supplied creation time (epoch milliseconds). Never generated here.
    pub created_at_epoch_ms: u64,
    pub report: ContradictionReport,
}

// ── Builder ─────────────────────────────────────────────────────────────────

/// Wrap a `ContradictionReport` in a versioned snapshot. `report_id` is a stable,
/// deterministic string derived from four counts — no hashing, no randomness.
pub fn build_report_snapshot(
    report: ContradictionReport,
    created_at_epoch_ms: u64,
) -> ContradictionReportSnapshot {
    let report_id = format!(
        "step6:{}:{}:{}:{}",
        contradiction_count(&report),
        cluster_count(&report),
        report.graph.nodes.len(),
        report.graph.edges.len(),
    );
    ContradictionReportSnapshot {
        schema_version: CONTRADICTION_REPORT_SCHEMA_VERSION.to_string(),
        report_id,
        created_at_epoch_ms,
        report,
    }
}

// ── Queries ─────────────────────────────────────────────────────────────────

/// Fixed-template one-line summary.
pub fn snapshot_summary(snapshot: &ContradictionReportSnapshot) -> String {
    format!(
        "STEP6 report {} ({}) contains {} contradictions, {} clusters.",
        snapshot.report_id,
        snapshot.schema_version,
        contradiction_count(&snapshot.report),
        cluster_count(&snapshot.report),
    )
}

/// True iff the snapshot's schema version equals the current version.
pub fn snapshot_is_current(snapshot: &ContradictionReportSnapshot) -> bool {
    snapshot.schema_version == CONTRADICTION_REPORT_SCHEMA_VERSION
}

// ── Migration readiness (classification only) ───────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotCompatibility {
    Compatible,
    VersionMismatch,
}

/// Classify compatibility. No migration logic.
pub fn check_snapshot_compatibility(snapshot: &ContradictionReportSnapshot) -> SnapshotCompatibility {
    if snapshot_is_current(snapshot) {
        SnapshotCompatibility::Compatible
    } else {
        SnapshotCompatibility::VersionMismatch
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

    const TS: u64 = 1_700_000_000_000;

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

    // 3 fully-connected clinical contradictions (3 edges) + 1 isolated family.
    fn sample_report() -> ContradictionReport {
        let view = enrich_contradictions(vec![
            cc(ContradictionDomain::Clinical, "assertion", "fatigue", 0.50),
            cc(ContradictionDomain::Clinical, "assertion", "symptom:fatigue", 0.50),
            cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.50),
            cc(ContradictionDomain::Family, "relational", "a↔b", 0.40),
        ]);
        build_contradiction_report(view)
    }

    // 1.
    #[test]
    fn snapshot_build_is_deterministic() {
        let a = build_report_snapshot(sample_report(), TS);
        let b = build_report_snapshot(sample_report(), TS);
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    // 2.
    #[test]
    fn snapshot_contains_report() {
        let s = build_report_snapshot(sample_report(), TS);
        assert_eq!(s.report.view.enriched_contradictions.len(), 4);
        assert_eq!(s.report.graph.nodes.len(), 4);
        assert!(!s.report.analytics.cluster_metrics.is_empty());
        assert_eq!(s.created_at_epoch_ms, TS);
    }

    // 3.
    #[test]
    fn report_id_format_is_stable() {
        let s = build_report_snapshot(sample_report(), TS);
        // contradictions:4, clusters:2, nodes:4, edges:3
        assert_eq!(s.report_id, "step6:4:2:4:3");
    }

    // 4.
    #[test]
    fn schema_version_is_set() {
        let s = build_report_snapshot(sample_report(), TS);
        assert_eq!(s.schema_version, "1.0");
        assert_eq!(s.schema_version, CONTRADICTION_REPORT_SCHEMA_VERSION);
    }

    // 5.
    #[test]
    fn snapshot_summary_is_correct() {
        let s = build_report_snapshot(sample_report(), TS);
        assert_eq!(
            snapshot_summary(&s),
            "STEP6 report step6:4:2:4:3 (1.0) contains 4 contradictions, 2 clusters."
        );
    }

    // 6.
    #[test]
    fn current_snapshot_is_compatible() {
        let s = build_report_snapshot(sample_report(), TS);
        assert!(snapshot_is_current(&s));
        assert_eq!(check_snapshot_compatibility(&s), SnapshotCompatibility::Compatible);
    }

    // 7.
    #[test]
    fn version_mismatch_detected() {
        let mut s = build_report_snapshot(sample_report(), TS);
        s.schema_version = "0.9".to_string();
        assert!(!snapshot_is_current(&s));
        assert_eq!(check_snapshot_compatibility(&s), SnapshotCompatibility::VersionMismatch);
    }

    // 8.
    #[test]
    fn snapshot_builder_does_not_modify_report() {
        let report = sample_report();
        let before = serde_json::to_string(&report).unwrap();
        let s = build_report_snapshot(report, TS);
        // The report is carried verbatim into the snapshot.
        assert_eq!(serde_json::to_string(&s.report).unwrap(), before);
    }
}
