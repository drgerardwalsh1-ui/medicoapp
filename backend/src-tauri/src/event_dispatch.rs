//! Event extension dispatch layer — a PURE ROUTING BOUNDARY.
//!
//! This module is the single insertion point for new event types. It contains
//! NO domain logic: every lowering is delegated verbatim to the existing
//! converters in `case_events.rs`. Adding a future event type means adding one
//! `EventEnvelope` variant and one `match` arm here — never touching the
//! clinical, family, longitudinal, identity, temporal, or STEP-6 pipelines.
//!
//! Guarantees:
//!   - No logic duplication — only routes already-defined conversions.
//!   - Deterministic — order-preserving `Vec` routing; no `HashMap`, no
//!     iteration-order dependence.
//!   - No inference — explicit event-type matching only; no classification,
//!     heuristics, or branching beyond the enum match.
//!   - Total — unsupported events route to `Ignored` (no panic, no error path).

// Additive routing boundary; not yet wired to a Tauri command.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use crate::canonical_case::TimelineEntry;
use crate::case_events::{InjuryEvent, LegalStatusEvent};
use crate::clinical_events::ClinicalEvent;
use crate::fact_assertion::FactAssertion;
use crate::family_graph::FamilyEvent;

/// Tagged input wrapper. Future event types are added as new variants here
/// FIRST — this is the only place core routing changes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EventEnvelope {
    Injury(InjuryEvent),
    Legal(LegalStatusEvent),
    Family(FamilyEvent),
    /// A non-clinical factual assertion (marital/work/smoking/… status). Routed
    /// to `Fact` and folded into value-disagreement contradictions downstream.
    Fact(FactAssertion),
    /// Any unsupported/unknown event — routed to `Ignored`.
    Unknown,
}

/// Where a routed event lands. Pure data — no behaviour beyond a name accessor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DispatchResult {
    Clinical(ClinicalEvent),
    Family(FamilyEvent),
    Timeline(TimelineEntry),
    /// A routed factual assertion, carried verbatim for value-contradiction
    /// generation in the pipeline.
    Fact(FactAssertion),
    Ignored,
}

impl DispatchResult {
    /// Stable variant tag for routing assertions / logging. Deterministic.
    pub fn variant_name(&self) -> &'static str {
        match self {
            DispatchResult::Clinical(_) => "clinical",
            DispatchResult::Family(_) => "family",
            DispatchResult::Timeline(_) => "timeline",
            DispatchResult::Fact(_) => "fact",
            DispatchResult::Ignored => "ignored",
        }
    }
}

/// Route a single event to its domain target. Lowering is delegated entirely to
/// `case_events.rs`; this function adds no logic of its own.
///
///   - `Injury` → `case_events::InjuryEvent::to_clinical_event` → `Clinical`
///   - `Legal`  → `case_events::LegalStatusEvent::to_timeline_entry` → `Timeline`
///   - `Family` → passthrough → `Family`
///   - `Unknown`→ `Ignored`
pub fn dispatch_event(event: EventEnvelope) -> DispatchResult {
    match event {
        EventEnvelope::Injury(e) => DispatchResult::Clinical(e.to_clinical_event()),
        EventEnvelope::Legal(e) => DispatchResult::Timeline(e.to_timeline_entry()),
        EventEnvelope::Family(e) => DispatchResult::Family(e),
        EventEnvelope::Fact(e) => DispatchResult::Fact(e),
        EventEnvelope::Unknown => DispatchResult::Ignored,
    }
}

/// Route a batch, preserving input order exactly (deterministic).
pub fn dispatch_events(events: Vec<EventEnvelope>) -> Vec<DispatchResult> {
    events.into_iter().map(dispatch_event).collect()
}

