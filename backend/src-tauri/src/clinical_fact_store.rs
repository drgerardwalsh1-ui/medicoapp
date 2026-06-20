//! Canonical clinical fact spine — Phase 1.
//!
//! The Rust event store is the single durable truth for clinical interview
//! state. The frontend `ClinicalState` blob (engine/state.ts) is demoted to
//! a projection cache: it is rebuilt from these events, never persisted as
//! truth on its own.
//!
//! `fold_clinical_state` is the pure, deterministic fold of a client's
//! event stream into the exact JSON shape `deserialiseState` expects on the
//! frontend (camelCase keys, append-only arrays in event order). Reasoning
//! (episodes / conflicts / suggestions / candidacy) is NEVER stored — the
//! frontend recomputes it from this state, matching the doctrine in
//! engine/state.ts.

use serde::{Deserialize, Serialize};

use crate::events::{EventEnvelope, EventPayload};

/// Review-item kinds accepted by `record_clinical_review_item` and routed
/// by the fold. Anything else fails closed: rejected at the command
/// boundary, and ignored by the fold if it ever reaches the log.
pub const REVIEW_KINDS: [&str; 5] = [
    "attestation",
    "resolution",
    "correction",
    "conclusion",
    "snapshot",
];

/// Wire shape of the frontend `ClinicalState` (engine/state.ts). Field
/// names serialise camelCase so `deserialiseState(JSON)` consumes the
/// command output directly.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClinicalStateDto {
    pub observation_log: Vec<serde_json::Value>,
    pub attestations: Vec<serde_json::Value>,
    pub resolutions: Vec<serde_json::Value>,
    pub corrections: Vec<serde_json::Value>,
    pub conclusions: Vec<serde_json::Value>,
    pub snapshots: Vec<serde_json::Value>,
}

/// Pure in-order fold of one client's events into clinical state. Strict
/// append-only: every event appends to exactly one array; nothing is ever
/// rewritten or removed (observation edits/tombstones are new entries with
/// the same observation id, collapsed by the frontend's
/// `latestObservations`). Non-clinical events are ignored.
pub fn fold_clinical_state(events: &[EventEnvelope]) -> ClinicalStateDto {
    let mut state = ClinicalStateDto::default();
    for env in events {
        match &env.payload {
            EventPayload::ClinicalObservationRecorded(p) => {
                state.observation_log.push(p.observation.clone());
            }
            EventPayload::ClinicalReviewRecorded(p) => match p.kind.as_str() {
                "attestation" => state.attestations.push(p.item.clone()),
                "resolution" => state.resolutions.push(p.item.clone()),
                "correction" => state.corrections.push(p.item.clone()),
                "conclusion" => state.conclusions.push(p.item.clone()),
                "snapshot" => state.snapshots.push(p.item.clone()),
                // Fail closed: an unknown kind routes nowhere rather than
                // polluting a surface. The command boundary rejects these
                // at write time, so reaching here implies a foreign writer.
                _ => {}
            },
            _ => {}
        }
    }
    state
}

