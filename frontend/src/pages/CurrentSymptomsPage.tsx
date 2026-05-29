// Phase 17 — UI migration to decision-first interface.
// Symptom entry remains the input layer; clinical decision presentation is a
// separate cognitive layer (ClinicalDecisionView). The legacy candidacy-style
// ClinicalOverlayPanel is no longer in the primary render path. Forensic detail
// lives inside ClinicalDecisionView's own drawer.

import { useEffect, useMemo } from "react";
import CurrentSymptoms from "../components/CurrentSymptoms";
import DSMErrorBoundary from "../components/DSMErrorBoundary";
import ClinicalDecisionView from "../integration/ui/ClinicalDecisionView";
import { runClinicalOverlay } from "../integration/clinicalBridge";
import { buildReportSnapshotV2 } from "../integration/clinicalDecision";
import { buildClinicalReplay } from "../integration/clinicalReplay";
import { getActiveClinicianId } from "../integration/clinicianSession";
import type { Client } from "../types/client";
import type { DSMAssessmentData } from "../types/dsm";

export type CurrentSymptomsPageProps = {
  client: Client;
  onClientChange: (updated: Client) => void;
};

export default function CurrentSymptomsPage({ client, onClientChange }: CurrentSymptomsPageProps) {
  // INPUT LAYER — symptom entry only. No diagnostic interpretation rendered here.
  // CLINICAL DECISION LAYER — built from existing (frozen) engine output via the
  // bridge. Snapshot + replay are pure derivations: no recomputation of engine
  // logic, no re-running of constraints/semantics/temporal — those are already
  // baked into the overlay.
  const overlay = useMemo(
    () => runClinicalOverlay(client.dsmAssessment),
    [client.dsmAssessment],
  );

  const snapshot = useMemo(
    () =>
      buildReportSnapshotV2(
        client.dsmAssessment,
        overlay,
        {
          clientId: client.id,
          takenBy: getActiveClinicianId(),
          takenAt: client.updated_at,
        },
        [],
      ),
    [client.dsmAssessment, client.id, client.updated_at, overlay],
  );

  const replay = useMemo(() => buildClinicalReplay(snapshot), [snapshot]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[clinical-decision-view] snapshot", snapshot.snapshotHash);
  }, [snapshot.snapshotHash]);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Input — symptom entry only */}
      <DSMErrorBoundary label="Current Symptoms">
        <CurrentSymptoms
          data={client.dsmAssessment}
          onChange={(d: DSMAssessmentData) =>
            onClientChange({ ...client, dsmAssessment: d })
          }
        />
      </DSMErrorBoundary>

      {/* Decision-first primary interface (Phase 16 view).
          Forensic detail (candidacies, semantic states, constraint logs,
          temporal layer, replay) lives inside its own drawer — NOT here. */}
      <section className="border-t border-slate-200 pt-3">
        <ClinicalDecisionView
          snapshot={snapshot}
          replay={replay}
          clientId={client.id}
          onFinalized={(decision, finalSnapshot, confirmation) => {
            // eslint-disable-next-line no-console
            console.log("[clinical-decision] recorded", {
              decisionId: decision.id,
              snapshotHash: finalSnapshot.snapshotHash,
              confirmation,
            });
          }}
        />
      </section>
    </div>
  );
}
