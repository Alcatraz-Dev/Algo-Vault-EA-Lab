import { NextRequest, NextResponse } from "next/server";
import { ERPNextAPIClient } from "../../../../../lib/integrations/erpnext/client";
import { loadERPNextConfig, isERPNextConfigured } from "../../../../../lib/integrations/erpnext/config";
import { getSyncState } from "../../../../../lib/integrations/erpnext/sync";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const config = loadERPNextConfig();
  const enabled = isERPNextConfigured(config);
  let reachable = false;
  let lastSyncAt: string | undefined;
  let pendingEvents = 0;
  let failedEvents = 0;

  if (enabled) {
    try {
      const client = new ERPNextAPIClient();
      const health = await client.healthCheck();
      reachable = health.reachable;
      pendingEvents = health.pendingEvents;
      failedEvents = health.failedEvents;
      lastSyncAt = health.lastSyncAt;
    } catch {
      reachable = false;
    }
  }

  const state = getSyncState();
  if (!lastSyncAt) lastSyncAt = state.lastSyncAt;
  if (pendingEvents === 0) pendingEvents = state.pendingEvents;
  if (failedEvents === 0) failedEvents = state.failedEvents;

  return NextResponse.json({
    enabled,
    reachable,
    lastSyncAt: lastSyncAt ?? null,
    pendingEvents,
    failedEvents,
  });
}
