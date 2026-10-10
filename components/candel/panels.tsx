"use client";

import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  Brain,
  Check,
  GitBranch,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError, FormField } from "@/components/ui/form-field";
import { SectionHeader } from "@/components/ui/section-header";
import { timeAgo } from "@/components/candel/role-visuals";
import { ApprovalCard } from "@/components/candel/ApprovalCard";
import { isApprovalExpired, isApprovalPending } from "@/lib/candel/approvals";
import { candelApi, candelErrorMessage, type BindableAccount } from "@/lib/candel/client";
import type {
  AccountBinding,
  AccountContext,
  CandelActivity,
  CandelApprovalRequest,
  CandelAutomation,
  CandelMemoryEntry,
  CandelPermissions,
} from "@/lib/candel/types";

/**
 * Shared panel shell. `data === null` means "still loading" — the panels set
 * their slice only after the request resolves, so nothing calls setState
 * synchronously inside an effect and a slow response can never resurrect a
 * stale Candel's data.
 */
function PanelBody({
  data,
  error,
  empty,
  children,
}: {
  data: unknown;
  error: string;
  empty?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (error) return <FormError>{error}</FormError>;
  if (data === null) return <LoadingState rows={3} />;
  if (empty) return <>{empty}</>;
  return <>{children}</>;
}

// ─── Memory ─────────────────────────────────────────────────────────────────

const MEMORY_KINDS: CandelMemoryEntry["kind"][] = ["preference", "fact", "strategy", "risk", "note"];

export function MemoryPanel({ candelId }: { candelId: string }) {
  const [entries, setEntries] = useState<CandelMemoryEntry[] | null>(null);
  const [error, setError] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [valueInput, setValueInput] = useState("");
  const [kind, setKind] = useState<CandelMemoryEntry["kind"]>("preference");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.memory(candelId);
        if (!cancelled) {
          setEntries(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  async function add() {
    if (!keyInput.trim() || !valueInput.trim()) return;
    setSaving(true);
    setError("");
    try {
      const entry = await candelApi.remember(candelId, {
        key: keyInput.trim(),
        value: valueInput.trim(),
        scope: kind,
      });
      setEntries((prev) => [...(prev ?? []), entry]);
      setKeyInput("");
      setValueInput("");
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(entryId: string) {
    try {
      await candelApi.forget(candelId, entryId);
      setEntries((prev) => (prev ?? []).filter((entry) => entry.id !== entryId));
    } catch (err) {
      setError(candelErrorMessage(err));
    }
  }

  const list = entries ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Brain className="size-4" />}
        title="Memory"
        description="Preferences and facts this Candel carries into every conversation."
      />

      <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          placeholder="Key (e.g. risk per trade)"
        />
        <Input
          value={valueInput}
          onChange={(event) => setValueInput(event.target.value)}
          placeholder="Value (e.g. 0.5%)"
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as CandelMemoryEntry["kind"])}
        >
          {MEMORY_KINDS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          onClick={() => void add()}
          disabled={saving || !keyInput.trim() || !valueInput.trim()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Remember
        </Button>
      </div>

      <PanelBody
        data={entries}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<Brain className="size-4" />}
            title="Nothing remembered yet"
            description="Add a preference and this Candel will use it as context in every reply."
          />
        }
      >
        {list.length === 0 ? null : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{entry.kind}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {entry.source} · {timeAgo(entry.updatedAt || entry.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{entry.text}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Forget entry"
                  onClick={() => void remove(entry.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </div>
  );
}

// ─── Activity ───────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  tool_call: "Tool call",
  approval_request: "Approval requested",
  approval_granted: "Approval granted",
  approval_denied: "Approval denied",
  execution_prepared: "Execution prepared",
  execution_executed: "Execution executed",
  approval_required: "Approval required",
  error: "Error",
  job_start: "Job started",
  job_end: "Job finished",
  memory_read: "Memory read",
  memory_write: "Memory written",
  page_create: "Page created",
  page_update: "Page updated",
  message_sent: "Message sent",
  conversation_created: "Conversation started",
};

export function ActivityPanel({
  candelId,
  reloadKey = 0,
}: {
  candelId: string;
  reloadKey?: number;
}) {
  const [activities, setActivities] = useState<CandelActivity[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.activity(candelId);
        if (!cancelled) {
          setActivities(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId, reloadKey]);

  async function clear() {
    try {
      await candelApi.clearActivity(candelId);
      setActivities([]);
    } catch (err) {
      setError(candelErrorMessage(err));
    }
  }

  const list = activities ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<ActivityIcon className="size-4" />}
        title="Activity"
        description="Server-generated audit trail for this Candel."
        action={
          list.length > 0 ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => void clear()}>
              <Trash2 className="size-3" /> Clear
            </Button>
          ) : null
        }
      />
      <PanelBody
        data={activities}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<ActivityIcon className="size-4" />}
            title="No activity yet"
            description="Creating, customizing and messaging this Candel all show up here."
          />
        }
      >
        {list.length === 0 ? null : (
          <ol className="relative space-y-3 border-l border-border pl-4">
            {list.map((activity) => (
              <li key={activity.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-1.5 rounded-full bg-muted-foreground" />
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {ACTION_LABELS[activity.action] ?? activity.action}
                  </span>
                  <span className="text-xs text-muted-foreground">{timeAgo(activity.timestamp)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {activity.targetType}
                  {activity.targetId ? ` · ${activity.targetId.slice(0, 8)}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </PanelBody>
    </div>
  );
}

// ─── Permissions ────────────────────────────────────────────────────────────

interface PermissionToggle {
  group: keyof Pick<
    CandelPermissions,
    "workspace" | "market" | "tradingAccount" | "execution" | "external"
  >;
  key: string;
  label: string;
  description?: string;
  danger?: boolean;
}

const PERMISSION_TOGGLES: PermissionToggle[] = [
  { group: "workspace", key: "readPages", label: "Read workspace pages" },
  { group: "workspace", key: "createPages", label: "Create workspace pages" },
  { group: "workspace", key: "editPages", label: "Edit workspace pages" },
  { group: "workspace", key: "saveResearch", label: "Save research" },
  { group: "market", key: "readMarketData", label: "Read market data" },
  { group: "market", key: "analyzeChart", label: "Analyze charts" },
  { group: "market", key: "scanSymbols", label: "Scan symbols" },
  { group: "market", key: "createWatchlists", label: "Manage watchlists" },
  { group: "market", key: "createAlerts", label: "Create alerts" },
  { group: "tradingAccount", key: "readAccount", label: "Read bound account" },
  { group: "tradingAccount", key: "readPositions", label: "Read positions" },
  { group: "tradingAccount", key: "readOrders", label: "Read orders" },
  { group: "tradingAccount", key: "readPerformance", label: "Read performance" },
  { group: "tradingAccount", key: "readRisk", label: "Read risk state" },
  { group: "execution", key: "createOrder", label: "Create orders", description: "Approval always required", danger: true },
  { group: "execution", key: "modifyOrder", label: "Modify orders", description: "Approval always required", danger: true },
  { group: "execution", key: "closePosition", label: "Close positions", description: "Approval always required", danger: true },
  { group: "execution", key: "cancelOrder", label: "Cancel orders", description: "Approval always required", danger: true },
  { group: "external", key: "tradingviewMcp", label: "TradingView MCP" },
  { group: "external", key: "telegram", label: "Telegram" },
  { group: "external", key: "discord", label: "Discord" },
];

export function PermissionsPanel({
  candelId,
  onChanged,
}: {
  candelId: string;
  onChanged?: (permissions: CandelPermissions) => void;
}) {
  const [permissions, setPermissions] = useState<CandelPermissions | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.permissions(candelId);
        if (!cancelled) {
          setPermissions(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  function toggle(toggleDef: PermissionToggle) {
    setSaved(false);
    setPermissions((prev) => {
      if (!prev) return prev;
      const group = prev[toggleDef.group] as Record<string, boolean>;
      return { ...prev, [toggleDef.group]: { ...group, [toggleDef.key]: !group[toggleDef.key] } };
    });
  }

  async function save() {
    if (!permissions) return;
    setSaving(true);
    setError("");
    try {
      const next = await candelApi.savePermissions(candelId, permissions);
      setPermissions(next);
      setSaved(true);
      onChanged?.(next);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const executionEnabled = !!permissions && Object.values(permissions.execution).some(Boolean);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<ShieldCheck className="size-4" />}
        title="Permissions"
        description="What this Candel is allowed to touch. Execution stays off until you turn it on here."
        action={
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={saving || !permissions}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            {saved ? "Saved" : "Save"}
          </Button>
        }
      />

      <PanelBody data={permissions} error={error}>
        {permissions ? (
          <div className="space-y-4">
            {(["workspace", "market", "tradingAccount", "execution", "external"] as const).map(
              (group) => (
                <div key={group} className="rounded-lg border border-border">
                  <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                    {group === "tradingAccount" ? "Trading account" : group}
                  </div>
                  <div className="grid gap-1 p-2 sm:grid-cols-2">
                    {PERMISSION_TOGGLES.filter((t) => t.group === group).map((toggleDef) => {
                      const groupValues = permissions[toggleDef.group] as Record<string, boolean>;
                      const enabled = Boolean(groupValues[toggleDef.key]);
                      return (
                        <label
                          key={`${toggleDef.group}-${toggleDef.key}`}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={() => toggle(toggleDef)}
                            className={`size-3.5 ${toggleDef.danger ? "accent-destructive" : "accent-primary"}`}
                          />
                          <span
                            className={enabled && toggleDef.danger ? "text-destructive" : "text-foreground"}
                          >
                            {toggleDef.label}
                          </span>
                          {toggleDef.description ? (
                            <span className="ml-auto text-xs text-muted-foreground">
                              {toggleDef.description}
                            </span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            {executionEnabled ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Execution is enabled. Every order still requires your explicit approval and a bound account —
                nothing is ever submitted automatically.
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                Execution is off. This Candel can read and advise, but cannot trade.
              </p>
            )}
          </div>
        ) : null}
      </PanelBody>
    </div>
  );
}

// ─── Automations ────────────────────────────────────────────────────────────

export function AutomationsPanel({ candelId }: { candelId: string }) {
  const [automations, setAutomations] = useState<CandelAutomation[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"cron" | "event">("cron");
  const [schedule, setSchedule] = useState("0 8 * * 1-5");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.automations(candelId);
        if (!cancelled) {
          setAutomations(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  async function create() {
    if (!name.trim() || !schedule.trim()) return;
    setSaving(true);
    setError("");
    try {
      const automation = await candelApi.createAutomation(candelId, {
        name: name.trim(),
        type,
        schedule: schedule.trim(),
      });
      setAutomations((prev) => [...(prev ?? []), automation]);
      setName("");
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(automationId: string) {
    try {
      await candelApi.deleteAutomation(candelId, automationId);
      setAutomations((prev) => (prev ?? []).filter((a) => a.id !== automationId));
    } catch (err) {
      setError(candelErrorMessage(err));
    }
  }

  const list = automations ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<GitBranch className="size-4" />}
        title="Automations"
        description="Scheduled or event-driven prompts for this Candel."
      />
      <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto_1fr_auto]">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name (e.g. Morning briefing)"
        />
        <Select value={type} onChange={(event) => setType(event.target.value as "cron" | "event")}>
          <option value="cron">Schedule</option>
          <option value="event">Event</option>
        </Select>
        <Input
          value={schedule}
          onChange={(event) => setSchedule(event.target.value)}
          placeholder={type === "cron" ? "0 8 * * 1-5" : "signal.created"}
        />
        <Button
          type="button"
          onClick={() => void create()}
          disabled={saving || !name.trim() || !schedule.trim()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </div>
      <PanelBody
        data={automations}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<GitBranch className="size-4" />}
            title="No automations"
            description="Schedule this Candel to run a prompt, or trigger it when an event fires."
          />
        }
      >
        {list.length === 0 ? null : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((automation) => (
              <li key={automation.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{automation.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {automation.trigger.kind === "cron"
                      ? `cron ${automation.trigger.cron ?? ""}`
                      : `on ${automation.trigger.event ?? ""}`}
                  </p>
                </div>
                <Badge variant={automation.status === "active" ? "success" : "outline"}>
                  {automation.status}
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Delete automation"
                  onClick={() => void remove(automation.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </div>
  );
}

// ─── Account bindings ───────────────────────────────────────────────────────

const CONTEXT_OPTIONS: { id: AccountContext; label: string }[] = [
  { id: "read", label: "Account basics" },
  { id: "read_positions", label: "Positions" },
  { id: "read_orders", label: "Orders" },
  { id: "read_performance", label: "Performance" },
  { id: "read_risk", label: "Risk state" },
  { id: "execute", label: "Execute (approval-gated)" },
];

interface BindingsData {
  bindings: AccountBinding[];
  accounts: BindableAccount[];
}

export function BindingsPanel({ candelId }: { candelId: string }) {
  const [data, setData] = useState<BindingsData | null>(null);
  const [contexts, setContexts] = useState<AccountContext[]>(["read"]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bindings, accounts] = await Promise.all([
          candelApi.bindings(candelId),
          candelApi.bindableAccounts(),
        ]);
        if (!cancelled) {
          setData({ bindings, accounts });
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  const bindings = data?.bindings ?? [];
  const accounts = data?.accounts ?? [];
  const boundIds = new Set(bindings.map((binding) => binding.tradingAccountId));
  const available = accounts.filter((account) => !boundIds.has(account.id));

  async function bind() {
    if (!selectedAccount) return;
    setSaving(true);
    setError("");
    try {
      const binding = await candelApi.bindAccount(candelId, selectedAccount, contexts);
      setData((prev) =>
        prev ? { ...prev, bindings: [...prev.bindings, binding] } : prev
      );
      setSelectedAccount("");
      setContexts(["read"]);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function unbind(accountId: string) {
    try {
      await candelApi.unbindAccount(candelId, accountId);
      setData((prev) =>
        prev
          ? {
              ...prev,
              bindings: prev.bindings.filter((b) => b.tradingAccountId !== accountId),
            }
          : prev
      );
    } catch (err) {
      setError(candelErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Wallet className="size-4" />}
        title="Accounts"
        description="Candels never guess an account — they can only touch accounts you bind here."
      />

      <PanelBody data={data} error={error}>
        <div className="space-y-4">
          {bindings.length === 0 ? (
            <EmptyState
              compact
              icon={<Wallet className="size-4" />}
              title="No accounts bound"
              description="Bind an account to let this Candel read its state — or, with approval, prepare orders for it."
            />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {bindings.map((binding) => (
                <li key={binding.tradingAccountId} className="flex items-center gap-3 px-3 py-2">
                  <Link2 className="size-3.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      {binding.label || binding.accountRef || binding.tradingAccountId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {binding.allowedContexts.join(", ")}
                    </p>
                  </div>
                  {binding.allowedContexts.includes("execute") ? (
                    <Badge variant="warning">execution</Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Unbind account"
                    onClick={() => void unbind(binding.tradingAccountId)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {accounts.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              No connected trading accounts found. Connect one in the terminal first.
            </p>
          ) : available.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Every connected account is already bound to this Candel.
            </p>
          ) : (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <FormField label="Bind an account">
                <Select
                  value={selectedAccount}
                  onChange={(event) => setSelectedAccount(event.target.value)}
                >
                  <option value="">Select an account…</option>
                  {available.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountRef}
                      {account.broker ? ` · ${account.broker}` : ""} · {account.status}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="grid gap-1 sm:grid-cols-2">
                {CONTEXT_OPTIONS.map((option) => {
                  const checked = contexts.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        className={`size-3.5 ${option.id === "execute" ? "accent-destructive" : "accent-primary"}`}
                        onChange={() =>
                          setContexts((prev) =>
                            prev.includes(option.id)
                              ? prev.filter((c) => c !== option.id)
                              : [...prev, option.id]
                          )
                        }
                      />
                      {option.label}
                    </label>
                  );
                })}
              </div>
              <Button type="button" onClick={() => void bind()} disabled={saving || !selectedAccount}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
                Bind account
              </Button>
            </div>
          )}
        </div>
      </PanelBody>
    </div>
  );
}

// ─── Approvals (human-in-the-loop inbox) ────────────────────────────────────

/**
 * The approval inbox. A Candel can only *ask* to touch a live account; this is
 * where the user answers. Pending requests are listed first because they are
 * the only ones that still need something from a human.
 */
export function ApprovalsPanel({
  candelId,
  reloadKey = 0,
  onDecided,
}: {
  candelId: string;
  reloadKey?: number;
  onDecided?: () => void;
}) {
  const [approvals, setApprovals] = useState<CandelApprovalRequest[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.approvals(candelId);
        if (!cancelled) {
          setApprovals(next);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId, reloadKey]);

  async function decide(
    approvalId: string,
    decision: "approved" | "rejected",
    reason: string
  ) {
    setBusyId(approvalId);
    setError("");
    try {
      const updated = await candelApi.decideApproval(candelId, approvalId, decision, reason);
      setApprovals((prev) =>
        (prev ?? []).map((entry) => (entry.id === approvalId ? updated : entry))
      );
      onDecided?.();
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function withdraw(approvalId: string) {
    setBusyId(approvalId);
    setError("");
    try {
      await candelApi.withdrawApproval(candelId, approvalId);
      setApprovals((prev) => (prev ?? []).filter((entry) => entry.id !== approvalId));
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const list = approvals ?? [];
  const pending = list.filter((entry) => isApprovalPending(entry));
  const decided = list.filter((entry) => !isApprovalPending(entry));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<ShieldCheck className="size-4" />}
        title="Approvals"
        description="Live actions a Candel asked permission for. Nothing is submitted without your decision."
        meta={
          pending.length > 0 ? (
            <Badge variant="warning">
              {pending.length} pending
            </Badge>
          ) : null
        }
      />

      <PanelBody
        data={approvals}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<ShieldCheck className="size-4" />}
            title="Nothing needs your approval"
            description="When a Candel wants to place, modify or close a position it will ask here first."
          />
        }
      >
        <div className="space-y-3">
          {pending.map((request) => (
            <ApprovalCard
              key={request.id}
              request={request}
              busy={busyId === request.id}
              onDecide={(id, decision, reason) => void decide(id, decision, reason)}
            />
          ))}

          {decided.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                History
              </p>
              {decided.slice(0, 12).map((request) => (
                <div key={request.id} className="space-y-1">
                  <ApprovalCard
                    request={request}
                    busy={busyId === request.id}
                    onDecide={() => undefined}
                  />
                  {isApprovalExpired(request) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={busyId === request.id}
                      onClick={() => void withdraw(request.id)}
                    >
                      <Trash2 className="size-3" /> Remove expired request
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </PanelBody>
    </div>
  );
}
