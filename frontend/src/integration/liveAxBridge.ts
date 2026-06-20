// ── Live Assessment → shared entity store bridge ──────────────────────────────
// A fact captured in the Live Ax must light up everywhere the clinician
// already works: the Current Symptoms page, the DSM workspace evidence, and
// the MSE linked/shared-mood domains — all of which read
// `client.dsmAssessment` (the shared SymptomEntity store + MoodState).
//
// This bridge maps one subjective Observation onto that store. Pure function:
// (client blob, observation) → updated client blob. The canonical truth
// remains the observation spine; this keeps the legacy page stores in step
// until those pages consume projections directly (PRD Phase 2 follow-on).

import type { Client } from "../types/client";
import type { Observation } from "../types/observation";
import {
  defaultDSMAssessmentData,
  type DSMAssessmentData,
  type SymptomEntity,
  type SymptomSeverity,
} from "../types/dsm";

// Symptom entities that double as MSE/Current-Symptoms shared mood
// descriptors (data/moodState.ts). Present adds the descriptor; denied or
// tombstoned removes it.
const MOOD_DESCRIPTOR_BY_ENTITY: Record<string, string> = {
  depressed_mood: "depressed",
  irritability: "irritable",
  elevated_mood: "elevated",
  hopelessness: "hopeless",
};

export function applyObservationToClient(client: Client, obs: Observation): Client {
  if (obs.frame !== "subjective") return client; // observed/collateral never touch the reported store

  const entityId = obs.symptomTypeId as string;
  const data: DSMAssessmentData = client.dsmAssessment ?? defaultDSMAssessmentData();
  const existing: SymptomEntity =
    data.symptoms[entityId] ?? { id: entityId, symptomType: entityId };

  const removed = obs.tombstoned === true;
  const presence: boolean | undefined = removed
    ? undefined
    : obs.presence === "present"
      ? true
      : obs.presence === "absent"
        ? false
        : undefined;

  const entity: SymptomEntity = {
    ...existing,
    currentPresence: presence,
    severity: (obs.severity ?? existing.severity ?? "") as SymptomSeverity,
    frequencyCount: obs.frequencyCount ?? existing.frequencyCount,
    frequencyUnit: obs.frequencyUnit ?? existing.frequencyUnit,
    durationCount: obs.durationCount ?? existing.durationCount,
    durationUnit: obs.durationUnit ?? existing.durationUnit,
    onsetDate: obs.onset ?? existing.onsetDate,
    notes: obs.note ?? existing.notes,
  };

  // Shared mood descriptors: keep MoodState (MSE Mood domain + Current
  // Symptoms mood chips) in step for the entities that map to one.
  const descriptor = MOOD_DESCRIPTOR_BY_ENTITY[entityId];
  let moodState = data.moodState;
  if (descriptor) {
    const current = new Set(moodState?.descriptors ?? []);
    if (presence === true) current.add(descriptor);
    else current.delete(descriptor);
    moodState = { ...(moodState ?? { descriptors: [] }), descriptors: [...current] };
  }

  return {
    ...client,
    dsmAssessment: {
      ...data,
      symptoms: { ...data.symptoms, [entityId]: entity },
      moodState,
    },
  };
}
