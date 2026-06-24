// Capture Workspace — WRITE LAYER DEPRECATED (Phase 4 consolidation).
//
// This surface NO LONGER ingests evidence. There is exactly one canonical
// evidence-ingestion pipeline in the application, hosted by the Live Assessment
// workspace omnibox:
//
//   raw input
//     → engine/omnibox.parseOmniboxInput
//     → integration/candidateFacts.buildCandidateFacts
//     → candidateFacts.verificationQueue        (UI gate only)
//     → integration/liveAxBridge.applyObservationToClient
//     → Rust record_clinical_observation        (append-only event)
//
// The previous Draft / LEX parser / applyDraft / commit pipeline that lived here
// was a PARALLEL write system (a second parser + a duplicate finding model that
// mutated client.psychiatricHistory / dsmAssessment). It has been removed so this
// page can never independently create domain objects. The page is now READ-ONLY:
// it derives a Case summary from already-committed client state and writes
// NOTHING (no Draft model, no parser, no onClientChange call).

import type { Client } from "../types/client";

// `onClientChange` is intentionally retained in the prop type for call-site
// compatibility but is NOT consumed — this page has no write authority.
export type CaptureWorkspaceProps = {
  client: Client;
  onClientChange?: (updated: Client) => void;
};

export default function CaptureWorkspace({ client }: CaptureWorkspaceProps) {
  // Read-only projections of committed evidence (no mutation, no derivation engine).
  const ph = client.psychiatricHistory;
  const dsm = client.dsmAssessment;
  const events = [...(ph?.preExistingEvents ?? []), ...(ph?.subsequentEvents ?? [])];
  const treatments = ph?.treatmentHistory?.treatments ?? [];
  const work = ph?.workHistory ?? [];
  const timeline = dsm?.timelineEvents ?? [];

  return (
    <div className="h-full flex flex-col gap-3 p-3 bg-slate-100 overflow-hidden text-slate-800">
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
        {/* Capture relocated to the canonical pipeline — this surface no longer writes. */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 shrink-0">
            <h2 className="text-[10.5px] font-bold tracking-wider text-slate-600 uppercase">
              Capture (moved to Live Assessment)
            </h2>
          </div>
          <div className="p-4 text-sm text-slate-600 space-y-2 overflow-y-auto">
            <p>
              Evidence capture now flows exclusively through the single canonical
              pipeline in the <strong>Live Assessment</strong> workspace omnibox.
            </p>
            <p className="text-[13px] text-slate-500">
              This page is read-only and records nothing. It derives the case
              summary below from committed evidence only — every claim is captured,
              attributed, and stored as an append-only event elsewhere.
            </p>
          </div>
        </section>

        {/* READ-ONLY case summary — derived from committed client state; writes nothing. */}
        <aside className="bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col min-h-0 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 shrink-0">
            <h2 className="text-[10.5px] font-bold tracking-wider text-slate-600 uppercase">Case summary</h2>
          </div>
          <div className="p-3 overflow-y-auto flex-1 min-h-0">
            <Section
              title={`History events (${events.length})`}
              items={events.map((e) => `${e.title ?? "(untitled)"} · ${e.category} · ${e.timing}`)}
            />
            <Section
              title={`Treatments (${treatments.length})`}
              items={treatments.map((t) => `${t.name || "(unnamed)"} · ${t.category}`)}
            />
            <Section
              title={`Work history (${work.length})`}
              items={work.map((w) => w.reasonForLeaving || w.role || w.employer || "(entry)")}
            />
            <Section
              title={`DSM timeline (${timeline.length})`}
              items={timeline.map((t) => `${t.type}: ${t.description}`)}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-semibold text-slate-700 mb-1">{title}</h3>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-400">none</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((s, i) => (
            <li key={i} className="text-[12px] text-slate-600 leading-snug">
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
