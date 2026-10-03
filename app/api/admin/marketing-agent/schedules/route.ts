/** Marketing Agent — schedules: list, pause, resume, cancel (§26, §33). */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdmin } from "../_runtime";
import { deleteSchedule, getSchedule, listSchedules, saveSchedule } from "@/lib/marketing-agent/storage";
import { nextOccurrence, isValidTimeZone } from "@/lib/marketing-agent/scheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const state = new URL(req.url).searchParams.get("state") ?? undefined;
  const schedules = await listSchedules(state ?? undefined);
  return jsonOk({ schedules });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const body = (await req.json().catch(() => ({}))) as { action?: string; scheduleId?: string };
  if (!body.scheduleId) return jsonError("scheduleId is required.", 422);

  const schedule = await getSchedule(body.scheduleId);
  if (!schedule) return jsonError("Schedule not found.", 404);

  switch (body.action) {
    case "pause": {
      await saveSchedule({ ...schedule, state: "PAUSED", pausedAt: Date.now(), updatedAt: Date.now() });
      return jsonOk({ schedule: { ...schedule, state: "PAUSED" } });
    }
    case "resume": {
      const tz = isValidTimeZone(schedule.timezone) ? schedule.timezone : "UTC";
      const nextRunAt = schedule.recurrence.kind === "NONE"
        ? schedule.scheduledFor
        : nextOccurrence(schedule.recurrence, tz, Date.now());
      const updated = { ...schedule, state: "ACTIVE" as const, pausedAt: undefined, nextRunAt: nextRunAt ?? schedule.nextRunAt, updatedAt: Date.now() };
      await saveSchedule(updated);
      return jsonOk({ schedule: updated });
    }
    case "cancel": {
      await saveSchedule({ ...schedule, state: "CANCELLED", updatedAt: Date.now() });
      return jsonOk({ schedule: { ...schedule, state: "CANCELLED" } });
    }
    case "delete": {
      await deleteSchedule(schedule.id ?? body.scheduleId);
      return jsonOk({ deleted: true });
    }
    default:
      return jsonError(`Unknown action "${body.action}".`, 422);
  }
}
