"use client";

/**
 * AlgoVault Candel — browser client.
 *
 * One place that knows how to talk to `/api/candel/*`: it attaches the Firebase
 * ID token, unwraps the `{ success, error }` envelope and turns failures into a
 * single typed error. Pages and components never call `fetch` directly, so the
 * "forgot the Authorization header" class of bug (which silently produced 401s
 * across the whole Candel surface) cannot come back.
 */

import { auth } from "@/lib/firebase";
import type {
  AccountBinding,
  AccountContext,
  CandelActivity,
  CandelApprovalRequest,
  CandelAutomation,
  CandelConversation,
  CandelInstance,
  CandelJob,
  CandelMemoryEntry,
  CandelMessage,
  CandelPage,
  CandelPermissions,
  CandelProposal,
  CandelTemplate,
  CandelToolCall,
} from "@/lib/candel/types";

export class CandelApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CandelApiError";
    this.status = status;
  }
}

interface ApiEnvelope {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** Attach the ID token and normalize the response envelope. */
async function candelFetch<T extends ApiEnvelope>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new CandelApiError("You are signed out. Sign in again to use Candels.", 401);
  }
  const token = await user.getIdToken();

  const { json, headers, ...rest } = init;
  const response = await fetch(path, {
    ...rest,
    cache: "no-store",
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  let payload: ApiEnvelope = {};
  try {
    payload = (await response.json()) as ApiEnvelope;
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    throw new CandelApiError(
      payload.error || `Request failed (${response.status})`,
      response.status,
    );
  }
  return payload as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

const BASE = "/api/candel/candel";

export type SendMessageResult = {
  response: string;
  conversation: CandelConversation;
  messages: CandelMessage[];
  /** Live actions the Candel asked permission for on this turn. */
  approvals?: CandelApprovalRequest[];
  /**
   * Present (no adapter) when the Candel's template could not be loaded, so a
   * turn can fail without throwing a transport error.
   */
  status?: string;
};

export interface BindableAccount {
  id: string;
  accountRef: string;
  broker: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  status: string;
}

export const candelApi = {
  // ── Instances ────────────────────────────────────────────────────────────
  async list(includeArchived = false): Promise<CandelInstance[]> {
    const data = await candelFetch<{ instances: CandelInstance[] }>(
      `${BASE}${query({ archived: includeArchived })}`,
    );
    return data.instances ?? [];
  },

  async get(candelId: string): Promise<CandelInstance> {
    const data = await candelFetch<{ instance: CandelInstance }>(
      `${BASE}/${candelId}${query({ candelId })}`,
    );
    return data.instance;
  },

  async create(input: {
    templateId: string;
    name: string;
    description?: string;
    role?: string;
    avatar?: string;
    instructions?: string;
    model?: string;
    tools?: string[];
    capabilities?: string[];
  }): Promise<CandelInstance> {
    const data = await candelFetch<{ instance: CandelInstance }>(BASE, {
      method: "POST",
      json: input,
    });
    return data.instance;
  },

  async update(
    candelId: string,
    patch: {
      name?: string;
      description?: string;
      status?: CandelInstance["status"];
      role?: string;
      avatar?: string;
      instructions?: string;
      model?: string;
      memoryPolicy?: "owner" | "shared" | "none";
      tools?: string[];
      capabilities?: string[];
    },
  ): Promise<CandelInstance> {
    const data = await candelFetch<{ instance: CandelInstance }>(
      `${BASE}${query({ candelId })}`,
      { method: "PATCH", json: patch },
    );
    return data.instance;
  },

  async archive(candelId: string): Promise<void> {
    await candelFetch(`${BASE}${query({ candelId })}`, { method: "DELETE" });
  },

  /** Permanent delete: the instance and every per-Candel sub-tree. */
  async destroy(candelId: string): Promise<void> {
    await candelFetch(`${BASE}${query({ candelId, hard: "true" })}`, { method: "DELETE" });
  },

  // ── Templates ────────────────────────────────────────────────────────────
  async templates(all = false): Promise<CandelTemplate[]> {
    const data = await candelFetch<{ templates: CandelTemplate[] }>(
      `${BASE}/template${query({ all })}`,
    );
    return data.templates ?? [];
  },

  // ── Conversations & chat ─────────────────────────────────────────────────
  async conversations(
    candelId: string,
    opts: { includeMessages?: boolean } = {},
  ): Promise<{ conversations: CandelConversation[]; messagesByConversation: Record<string, CandelMessage[]> }> {
    const data = await candelFetch<{
      conversations: CandelConversation[];
      messagesByConversation?: Record<string, CandelMessage[]>;
    }>(`${BASE}/conversation${query({ candelId, includeMessages: opts.includeMessages })}`);
    return {
      conversations: data.conversations ?? [],
      messagesByConversation: data.messagesByConversation ?? {},
    };
  },

  /** Append a user turn and run the Candel agent. */
  async sendMessage(input: {
    candelId: string;
    content: string;
    conversationId?: string;
  }): Promise<SendMessageResult> {
    const data = await candelFetch<SendMessageResult>(`${BASE}/conversation/message`, {
      method: "POST",
      json: input,
    });
    return data;
  },

  async deleteConversation(candelId: string, conversationId: string): Promise<void> {
    await candelFetch(`${BASE}/conversation${query({ candelId, conversationId })}`, {
      method: "DELETE",
    });
  },

  // ── Memory ───────────────────────────────────────────────────────────────
  async memory(candelId: string): Promise<CandelMemoryEntry[]> {
    const data = await candelFetch<{ memory: CandelMemoryEntry[] }>(
      `${BASE}/memory${query({ candelId })}`,
    );
    return data.memory ?? [];
  },

  async remember(
    candelId: string,
    input: { key: string; value: string; scope?: CandelMemoryEntry["kind"] },
  ): Promise<CandelMemoryEntry> {
    const data = await candelFetch<{ entry: CandelMemoryEntry }>(
      `${BASE}/memory${query({ candelId })}`,
      { method: "POST", json: input },
    );
    return data.entry;
  },

  async forget(candelId: string, entryId: string): Promise<void> {
    await candelFetch(`${BASE}/memory${query({ candelId, entryId })}`, { method: "DELETE" });
  },

  // ── Activity ─────────────────────────────────────────────────────────────
  async activity(candelId: string): Promise<CandelActivity[]> {
    const data = await candelFetch<{ activities: CandelActivity[] }>(
      `${BASE}/activity${query({ candelId })}`,
    );
    return data.activities ?? [];
  },

  async clearActivity(candelId: string): Promise<void> {
    await candelFetch(`${BASE}/activity${query({ candelId })}`, { method: "DELETE" });
  },

  async toolCalls(candelId: string): Promise<CandelToolCall[]> {
    const data = await candelFetch<{ toolCalls: CandelToolCall[] }>(
      `${BASE}/tool-calls${query({ candelId })}`,
    );
    return data.toolCalls ?? [];
  },

  // ── Approvals (human-in-the-loop) ────────────────────────────────────────
  async approvals(candelId: string): Promise<CandelApprovalRequest[]> {
    const data = await candelFetch<{ approvals: CandelApprovalRequest[] }>(
      `${BASE}/approval${query({ candelId })}`,
    );
    return data.approvals ?? [];
  },

  /** Record the human decision on a request. Execution still happens elsewhere. */
  async decideApproval(
    candelId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    reason = "",
  ): Promise<CandelApprovalRequest> {
    const data = await candelFetch<{ approval: CandelApprovalRequest }>(
      `${BASE}/approval/decide${query({ candelId })}`,
      { method: "POST", json: { candelId, approvalId, decision, reason } },
    );
    return data.approval;
  },

  async withdrawApproval(candelId: string, approvalId: string): Promise<void> {
    await candelFetch(`${BASE}/approval${query({ candelId, approvalId })}`, {
      method: "DELETE",
    });
  },

  // ── Permissions ──────────────────────────────────────────────────────────
  async permissions(candelId: string): Promise<CandelPermissions | null> {
    const data = await candelFetch<{ permissions: CandelPermissions | null }>(
      `${BASE}/permissions${query({ candelId })}`,
    );
    return data.permissions;
  },

  async savePermissions(
    candelId: string,
    permissions: Partial<CandelPermissions>,
  ): Promise<CandelPermissions> {
    const data = await candelFetch<{ permissions: CandelPermissions }>(
      `${BASE}/permissions${query({ candelId })}`,
      { method: "POST", json: permissions },
    );
    return data.permissions;
  },

  // ── Accounts & bindings ──────────────────────────────────────────────────
  async bindableAccounts(): Promise<BindableAccount[]> {
    const data = await candelFetch<{ accounts: BindableAccount[] }>(`${BASE}/accounts`);
    return data.accounts ?? [];
  },

  async bindings(candelId: string): Promise<AccountBinding[]> {
    const data = await candelFetch<{ bindings: AccountBinding[] }>(
      `${BASE}/bindings${query({ candelId })}`,
    );
    return data.bindings ?? [];
  },

  async bindAccount(
    candelId: string,
    accountId: string,
    allowedContexts: AccountContext[],
  ): Promise<AccountBinding> {
    const data = await candelFetch<{ binding: AccountBinding }>(
      `${BASE}/bindings${query({ candelId })}`,
      { method: "POST", json: { accountId, allowedContexts } },
    );
    return data.binding;
  },

  async unbindAccount(candelId: string, accountId: string): Promise<void> {
    await candelFetch(`${BASE}/bindings${query({ candelId, accountId })}`, {
      method: "DELETE",
    });
  },

  // ── Automations ──────────────────────────────────────────────────────────
  async automations(candelId: string): Promise<CandelAutomation[]> {
    const data = await candelFetch<{ automations: CandelAutomation[] }>(
      `${BASE}/automations${query({ candelId })}`,
    );
    return data.automations ?? [];
  },

  async createAutomation(
    candelId: string,
    input: { name: string; type: "cron" | "event"; schedule: string; description?: string },
  ): Promise<CandelAutomation> {
    const data = await candelFetch<{ automation: CandelAutomation }>(
      `${BASE}/automations${query({ candelId })}`,
      { method: "POST", json: input },
    );
    return data.automation;
  },

  async deleteAutomation(candelId: string, automationId: string): Promise<void> {
    await candelFetch(`${BASE}/automations${query({ candelId, automationId })}`, {
      method: "DELETE",
    });
  },

  // ── Workspace pages (Candel notes / research) ────────────────────────────
  async workspacePages(candelId: string): Promise<CandelPage[]> {
    const data = await candelFetch<{ pages: CandelPage[] }>(
      `${BASE}/workspace${query({ candelId })}`,
    );
    return data.pages ?? [];
  },

  async createWorkspacePage(
    candelId: string,
    input: { title: string; content?: string },
  ): Promise<CandelPage> {
    const data = await candelFetch<{ page: CandelPage }>(
      `${BASE}/workspace${query({ candelId })}`,
      { method: "POST", json: input },
    );
    return data.page;
  },

  async deleteWorkspacePage(candelId: string, pageId: string): Promise<void> {
    await candelFetch(`${BASE}/workspace${query({ candelId, pageId })}`, {
      method: "DELETE",
    });
  },

  // ── Proposals (intents the Candel prepared) ──────────────────────────────
  async proposals(candelId: string): Promise<CandelProposal[]> {
    const data = await candelFetch<{ proposals: CandelProposal[] }>(
      `${BASE}/proposals${query({ candelId })}`,
    );
    return data.proposals ?? [];
  },

  // ── Background jobs (scheduled work) ─────────────────────────────────────
  async jobs(candelId: string): Promise<CandelJob[]> {
    const data = await candelFetch<{ jobs: CandelJob[] }>(
      `${BASE}/jobs${query({ candelId })}`,
    );
    return data.jobs ?? [];
  },

  async createJob(
    candelId: string,
    input: { name: string; cron: string; action: string; enabled?: boolean },
  ): Promise<CandelJob> {
    const data = await candelFetch<{ job: CandelJob }>(
      `${BASE}/jobs${query({ candelId })}`,
      { method: "POST", json: input },
    );
    return data.job;
  },

  async deleteJob(candelId: string, jobId: string): Promise<void> {
    await candelFetch(`${BASE}/jobs${query({ candelId, jobId })}`, {
      method: "DELETE",
    });
  },
};

/** Human-readable message for any thrown value. */
export function candelErrorMessage(error: unknown): string {
  if (error instanceof CandelApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
