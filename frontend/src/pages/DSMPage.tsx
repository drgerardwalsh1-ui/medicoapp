import DSMAssessment from "../components/DSMAssessment";
import type { Client } from "../types/client";
import type { DSMAssessmentData } from "../types/dsm";

// Body-only DSM Assessment page. Single mount point — DSM is no longer
// rendered inside DemographicsPage or ReportPage, eliminating the "DSM
// Assessment inherits previous page layout" bug (spec Part 12).

export type DSMPageProps = {
  client: Client;
  onClientChange: (updated: Client) => void;
};

export default function DSMPage({ client, onClientChange }: DSMPageProps) {
  return (
    <div className="h-full">
      <DSMAssessment
        data={client.dsmAssessment}
        onChange={(d: DSMAssessmentData) =>
          onClientChange({ ...client, dsmAssessment: d })
        }
      />
    </div>
  );
}
