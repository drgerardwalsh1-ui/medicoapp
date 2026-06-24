import "./index.css";
import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import Home from "./pages/Home";
import DemographicsPage from "./pages/DemographicsPage";
import DSMPage from "./pages/DSMPage";
import CurrentSymptomsPage from "./pages/CurrentSymptomsPage";
import HistoryEditor from "./components/History/HistoryEditor";
import ReportPage from "./pages/ReportPage";
import WorkTimelinePage from "./pages/WorkTimelinePage";
import MSEPage from "./pages/MSEPage";
import LiveAssessmentPage from "./pages/LiveAssessmentPage";
import CaptureWorkspace from "./pages/CaptureWorkspace";
import CalendarView from "./calendar/CalendarView";
import SystemPage from "./pages/SystemPage";
import { TauriAPI, isTauri, type ClientViewModel } from "./api/tauriApi";
import AppLayout from "./components/AppLayout";
import ClientLayout, {
  clientTabs,
  deriveSchema,
  type ClientTabId,
} from "./components/ClientLayout";
import ActiveTimerGuardModal from "./components/ActiveTimerGuardModal";
import type { TopBarProps, SaveStatus } from "./components/TopBar";
import { exportReportToDocx } from "./engine/exportDocx";
import {
  appendEvent,
  newTimelineEvent,
  defaultTitleForType,
  activeEvent as findActiveEvent,
  pauseEvent,
  resumeEvent,
  stopEvent,
  updateOpenAssessmentPauseIssue,
  wallClockMs,
  endUtcFromDuration,
  getViewerTimeZone,
  deriveSuggestedTimerType,
  findCurrentOrSoonAppointment,
  type WorkTimelineEvent,
  type WorkTimelineEventType,
  type TimerBarProps,
} from "./time";
import { Temporal } from "@js-temporal/polyfill";
import {
  formatFullName,
  parseClientBlob,
  reconcileClient,
  defaultClient,
  defaultReport,
  defaultAssessmentChecklist,
  type Client,
  type Appointment,
} from "./types/client";
import { validateClientName } from "./types/clientValidation";
import { isPersistedClientId } from "./types/client";

// Spec Part 9–13, Part 22. The single state machine that drives the app.
// All client tabs route through ClientLayout — there is no longer a separate
// "app" view for the report builder. activeClient lives here, alongside the
// active timer event so it survives navigation away from the client area.

type View = "home" | "client" | "create" | "calendar" | "finance" | "system";

function viewToClient(v: ClientViewModel): Client {
  // STEP 2 FIX: preserve the projection document list. `parseClientBlob`
  // reconstructs ONLY demographics — it has no knowledge of documents,
  // which live in the projection `documents` table (not the demographics
  // blob). Without carrying `v.documents` here, every client object
  // sourced from the projection (listClients / handleClientCreated)
  // silently loses its documents, and the UI shows an empty document
  // list after navigation even though the data is safe in SQLite.
  return {
    ...parseClientBlob(v.id, v.demographics),
    documents: v.documents ?? [],
  };
}

function buildSaveBlob(c: Client): Record<string, unknown> {
  return {
    identity: c.identity,
    administrative: c.administrative,
    clinical: c.clinical,
    appointments: c.appointments ?? [],
    relationships: c.relationships ?? [],
    householdRelationships: c.householdRelationships,
    dsmAssessment: c.dsmAssessment,
    assessmentChecklist: c.assessmentChecklist ?? defaultAssessmentChecklist(),
    report: c.report ?? defaultReport(),
    workTimeline: c.workTimeline ?? [],
    psychiatricHistory: c.psychiatricHistory,
    mse: c.mse,
  };
}

