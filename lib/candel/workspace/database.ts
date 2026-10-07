/**
 * AlgoVault Candel SDK — RTDB Store
 *
 * Firebase RTDB-backed persistence for Candel objects.
 * Wraps every set/update with deepClean() so nested undefined is
 * converted to null (Firebase RTDB rejects nested undefined).
 */

import { adminAuth } from "@/lib/firebase-admin";
import { adminDatabase } from "@/lib/firebase-admin";
import type {
  CandelInstance,
  CandelTemplate,
  CandelPage,
  CandelMemoryEntry,
  CandelConversation,
  CandelActivity,
  CandelApprovalRequest,
  CandelJob,
  CandelAutomation,
  CandelToolCall,
  CandelPermissions,
  AccountBinding,
  CandelProposal,
  CandelAccountContext,
} from "../types";

// ─── Deep-clean for RTDB (undefined → null; arrays sanitized) ─────────────
function deepClean(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => deepClean(v));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepClean(v);
    }
    return out;
  }
  return value;
}

// ─── Template operations (admin + owner) ───────────────────────────────────

export async function getCandelTemplate(id: string): Promise<CandelTemplate | null> {
  const snap = await adminDatabase.ref(`candelTemplates/${id}`).get();
  if (!snap.exists()) return null;
  return snap.val() as CandelTemplate;
}

export async function getAllCandelTemplates(): Promise<CandelTemplate[]> {
  const snap = await adminDatabase.ref("candelTemplates").get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelTemplate>;
  return Object.values(val);
}

export async function saveCandelTemplate(template: CandelTemplate): Promise<void> {
  await adminDatabase.ref(`candelTemplates/${template.id}`).set({
    ...template,
    updatedAt: Date.now(),
  });
}

export async function deleteCandelTemplate(id: string, userId: string): Promise<void> {
  const snap = await adminDatabase.ref(`candelTemplates/${id}`).get();
  if (!snap.exists()) throw new Error("Template not found.");
  const data = snap.val() as { createdBy?: string };
  if (data.createdBy !== userId && !isAdmin(userId)) {
    throw new Error("Template deletion denied.");
  }
  await adminDatabase.ref(`candelTemplates/${id}`).remove();
}

function isAdmin(uid: string): Promise<boolean> {
  // Server-side enforcement is implicit: this module uses Firebase Admin SDK.
  // Client bundles never import this module.
  return adminAuth.getUser(uid)
    .then((userRecord) => (userRecord.customClaims?.admin === true || userRecord.customClaims?.role === "admin") as boolean)
    .catch(() => false);
}

// ─── Instance operations ────────────────────────────────────────────────────

export async function getCandelInstance(id: string): Promise<CandelInstance | null> {
  const snap = await adminDatabase.ref(`candel/${id}`).get();
  if (!snap.exists()) return null;
  return snap.val() as CandelInstance;
}

export async function getCandelInstancesByUser(userId: string): Promise<CandelInstance[]> {
  const snap = await adminDatabase.ref(`candel`).orderByChild("userId").equalTo(userId).get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelInstance>;
  return Object.values(val);
}

export async function saveCandelInstance(instance: CandelInstance): Promise<void> {
  await adminDatabase.ref(`candel/${instance.id}`).set(deepClean(instance));
}

export async function deleteCandelInstance(id: string, userId: string): Promise<void> {
  const snap = await adminDatabase.ref(`candel/${id}`).get();
  if (!snap.exists()) throw new Error("Candel not found.");
  const data = snap.val() as { createdBy?: string };
  if (data.createdBy !== userId && !isAdmin(userId)) {
    throw new Error("Candel deletion denied.");
  }
  await adminDatabase.ref(`candel/${id}`).remove();
}

// ─── Account bindings ───────────────────────────────────────────────────────

export async function getCandelAccountBindings(candelId: string): Promise<AccountBinding[]> {
  const snap = await adminDatabase.ref(`candelAccountBindings`).get();
  if (!snap.exists()) return [];
  const bindings: AccountBinding[] = [];
  for (const [userId, userIdVal] of Object.entries(snap.val() as Record<string, unknown>)) {
    if (typeof userIdVal !== "object" || userIdVal === null) continue;
    const userIdObj = userIdVal as Record<string, unknown>;
    if (typeof userIdObj[candelId] !== "object" || userIdObj[candelId] === null) continue;
    const candelObj = userIdObj[candelId] as Record<string, AccountBinding>;
    bindings.push(...Object.values(candelObj));
  }
  return bindings;
}

