//! STEP-6 export — deterministic, read-only PROJECTIONS of the enriched stream.
//!
//! Consumes `step6_enrichment::Step6View` ONLY. It never touches a graph, an
//! engine, dispatch, or an event; never recomputes contradictions; never
//! mutates `CaseContradiction` / `EnrichedCaseContradiction`; never alters
//! confidence values or ordering. Every output is a 1:1, order-preserving
//! projection of values already present on the view.
//!
//! Determinism: input order preserved verbatim; `BTreeMap` for the summary; no
//! `HashMap`, no randomness, no timestamps, no UUIDs, no filesystem access.

// Additive projection layer; not yet wired to a command.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};

use crate::canonical_case::{CaseContradiction, CaseContradictionBody};
use crate::step6_enrichment::Step6View;

/// Confidence decimal places in CSV output. The engine computes
/// `resolution_confidence` via `round3` (3 dp); pinning the CSV to `{:.N}` with
/// N = 3 reproduces the engine value exactly and prevents f32→f64 widening from
/// leaking spurious precision (audit F6). Internal values are unchanged.
const CONFIDENCE_DECIMALS: usize = 3;

// ── Projection types ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Step6ExportRow {
    pub domain: String,
    pub subject: String,
    pub conflict_label: String,
    pub resolution_confidence: f64,
    pub severity_rank: u8,
    pub presentation_group: String,
    pub cross_domain_tag: Option<String>,
    // ── Provenance (audit F4) — read verbatim from the contradiction body. ──
    /// Stable id of the underlying contradiction (traceability anchor).
    pub contradiction_id: String,
    /// Source ids: clinical = unified+patient event ids; family = source labels.
    /// Sorted (BTreeSet) for determinism.
    pub source_ids: Vec<String>,
    /// Family-only edge ids (empty for clinical). Sorted for determinism.
    pub edge_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Step6Export {
    pub rows: Vec<Step6ExportRow>,
}

const CSV_HEADER: &str = "domain,subject,conflict_label,resolution_confidence,severity_rank,presentation_group,cross_domain_tag,contradiction_id,source_ids,edge_ids";

/// Deterministically extract `(source_ids, edge_ids)` provenance from the
/// already-built contradiction body. Read-only; no recomputation. `BTreeSet`
/// ⇒ sorted, stable ordering.
fn provenance_of(c: &CaseContradiction) -> (Vec<String>, Vec<String>) {
    match &c.body {
        CaseContradictionBody::Clinical(x) => {
            let mut s: BTreeSet<String> = x.source_unified_event_ids.iter().cloned().collect();
            s.extend(x.source_patient_event_ids.iter().cloned());
            (s.into_iter().collect(), Vec::new())
        }
        CaseContradictionBody::Family(x) => {
            let s: BTreeSet<String> = x.source_refs.iter().map(|r| r.source.clone()).collect();
            let e: BTreeSet<String> = x.edge_ids.iter().cloned().collect();
            (s.into_iter().collect(), e.into_iter().collect())
        }
    }
}

// ── A) Row projection ─────────────────────────────────────────────────────────

/// One row per `EnrichedCaseContradiction`, in input order. No sorting,
/// filtering, or aggregation; values copied verbatim.
pub fn export_rows(view: &Step6View) -> Step6Export {
    let rows = view
        .enriched_contradictions
        .iter()
        .map(|e| {
            let (source_ids, edge_ids) = provenance_of(&e.base);
            Step6ExportRow {
                domain: e.base.domain.as_str().to_string(),
                subject: e.base.subject.clone(),
                conflict_label: e.base.conflict_label.clone(),
                // Widening f32 → f64 is exact; no value change.
                resolution_confidence: e.base.resolution_confidence as f64,
                severity_rank: e.derived.severity_rank,
                presentation_group: e.derived.presentation_group.clone(),
                cross_domain_tag: e.derived.cross_domain_tag.clone(),
                contradiction_id: e.base.contradiction_id.clone(),
                source_ids,
                edge_ids,
            }
        })
        .collect();
    Step6Export { rows }
}

// ── B) CSV projection ─────────────────────────────────────────────────────────

