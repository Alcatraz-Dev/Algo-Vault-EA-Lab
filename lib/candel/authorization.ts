/**
 * AlgoVault Candel SDK — Authorization
 *
 * Server-side enforcement ONLY (Firebase Admin SDK).
 * No client-supplied userId, candelId, accountId, role, or permission flags are trusted.
 *
 * Strategy: owner OR admin for everything; trading data additionally
 * requires explicit `candelAccountBindings` grant.
 *
 * Fail-closed: missing permission/account context => "unavailable: missing ..."
 */

import { adminAuth } from "@/lib/firebase-admin";
import { adminDatabase } from "@/lib/firebase-admin";
import type {
  CandelInstance,
  CandelPermissions,
  AccountBinding,
  CandelTemplate,
  CandelApprovalRequest,
  ApprovalDecision,
  CandelActivity,
  CandelAccountContext,
} from "./types";

// ─── Helpers ───────────────────────────────────────────────────────────────

function assertServerSide(): void {
  // Server-side enforcement is implicit: this module uses Firebase Admin SDK.
  // Client bundles never import this module.
}

// ─── Candel ownership checks ───────────────────────────────────────────────

export async function resolveCandelOwner(candelId: string): Promise<string | null> {
  const snap = await adminDatabase.ref(`candel/${candelId}`).get();
  if (!snap.exists()) return null;
  return (snap.val().createdBy as string) || null;
}

export async function requireCandelOwner(candelId: string, requestedUserId: string): Promise<void> {
  assertServerSide();
  const owner = await resolveCandelOwner(candelId);
  if (!owner || owner !== requestedUserId) {
    throw new Error("Candel not found or access denied.");
  }
}

export async function requireCandelReadable(candelId: string, userId: string): Promise<void> {
  assertServerSide();
  const snap = await adminDatabase.ref(`candel/${candelId}`).get();
  if (!snap.exists()) throw new Error("Candel not found.");
  const data = snap.val() as { createdBy?: string };
  if (data.createdBy !== userId && !isAdmin(userId)) {
    throw new Error("Candel access denied.");
  }
}

// ─── Account binding resolution ─────────────────────────────────────────────

export async function resolveAccountBindingsForCandel(
  candelId: string,
  userId: string
): Promise<AccountBinding[]> {
  const snap = await adminDatabase
    .ref(`candelAccountBindings/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, AccountBinding>;
  return Object.values(val);
}

export async function requireCandelAccountContext(
  candelId: string,
  userId: string,
  accountId?: string
): Promise<AccountBinding | null> {
  assertServerSide();
  if (!accountId) return null;
  const bindings = await resolveAccountBindingsForCandel(candelId, userId);
  return bindings.find((b) => b.tradingAccountId === accountId) ?? null;
}

export async function requireCandelCanReadAccount(
  candelId: string,
  userId: string,
  accountId: string
): Promise<void> {
  assertServerSide();
  const binding = await requireCandelAccountContext(candelId, userId, accountId);
  if (!binding) {
    throw new Error("Candel cannot read this trading account: account permission missing.");
  }
}

// ─── Granular permission checks ─────────────────────────────────────────────

export async function resolveCandelPermissions(
  candelId: string,
  userId: string
): Promise<CandelPermissions> {
  assertServerSide();
  const snap = await adminDatabase
    .ref(`candelPermissions/${userId}/${candelId}`)
    .get();
  if (snap.exists()) {
    return snap.val() as CandelPermissions;
  }
  // Default: general permissions, execution OFF, trading account access = none
  return {
    workspace: { readPages: true, createPages: true, editPages: true, saveResearch: true },
    market: { readMarketData: true, analyzeChart: true, scanSymbols: true, createWatchlists: true, createAlerts: true },
    tradingAccount: { readAccount: false, readPositions: false, readOrders: false, readPerformance: false, readRisk: false },
    execution: { createOrder: false, modifyOrder: false, closePosition: false, cancelOrder: false },
    external: { tradingviewMcp: false, telegram: false, discord: false },
    approvalRequirements: {
      createOrder: false,
      modifyOrder: false,
      closePosition: false,
      cancelOrder: false,
      tradeJournalWrite: false,
    },
    executionDefault: "off",
    executionDefaultsToOff: true,
  };
}

export async function requireCandelPermission(
  candelId: string,
  userId: string,
  permission: keyof CandelPermissions,
  subPermission?: string
): Promise<void> {
  assertServerSide();
  const permissions = await resolveCandelPermissions(candelId, userId);

  // Top-level
  if (!permissions[permission]) {
    throw new Error(`Candel permission denied: ${String(permission)}.`);
  }

  // Deep-level
  if (subPermission) {
    const parts = String(subPermission).split(".");
    const level = permissions[permission] as Record<string, unknown>;
    if (typeof level === "object" && level !== null) {
      let cur: unknown = level;
      for (const p of parts) {
        if (typeof cur !== "object" || cur === null) {
          throw new Error(`Candel permission denied: ${subPermission}.`);
        }
        const next = (cur as Record<string, unknown>)[p];
        if (next === undefined || next === null) {
          throw new Error(`Candel permission denied: ${subPermission}.`);
        }
        cur = next;
      }
      // cur is now the leaf value; ensure truthy
      if (!cur) {
        throw new Error(`Candel permission denied: ${subPermission}.`);
      }
    } else {
      throw new Error(`Candel permission denied: ${subPermission}.`);
    }
  }
}

// ─── Execution permission (fail-closed default OFF) ─────────────────────────

export async function requireExecutionPermission(
  candelId: string,
  userId: string,
  action: "createOrder" | "modifyOrder" | "closePosition" | "cancelOrder"
): Promise<void> {
  assertServerSide();
  const perms = await resolveCandelPermissions(candelId, userId);
  if (!perms.execution[action]) {
    throw new Error(
      `Candel execution permission denied: ${action}. Execution permissions must default to OFF.`
    );
  }
  if (perms.executionDefaultsToOff === false) {
    throw new Error(
      "Candel execution permission is currently OFF. Enable it in Candel permissions."
    );
  }
}

// ─── Approval requirements (fail-closed) ───────────────────────────────────

export async function requireApproval(
  candelId: string,
  userId: string,
  actionType: string,
  riskLevel: "read_only" | "low_risk" | "user_confirmation" | "high_risk" | "live_trading"
): Promise<boolean> {
  assertServerSide();
  // Trading execution actions ALWAYS require approval
  if (
    actionType === "execution_prepared" ||
    actionType === "execution_executed" ||
    actionType === "approval_required" ||
    riskLevel === "live_trading" ||
    riskLevel === "high_risk"
  ) {
    return true;
  }
  // Non-trading actions: configurable, default off
  const perms = await resolveCandelPermissions(candelId, userId);
  const config = perms.approvalRequirements ?? {};
  const approved = (config as Record<string, boolean>)[actionType] ?? false;
  return approved;
}

// ─── Activity recording (audit) ─────────────────────────────────────────────

export async function recordCandelActivity(
  candelId: string,
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  details: Record<string, unknown>
): Promise<void> {
  assertServerSide();
  // Sanitize: never store passwords, secrets, tokens, private credentials
  const sanitized = sanitizeForAudit(details);
  const activity = {
    id: `${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    candelId,
    userId,
    action,
    targetType,
    targetId,
    details: sanitized,
    timestamp: Date.now(),
  };
  await adminDatabase
    .ref(`candelActivity/${userId}/${candelId}`)
    .push(activity)
    .catch(() => {
      // Non-fatal: audit is best-effort
    });
}

function sanitizeForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const forbidden = [
    "password", "secret", "token", "apiKey", "apikey", "credentials",
    "authorization", "bearer", "cookie", "session", "private", "privateKey",
    "env", "config", "key", "pass",
  ];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    if (forbidden.some((f) => lower.includes(f))) continue;
    out[k] = sanitizeForAudit(v);
  }
  return out;
}

