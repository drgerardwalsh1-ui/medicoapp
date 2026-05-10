export { TimeService } from "./TimeService";
export type { TimeServiceType } from "./TimeService";

export type {
  Appointment,
  AppointmentAlert,
  AlertKind,
  WorkSession,
  WorkSessionType,
  ViewerTimeZone,
  AppointmentTimeZone,
  UUID,
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

export { default as TimerBar } from "./TimerBar";
