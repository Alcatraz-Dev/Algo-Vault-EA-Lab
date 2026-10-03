/**
 * Marketing Agent — scheduling engine (§26).
 *
 * Computation only: the schedule RECORD is stored by `storage.ts` and the
 * existing growth cron surface triggers execution. No duplicate cron system is
 * created here — this module answers "when is the next run?" and nothing else.
 *
 * Timezone handling uses the platform's `Intl` database, so an IANA zone is
 * always honoured rather than assuming server-local time.
 *
 * Pure module: no I/O.
 */

import type { MarketingPlatform } from "./collections";
import type { MarketingSchedule, ScheduleRecurrence } from "./types";

export const DEFAULT_PUBLISH_HOUR = 18;
export const DEFAULT_PUBLISH_MINUTE = 0;

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zoneOffsetMinutes(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** Wall-clock in `tz` → UTC epoch ms (two-pass, DST-correct). */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string
): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = naive;
  for (let i = 0; i < 2; i++) {
    const off = zoneOffsetMinutes(utc, tz);
    utc = naive - off * 60000;
  }
  return utc;
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

export function utcToWall(utcMs: number, tz: string): WallClock {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday] ?? 0,
  };
}

/** Next occurrence strictly after `afterMs`, honouring the schedule's zone. */
export function nextOccurrence(
  recurrence: ScheduleRecurrence,
  timezone: string,
  afterMs: number,
  anchor?: { hour: number; minute: number }
): number | null {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  const start = utcToWall(afterMs, tz);
  const h = anchor?.hour ?? start.hour;
  const mi = anchor?.minute ?? start.minute;

  if (recurrence.kind === "NONE") return null;

  if (recurrence.kind === "DAILY") {
    const interval = Math.max(1, recurrence.intervalDays);
    for (let offset = 0; offset <= 400; offset += interval) {
      const candidate = addDays(start, offset);
      const utc = zonedToUtc(candidate.year, candidate.month, candidate.day, h, mi, tz);
      if (utc > afterMs) return utc;
    }
    return null;
  }

  if (recurrence.kind === "WEEKLY") {
    const days = recurrence.daysOfWeek.length ? recurrence.daysOfWeek.slice().sort((a, b) => a - b) : [start.weekday];
    const intervalWeeks = Math.max(1, recurrence.intervalWeeks || 1);
    for (let week = 0; week < 60; week++) {
      const weekStart = addDays(start, week * 7 * intervalWeeks);
      for (const dow of days) {
        const diff = (dow - weekStart.weekday + 7) % 7;
        const day = addDays(weekStart, diff);
        const utc = zonedToUtc(day.year, day.month, day.day, h, mi, tz);
        if (utc > afterMs) return utc;
      }
    }
    return null;
  }

  // MONTHLY
  for (let monthOffset = 0; monthOffset < 24; monthOffset++) {
    const target = new Date(Date.UTC(start.year, start.month - 1 + monthOffset, 1));
    const y = target.getUTCFullYear();
    const mo = target.getUTCMonth() + 1;
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const day = Math.min(Math.max(1, recurrence.dayOfMonth), daysInMonth);
    const utc = zonedToUtc(y, mo, day, h, mi, tz);
    if (utc > afterMs) return utc;
  }
  return null;
}

