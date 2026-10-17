/**
 * Marketing Agent cron tick (§26, §79).
 *
 * Lives beside the existing `/api/growth/cron/[job]` handler and reuses the
 * SAME job registry (`runCronJob`) — no second scheduler is introduced. A
 * static segment takes precedence over `[job]`.
 *   - GET: Vercel Cron entrypoint, authorized by CRON_SECRET only.
 *   - POST: manual/operator trigger; admin session or a presented secret.
 *
 * Every tick is idempotent: `claimJobKey` deduplicates by bucket, and every
 * publishing operation carries an idempotency key (§29).
 */

import { NextRequest } from "next/server";
import { handleMarketingAgentGet, handleMarketingAgentPost } from "@/lib/growth/cron-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleMarketingAgentGet(request);
}

export async function POST(request: NextRequest) {
  return handleMarketingAgentPost(request);
}