/// RFC4180-style field escaping: wrap in quotes (doubling internal quotes) only
/// when the field contains a comma, quote, or newline. Deterministic.
fn csv_escape(s: &str) -> String {
    if s.contains(|c| matches!(c, ',' | '"' | '\n' | '\r')) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn row_to_csv(r: &Step6ExportRow) -> String {
    format!(
        "{},{},{},{:.*},{},{},{},{},{},{}",
        csv_escape(&r.domain),
        csv_escape(&r.subject),
        csv_escape(&r.conflict_label),
        // Pinned precision (F6): exactly CONFIDENCE_DECIMALS dp.
        CONFIDENCE_DECIMALS,
        r.resolution_confidence,
        r.severity_rank,
        csv_escape(&r.presentation_group),
        r.cross_domain_tag.as_deref().map(csv_escape).unwrap_or_default(),
        csv_escape(&r.contradiction_id),
        // Multi-valued provenance joined with ';' inside one quoted-as-needed cell.
        csv_escape(&r.source_ids.join(";")),
        csv_escape(&r.edge_ids.join(";")),
    )
}

/// Header line followed by one line per row, in input order. No filesystem
/// access — returns the lines only. Stable across runs.
pub fn export_csv_lines(view: &Step6View) -> Vec<String> {
    let export = export_rows(view);
    let mut lines = Vec::with_capacity(export.rows.len() + 1);
    lines.push(CSV_HEADER.to_string());
    for r in &export.rows {
        lines.push(row_to_csv(r));
    }
    lines
}

// ── C) Summary projection ─────────────────────────────────────────────────────

/// Count of rows per `presentation_group`. `BTreeMap` ⇒ deterministic,
/// key-sorted ordering.
pub fn export_summary(view: &Step6View) -> BTreeMap<String, usize> {
    let mut out: BTreeMap<String, usize> = BTreeMap::new();
    for e in &view.enriched_contradictions {
        *out.entry(e.derived.presentation_group.clone()).or_insert(0) += 1;
    }
    out
}

// ════════════════════════════════════════════════════════════════════════
// Tests — projection only; no engine behaviour exercised.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::canonical_case::{CaseContradiction, CaseContradictionBody, ContradictionDomain};
    use crate::family_graph::{FamilyConflictType, FamilyContradiction, FamilyValue};
    use crate::step6_enrichment::enrich_step6;

    fn body(conflict_flag: bool, rc: f32) -> CaseContradictionBody {
        CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: "x".into(),
            conflict_type: FamilyConflictType::Relational,
            pair: ("a".into(), Some("b".into())),
            subject: "s".into(),
            canonical_value: FamilyValue {
                value: "v".into(),
                support_count: 1,
                confidence: rc,
                sources: vec![],
                edge_ids: vec![],
            },
            alternatives: vec![],
            conflict_flag,
            resolution_confidence: rc,
            source_refs: vec![],
            edge_ids: vec![],
            metadata: serde_json::json!({}),
        })
    }

    fn cc(domain: ContradictionDomain, label: &str, subject: &str, rc: f32) -> CaseContradiction {
        CaseContradiction {
            domain,
            contradiction_id: format!("{}:{}:{}", domain.as_str(), label, subject),
            conflict_label: label.into(),
            subject: subject.into(),
            resolution_confidence: rc,
            body: body(true, rc),
        }
    }

    // Family body carrying real provenance (source labels + edge ids).
    fn family_cc_prov(subject: &str, rc: f32, sources: &[&str], edges: &[&str]) -> CaseContradiction {
        use crate::family_graph::SourceRef;
        let body = CaseContradictionBody::Family(FamilyContradiction {
            contradiction_id: format!("famcontra::{subject}"),
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
            source_refs: sources
                .iter()
                .map(|s| SourceRef { source: (*s).into(), date: None, context: "c".into() })
                .collect(),
            edge_ids: edges.iter().map(|e| (*e).to_string()).collect(),
            metadata: serde_json::json!({}),
        });
        CaseContradiction {
            domain: ContradictionDomain::Family,
            contradiction_id: format!("famcontra::{subject}"),
            conflict_label: "relational".into(),
            subject: subject.into(),
            resolution_confidence: rc,
            body,
        }
    }

    // Clinical body carrying real provenance (unified + patient event ids).
    fn clinical_cc_prov(subject: &str, rc: f32, unified: &[&str], patient: &[&str]) -> CaseContradiction {
        use crate::canonical_case::{
            ConflictDimension, Contradiction, ContradictionValue,
        };
        use crate::clinical_events::EventType;
        let body = CaseContradictionBody::Clinical(Contradiction {
            contradiction_id: format!("contradiction::{subject}"),
            dimension: ConflictDimension::Assertion,
            subject: subject.into(),
            event_type: EventType::Diagnosis,
            canonical_value: ContradictionValue {
                value: "affirmed".into(),
                support_count: 1,
                confidence: rc,
                sources: vec![],
            },
            alternatives: vec![],
            conflict_flag: true,
            resolution_confidence: rc,
            source_unified_event_ids: unified.iter().map(|s| (*s).to_string()).collect(),
            source_patient_event_ids: patient.iter().map(|s| (*s).to_string()).collect(),
            metadata: serde_json::json!({}),
        });
        CaseContradiction {
            domain: ContradictionDomain::Clinical,
            contradiction_id: format!("contradiction::{subject}"),
            conflict_label: "assertion".into(),
            subject: subject.into(),
            resolution_confidence: rc,
            body,
        }
    }

    fn sample_view() -> Step6View {
        enrich_step6(vec![
            cc(ContradictionDomain::Clinical, "assertion", "ptsd", 0.40),
            cc(ContradictionDomain::Family, "cardinality", "kids", 0.50),
            cc(ContradictionDomain::Family, "cardinality", "deps", 0.80),
        ])
    }

    // 1.
    #[test]
    fn export_rows_preserves_order() {
        let rows = export_rows(&sample_view()).rows;
        let subjects: Vec<&str> = rows.iter().map(|r| r.subject.as_str()).collect();
        assert_eq!(subjects, vec!["ptsd", "kids", "deps"]);
        let domains: Vec<&str> = rows.iter().map(|r| r.domain.as_str()).collect();
        assert_eq!(domains, vec!["clinical", "family", "family"]);
    }

    // 2.
    #[test]
    fn export_rows_is_deterministic() {
        let v = sample_view();
        assert_eq!(export_rows(&v), export_rows(&v));
    }

    // 3.
    #[test]
    fn csv_export_is_byte_identical_across_runs() {
        let v = sample_view();
        let a = export_csv_lines(&v);
        let b = export_csv_lines(&v);
        assert_eq!(a, b);
        assert_eq!(a[0], CSV_HEADER);
        assert_eq!(a.len(), 4); // header + 3 rows
        // Spot-check a projected row's stable shape.
        assert!(a[1].starts_with("clinical,ptsd,assertion,"));
    }

    // 4.
    #[test]
    fn summary_is_sorted_and_stable() {
        let v = sample_view();
        let s1 = export_summary(&v);
        let s2 = export_summary(&v);
        assert_eq!(s1, s2);
        let keys: Vec<&String> = s1.keys().collect();
        // BTreeMap ⇒ sorted: clinical:assertion before family:cardinality.
        assert_eq!(
            keys,
            vec![&"clinical:assertion".to_string(), &"family:cardinality".to_string()]
        );
        assert_eq!(s1["clinical:assertion"], 1);
        assert_eq!(s1["family:cardinality"], 2);
    }

    // 5.
    #[test]
    fn export_does_not_modify_input() {
        let v = sample_view();
        let before = serde_json::to_string(&v).unwrap();
        let _ = export_rows(&v);
        let _ = export_csv_lines(&v);
        let _ = export_summary(&v);
        let after = serde_json::to_string(&v).unwrap();
        assert_eq!(before, after);
    }

    // 6.
    #[test]
    fn cross_domain_tag_is_preserved_verbatim() {
        // Aligned scenario: same subject + label across domains, close confidence.
        let v = enrich_step6(vec![
            cc(ContradictionDomain::Clinical, "match", "shared", 0.50),
            cc(ContradictionDomain::Family, "match", "shared", 0.55),
        ]);
        let rows = export_rows(&v).rows;
        for (row, e) in rows.iter().zip(&v.enriched_contradictions) {
            assert_eq!(row.cross_domain_tag, e.derived.cross_domain_tag);
        }
        assert_eq!(rows[0].cross_domain_tag.as_deref(), Some("aligned"));

        // None case preserved too.
        let v2 = sample_view();
        let rows2 = export_rows(&v2).rows;
        assert!(rows2[0].cross_domain_tag.is_none());
    }

    // 7.
    #[test]
    fn resolution_confidence_is_preserved_exactly() {
        let v = sample_view();
        let rows = export_rows(&v).rows;
        for (row, e) in rows.iter().zip(&v.enriched_contradictions) {
            assert_eq!(row.resolution_confidence, e.base.resolution_confidence as f64);
        }
    }

    // 8.
    #[test]
    fn severity_rank_is_preserved_exactly() {
        let v = sample_view();
        let rows = export_rows(&v).rows;
        for (row, e) in rows.iter().zip(&v.enriched_contradictions) {
            assert_eq!(row.severity_rank, e.derived.severity_rank);
        }
        // sanity: 0.40+flag → 3, 0.50 → 2, 0.80 → 1.
        assert_eq!(rows[0].severity_rank, 3);
        assert_eq!(rows[1].severity_rank, 2);
        assert_eq!(rows[2].severity_rank, 1);
    }

    // CSV escaping correctness for fields containing a comma.
    #[test]
    fn csv_escapes_commas_deterministically() {
        let v = enrich_step6(vec![cc(ContradictionDomain::Family, "relational", "a, b", 0.5)]);
        let lines = export_csv_lines(&v);
        assert!(lines[1].contains("\"a, b\""));
    }

    // ── PART A: provenance preservation (audit F4) ──────────────────────────

    #[test]
    fn export_rows_preserve_contradiction_id() {
        let v = enrich_step6(vec![
            clinical_cc_prov("ptsd", 0.5, &["u1"], &["p1"]),
            family_cc_prov("a↔b", 0.5, &["docX"], &["edge1"]),
        ]);
        let rows = export_rows(&v).rows;
        for (row, e) in rows.iter().zip(&v.enriched_contradictions) {
            assert_eq!(row.contradiction_id, e.base.contradiction_id);
        }
        assert_eq!(rows[0].contradiction_id, "contradiction::ptsd");
        assert_eq!(rows[1].contradiction_id, "famcontra::a↔b");
    }

    #[test]
    fn export_rows_preserve_family_edge_ids() {
        // Insert edges out of order; output must be sorted (BTreeSet) + complete.
        let v = enrich_step6(vec![family_cc_prov("a↔b", 0.5, &["docB", "docA"], &["e2", "e1"])]);
        let row = &export_rows(&v).rows[0];
        assert_eq!(row.edge_ids, vec!["e1".to_string(), "e2".to_string()]);
        assert_eq!(row.source_ids, vec!["docA".to_string(), "docB".to_string()]);
    }

    #[test]
    fn export_rows_preserve_clinical_source_ids() {
        let v = enrich_step6(vec![clinical_cc_prov("ptsd", 0.5, &["u2", "u1"], &["p1"])]);
        let row = &export_rows(&v).rows[0];
        // unified + patient ids unioned, sorted; no edge ids for clinical.
        assert_eq!(
            row.source_ids,
            vec!["p1".to_string(), "u1".to_string(), "u2".to_string()]
        );
        assert!(row.edge_ids.is_empty());
    }

    #[test]
    fn export_csv_is_stable_with_provenance() {
        let v = enrich_step6(vec![
            clinical_cc_prov("ptsd", 0.5, &["u1"], &["p1"]),
            family_cc_prov("a↔b", 0.5, &["docX"], &["edge1", "edge2"]),
        ]);
        let a = export_csv_lines(&v);
        let b = export_csv_lines(&v);
        assert_eq!(a, b);
        // Header now exposes provenance columns.
        assert_eq!(a[0], CSV_HEADER);
        assert!(a[0].ends_with(",contradiction_id,source_ids,edge_ids"));
        // Family row carries its edge ids joined with ';'.
        assert!(a[2].contains("edge1;edge2"));
        assert!(a[1].contains("contradiction::ptsd"));
    }

    // ── PART B: confidence formatting (audit F6) ────────────────────────────

    #[test]
    fn export_csv_confidence_formatting_is_pinned() {
        // 2/3 → round3 → 0.667 (f32); CSV must show exactly 3 dp, not widened noise.
        let rc = ((2.0_f32 / 3.0_f32) * 1000.0).round() / 1000.0; // mirrors round3
        let v = enrich_step6(vec![family_cc_prov("x", rc, &[], &[])]);
        let line = &export_csv_lines(&v)[1];
        // Field 4 is resolution_confidence.
        let conf = line.split(',').nth(3).unwrap();
        assert_eq!(conf, "0.667");
        // Exact values render with trailing zeros to 3 dp.
        let v2 = enrich_step6(vec![family_cc_prov("y", 0.5, &[], &[])]);
        let conf2 = export_csv_lines(&v2)[1].split(',').nth(3).unwrap().to_string();
        assert_eq!(conf2, "0.500");
    }

    #[test]
    fn export_csv_confidence_roundtrip_stable() {
        let v = enrich_step6(vec![family_cc_prov("x", 0.667, &[], &[])]);
        let a = export_csv_lines(&v);
        let b = export_csv_lines(&v);
        assert_eq!(a, b);
        // The CSV decimal parses back to the same pinned value.
        let conf: f64 = a[1].split(',').nth(3).unwrap().parse().unwrap();
        assert_eq!(conf, 0.667);
    }
}
