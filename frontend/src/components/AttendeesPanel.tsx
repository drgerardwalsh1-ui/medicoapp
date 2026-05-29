import type { AssessmentAttendees } from "../types/client";
import { SUPPORT_PERSON_RELATIONS } from "../types/client";

// Shared attendee / interpreter editor. Mounted on BOTH the Demographics page
// and the MSE page against the same `client.assessmentChecklist.attendees`
// object — a single shared state source, so an edit on either page is
// instantly reflected on the other.
//
// `variant` controls only what is shown, never the data:
//   - "demographics" shows the full interpreter detail fields.
//   - "mse" hides interpreter name / NAATI / language (those must NOT carry
//     into the MSE), but still shows interpreter coverage status.

export type AttendeesPanelProps = {
  attendees: AssessmentAttendees;
  onChange: (next: AssessmentAttendees) => void;
  variant?: "demographics" | "mse";
};

function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-2.5 py-1 rounded-full text-xs font-medium border transition select-none capitalize",
        active
          ? "bg-violet-600 border-violet-600 text-white"
          : "bg-white border-slate-300 text-slate-600 hover:border-violet-400 hover:text-violet-700",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function AttendeesPanel({
  attendees,
  onChange,
  variant = "demographics",
}: AttendeesPanelProps) {
  const att = attendees;
  function patch(p: Partial<AssessmentAttendees>) {
    onChange({ ...att, ...p });
  }

  return (
    <div className="space-y-4">
      {/* ── Attended alone / support person ── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Attendees</h3>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
          <input
            type="checkbox"
            className="w-4 h-4 accent-violet-600"
            checked={!!att.attendedAlone}
            onChange={(e) => patch({ attendedAlone: e.target.checked })}
          />
          Attended alone
        </label>

        {!att.attendedAlone && (
          <div className="space-y-2 pl-1">
            <div className="flex flex-wrap gap-1.5">
              {SUPPORT_PERSON_RELATIONS.map((rel) => (
                <Chip
                  key={rel}
                  label={rel}
                  active={att.supportPersonRelation === rel}
                  onClick={() =>
                    patch({
                      supportPersonRelation:
                        att.supportPersonRelation === rel ? "" : rel,
                    })
                  }
                />
              ))}
            </div>
            <div>
              <label className="label">Other attendee / support person</label>
              <input
                className="input"
                placeholder="Name or description"
                value={att.supportPerson || ""}
                onChange={(e) => patch({ supportPerson: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Interpreter ── */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
          <input
            type="checkbox"
            className="w-4 h-4 accent-violet-600"
            checked={!!att.interpreterPresent}
            onChange={(e) => patch({ interpreterPresent: e.target.checked })}
          />
          Interpreter present
        </label>

        {att.interpreterPresent && (
          <div className="space-y-2 pl-1">
            <div className="flex flex-wrap gap-1.5">
              <Chip
                label="Present entire assessment"
                active={(att.interpreterCoverage ?? "entire") === "entire"}
                onClick={() => patch({ interpreterCoverage: "entire" })}
              />
              <Chip
                label="Present partially"
                active={att.interpreterCoverage === "partial"}
                onClick={() => patch({ interpreterCoverage: "partial" })}
              />
            </div>
            {att.interpreterCoverage === "partial" && (
              <div>
                <label className="label">Reason for partial attendance</label>
                <input
                  className="input"
                  value={att.interpreterPartialReason || ""}
                  onChange={(e) =>
                    patch({ interpreterPartialReason: e.target.value })
                  }
                />
              </div>
            )}

            {variant === "demographics" && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Interpreter Name</label>
                  <input
                    className="input"
                    value={att.interpreterName || ""}
                    onChange={(e) => patch({ interpreterName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">NAATI Number</label>
                  <input
                    className="input"
                    value={att.interpreterNaati || ""}
                    onChange={(e) => patch({ interpreterNaati: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Language</label>
                  <input
                    className="input"
                    value={att.interpreterLanguage || ""}
                    onChange={(e) =>
                      patch({ interpreterLanguage: e.target.value })
                    }
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