/// Minimal structural validation for an observation payload at the command
/// boundary. The payload stays opaque, but a fact with no id, concept, or
/// frame can never be collapsed/projected, so it is refused at write time.
pub fn validate_observation(observation: &serde_json::Value) -> Result<(), String> {
    let obj = observation
        .as_object()
        .ok_or("observation must be a JSON object")?;
    for field in ["id", "symptomTypeId", "frame"] {
        match obj.get(field).and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => {}
            _ => return Err(format!("observation.{field} must be a non-empty string")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{
        Actor, ClinicalObservationRecordedP, ClinicalReviewRecordedP, EventEnvelope,
        EventPayload,
    };
    use serde_json::json;

    fn obs_event(client: &str, version: u64, observation: serde_json::Value) -> EventEnvelope {
        EventEnvelope::new(
            client.to_string(),
            version,
            Actor::System { component: "test".into() },
            EventPayload::ClinicalObservationRecorded(ClinicalObservationRecordedP {
                observation,
            }),
            None,
            None,
        )
    }

    fn review_event(
        client: &str,
        version: u64,
        kind: &str,
        item: serde_json::Value,
    ) -> EventEnvelope {
        EventEnvelope::new(
            client.to_string(),
            version,
            Actor::System { component: "test".into() },
            EventPayload::ClinicalReviewRecorded(ClinicalReviewRecordedP {
                kind: kind.into(),
                item,
            }),
            None,
            None,
        )
    }

    #[test]
    fn fold_appends_observations_in_order() {
        let o1 = json!({"id": "o1", "symptomTypeId": "depressed_mood", "frame": "subjective", "presence": "present"});
        let o1_edit = json!({"id": "o1", "symptomTypeId": "depressed_mood", "frame": "subjective", "presence": "absent"});
        let state = fold_clinical_state(&[
            obs_event("c1", 1, o1.clone()),
            obs_event("c1", 2, o1_edit.clone()),
        ]);
        // Append-only: the edit is a second entry, never an overwrite.
        assert_eq!(state.observation_log, vec![o1, o1_edit]);
    }

    #[test]
    fn fold_routes_review_kinds_to_their_surfaces() {
        let state = fold_clinical_state(&[
            review_event("c1", 1, "attestation", json!({"a": 1})),
            review_event("c1", 2, "resolution", json!({"r": 1})),
            review_event("c1", 3, "correction", json!({"c": 1})),
            review_event("c1", 4, "conclusion", json!({"d": 1})),
            review_event("c1", 5, "snapshot", json!({"s": 1})),
        ]);
        assert_eq!(state.attestations, vec![json!({"a": 1})]);
        assert_eq!(state.resolutions, vec![json!({"r": 1})]);
        assert_eq!(state.corrections, vec![json!({"c": 1})]);
        assert_eq!(state.conclusions, vec![json!({"d": 1})]);
        assert_eq!(state.snapshots, vec![json!({"s": 1})]);
    }

    #[test]
    fn fold_ignores_unknown_review_kind_fail_closed() {
        let state = fold_clinical_state(&[review_event("c1", 1, "mystery", json!({"x": 1}))]);
        assert_eq!(state, ClinicalStateDto::default());
    }

    #[test]
    fn dto_serialises_camel_case_for_frontend_deserialise_state() {
        let state = fold_clinical_state(&[obs_event(
            "c1",
            1,
            json!({"id": "o1", "symptomTypeId": "anhedonia", "frame": "subjective"}),
        )]);
        let wire = serde_json::to_value(&state).unwrap();
        // Exact key set deserialiseState expects (order irrelevant to JSON).
        let keys: std::collections::BTreeSet<&str> =
            wire.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        let expected: std::collections::BTreeSet<&str> = [
            "observationLog",
            "attestations",
            "resolutions",
            "corrections",
            "conclusions",
            "snapshots",
        ]
        .into();
        assert_eq!(keys, expected);
    }

    #[test]
    fn validate_observation_rejects_structurally_unusable_facts() {
        assert!(validate_observation(&json!({"id": "o1", "symptomTypeId": "x", "frame": "subjective"})).is_ok());
        assert!(validate_observation(&json!("not an object")).is_err());
        assert!(validate_observation(&json!({"id": "", "symptomTypeId": "x", "frame": "subjective"})).is_err());
        assert!(validate_observation(&json!({"id": "o1", "frame": "subjective"})).is_err());
        assert!(validate_observation(&json!({"id": "o1", "symptomTypeId": "x"})).is_err());
    }

    #[test]
    fn fold_is_deterministic() {
        let events = vec![
            obs_event("c1", 1, json!({"id": "o1", "symptomTypeId": "x", "frame": "subjective"})),
            review_event("c1", 2, "attestation", json!({"a": 1})),
        ];
        assert_eq!(fold_clinical_state(&events), fold_clinical_state(&events));
    }
}
