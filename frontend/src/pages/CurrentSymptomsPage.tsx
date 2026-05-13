import CurrentSymptoms from "../components/CurrentSymptoms";
import type { Client } from "../types/client";
import type { DSMAssessmentData } from "../types/dsm";

// Body-only Current Symptoms page. Single mount point — no longer rendered
// inside ReportPage's special-case branch (spec Part 13).

export type CurrentSymptomsPageProps = {
  client: Client;
  onClientChange: (updated: Client) => void;
};

export default function CurrentSymptomsPage({ client, onClientChange }: CurrentSymptomsPageProps) {
  return (
    <div className="h-full">
      <CurrentSymptoms
        data={client.dsmAssessment}
        onChange={(d: DSMAssessmentData) =>
          onClientChange({ ...client, dsmAssessment: d })
        }
      />
    </div>
  );
}
