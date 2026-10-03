/** Marketing Agent — social accounts: status, health check, disconnect (§30, §32). */

import { NextRequest } from "next/server";
import { jsonError, jsonOk, requireAdmin } from "../_runtime";
import { getSocialAccount, listSocialAccounts, upsertSocialAccount, audit } from "@/lib/marketing-agent/storage";
import { listSocialPublishers, registerSocialPublishers, getSocialPublisher } from "@/lib/marketing-agent/publishing/providers";
import { capabilityMatrix } from "@/lib/marketing-agent/publishing/capabilities";
import type { MarketingPlatform, SocialAccountState } from "@/lib/marketing-agent/collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sanitize(account: Record<string, unknown>) {
  // Never return anything token-shaped (§30, §88).
  const { ...rest } = account;
  delete rest.accessToken;
  delete rest.refreshToken;
  delete rest.token;
  delete rest.secret;
  return rest;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  registerSocialPublishers();
  const accounts = await listSocialAccounts();
  const publishers = listSocialPublishers();

  const connectors = await Promise.all(
    publishers.map(async (p) => {
      const health = await p.health();
      return {
        platform: p.platform,
        state: health.ok ? "CONNECTED" : health.state === "NOT_CONFIGURED" ? "DISCONNECTED" : "ERROR",
        reason: health.ok ? undefined : health.reason,
        permissions: health.ok ? health.value.permissions : [],
        tokenState: health.ok ? (health.value.tokenExpiresAt ? "VALID" : "VALID") : "NONE",
        tokenExpiresAt: health.ok ? health.value.tokenExpiresAt : undefined,
        capabilities: p.capabilities,
      };
    })
  );

  return jsonOk({
    accounts: accounts.map((a) => sanitize(a as unknown as Record<string, unknown>)),
    connectors,
    capabilities: capabilityMatrix(),
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (!admin) return jsonError("Admin required", 403);

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    accountId?: string;
    platform?: string;
    accountName?: string;
  };

  registerSocialPublishers();

  switch (body.action) {
    case "health": {
      const accounts = await listSocialAccounts();
      const results = [];
      for (const account of accounts) {
        const publisher = getSocialPublisher(account.platform as MarketingPlatform);
        if (!publisher) continue;
        const health = await publisher.health(account.accountId);
        const state: SocialAccountState = health.ok
          ? health.value.tokenExpiresAt && health.value.tokenExpiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000
            ? "EXPIRING"
            : "CONNECTED"
          : health.state === "NOT_CONFIGURED"
            ? "DISCONNECTED"
            : health.state === "AUTH"
              ? "RECONNECT_REQUIRED"
              : "ERROR";
        await upsertSocialAccount({
          id: account.id,
          platform: account.platform,
          accountId: account.accountId,
          accountName: account.accountName,
          state,
          permissions: health.ok ? health.value.permissions : account.permissions,
          tokenState: health.ok ? "VALID" : health.state === "AUTH" ? "EXPIRED" : "NONE",
          ...(health.ok && health.value.tokenExpiresAt ? { tokenExpiresAt: health.value.tokenExpiresAt } : {}),
          lastHealthCheckAt: Date.now(),
          ...(health.ok ? {} : { lastHealthError: health.reason }),
          createdBy: account.createdBy,
        });
        results.push({ id: account.id, platform: account.platform, state, detail: health.ok ? undefined : health.reason });
      }
      await audit({ actor: admin.uid, action: "social_health_check", targetType: "marketingSocialAccount", targetId: "", detail: { checked: results.length } });
      return jsonOk({ results });
    }

    case "disconnect": {
      if (!body.accountId) return jsonError("accountId is required.", 422);
      const account = await getSocialAccount(body.accountId);
      if (!account) return jsonError("Account not found.", 404);
      await upsertSocialAccount({
        ...account,
        state: "DISCONNECTED",
        tokenState: "NONE",
        permissions: [],
        lastHealthCheckAt: Date.now(),
      });
      await audit({ actor: admin.uid, action: "social_disconnected", targetType: "marketingSocialAccount", targetId: account.id ?? "", detail: { platform: account.platform } });
      return jsonOk({ account: sanitize(account as unknown as Record<string, unknown>) });
    }

    case "register": {
      if (!body.platform || !body.accountId) return jsonError("platform and accountId are required.", 422);
      const id = await upsertSocialAccount({
        platform: body.platform,
        accountId: body.accountId,
        accountName: body.accountName || body.accountId,
        state: "CONNECTED",
        permissions: [],
        tokenState: "VALID",
        connectedAt: Date.now(),
        createdBy: admin.uid,
      });
      await audit({ actor: admin.uid, action: "social_connected", targetType: "marketingSocialAccount", targetId: id, detail: { platform: body.platform } });
      return jsonOk({ id }, 201);
    }

    default:
      return jsonError(`Unknown action "${body.action}".`, 422);
  }
}