function Root() {
  const [clients, setClients] = useState<Client[]>([]);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [view, setView] = useState<View>("home");
  const [activeClientTab, setActiveClientTab] = useState<ClientTabId>("demographics");
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Client | null>(null);
  const [isDeletingClient, setIsDeletingClient] = useState(false);

  // Save state — owned here so every tab has the same indicator
  // experience in TopBar (spec Part 11).
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);

  // Spec Part 18 / validator agent footgun #2: the active timer event is
  // bound to whatever client was active *at start time*. It survives
  // navigation away from the client area; on stop, the close-event lands
  // on the original client's timeline regardless of which client is
  // currently active.
  //
  // Pause is event-state — `event.pausedAtUtc` is the source of truth.
  // We do NOT track a separate paused boolean; that would be a duplicate
  // source of truth (spec Part 6).
  const [timerOwnerClientId, setTimerOwnerClientId] = useState<string | null>(null);
  const [activeTimerEvent, setActiveTimerEvent] = useState<WorkTimelineEvent | null>(null);

  // ── Save handler bridge for DemographicsPage (which manages new-client
  // creation locally because the create-then-save flow needs to call
  // TauriAPI.createClient before any update). For controlled body
  // components (DSM/Report/WorkTimeline), main.tsx owns the save flow.
  const newClientCreateRef = useRef<(() => Promise<void>) | null>(null);

  async function refreshFromProjection() {
    try {
      const views = await TauriAPI.listClients();
      setClients(views.map(viewToClient));
    } catch (err) {
      console.warn("[main] listClients failed, keeping current state:", err);
    }
  }

  useEffect(() => {
    if (isTauri) refreshFromProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isTauri && (view === "home" || view === "calendar")) refreshFromProjection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ── Active client mutation flow ----------------------------------------
  function handleActiveClientChange(updated: Client) {
    // INVARIANT: a page mirror that rebuilt the Client from demographics
    // (parseClientBlob strips projection-owned fields like `documents`) must
    // never erase those fields from the active client. reconcileClient
    // back-fills any projection-owned field the update dropped (=== undefined)
    // from the previous, authoritative activeClient. See types/client.ts.
    setActiveClient((prev) => reconcileClient(prev, updated));
    setIsDirty(true);
  }

  // ── Persistence: debounced autosave + manual save -----------------------
  const saveAbortRef = useRef<AbortController | null>(null);
  async function flushSaveActiveClient(): Promise<void> {
    if (!activeClient || !activeClient.id) return;
    if (!isTauri) {
      setIsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
      return;
    }
    saveAbortRef.current?.abort();
    const ac = new AbortController();
    saveAbortRef.current = ac;
    setSaveStatus("saving");
    try {
      await TauriAPI.updateClientDemographics(activeClient.id, buildSaveBlob(activeClient));
      if (ac.signal.aborted) return;
      setIsDirty(false);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
      // Refresh the projection-derived list so Home reflects updated_at etc.
      refreshFromProjection().catch(() => undefined);
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error("[main] save failed:", err);
      setSaveStatus("error");
    }
  }

  // Debounce autosave for any change to activeClient that flagged dirty.
  useEffect(() => {
    if (!isDirty || !activeClient?.id) return;
    const t = setTimeout(() => { flushSaveActiveClient(); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, activeClient]);

  // Cmd/Ctrl+S triggers an immediate flush.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const el = document.activeElement;
        if (el instanceof HTMLElement) el.blur();
        if (view === "create") {
          newClientCreateRef.current?.();
        } else if (activeClient?.id) {
          flushSaveActiveClient();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activeClient?.id]);

  // ── Timer ownership invariant (exclusive client context) ─────────────
  //
  // 1. A timer MUST belong to exactly one clientId for its entire lifetime.
  //    The binding happens here, once, at start.
  //
  // 2. The client MUST be saved (present in `clients[]`, i.e. persisted
  //    via TauriAPI.createClient). Draft clients in the "create" view
  //    have a fresh UUID but no backend row — starting a timer there
  //    would queue an autosave against a non-existent client and fail.
  //
  // 3. There is at most ONE active timer event globally.
  //
  // 4. EXCLUSIVE CLIENT CONTEXT — a running timer cannot survive a
  //    change of activeClient. Every id-changing setActiveClient call
  //    is routed through `switchActiveClient`, which closes the open
  //    event on the previous client BEFORE the new one becomes active.
  //    Inside the active-client view, navigation (Home / Calendar /
  //    sidebar) does NOT switch clients and therefore does NOT stop
  //    the timer — only choosing a different client (or creating one)
  //    closes it.
  //
  // Pause / resume / stop mutate the event in activeClient.workTimeline
  // — under the exclusive-context model, activeClient IS the owner
  // whenever a timer exists, so there's never a cross-client write.
  function handleTimerStart(type: WorkTimelineEventType) {
    if (!activeClient?.id) return;
    // Reject if the active client is an unsaved draft. The presence of
    // an id is not enough — `defaultClient()` mints one for drafts too.
    const isSaved = clients.some((c) => c.id === activeClient.id);
    if (!isSaved) {
      console.warn("[timer] start refused — active client is an unsaved draft");
      return;
    }
    if (activeTimerEvent) {
      console.warn("[timer] start refused — a timer is already running");
      return;
    }
    // For Assessment starts, link the appointment that is currently
    // happening (or starting within the smart-default window). Manual
    // Assessment starts with no qualifying appointment are allowed —
    // linkedAppointmentId stays undefined.
    let linkedAppointmentId: string | undefined;
    if (type === "assessment") {
      const appt = findCurrentOrSoonAppointment(
        activeClient.appointments,
        Date.now(),
      );
      linkedAppointmentId = appt?.id;
    }
    const event = newTimelineEvent({
      type,
      title: defaultTitleForType(type),
      startedAtUtc: Temporal.Now.instant().toString(),
      endedAtUtc: null,
      createdAutomatically: true,
      linkedAppointmentId,
    });
    const next: Client = {
      ...activeClient,
      workTimeline: appendEvent(activeClient.workTimeline, event),
    };
    setActiveClient(next);
    setIsDirty(true);
    setTimerOwnerClientId(activeClient.id);
    setActiveTimerEvent(event);
  }

  // Pause / resume / stop. Under the exclusive-context model the owner
  // is always activeClient when a timer exists. If it's not, something
  // broke the invariant — log and refuse rather than silently writing
  // to the wrong client.
  function applyTimerMutation(
    fn: (timeline: WorkTimelineEvent[] | undefined, id: string) => WorkTimelineEvent[]
  ) {
    if (!activeTimerEvent || !timerOwnerClientId) return;
    if (!activeClient || activeClient.id !== timerOwnerClientId) {
      console.error(
        "[timer] mutation refused — active client is not the timer owner",
        { activeClientId: activeClient?.id, timerOwnerClientId }
      );
      return;
    }
    const nextTimeline = fn(activeClient.workTimeline, activeTimerEvent.id);
    setActiveClient({ ...activeClient, workTimeline: nextTimeline });
    setIsDirty(true);
  }

  function handleTimerPause()  { applyTimerMutation(pauseEvent);  }
  function handleTimerResume() { applyTimerMutation(resumeEvent); }

  // Patch the open AssessmentPauseIssue (chip selection / note typing).
  // Routed through the same owner gate as other timer mutations — the
  // assessment event lives on the timer owner's timeline, so writes must
  // go to that client and only that client.
  function handleAssessmentPauseIssueChange(
    patch: Partial<{ category: string; reason: string; note: string }>
  ) {
    if (!activeTimerEvent || !timerOwnerClientId) return;
    if (!activeClient || activeClient.id !== timerOwnerClientId) {
      console.error(
        "[timer] assessment pause issue update refused — active client is not the timer owner",
      );
      return;
    }
    if (activeTimerEvent.type !== "assessment") return;
    const nextTimeline = updateOpenAssessmentPauseIssue(
      activeClient.workTimeline,
      activeTimerEvent.id,
      patch as Parameters<typeof updateOpenAssessmentPauseIssue>[2],
    );
    setActiveClient({ ...activeClient, workTimeline: nextTimeline });
    setIsDirty(true);
  }

  // When an ASSESSMENT timer is stopped and finalised, the measured work
  // duration becomes the authoritative assessment length: today's appointment
  // end time is rebuilt as start + duration. The calendar reads the same
  // `endUtc` field, so the calendar appointment updates with no extra wiring.
  function applyAssessmentEndTime(
    client: Client,
    stopped: WorkTimelineEvent
  ): Client {
    if (stopped.type !== "assessment" || !stopped.endedAtUtc) return client;
    // Use wall-clock for Assessment: pauses are part of the session and
    // must be reflected in the resulting appointment end time.
    const workMs = wallClockMs(stopped);
    if (workMs <= 0) return client;
    const mins = Math.max(1, Math.round(workMs / 60000));
    const viewerTz = getViewerTimeZone();
    const today = Temporal.Now.plainDateISO(viewerTz);
    const appts = client.appointments ?? [];
    const idx = appts.findIndex((a) => {
      try {
        const tz = a.appointmentTimeZone || viewerTz;
        const d = Temporal.Instant.from(a.startUtc).toZonedDateTimeISO(tz).toPlainDate();
        return d.equals(today);
      } catch {
        return false;
      }
    });
    if (idx < 0) return client;
    const appt = appts[idx];
    const newEndUtc = endUtcFromDuration(appt.startUtc, mins);
    const nextAppts = appts.map((a, i) =>
      i === idx ? { ...a, endUtc: newEndUtc } : a
    );
    return { ...client, appointments: nextAppts };
  }

  function handleTimerStop() {
    if (!activeTimerEvent || !timerOwnerClientId) return;
    if (!activeClient || activeClient.id !== timerOwnerClientId) {
      console.error("[timer] stop refused — active client is not the timer owner");
      return;
    }
    const nextTimeline = stopEvent(activeClient.workTimeline, activeTimerEvent.id);
    const stopped = nextTimeline.find((e) => e.id === activeTimerEvent.id);
    let nextClient: Client = { ...activeClient, workTimeline: nextTimeline };
    if (stopped) nextClient = applyAssessmentEndTime(nextClient, stopped);
    setActiveClient(nextClient);
    setIsDirty(true);
    // The post-stop sync effect below picks up the closed event and
    // clears activeTimerEvent + timerOwnerClientId.
  }

  // Keep the active-event reference in sync with the active client's
  // current workTimeline. Triggers:
  //   1. Pause/resume/stop mutated the event — pick up the new fields.
  //   2. Manual edits on WorkTimelinePage closed/deleted the event.
  //   3. Save round-trip rehydrated activeClient.
  // Under the exclusive-context model, the owner is always activeClient
  // when a timer exists (switchActiveClient enforces this) — no
  // cross-client lookup is needed.
  useEffect(() => {
    if (!activeTimerEvent || !timerOwnerClientId) return;
    if (!activeClient || activeClient.id !== timerOwnerClientId) return;
    const stillOpen = findActiveEvent(activeClient.workTimeline);
    if (!stillOpen || stillOpen.id !== activeTimerEvent.id) {
      // Closed externally (manual edit, stop) — drop the reference.
      setActiveTimerEvent(null);
      setTimerOwnerClientId(null);
    } else if (stillOpen !== activeTimerEvent) {
      setActiveTimerEvent(stillOpen);
    }
  }, [activeClient, activeTimerEvent, timerOwnerClientId]);

  // App-restart recovery: if the just-loaded activeClient has an open
  // event in its timeline (the user had a timer running when the app
  // closed), reattach to it. Without this, the event is "orphaned" — UI
  // shows idle but the event is open in the persisted timeline.
  // Only runs when there's no in-flight timer to take over; never
  // overrides an in-progress session.
  useEffect(() => {
    if (activeTimerEvent || !activeClient?.id) return;
    const open = findActiveEvent(activeClient.workTimeline);
    if (open) {
      setActiveTimerEvent(open);
      setTimerOwnerClientId(activeClient.id);
    }
  }, [activeClient?.id, activeTimerEvent]);

  // ── Navigation ---------------------------------------------------------

  // Stop the running timer (if any), persist the closed event, and
  // clear in-memory timer references. Idempotent — safe to call when
  // no timer is running. The wall-clock span [startedAt, endedAt] is
  // preserved on the event for audit; `activeWorkMs` reports the
  // billable subset.
  //
  // Used by both `requestNavigation` (via the modal's "End and
  // continue") and `handleTimerStop` (via the TimerBar Stop button).
  function finaliseRunningTimer() {
    if (!activeTimerEvent || !timerOwnerClientId) return;
    const owner: Client | null =
      activeClient?.id === timerOwnerClientId
        ? activeClient
        : clients.find((c) => c.id === timerOwnerClientId) ?? null;
    if (owner) {
      const closedTimeline = stopEvent(owner.workTimeline, activeTimerEvent.id);
      const stopped = closedTimeline.find((e) => e.id === activeTimerEvent.id);
      let updatedOwner: Client = { ...owner, workTimeline: closedTimeline };
      if (stopped) updatedOwner = applyAssessmentEndTime(updatedOwner, stopped);
      setClients((prev) => {
        const exists = prev.some((c) => c.id === updatedOwner.id);
        return exists
          ? prev.map((c) => (c.id === updatedOwner.id ? updatedOwner : c))
          : [...prev, updatedOwner];
      });
      if (activeClient?.id === updatedOwner.id) {
        setActiveClient(updatedOwner);
      }
      // Fire-and-forget persist. If it fails, clients[] still has the
      // closed event locally, so a later autosave will reconcile.
      if (isTauri) {
        TauriAPI.updateClientDemographics(updatedOwner.id, buildSaveBlob(updatedOwner))
          .catch((err) =>
            console.error("[timer] finalise — save failed:", err)
          );
      }
    }
    setActiveTimerEvent(null);
    setTimerOwnerClientId(null);
  }

  // ── Navigation guard ──────────────────────────────────────────────
  //
  // Per spec, ANY navigation away from the current client context
  // (switching clients, creating a client, returning Home, sidebar)
  // is intercepted by a confirmation modal when a timer is running.
  // The user picks one of:
  //   1. End timer and continue → finaliseRunningTimer() + run intent
  //   2. Return to current client → abort intent, restore owner view
  //   3. Cancel → abort intent, leave current state unchanged
  //
  // The "intent" is the navigation action as a closure. Callers wrap
  // their existing `setView` / `setActiveClient` calls in a closure
  // and pass it to `requestNavigation`. No silent timer destruction.
  type NavigationIntent = {
    commit: () => void;
  };
  const [pendingNavigation, setPendingNavigation] =
    useState<NavigationIntent | null>(null);

  function requestNavigation(commit: () => void) {
    if (activeTimerEvent && timerOwnerClientId) {
      // Defer — the modal will run `commit` if the user chooses to end.
      setPendingNavigation({ commit });
      return;
    }
    commit();
  }

  function guardEndAndContinue() {
    if (!pendingNavigation) return;
    const { commit } = pendingNavigation;
    finaliseRunningTimer();
    // Run the navigation AFTER scheduling the timer close — both
    // batches into the same React render. The user lands on the new
    // context with the closed event already in clients[].
    commit();
    setPendingNavigation(null);
  }

  function guardReturnToCurrent() {
    // Abort the pending intent, then route the user back to the
    // timer's owning client so the running timer is visible again.
    setPendingNavigation(null);
    if (!timerOwnerClientId) return;
    const owner =
      activeClient?.id === timerOwnerClientId
        ? activeClient
        : clients.find((c) => c.id === timerOwnerClientId);
    if (!owner) return;
    setActiveClient(owner);
    setActiveClientTab("demographics");
    setView("client");
  }

  function guardCancel() {
    // Drop the intent; leave current view/client/timer untouched.
    setPendingNavigation(null);
  }

  function handleClientCreated(updated: Client) {
    setClients((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      return exists
        ? prev.map((c) => (c.id === updated.id ? updated : c))
        : [...prev, updated];
    });
    // Routed through requestNavigation defensively. Under normal flow
    // drafts can't host a timer (Start is disabled), so the guard is a
    // no-op here. If we ever loosen that, the modal protects us.
    requestNavigation(() => {
      setActiveClient(updated);
      setView("client");
      setActiveClientTab("demographics");
    });
  }

  // Ask before deleting the currently-active saved client. Refuses while a
  // timer is running for that client (the user must stop it first — we never
  // auto-finalise a timer into a deleted client).
  function requestDeleteActiveClient() {
    if (!activeClient?.id) return;

    if (activeTimerEvent && timerOwnerClientId === activeClient.id) {
      alert("Stop the active timer before deleting this client.");
      return;
    }

    setDeleteCandidate(activeClient);
  }

  // Delete only after the warning modal's Continue button is clicked. On
  // success the projection is the source of truth: we drop the in-memory
  // entry, clear active/dirty state, route home, and refresh from projection.
  async function confirmDeleteClient() {
    if (!deleteCandidate?.id || isDeletingClient) return;

    const deletedId = deleteCandidate.id;
    setIsDeletingClient(true);
    try {
      if (isTauri) {
        await TauriAPI.deleteClient(deletedId);
      }
      setClients((prev) => prev.filter((c) => c.id !== deletedId));
      setDeleteCandidate(null);
      setActiveClient(null);
      setIsDirty(false);
      setSaveStatus("idle");
      setView("home");
      if (isTauri) {
        refreshFromProjection().catch(() => undefined);
      }
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsDeletingClient(false);
    }
  }

  function cancelDeleteClient() {
    if (isDeletingClient) return;
    setDeleteCandidate(null);
  }

  function handleReset() {
    // Wipe all client data. If a timer is running, the modal fires —
    // the user can choose End+continue (timer stops, then wipe) or
    // Cancel (no wipe at all).
    requestNavigation(() => {
      setClients([]);
      setActiveClient(null);
      setView("home");
    });
  }

  // The ONLY sanctioned entry point into the "create" view.
  //
  // Critical: must initialize activeClient with a *brand-new* client
  // object every time, not the previously-viewed one. The earlier
  // implementation rendered the create view from
  // `activeClient ?? defaultClient()` — but that `??` fallback only
  // fired when activeClient was null, so clicking "+ New Client" while
  // an existing client was loaded inherited the entire previous client
  // (identity, appointments, workTimeline, DSM, ...). A "Create" click
  // then issued TauriAPI.createClient with the *previous client's
  // blob*, duplicating their record.
  //
  // The timer is intentionally NOT cleared here: timers are bound to
  // their owning client (set at start). A running timer on a different
  // client survives this transition and keeps writing to its original
  // owner — never to the new draft (spec / validator footgun #2).
  //
  // The `enteredCreateViaSanctionedPath` ref pairs with a watchdog
  // useEffect: if `view` ever transitions to "create" without this
  // function running first, the watchdog will reset activeClient to a
  // fresh defaultClient before render. So this is the only correct
  // entry point AND we defend against future code paths that forget.
  const enteredCreateViaSanctionedPathRef = useRef(false);
  function beginCreateClient() {
    // Routed through requestNavigation so a running timer triggers the
    // confirmation modal before the draft replaces activeClient. If
    // the user picks Cancel/Return, the sanctioned-path ref must be
    // reset (the navigation never committed), so we set it INSIDE the
    // commit closure — not outside.
    requestNavigation(() => {
      enteredCreateViaSanctionedPathRef.current = true;
      setActiveClient(defaultClient());
      setActiveClientTab("demographics");
      setView("create");
    });
  }

  // Watchdog: if some future caller does `setView("create")` directly
  // (bypassing beginCreateClient), reset activeClient to a fresh
  // defaultClient so the previous client's data can't leak. This is
  // an error-recovery path; we finalise the timer silently here
  // (rather than open a modal mid-render) because the user is already
  // in an invalid state.
  useEffect(() => {
    if (view !== "create") {
      enteredCreateViaSanctionedPathRef.current = false;
      return;
    }
    if (enteredCreateViaSanctionedPathRef.current) {
      enteredCreateViaSanctionedPathRef.current = false;
      return;
    }
    // Unsanctioned entry — silently finalise any running timer and
    // replace activeClient with a fresh draft.
    finaliseRunningTimer();
    setActiveClient(defaultClient());
  }, [view]);

  async function navigate(target: string) {
    if (target === "client") {
      // Sidebar "Client Profile" entry. Previously this only flipped the
      // view and REUSED the cached `activeClient`, which could be a stale
      // / partial object (e.g. one whose `.documents` were never refreshed
      // after upload or demographics edit). That is why the sidebar path
      // showed a bare "(unnamed)" document with no extraction, while the
      // Home dropdown and Calendar paths — which both re-seed
      // `activeClient` from the projection-sourced `clients[]` via
      // `viewToClient` — hydrated correctly.
      //
      // FIX: re-seed `activeClient` from a FRESH projection fetch so EVERY
      // entry point into the client view (Home / Calendar / Sidebar) lands
      // on identical, fully-hydrated state. The page's own effects then
      // load documents + extraction the same way regardless of entry path.
      if (!activeClient) {
        setView("home");
        return;
      }
      if (isTauri && isPersistedClientId(activeClient.id)) {
        try {
          const v = await TauriAPI.getClientView(activeClient.id);
          const fresh = viewToClient(v);
          // TEMP verification (remove after confirming): the sidebar entry
          // should now carry the same hydrated documents as Home/Calendar.
          console.log("[SIDEBAR] re-seeded client:", fresh.id,
            "documents:", fresh.documents?.length ?? 0);
          setActiveClient(fresh);
        } catch (err) {
          console.warn("[nav] getClientView failed; using cached client:", err);
        }
      }
      setView("client");
      return;
    }
    if (target === "home" || target === "calendar" || target === "finance" || target === "system") {
      // Leaving the client context. If a timer is running, the modal
      // intercepts; otherwise we navigate immediately.
      requestNavigation(() => setView(target as View));
    }
  }

  // Timer props for ClientLayout. Under the exclusive-context model:
  //   - The timer owner is always the active client when a timer is
  //     running, so `todayTimeline` reads directly from activeClient.
  //   - `ownerLabel` is the active client's display name (still useful
  //     even though it always matches the page title — confirms the
  //     binding visibly).
  //   - Start is disabled unless the active client is *saved* (in
  //     `clients[]`). Drafts in the "create" view have an id but no
  //     backend row, so a timer there would queue an autosave against
  //     a non-existent client and fail.
  const isActiveClientSaved =
    !!activeClient && clients.some((c) => c.id === activeClient.id);

  // Smart-default suggestion. Re-derives once per minute so the picker
  // can flip from "prereading" to "assessment" as an appointment
  // approaches the 30-minute window — but never auto-starts a timer.
  // Tab changes also re-derive (cheap), but `suggestionKey` deliberately
  // ignores the tab so a user who manually chose a type isn't overridden
  // by tab-hopping. See deriveSuggestedTimerType for the precedence rule.
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTickMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const suggestion = deriveSuggestedTimerType(
    activeClient,
    activeClientTab,
    nowTickMs,
  );

  const timerProps: TimerBarProps = {
    activeEvent: activeTimerEvent,
    todayTimeline: activeClient?.workTimeline ?? [],
    onStart: handleTimerStart,
    onPause: handleTimerPause,
    onResume: handleTimerResume,
    onStop: handleTimerStop,
    onAssessmentPauseIssueChange: handleAssessmentPauseIssueChange,
    suggestedType: suggestion.type,
    suggestionKey: suggestion.key,
    disabled: !isActiveClientSaved,
    ownerLabel:
      activeTimerEvent && activeClient
        ? formatFullName(activeClient.identity) || "(unnamed)"
        : undefined,
  };

  function pageContent() {
    if (view === "home") {
      return (
        <Home
          clients={clients}
          setActiveClient={(c: Client) => {
            requestNavigation(() => {
              setActiveClient(c);
              setActiveClientTab("demographics");
              setView("client");
            });
          }}
          startCreate={beginCreateClient}
        />
      );
    }
    if (view === "create") {
      // New client — only the Demographics tab is interactive (spec Part
      // 22 + validator agent footgun #4). ClientLayout's tabs row shows
      // every tab, but disables non-Demographics tabs until first save.
      //
      // INVARIANT: when we land here, activeClient is a brand-new
      // defaultClient() — `beginCreateClient` is responsible. The view
      // transition watchdog effect below enforces this even when some
      // future code path calls setView("create") directly.
      //
      // We render directly from activeClient (it IS the draft) — no
      // `??` fallback here. Earlier the line read `activeClient ??
      // defaultClient()`, which silently inherited the previous
      // client's full object when activeClient was non-null at "+ New
      // Client" time. That was the regression vector.
      if (!activeClient) {
        return (
          <div className="p-8 text-sm text-slate-500">Preparing new client…</div>
        );
      }
      const draft = activeClient;
      newClientCreateRef.current = async () => {
        if (!isTauri) return;
        // STRICT: no "Unnamed Client". A client cannot be persisted
        // without at least one non-whitespace character in firstName or
        // lastName. See clientValidation.ts for the canonical rule.
        const nameCheck = validateClientName({
          firstName: draft.identity?.firstName,
          lastName: draft.identity?.lastName,
        });
        if (!nameCheck.ok) {
          alert(nameCheck.message);
          return;
        }
        try {
          const blob = buildSaveBlob(draft);
          const id = await TauriAPI.createClient(blob);
          const v = await TauriAPI.getClientView(id);
          handleClientCreated(viewToClient(v));
        } catch (err) {
          alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      return (
        <ClientLayout
          client={draft}
          isNew={true}
          activeTab="demographics"
          onTabChange={() => undefined}
          versionHistoryOpen={false}
          onVersionHistoryClose={() => undefined}
          timerProps={timerProps}
          scrollKey={`client:new:${draft.id}:demographics`}
        >
          <DemographicsPage
            key={draft.id}
            client={draft}
            isNew={true}
            // In-place updates to the draft — same identity, no
            // auto-stop needed. Drafts can't host a timer anyway.
            onClientChange={(c) => setActiveClient(c)}
            onCreate={() => newClientCreateRef.current?.()}
            onCancel={() => {
              requestNavigation(() => {
                setActiveClient(null);
                setView("home");
              });
            }}
          />
        </ClientLayout>
      );
    }
    if (view === "client") {
      if (!activeClient) {
        return (
          <div className="p-8 text-slate-600">
            Select a client from{" "}
            <button className="underline" onClick={() => setView("home")}>Home</button>
            .
          </div>
        );
      }
      const tabs = clientTabs(activeClient);
      const isSchemaSection = tabs.some(
        (t) => t.id === activeClientTab &&
               t.id !== "demographics" && t.id !== "dsm" && t.id !== "mse" &&
               t.id !== "timeline" && t.id !== "backgroundHistory" &&
               t.id !== "live"
      );

      const body = (() => {
        if (activeClientTab === "demographics") {
          return (
            <DemographicsPage
              key={activeClient.id}
              client={activeClient}
              isNew={false}
              onClientChange={handleActiveClientChange}
              onCancel={() => requestNavigation(() => setView("home"))}
            />
          );
        }
        if (activeClientTab === "dsm") {
          return (
            <DSMPage
              key={activeClient.id}
              client={activeClient}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        if (activeClientTab === "live") {
          return (
            <LiveAssessmentPage
              key={activeClient.id}
              client={activeClient}
              onNavigateToTab={(tab) => setActiveClientTab(tab)}
              onOpenVersionHistory={() => setVersionHistoryOpen(true)}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        if (activeClientTab === "capture") {
          return (
            <CaptureWorkspace
              key={activeClient.id}
              client={activeClient}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        if (activeClientTab === "mse") {
          return (
            <MSEPage
              key={activeClient.id}
              client={activeClient}
              onClientChange={handleActiveClientChange}
              onNavigateToSymptoms={() => setActiveClientTab("symptoms")}
            />
          );
        }
        if (activeClientTab === "timeline") {
          return (
            <WorkTimelinePage
              key={activeClient.id}
              client={activeClient}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        if (activeClientTab === "backgroundHistory") {
          return (
            <HistoryEditor
              key={activeClient.id}
              client={activeClient}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        if (activeClientTab === "symptoms") {
          return (
            <CurrentSymptomsPage
              key={activeClient.id}
              client={activeClient}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        if (isSchemaSection) {
          return (
            <ReportPage
              key={`${activeClient.id}-${activeClientTab}`}
              client={activeClient}
              sectionId={activeClientTab}
              onClientChange={handleActiveClientChange}
            />
          );
        }
        return (
          <div className="p-8 text-slate-500 text-sm">
            Unknown tab "{activeClientTab}".
          </div>
        );
      })();

      return (
        <ClientLayout
          client={activeClient}
          isNew={false}
          activeTab={activeClientTab}
          onTabChange={(tab) => setActiveClientTab(tab)}
          versionHistoryOpen={versionHistoryOpen}
          onVersionHistoryClose={() => setVersionHistoryOpen(false)}
          onClientRestored={() => refreshFromProjection()}
          timerProps={timerProps}
          scrollKey={`client:${activeClient.id}:${activeClientTab}`}
        >
          {body}
        </ClientLayout>
      );
    }
    if (view === "calendar") {
      return (
        <CalendarView
          clients={clients}
          onNavigate={(clientId: string) => {
            const found = clients.find((c) => c.id === clientId);
            if (!found) return;
            requestNavigation(() => {
              setActiveClient(found);
              setActiveClientTab("demographics");
              setView("client");
            });
          }}
          onUpdateClient={(updated: Client) => {
            const appointments = updated.appointments as Appointment[];
            handleClientCreated({ ...updated, appointments });
          }}
        />
      );
    }
    if (view === "finance") {
      return (
        <div className="p-8 text-slate-600">
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Finance</h2>
          <p className="text-sm">Coming soon.</p>
        </div>
      );
    }
    if (view === "system") {
      return <SystemPage onReset={handleReset} />;
    }
    return null;
  }

  // ── TopBar props per view ----------------------------------------------
  function topBarProps(): TopBarProps {
    if (view === "home")     return { title: "Home" };
    if (view === "calendar") return { title: "Calendar" };
    if (view === "finance")  return { title: "Finance" };
    if (view === "system")   return { title: "System" };
    if (view === "create") {
      return {
        title: "New Client",
        // Going Home from the create draft. Drafts can't host a timer
        // so requestNavigation is a no-op; the wrap is defensive.
        onBack: () => requestNavigation(() => setView("home")),
        showSave: true,
        saveLabel: "Create",
        onSave: () => newClientCreateRef.current?.(),
        saveStatus,
        saveDirty: isDirty,
      };
    }
    if (view === "client") {
      const referrerOrg = activeClient?.administrative?.referrer?.org;
      return {
        title: formatFullName(activeClient?.identity) || "Client Profile",
        subtitle: referrerOrg ?? undefined,
        // Back to Home — if a timer is running, modal intercepts.
        onBack: () => requestNavigation(() => setView("home")),
        showSave: !!activeClient,
        onSave: () => flushSaveActiveClient(),
        saveDisabled: saveStatus === "saving" || !activeClient?.id,
        saveStatus,
        saveDirty: isDirty,
        showVersionHistory: !!activeClient?.id,
        onShowVersionHistory: () => setVersionHistoryOpen(true),
        showExportDocx: !!activeClient,
        onExportDocx: () => {
          if (!activeClient) return;
          const schema = deriveSchema(activeClient);
          exportReportToDocx(activeClient, schema.title);
        },
        showDeleteClient: !!activeClient?.id,
        onDeleteClient: requestDeleteActiveClient,
        deleteClientDisabled:
          isDeletingClient ||
          (!!activeTimerEvent && timerOwnerClientId === activeClient?.id),
      };
    }
    return { title: "" };
  }

  // Aggregate every client's appointments for the global overrun-alert.
  const allAppointments = clients.flatMap((c) => c.appointments ?? []);

  // Resolve the timer's owner for the guard modal. Prefer activeClient
  // when it IS the owner (most up-to-date workTimeline); fall back to
  // the projection-derived entry. The modal needs the owner to render
  // the client's name even if the user has navigated to another view.
  const timerOwner: Client | null = timerOwnerClientId
    ? (activeClient?.id === timerOwnerClientId
        ? activeClient
        : clients.find((c) => c.id === timerOwnerClientId) ?? null)
    : null;

  return (
    <>
      <AppLayout
        currentView={view}
        setView={navigate}
        topBarProps={topBarProps()}
        upcomingAppointments={allAppointments}
        scrollKey={`app:${view}`}
      >
        {pageContent()}
      </AppLayout>
      <ActiveTimerGuardModal
        open={pendingNavigation !== null}
        ownerClient={timerOwner}
        activeEvent={activeTimerEvent}
        onEndAndContinue={guardEndAndContinue}
        onReturnToCurrent={guardReturnToCurrent}
        onCancel={guardCancel}
      />
      {deleteCandidate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-client-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 id="delete-client-title" className="text-base font-semibold text-slate-900">
                Delete client?
              </h2>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-slate-700">
                You are about to delete{" "}
                <strong>{formatFullName(deleteCandidate.identity) || "this client"}</strong>.
              </p>
              <p className="text-sm text-slate-600">
                This removes the client from the app. Continue with the delete?
              </p>
            </div>
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-white text-slate-700 disabled:opacity-50"
                onClick={cancelDeleteClient}
                disabled={isDeletingClient}
              >
                Cancel
              </button>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                onClick={confirmDeleteClient}
                disabled={isDeletingClient}
              >
                {isDeletingClient ? "Deleting..." : "Continue Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