export async function saveCandelAccountBindings(
  candelId: string,
  userId: string,
  bindings: AccountBinding[]
): Promise<void> {
  for (const binding of bindings) {
    await adminDatabase
      .ref(`candelAccountBindings/${userId}/${candelId}`)
      .set(deepClean(binding));
  }
}

export async function deleteCandelAccountBinding(
  candelId: string,
  userId: string,
  tradingAccountId: string
): Promise<void> {
  await adminDatabase
    .ref(`candelAccountBindings/${userId}/${candelId}/${tradingAccountId}`)
    .remove();
}

// ─── Permissions ────────────────────────────────────────────────────────────

export async function getCandelPermissions(candelId: string, userId: string): Promise<CandelPermissions | null> {
  const snap = await adminDatabase
    .ref(`candelPermissions/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return null;
  return snap.val() as CandelPermissions;
}

export async function saveCandelPermissions(
  candelId: string,
  userId: string,
  permissions: CandelPermissions
): Promise<void> {
  await adminDatabase
    .ref(`candelPermissions/${userId}/${candelId}`)
    .set(deepClean(permissions));
}

// ─── Conversations ──────────────────────────────────────────────────────────

export async function getCandelConversations(candelId: string, userId: string): Promise<CandelConversation[]> {
  const snap = await adminDatabase
    .ref(`candelConversations/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelConversation>;
  return Object.values(val);
}

export async function saveCandelConversation(conv: CandelConversation): Promise<void> {
  await adminDatabase
    .ref(`candelConversations/${conv.userId}/${conv.candelId}/${conv.id}`)
    .set(deepClean(conv));
}

export async function deleteCandelConversation(convId: string, userId: string, candelId: string): Promise<void> {
  await adminDatabase
    .ref(`candelConversations/${userId}/${candelId}/${convId}`)
    .remove();
}

// ─── Workspace pages ────────────────────────────────────────────────────────

export async function getCandelWorkspacePages(candelId: string, userId: string): Promise<CandelPage[]> {
  const snap = await adminDatabase
    .ref(`candelWorkspace/${userId}/${candelId}/pages`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelPage>;
  return Object.values(val);
}

export async function saveCandelWorkspacePage(page: CandelPage): Promise<void> {
  await adminDatabase
    .ref(`candelWorkspace/${page.userId}/${page.candelId}/pages/${page.id}`)
    .set(deepClean(page));
}

export async function deleteCandelWorkspacePage(pageId: string, candelId: string, userId: string): Promise<void> {
  await adminDatabase
    .ref(`candelWorkspace/${userId}/${candelId}/pages/${pageId}`)
    .remove();
}

// ─── Memory entries ─────────────────────────────────────────────────────────

export async function getCandelMemory(candelId: string, userId: string): Promise<CandelMemoryEntry[]> {
  const snap = await adminDatabase
    .ref(`candelMemory/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelMemoryEntry>;
  return Object.values(val);
}

export async function saveCandelMemoryEntry(entry: CandelMemoryEntry): Promise<void> {
  await adminDatabase
    .ref(`candelMemory/${entry.userId}/${entry.candelId}/${entry.id}`)
    .set(deepClean(entry));
}

export async function deleteCandelMemoryEntry(entryId: string, candelId: string, userId: string): Promise<void> {
  await adminDatabase
    .ref(`candelMemory/${userId}/${candelId}/${entryId}`)
    .remove();
}

// ─── Activity (audit) ───────────────────────────────────────────────────────

export async function getCandelActivity(candelId: string, userId: string): Promise<CandelActivity[]> {
  const snap = await adminDatabase
    .ref(`candelActivity/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelActivity>;
  return Object.values(val);
}

// ─── Approvals ──────────────────────────────────────────────────────────────

export async function getCandelApprovals(candelId: string, userId: string): Promise<CandelApprovalRequest[]> {
  const snap = await adminDatabase
    .ref(`candelApprovals/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelApprovalRequest>;
  return Object.values(val);
}

export async function saveApprovalRequest(request: CandelApprovalRequest): Promise<void> {
  await adminDatabase
    .ref(`candelApprovals/${request.userId}/${request.candelId}/${request.id}`)
    .set(deepClean(request));
}

export async function deleteApprovalRequest(id: string, candelId: string, userId: string): Promise<void> {
  await adminDatabase
    .ref(`candelApprovals/${userId}/${candelId}/${id}`)
    .remove();
}

// ─── Background jobs ────────────────────────────────────────────────────────

export async function getCandelJobs(candelId: string, userId: string): Promise<CandelJob[]> {
  const snap = await adminDatabase
    .ref(`candelAutomation/${userId}/${candelId}/jobs`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelJob>;
  return Object.values(val);
}

export async function saveCandelJob(job: CandelJob): Promise<void> {
  await adminDatabase
    .ref(`candelAutomation/${job.userId}/${job.candelId}/jobs/${job.id}`)
    .set(deepClean(job));
}

export async function deleteCandelJob(jobId: string, candelId: string, userId: string): Promise<void> {
  await adminDatabase
    .ref(`candelAutomation/${userId}/${candelId}/jobs/${jobId}`)
    .remove();
}

// ─── Automations ────────────────────────────────────────────────────────────

export async function getCandelAutomations(candelId: string, userId: string): Promise<CandelAutomation[]> {
  const snap = await adminDatabase
    .ref(`candelAutomation/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelAutomation>;
  return Object.values(val);
}

export async function saveCandelAutomation(auto: CandelAutomation): Promise<void> {
  await adminDatabase
    .ref(`candelAutomation/${auto.userId}/${auto.candelId}/${auto.id}`)
    .set(deepClean(auto));
}

export async function deleteCandelAutomation(autoId: string, candelId: string, userId: string): Promise<void> {
  await adminDatabase
    .ref(`candelAutomation/${userId}/${candelId}/${autoId}`)
    .remove();
}

// ─── Tool calls ─────────────────────────────────────────────────────────────

export async function getCandelToolCalls(candelId: string, userId: string): Promise<CandelToolCall[]> {
  const snap = await adminDatabase
    .ref(`candelToolCalls/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelToolCall>;
  return Object.values(val);
}

export async function saveCandelToolCall(call: CandelToolCall): Promise<void> {
  await adminDatabase
    .ref(`candelToolCalls/${call.userId}/${call.candelId}/${call.id}`)
    .set(deepClean(call));
}

// ─── Proposals (transaction of intent) ──────────────────────────────────────

export async function getCandelProposals(candelId: string, userId: string): Promise<CandelProposal[]> {
  const snap = await adminDatabase
    .ref(`candelProposals/${userId}/${candelId}`)
    .get();
  if (!snap.exists()) return [];
  const val = snap.val() as Record<string, CandelProposal>;
  return Object.values(val);
}

export async function saveCandelProposal(proposal: CandelProposal): Promise<void> {
  await adminDatabase
    .ref(`candelProposals/${proposal.userId}/${proposal.candelId}/${proposal.id}`)
    .set(deepClean(proposal));
}

export async function deleteCandelProposal(proposalId: string, candelId: string, userId: string): Promise<void> {
  await adminDatabase
    .ref(`candelProposals/${userId}/${candelId}/${proposalId}`)
    .remove();
}

// ─── Account context (server-scoped read-only view) ─────────────────────────

export async function getCandelAccountContext(candelId: string, userId: string, accountId: string): Promise<CandelAccountContext | null> {
  const snap = await adminDatabase
    .ref(`candelAccountContext/${userId}/${candelId}/${accountId}`)
    .get();
  if (!snap.exists()) return null;
  return snap.val() as CandelAccountContext;
}

export async function saveCandelAccountContext(
  candelId: string,
  userId: string,
  accountId: string,
  context: CandelAccountContext
): Promise<void> {
  await adminDatabase
    .ref(`candelAccountContext/${userId}/${candelId}/${accountId}`)
    .set(deepClean(context));
}