function addDays(w: WallClock, days: number): WallClock {
  const d = new Date(Date.UTC(w.year, w.month - 1, w.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: w.hour,
    minute: w.minute,
    weekday: d.getUTCDay(),
  };
}

/** Weekday index for a name (0 = Sunday). Accepts full names, abbreviations
 * and colloquial forms ("Thursday", "thur", "tues"). Returns -1 when unknown. */
export function weekdayIndex(name: string): number {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  const map: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednes: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  return map[key] ?? -1;
}

export type ParsedSchedule = {
  scheduledFor: number;
  recurrence: ScheduleRecurrence;
  timezone: string;
  /** Human explanation of how the time was derived. */
  explanation: string;
  /** True when the instruction could not be resolved — caller must fail closed. */
  unresolved: boolean;
};

/**
 * Resolve a natural-language schedule hint (§26) into a concrete instant.
 * Returns `unresolved: true` rather than guessing when the instruction is
 * ambiguous — a stored schedule must be one the user actually asked for.
 */
export function parseScheduleHint(
  hint: string | null | undefined,
  options: { timezone?: string; now?: number; platform?: MarketingPlatform; explicitHour?: number; explicitMinute?: number } = {}
): ParsedSchedule {
  const now = options.now ?? Date.now();
  const tz = options.timezone && isValidTimeZone(options.timezone) ? options.timezone : "UTC";
  const hour = options.explicitHour ?? DEFAULT_PUBLISH_HOUR;
  const minute = options.explicitMinute ?? DEFAULT_PUBLISH_MINUTE;

  if (!hint) {
    return {
      scheduledFor: 0,
      recurrence: { kind: "NONE" },
      timezone: tz,
      explanation: "No schedule instruction supplied.",
      unresolved: true,
    };
  }

  const lower = hint.toLowerCase();
  const wall = utcToWall(now, tz);

  // Explicit clock time: "at 18:00" / "at 6 pm"
  let h = hour;
  let m = minute;
  const timeMatch = /at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(lower);
  if (timeMatch) {
    h = Number(timeMatch[1]) % 24;
    m = timeMatch[2] ? Number(timeMatch[2]) : 0;
    if (/pm/i.test(timeMatch[3] ?? "") && h < 12) h += 12;
    if (/am/i.test(timeMatch[3] ?? "") && h === 12) h = 0;
  }

  // Recurring weekdays: "every Monday and Thursday" / "every monday"
  const everyMatch = /\bevery\s+([a-z]+(?:\s*,?\s*(?:and\s+)?[a-z]+)*)/i.exec(lower);
  if (everyMatch) {
    const names = everyMatch[1]
      .split(/,|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean);
    const first = (names[0] ?? "").split(/\s+/)[0] ?? "";
    const isRecurrenceWord = /^(day|days|week|weeks|month|months|other)$/i.test(first);
    if (!isRecurrenceWord && names.length > 0) {
      const days = names.map((n) => weekdayIndex(n.split(/\s+/)[0] ?? n)).filter((d) => d >= 0);
      if (days.length > 0) {
        const recurrence: ScheduleRecurrence = { kind: "WEEKLY", daysOfWeek: days, intervalWeeks: 1 };
        const next = nextOccurrence(recurrence, tz, now, { hour: h, minute: m });
        if (next) {
          return {
            scheduledFor: next,
            recurrence,
            timezone: tz,
            explanation: `Recurring: ${days.map(dayName).join(" and ")} at ${pad(h)}:${pad(m)} (${tz}).`,
            unresolved: false,
          };
        }
      }
    }
  }

  // "every other day" / "every day"
  if (/\bevery\s+day\b/.test(lower) || /\bdaily\b/.test(lower)) {
    const recurrence: ScheduleRecurrence = { kind: "DAILY", intervalDays: 1 };
    const next = nextOccurrence(recurrence, tz, now, { hour: h, minute: m });
    if (next) {
      return { scheduledFor: next, recurrence, timezone: tz, explanation: `Daily at ${pad(h)}:${pad(m)} (${tz}).`, unresolved: false };
    }
  }

  // "next week"
  if (/\bnext\s+week\b/.test(lower)) {
    const daysUntilMonday = ((8 - wall.weekday) % 7) || 7;
    const monday = addDays(wall, daysUntilMonday);
    const utc = zonedToUtc(monday.year, monday.month, monday.day, h, m, tz);
    return {
      scheduledFor: utc,
      recurrence: { kind: "NONE" },
      timezone: tz,
      explanation: `Next Monday ${pad(h)}:${pad(m)} (${tz}).`,
      unresolved: false,
    };
  }

  // "this week" — next weekday boundary from now
  if (/\bthis\s+week\b/.test(lower)) {
    const utc = zonedToUtc(wall.year, wall.month, wall.day, h, m, tz);
    const candidate = utc > now ? utc : utc + 24 * 60 * 60 * 1000;
    return {
      scheduledFor: candidate,
      recurrence: { kind: "NONE" },
      timezone: tz,
      explanation: `This week at ${pad(h)}:${pad(m)} (${tz}).`,
      unresolved: false,
    };
  }

  // Bare time instruction: "schedule … for 18:00"
  if (timeMatch) {
    const wallNow = utcToWall(now, tz);
    const utc = zonedToUtc(wallNow.year, wallNow.month, wallNow.day, h, m, tz);
    const candidate = utc > now ? utc : utc + 24 * 60 * 60 * 1000;
    return { scheduledFor: candidate, recurrence: { kind: "NONE" }, timezone: tz, explanation: `At ${pad(h)}:${pad(m)} (${tz}).`, unresolved: false };
  }

  return {
    scheduledFor: 0,
    recurrence: { kind: "NONE" },
    timezone: tz,
    explanation: `Could not resolve schedule from "${hint}".`,
    unresolved: true,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dayName(index: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][index] ?? String(index);
}

/**
 * Whether a schedule is due to run, inside its campaign window, active, and
 * not yet expired (§26).
 */
export function isScheduleDue(
  schedule: Pick<MarketingSchedule, "state" | "nextRunAt" | "windowStart" | "windowEnd" | "recurrence" | "timezone" | "runCount">,
  now = Date.now()
): { due: boolean; reason: string; nextRunAt?: number } {
  const state = schedule.state;
  if (state !== "ACTIVE") return { due: false, reason: `Schedule is ${String(state).toLowerCase()}.` };
  if (!schedule.nextRunAt) return { due: false, reason: "No next run computed." };
  if (schedule.windowStart && now < schedule.windowStart) return { due: false, reason: "Before campaign window.", nextRunAt: schedule.nextRunAt };
  if (schedule.windowEnd && now > schedule.windowEnd) return { due: false, reason: "Campaign window closed.", nextRunAt: schedule.nextRunAt };
  if (schedule.nextRunAt > now) return { due: false, reason: "Not yet due.", nextRunAt: schedule.nextRunAt };
  if (schedule.recurrence.kind === "NONE" && schedule.runCount !== undefined && schedule.runCount > 0) {
    return { due: false, reason: "One-shot schedule already completed." };
  }
  return { due: true, reason: "Due.", nextRunAt: schedule.nextRunAt };
}

/** Compute the run after executing a one-shot/recurring schedule. */
export function advanceSchedule(
  schedule: Pick<MarketingSchedule, "recurrence" | "timezone" | "nextRunAt" | "windowEnd">,
  now = Date.now()
): { nextRunAt?: number; completed: boolean } {
  if (schedule.recurrence.kind === "NONE") return { completed: true };
  const next = nextOccurrence(schedule.recurrence, schedule.timezone, now);
  if (!next) return { completed: true };
  if (schedule.windowEnd && next > schedule.windowEnd) return { completed: true };
  return { nextRunAt: next, completed: false };
}
