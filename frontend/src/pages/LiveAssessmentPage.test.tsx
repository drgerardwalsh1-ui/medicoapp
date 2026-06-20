// @vitest-environment jsdom
// ── Live Assessment canvas — DOM smoke tests (template-driven rev 2) ──────────
// Drives the scrolling interview canvas as a clinician would: the template
// renders as the script with at-a-glance coverage; probe chips cycle
// not-asked → present → denied; the omnibox accelerator ticks the same
// coverage; the context rail shows the fact landing on DSM/PIRS surfaces.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveAssessmentPage from "./LiveAssessmentPage";
import { defaultClient, type Client } from "../types/client";
import { buildCandidateFacts } from "../integration/candidateFacts";

afterEach(cleanup);

function clientWithInjury(): Client {
  const c = defaultClient();
  return {
    ...c,
    clinical: {
      ...c.clinical,
      injury: {
        dateOfInjury: "2024-03-15",
        ageAtInjury: null,
        yearsSinceInjury: null,
        injuryType: null,
        claimNumber: null,
        insurerName: null,
        insurerReference: null,
        insurerContactPerson: null,
      },
    },
  };
}

describe("LiveAssessmentPage — template-driven interview canvas", () => {
  it("renders the interview script with Mood, Anxiety, PTSD up front; no MSE/PIRS sections", async () => {
    const user = userEvent.setup();
    render(<LiveAssessmentPage client={clientWithInjury()} />);

    const rail = screen.getByTestId("script-rail");
    expect(within(rail).getByText("Mood")).toBeTruthy();
    expect(within(rail).getByText("Anxiety")).toBeTruthy();
    expect(within(rail).getByText("PTSD / trauma")).toBeTruthy();
    // Clinician feedback: MSE and PIRS are not interview-script items.
    expect(within(rail).queryByText(/Mental state/i)).toBeNull();
    expect(within(rail).queryByText(/PIRS/)).toBeNull();

    // Templates still reshape the canvas: WC adds occupational history.
    expect(within(rail).queryByText("Occupational history")).toBeNull();
    await user.selectOptions(screen.getByTestId("template-picker"), "builtin-wc");
    expect(within(rail).getByText("Occupational history")).toBeTruthy();
  });

  it("probe chip cycles not-asked → present → denied and updates coverage + rail", async () => {
    const user = userEvent.setup();
    render(<LiveAssessmentPage client={clientWithInjury()} />);

    const moodSection = screen.getByTestId("section-sx-mood");
    const chip = within(moodSection).getByText("Depressed mood");

    await user.click(chip); // present
    const contextRail = screen.getByTestId("context-rail");
    expect(within(contextRail).getByText("MDD")).toBeTruthy(); // DSM evidence live
    const scriptRail = screen.getByTestId("script-rail");
    const moodNav = within(scriptRail).getByText("Mood").parentElement!;
    expect(moodNav.textContent).toContain("1/");

    await user.click(chip); // denied — still covered (documented negative)
    expect(moodNav.textContent).toContain("1/");

    await user.click(chip); // back to not-asked (tombstone)
    expect(moodNav.textContent).toContain("0/");
  });

  it("omnibox capture ticks the matching probe — no re-typing, no double entry", async () => {
    const user = userEvent.setup();
    render(<LiveAssessmentPage client={clientWithInjury()} />);

    await user.type(screen.getByTestId("omnibox"), "no si{Enter}");

    const riskSection = screen.getByTestId("section-sx-risk");
    const chip = within(riskSection).getByText("Suicidal ideation / thoughts of death");
    expect(chip.className).toContain("line-through"); // denied state visible
  });

  // Regression (clinician-reported 2026-06-13): chip set "present", then a
  // typed negation must FLIP the same fact — never fork a parallel one.
  it("omnibox amends the chip-set fact: present chip + 'no si' → denied", async () => {
    const user = userEvent.setup();
    render(<LiveAssessmentPage client={clientWithInjury()} />);

    const riskSection = screen.getByTestId("section-sx-risk");
    const chip = within(riskSection).getByText("Suicidal ideation / thoughts of death");

    await user.click(chip); // present via chip
    expect(chip.className).not.toContain("line-through");

    await user.type(screen.getByTestId("omnibox"), "no si{Enter}");
    expect(chip.className).toContain("line-through"); // flipped, not forked

    // And the reverse: typed assert flips a chip-denied fact back to present.
    await user.type(screen.getByTestId("omnibox"), "si{Enter}");
    expect(chip.className).not.toContain("line-through");
  });

  // Flow-through (clinician-reported gap 2026-06-13): a Live Ax capture must
  // light up the shared entity store the MSE / Current Symptoms / DSM pages
  // read — including the shared MoodState driving the MSE Mood domain.
  it("captures flow through to the shared entity store and MoodState", async () => {
    const user = userEvent.setup();
    const updates: Client[] = [];
    render(
      <LiveAssessmentPage
        client={clientWithInjury()}
        onClientChange={(c) => updates.push(c)}
      />,
    );

    const moodSection = screen.getByTestId("section-sx-mood");
    await user.click(within(moodSection).getByText("Depressed mood")); // present

    let latest = updates.at(-1)!;
    expect(latest.dsmAssessment!.symptoms["depressed_mood"].currentPresence).toBe(true);
    expect(latest.dsmAssessment!.moodState!.descriptors).toContain("depressed");

    // Omnibox denial flows through the same path and clears the descriptor.
    await user.type(screen.getByTestId("omnibox"), "no dep{Enter}");
    latest = updates.at(-1)!;
    expect(latest.dsmAssessment!.symptoms["depressed_mood"].currentPresence).toBe(false);
    expect(latest.dsmAssessment!.moodState!.descriptors).not.toContain("depressed");

    // Severity/onset attributes carry into the entity store.
    await user.type(screen.getByTestId("omnibox"), "anhed severe since mva{Enter}");
    latest = updates.at(-1)!;
    const anhedonia = latest.dsmAssessment!.symptoms["anhedonia"];
    expect(anhedonia.currentPresence).toBe(true);
    expect(anhedonia.severity).toBe("severe");
    expect(anhedonia.onsetDate).toBe("2024-03-15");
  });

  it("template manager clones a built-in and probe toggles reshape the canvas", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    render(<LiveAssessmentPage client={clientWithInjury()} />);

    await user.click(screen.getByTestId("open-template-manager"));
    const manager = screen.getByTestId("template-manager");
    expect(within(manager).getByText(/Built-ins are read-only/)).toBeTruthy();

    await user.click(within(manager).getByRole("button", { name: "Clone" }));
    const nameInput = within(manager).getByTestId("template-name") as HTMLInputElement;
    expect(nameInput.value).toContain("(copy)");

    // Remove the PTSD section from the clone; canvas follows after selecting it.
    await user.click(within(manager).getByLabelText("Remove PTSD / trauma"));
    await user.click(within(manager).getByLabelText("Close template manager"));

    const picker = screen.getByTestId("template-picker") as HTMLSelectElement;
    expect(picker.selectedOptions[0].textContent).toContain("(copy)");
    expect(screen.queryByTestId("section-sx-trauma")).toBeNull();
    expect(screen.getByTestId("section-sx-mood")).toBeTruthy();
  });

  it("narrative section ticks persist per client across remounts", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    const client = clientWithInjury();
    const { unmount } = render(<LiveAssessmentPage client={client} />);

    const section = screen.getByTestId("section-circumstances");
    await user.click(within(section).getByRole("checkbox"));
    unmount();

    render(<LiveAssessmentPage client={client} />);
    const again = screen.getByTestId("section-circumstances");
    expect((within(again).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });

  // Phase 3: facts from the brief surface as confirm-or-contest (echo, don't
  // re-ask), with unmapped/diagnosis facts routed to a verification queue.
  it("confirms a brief candidate inline → ticks the probe; routes diagnoses to the queue", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    const candidates = buildCandidateFacts([
      {
        event_id: "c-sleep",
        event_type: "symptom",
        concept: "difficulty sleeping",
        assertion_status: "affirmed",
        source_document_id: "doc1",
        source_section: "Treating GP",
        source_snippet: "ongoing difficulty sleeping since the accident",
        page: 12,
        participants: [{ role: "treating_gp", name: "Dr Smith" }],
      },
      {
        event_id: "c-ptsd",
        event_type: "diagnosis",
        concept: "post-traumatic stress disorder",
        assertion_status: "affirmed",
        source_document_id: "doc1",
        source_snippet: "diagnosis of PTSD",
      },
    ]);

    render(<LiveAssessmentPage client={clientWithInjury()} initialCandidates={candidates} />);

    // Diagnosis → verification queue (not auto-placed into a section).
    const queue = screen.getByTestId("verification-queue");
    expect(within(queue).getByText("post-traumatic stress disorder")).toBeTruthy();

    // Symptom candidate → inline "from the brief" strip in the sleep section.
    const brief = screen.getByTestId("brief-sx-neuroveg");
    expect(within(brief).getByText("Sleep disturbance")).toBeTruthy();

    // Confirm ticks the probe present and clears the strip.
    await user.click(within(brief).getByRole("button", { name: "Confirm" }));
    expect(screen.queryByTestId("brief-sx-neuroveg")).toBeNull();
    const sleepSection = screen.getByTestId("section-sx-neuroveg");
    expect(within(sleepSection).getByText("Sleep disturbance").className).toContain("violet");
  });

  it("contesting a candidate dismisses it without asserting anything", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    const candidates = buildCandidateFacts([
      {
        event_id: "c-anx",
        event_type: "symptom",
        concept: "excessive worry",
        assertion_status: "affirmed",
        source_document_id: "doc1",
        source_snippet: "reports excessive worry",
      },
    ]);
    render(<LiveAssessmentPage client={clientWithInjury()} initialCandidates={candidates} />);

    const brief = screen.getByTestId("brief-sx-anxiety");
    await user.click(within(brief).getByRole("button", { name: "Contest" }));
    expect(screen.queryByTestId("brief-sx-anxiety")).toBeNull();
    // The anxiety probe stays not-asked (no fact asserted).
    const scriptRail = screen.getByTestId("script-rail");
    const anxNav = within(scriptRail).getByText("Anxiety").parentElement!;
    expect(anxNav.textContent).toContain("0/");
  });

  it("coverage audit lists what has not been covered", async () => {
    const user = userEvent.setup();
    render(<LiveAssessmentPage client={clientWithInjury()} />);

    await user.click(screen.getByText(/items not yet covered/));
    const audit = screen.getByTestId("coverage-audit");
    expect(audit.textContent).toContain("Past psychiatric history");
    expect(audit.textContent).toContain("Mood:");
  });
});
