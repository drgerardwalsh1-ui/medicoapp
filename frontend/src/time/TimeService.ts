// TimeService — single canonical entry point for all time/timezone logic.
// Spec Part 1: NO component may implement independent time logic; every
// caller imports from `frontend/src/time` (which re-exports from here).

import * as format from "./format";
import * as duration from "./duration";
import * as calendar from "./calendar";
import * as zones from "./zones";
import * as alerts from "./alerts";
import * as age from "./age";
import * as workSession from "./workSession";
import { Temporal } from "@js-temporal/polyfill";

export const TimeService = {
  format,
  duration,
  calendar,
  zones,
  alerts,
  age,
  workSession,

  // Spec Part 12.6: timer durations always derived from UTC instants.
  nowUtcIso(): string {
    return Temporal.Now.instant().toString();
  },

  // Convenience: build a UTC instant from a viewer-tz wall clock. Used by
  // the demographics page when the user types a date+time pair.
  // Throws on DST gap/ambiguity unless `disambiguation: 'compatible'`.
  wallClockToUtcIso(args: {
    plainDate: string;          // "YYYY-MM-DD"
    hour: number;
    minute: number;
    timeZone: string;           // IANA id (appointment-tz)
    disambiguation?: "compatible" | "earlier" | "later" | "reject";
  }): string {
    const dt = Temporal.PlainDate.from(args.plainDate).toPlainDateTime({
      hour: args.hour,
      minute: args.minute,
      second: 0,
    });
    return dt
      .toZonedDateTime(args.timeZone, { disambiguation: args.disambiguation ?? "reject" })
      .toInstant()
      .toString();
  },
} as const;

export type TimeServiceType = typeof TimeService;