// ════════════════════════════════════════════════════════════════════════
// Tests — routing only; no pipeline behaviour exercised.
// ════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clinical_events::{AssertionStatus, EventType};
    use crate::case_events::LegalRole;
    use crate::family_graph::{FamilyEdgeStatus, FamilyEventPayload, FamilyRelation, SourceRef};
    use std::collections::BTreeMap;

    fn injury() -> InjuryEvent {
        InjuryEvent {
            event_id: "i1".into(),
            participant_id: "patient#1".into(),
            injury: "fractured wrist".into(),
            status: AssertionStatus::Affirmed,
            temporal: None,
            source_ids: vec!["docA".into()],
            attributes: BTreeMap::new(),
        }
    }

    fn legal() -> LegalStatusEvent {
        LegalStatusEvent {
            event_id: "l1".into(),
            participant_id: "patient#1".into(),
            role: LegalRole::Claimant,
            temporal: None,
            source_ids: vec!["docA".into()],
            attributes: BTreeMap::new(),
        }
    }

    fn family() -> FamilyEvent {
        FamilyEvent {
            event_id: "f1".into(),
            payload: FamilyEventPayload {
                relation: FamilyRelation::SiblingOf,
                subject: "a#1".into(),
                target: Some("b#1".into()),
                cardinality: None,
            },
            status: FamilyEdgeStatus::Affirmed,
            temporal: None,
            sources: vec![SourceRef { source: "d".into(), date: None, context: "c".into() }],
            confidence: 0.9,
        }
    }

    // 1. Routing correctness.
    #[test]
    fn routes_each_event_type_to_its_domain() {
        match dispatch_event(EventEnvelope::Injury(injury())) {
            DispatchResult::Clinical(ce) => {
                // Delegated to case_events — EventType::Diagnosis, normalised concept.
                assert_eq!(ce.event_type, EventType::Diagnosis);
                assert_eq!(ce.concept, "fractured wrist");
            }
            other => panic!("expected Clinical, got {}", other.variant_name()),
        }
        match dispatch_event(EventEnvelope::Legal(legal())) {
            DispatchResult::Timeline(t) => {
                assert_eq!(t.label, "legal_status:patient#1=claimant");
            }
            other => panic!("expected Timeline, got {}", other.variant_name()),
        }
        match dispatch_event(EventEnvelope::Family(family())) {
            DispatchResult::Family(f) => assert_eq!(f.event_id, "f1"),
            other => panic!("expected Family, got {}", other.variant_name()),
        }
    }

    // 2. No cross-routing leakage.
    #[test]
    fn no_cross_routing_leakage() {
        // Injury only ever lands Clinical.
        assert_eq!(
            dispatch_event(EventEnvelope::Injury(injury())).variant_name(),
            "clinical"
        );
        // Legal only ever lands Timeline (never Clinical/Family).
        assert_eq!(
            dispatch_event(EventEnvelope::Legal(legal())).variant_name(),
            "timeline"
        );
        // Family only ever lands Family.
        assert_eq!(
            dispatch_event(EventEnvelope::Family(family())).variant_name(),
            "family"
        );
    }

    // 3. Determinism — identical batches yield identical result sequences.
    #[test]
    fn batch_dispatch_is_deterministic_and_order_preserving() {
        let mk = || {
            vec![
                EventEnvelope::Family(family()),
                EventEnvelope::Injury(injury()),
                EventEnvelope::Legal(legal()),
                EventEnvelope::Unknown,
            ]
        };
        let r1 = dispatch_events(mk());
        let r2 = dispatch_events(mk());

        // Order preserved exactly.
        let names: Vec<&str> = r1.iter().map(|r| r.variant_name()).collect();
        assert_eq!(names, vec!["family", "clinical", "timeline", "ignored"]);

        // Byte-identical across runs.
        assert_eq!(
            serde_json::to_string(&r1).unwrap(),
            serde_json::to_string(&r2).unwrap()
        );
    }

    // 4. Ignored safety — unknown events route to Ignored without side effects.
    #[test]
    fn unknown_routes_to_ignored() {
        assert_eq!(
            dispatch_event(EventEnvelope::Unknown).variant_name(),
            "ignored"
        );
    }
}
