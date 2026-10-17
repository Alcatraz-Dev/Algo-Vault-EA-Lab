
/**
 * Marketing Agent cron tick (§26, §79).
 *
 * Lives beside the existing `/api/growth/cron/[job]` handler and reuses the
 * SAME job registry (`runCronJob`) — no second scheduler is introduced. A
 * static segment takes precedence over `[job]`, which lets a scheduled
 * invocation authenticate with `CRON_SECRET` while still accepting an admin
 * session for manual triggering.
 *
 * Every tick is idempotent: `claimJobKey` deduplicates by bucket, and every
 * publishing operation carries an idempotency key (§29).
 */

import { NextRequest, NextResponse } from "next/server";
import { runCronJob } from "@/lib/growth/jobs";
import { requireGrowthAdmin } from "@/lib/growth/server-auth";
import { cronSecretsMatch, getConfiguredCronSecret, presentedCronSecrets } from "@/lib/security/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      payload?: Record<string, unknown>;
      cronSecret?: string;
      bucket?: string;
    };

    const expected = getConfiguredCronSecret();
    const secretMatches =
      presentedCronSecrets(request).some((c) => cronSecretsMatch(c, expected)) ||
      cronSecretsMatch(body.cronSecret, expected);
    const admin = await requireGrowthAdmin(request);

    if (!secretMatches && !admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 5-minute buckets keep ticks deduplicated without blocking the next one.
    const bucket = body.bucket || `t${Math.floor(Date.now() / (5 * 60 * 1000))}`;
    const result = await runCronJob("marketing-agent", { ...(body.payload ?? {}), bucket });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Marketing Agent tick failed." },
      { status: 500 }
    );
  }
}
