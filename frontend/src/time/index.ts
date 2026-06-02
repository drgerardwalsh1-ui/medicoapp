export { TimeService } from "./TimeService";
export type { TimeServiceType } from "./TimeService";

export type {
  Appointment,
  AppointmentAlert,
  AlertKind,
  WorkSession,
  WorkSessionType,
  WorkTimelineEvent,
  WorkTimelineEventType,
  ViewerTimeZone,
  AppointmentTimeZone,
  UUID,
  AssessmentPauseIssue,
  AssessmentPauseIssueCategory,
} from "./types";

export {
  asViewerTimeZone,
  asAppointmentTimeZone,
} from "./types";

export {
  TIMEZONE_OPTIONS,
  isValidTimeZone,
  useViewerTimeZone,
  getViewerTimeZone,
  setViewerTimeZoneOverride,
  offsetMinutesAt,
  tzAbbreviation,
} from "./zones";

export type { TimeZoneOption } from "./zones";

export {
  formatTime24,
  formatDateISO,
  formatShortWeekday,
  formatMonthYear,
  formatDateRange,
  formatTimestamp,
  formatAppointmentTime,
  formatPartialDate,
} from "./format";

export {
  durationMinutes,
  durationMs,
  durationLabel,
  endUtcFromDuration,
  isFutureInstant,
  compareInstants,
  addMinutesToInstant,
  DURATION_MINUTE_OPTIONS,
} from "./duration";

export {
  HOUR_HEIGHT,
  START_HOUR,
  END_HOUR,
  SNAP_MINUTES,
  topPxFromInstant,
  heightPxFromInstants,
  pixelsToInstantIso,
  isInstantOnViewerDay,
  viewerPlainDate,
  viewerWeekStartDate,
  weekDates,
  addDaysToPlainDate,
  todayPlainDate,
  nowMinutesSinceStartHour,
} from "./calendar";

export {
  computeActiveAlert,
  useAppointmentAlerts,
  alertMessage,
} from "./alerts";

export {
  ageOnDate,
  ageNow,
  yearsSince,
} from "./age";

export {
  startWorkSession,
  endWorkSession,
  elapsedMinutes,
  totalMinutes,
} from "./workSession";

export {
  newTimelineEvent,
  appendEvent,
  updateEvent,
  deleteEvent,
  splitEvent,
  validateEvent,
  todayEventsInViewerTz,
  fromWorkSession,
  activeEvent,
  isPaused,
  pauseEvent,
  resumeEvent,
  stopEvent,
  updateOpenAssessmentPauseIssue,
  activeWorkMs,
  wallClockMs,
  displayedDurationMs,
  defaultTitleForType,
  totalMinutes as totalTimelineMinutes,
} from "./workTimeline";

export {
  deriveSuggestedTimerType,
  findCurrentOrSoonAppointment,
  findRecentCompletedAppointment,
  isReportWritingTab,
} from "./suggestion";

export type { TimerSuggestion } from "./suggestion";

export type { ValidationResult } from "./workTimeline";

export { default as TimerBar } from "./TimerBar";
export type { TimerBarProps } from "./TimerBar";