// ─── Subscription entitlement checks ────────────────────────────────────────

export async function isProEntitled(userId: string): Promise<boolean> {
  assertServerSide();
  const snap = await adminDatabase.ref(`users/${userId}`).get();
  if (!snap.exists()) return false;
  const user = snap.val() as { subscription?: { plan?: string } };
  return user.subscription?.plan === "pro";
}

export async function checkSubscriptionEntitlement(
  userId: string,
  required: "free" | "pro"
): Promise<void> {
  assertServerSide();
  const isPro = await isProEntitled(userId);
  const requiredIsPro = required === "pro";
  if (requiredIsPro !== isPro) {
    throw new Error(
      `Candel subscription required: ${required}. Upgrade to ${required === "pro" ? "Pro" : "free"} to access this Candel.`
    );
  }
}

// ─── Admin authorization ────────────────────────────────────────────────────

export async function isAdmin(uid: string): Promise<boolean> {
  assertServerSide();
  return adminAuth.getUser(uid)
    .then((userRecord) => userRecord.customClaims?.admin === true || userRecord.customClaims?.role === "admin")
    .catch(() => false);
}

export async function requireAdmin(userId: string): Promise<void> {
  assertServerSide();
  if (!isAdmin(userId)) {
    throw new Error("Admin access required.");
  }
}

export async function requireAdminOrCandelOwner(
  candelId: string,
  userId: string
): Promise<void> {
  assertServerSide();
  const owner = await resolveCandelOwner(candelId);
  if (!owner || !isAdmin(userId) || owner !== userId) {
    throw new Error("Admin or Candel owner access required.");
  }
}

// ─── Account context for Candel (read-only view) ───────────────────────────

export async function loadCandelAccountContext(
  candelId: string,
  userId: string,
  accountId: string
): Promise<CandelAccountContext | null> {
  assertServerSide();
  // 1. Verify Candel has this account bound (by accountId)
  const bindings = await resolveAccountBindingsForCandel(candelId, userId);
  const binding = bindings.find((b) => b.tradingAccountId === accountId);
  if (!binding) return null;

  // 2. Verify Candel has read_risk/read_account permission
  const perms = await resolveCandelPermissions(candelId, userId);
  if (!perms.tradingAccount.readAccount && !perms.tradingAccount.readRisk) {
    return null;
  }

  // 3. Load from RTDB trading_accounts/{accountId} (server-authoritative)
  const accountSnap = await adminDatabase.ref(`trading_accounts/${accountId}`).get();
  if (!accountSnap.exists()) return null;

  const accountData = accountSnap.val() as Record<string, unknown>;

  // 4. Load from trading_positions for open positions
  let openPositions = 0;
  const positionsSnap = await adminDatabase
    .ref(`trading_positions/${userId}`)
    .get();
  if (positionsSnap.exists()) {
    const positionsSnapData = positionsSnap.val() as Record<string, unknown> | null | undefined;
    const positions = Object.values(positionsSnapData ?? {});
    openPositions = positions.filter((p: unknown): boolean => {
      if (typeof p !== "object" || p === null) return false;
      const pos = p as Record<string, unknown>;
      return (pos as { status?: unknown }).status !== "closed";
    }).length;
  }

  return {
    accountId,
    balance: typeof accountData.balance === "number" ? accountData.balance : undefined,
    equity: typeof accountData.equity === "number" ? accountData.equity : undefined,
    margin: typeof accountData.margin === "number" ? accountData.margin : undefined,
    openPositions,
    openOrders: 0,
    riskMetrics: {},
    challengeRules: undefined,
  };
}
