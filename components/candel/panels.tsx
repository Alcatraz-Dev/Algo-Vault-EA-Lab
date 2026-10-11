"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowLeft,
  Brain,
  CalendarClock,
  Check,
  FileText,
  GitBranch,
  LayoutGrid,
  Link2,
  ListChecks,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Rows3,
  Search,
  ShieldCheck,
  Trash2,
  Wallet,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import { FormError, FormField } from "@/components/ui/form-field";
import { SectionHeader } from "@/components/ui/section-header";
import { relativeTime, timeAgo } from "@/components/candel/role-visuals";
import { ApprovalCard } from "@/components/candel/ApprovalCard";
import { isApprovalExpired, isApprovalPending } from "@/lib/candel/approvals";
import { CandelApiError, candelApi, candelErrorMessage, type BindableAccount } from "@/lib/candel/client";
import type {
  AccountBinding,
  AccountContext,
  CandelActivity,
  CandelApprovalRequest,
  CandelAutomation,
  CandelJob,
  CandelMemoryEntry,
  CandelPage,
  CandelPermissions,
  CandelProposal,
  CandelToolCall,
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editKind, setEditKind] = useState<CandelMemoryEntry["kind"]>("preference");
  const [savingEdit, setSavingEdit] = useState(false);

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

  function startEdit(entry: CandelMemoryEntry) {
    setEditingId(entry.id);
    setEditText(entry.text);
    setEditKind(entry.kind);
  }

  async function saveEdit() {
    if (!editingId || !editText.trim()) return;
    setSavingEdit(true);
    setError("");
    try {
      const updated = await candelApi.updateMemory(candelId, editingId, {
        text: editText.trim(),
        kind: editKind,
      });
      setEntries((prev) =>
        (prev ?? []).map((entry) => (entry.id === updated.id ? updated : entry))
      );
      setEditingId(null);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSavingEdit(false);
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
            {list.map((entry) => {
              const editing = editingId === entry.id;
              return (
                <li key={entry.id} className="flex items-start gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{editing ? editKind : entry.kind}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {entry.source} · {timeAgo(entry.updatedAt || entry.createdAt)}
                      </span>
                    </div>
                    {editing ? (
                      <div className="mt-1.5 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                        <Input
                          value={editText}
                          autoFocus
                          onChange={(event) => setEditText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveEdit();
                            if (event.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Select
                          value={editKind}
                          onChange={(event) =>
                            setEditKind(event.target.value as CandelMemoryEntry["kind"])
                          }
                        >
                          {MEMORY_KINDS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </Select>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void saveEdit()}
                            disabled={savingEdit || !editText.trim()}
                          >
                            {savingEdit ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-foreground">{entry.text}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Edit memory entry"
                      disabled={editing}
                      onClick={() => startEdit(entry)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Forget entry"
                      onClick={() => void remove(entry.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
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
  const [busyId, setBusyId] = useState<string | null>(null);

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

  /** Pause keeps the rule and its history; only the schedule stops firing. */
  async function toggle(automation: CandelAutomation) {
    const next = automation.status === "active" ? "paused" : "active";
    setBusyId(automation.id);
    setError("");
    try {
      const updated = await candelApi.updateAutomation(candelId, automation.id, next);
      setAutomations((prev) =>
        (prev ?? []).map((entry) => (entry.id === updated.id ? updated : entry))
      );
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusyId(null);
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
            {list.map((automation) => {
              const active = automation.status === "active";
              const busy = busyId === automation.id;
              return (
                <li key={automation.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                  <div className="min-w-40 flex-1">
                    <p className="truncate text-sm text-foreground">{automation.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {automation.trigger.kind === "cron"
                        ? `cron ${automation.trigger.cron ?? ""}`
                        : `on ${automation.trigger.event ?? ""}`}
                      {automation.updatedAt ? ` · updated ${timeAgo(automation.updatedAt)}` : ""}
                    </p>
                  </div>
                  <Badge variant={active ? "success" : "outline"}>{automation.status}</Badge>
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => void toggle(automation)}
                    >
                      {busy ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : active ? (
                        <Pause className="size-3" />
                      ) : (
                        <Play className="size-3" />
                      )}
                      {active ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete automation"
                      onClick={() => void remove(automation.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
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

// ─── Workspace pages ────────────────────────────────────────────────────────

/** Compact, safe preview of a JSON-ish value (arguments, payloads, results). */
function summarize(value: unknown, max = 140): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value);
  }
}

const TEXTAREA_CLASS =
  "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30";

/** Editor draft: the title, body and revision the editor opened from, as one
 *  unit. They must move together — a save with a fresh title and a stale
 *  revision is exactly the write the server is supposed to refuse. */
interface PageDraft {
  id: string;
  title: string;
  content: string;
  baseRevision: number;
}

const AUTOSAVE_DELAY_MS = 900;

/**
 * Workspace pages — the notes, research and plans a Candel keeps, laid out the
 * way OpenDots treats Spaces: a searchable library (list or grid) that opens
 * into a focused editor which autosaves as you write.
 *
 * Saves are revision-checked. If the stored page moved on while the editor was
 * open (an agent saved over it, or another tab did) the write is refused and we
 * stop autosaving rather than retry blindly — a retry loop would either lose
 * the newer revision or spin forever, so the user resolves it explicitly.
 */
export function WorkspacePanel({ candelId }: { candelId: string }) {
  const [pages, setPages] = useState<CandelPage[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [draft, setDraft] = useState<PageDraft | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [conflict, setConflict] = useState(false);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const next = await candelApi.workspacePages(candelId);
    setPages(next);
    return next;
  }, [candelId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.workspacePages(candelId);
        if (cancelled) return;
        setPages(next);
        setError("");
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  const stored = draft ? (pages ?? []).find((page) => page.id === draft.id) ?? null : null;
  const dirty =
    draft !== null &&
    stored !== null &&
    (draft.title !== stored.title || draft.content !== stored.content);

  /**
   * Write one draft snapshot. Returns nothing: the caller decides how to react,
   * and a failure always leaves the draft intact so nothing is lost.
   */
  const commitDraft = useCallback(
    async (snapshot: PageDraft) => {
      setSaveState("saving");
      try {
        const updated = await candelApi.updateWorkspacePage(candelId, snapshot.id, {
          title: snapshot.title,
          content: snapshot.content,
          baseRevision: snapshot.baseRevision,
        });
        setPages((prev) =>
          (prev ?? []).map((page) => (page.id === updated.id ? updated : page))
        );
        setDraft((current) =>
          current && current.id === updated.id
            ? { ...current, baseRevision: updated.revision }
            : current
        );
        setSavedAt(Date.now());
        setSaveState("saved");
        setError("");
      } catch (err) {
        setSaveState("error");
        if (err instanceof CandelApiError && err.status === 409) {
          setConflict(true);
          setError(
            "This page changed while you were editing it. The newer revision is loaded — choose which version to keep."
          );
          try {
            await reload();
          } catch {
            // the conflict banner already explains the state
          }
        } else {
          setError(candelErrorMessage(err));
        }
      }
    },
    [candelId, reload]
  );

  // Autosave: debounce the draft, then write it with the revision it was built
  // on. A conflict pauses autosave so this never becomes a retry loop.
  useEffect(() => {
    if (!draft || !stored || conflict) return;
    if (draft.title === stored.title && draft.content === stored.content) return;
    const snapshot = draft;
    const handle = window.setTimeout(() => void commitDraft(snapshot), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [draft, stored, conflict, commitDraft]);

  async function createPage() {
    setCreating(true);
    setError("");
    try {
      const page = await candelApi.createWorkspacePage(candelId, {
        title: "Untitled page",
        content: "",
      });
      setPages((prev) => [...(prev ?? []), page]);
      setDraft({
        id: page.id,
        title: page.title,
        content: page.content,
        baseRevision: page.revision,
      });
      setSaveState("idle");
      setSavedAt(null);
      setConflict(false);
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function remove(pageId: string) {
    try {
      await candelApi.deleteWorkspacePage(candelId, pageId);
      setPages((prev) => (prev ?? []).filter((page) => page.id !== pageId));
      if (draft?.id === pageId) setDraft(null);
    } catch (err) {
      setError(candelErrorMessage(err));
    }
  }

  function openPage(page: CandelPage) {
    setDraft({
      id: page.id,
      title: page.title,
      content: page.content,
      baseRevision: page.revision,
    });
    setSaveState("idle");
    setSavedAt(null);
    setConflict(false);
    setError("");
  }

  /** Accept the newer server revision as the base while keeping local text. */
  function keepMine() {
    if (!stored) return;
    setConflict(false);
    setDraft((current) =>
      current ? { ...current, baseRevision: stored.revision } : current
    );
  }

  function useTheirs() {
    if (!stored) return;
    setConflict(false);
    setError("");
    setDraft({
      id: stored.id,
      title: stored.title,
      content: stored.content,
      baseRevision: stored.revision,
    });
    setSaveState("idle");
  }

  const list = pages ?? [];
  const needle = query.trim().toLowerCase();
  const visible = [...list]
    .filter((page) =>
      needle ? `${page.title} ${page.content}`.toLowerCase().includes(needle) : true
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // ── Focused editor ───────────────────────────────────────────────────────
  if (draft) {
    const status = conflict
      ? { label: "Needs your decision", tone: "text-warning" }
      : saveState === "saving"
        ? { label: "Saving…", tone: "text-muted-foreground" }
        : saveState === "saved"
          ? { label: `Saved ${timeAgo(savedAt ?? undefined)}`, tone: "text-muted-foreground" }
          : saveState === "error"
            ? { label: "Draft kept — not saved", tone: "text-destructive" }
            : dirty
              ? { label: "Unsaved changes", tone: "text-warning" }
              : { label: "Autosave on", tone: "text-muted-foreground" };

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
            <ArrowLeft className="size-3.5" /> All pages
          </Button>
          <Badge variant="outline">rev {draft.baseRevision}</Badge>
          <span className={`text-xs ${status.tone}`}>{status.label}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Delete page"
              onClick={() => void remove(draft.id)}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </div>

        {error ? <FormError>{error}</FormError> : null}

        {conflict ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="min-w-40 flex-1">
              Another revision of this page exists. Keep your text, or load the other one.
            </span>
            <Button type="button" size="xs" variant="outline" onClick={keepMine}>
              Keep my version
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={useTheirs}>
              Use newer revision
            </Button>
          </div>
        ) : null}

        <div className="space-y-3 rounded-lg border border-border p-3">
          <Input
            value={draft.title}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, title: event.target.value } : current
              )
            }
            placeholder="Page title"
            aria-label="Page title"
            className="border-transparent bg-transparent font-heading text-base font-semibold shadow-none"
          />
          <textarea
            value={draft.content}
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, content: event.target.value } : current
              )
            }
            placeholder="What should this page hold? Markdown is fine."
            aria-label="Page content"
            spellCheck={false}
            className={`${TEXTAREA_CLASS} min-h-[40vh] font-mono text-xs leading-relaxed`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void commitDraft(draft)}
              disabled={saveState === "saving"}
            >
              {saveState === "saving" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Save now
            </Button>
            <span className="text-xs text-muted-foreground">
              Markdown source. Saves carry the revision they were written against.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Library ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<FileText className="size-4" />}
        title="Workspace"
        description="Notes, research and plans this Candel keeps between conversations."
        meta={<span className="text-xs text-muted-foreground">{list.length} pages</span>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="pl-8"
          />
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <Button
            type="button"
            variant={view === "list" ? "secondary" : "ghost"}
            size="icon-xs"
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <Rows3 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant={view === "grid" ? "secondary" : "ghost"}
            size="icon-xs"
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <LayoutGrid className="size-3.5" />
          </Button>
        </div>
        <Button type="button" size="sm" onClick={() => void createPage()} disabled={creating}>
          {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          New page
        </Button>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <PanelBody
        data={pages}
        error=""
        empty={
          <EmptyState
            compact
            icon={<FileText className="size-4" />}
            title="No workspace pages"
            description="Create a page, or let this Candel save research here as it works."
            action={
              <Button type="button" size="sm" onClick={() => void createPage()} disabled={creating}>
                <Plus className="size-3.5" /> New page
              </Button>
            }
          />
        }
      >
        {visible.length === 0 ? (
          <EmptyState
            compact
            icon={<Search className="size-4" />}
            title="No pages match that search"
            description="Try a shorter term — titles and page content are both searched."
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : view === "grid" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((page) => (
              <Card key={page.id} className="h-full">
                <CardContent className="flex h-full flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openPage(page)}
                    >
                      <p className="truncate text-sm font-medium text-foreground">{page.title}</p>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${page.title}`}
                      onClick={() => void remove(page.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="min-h-8 flex-1 text-left"
                    onClick={() => openPage(page)}
                  >
                    <p className="line-clamp-3 text-xs text-muted-foreground">
                      {page.content.trim() || "Empty page"}
                    </p>
                  </button>
                  <p className="text-xs text-muted-foreground">
                    rev {page.revision} · {timeAgo(page.updatedAt)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {visible.map((page) => (
              <li key={page.id} className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => openPage(page)}
                >
                  <p className="truncate text-sm text-foreground">{page.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    rev {page.revision} · updated {timeAgo(page.updatedAt)}
                    {page.content.trim() ? ` · ${page.content.trim().slice(0, 60)}` : ""}
                  </p>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete ${page.title}`}
                  onClick={() => void remove(page.id)}
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

// ─── Proposals ──────────────────────────────────────────────────────────────

const PROPOSAL_STATUS_VARIANT: Record<
  CandelProposal["status"],
  "warning" | "success" | "destructive" | "default" | "outline"
> = {
  pending: "warning",
  approved: "success",
  executing: "default",
  executed: "success",
  rejected: "destructive",
  failed: "destructive",
  blocked: "destructive",
};

const RISK_VARIANT: Record<CandelProposal["riskLevel"], "outline" | "warning" | "destructive"> = {
  read_only: "outline",
  low_risk: "outline",
  user_confirmation: "warning",
  high_risk: "warning",
  live_trading: "destructive",
};

/**
 * Proposals — the intents a Candel recorded for this user. Read-only: a
 * proposal becomes an approval request (see the Approvals inbox) before any
 * live action can happen.
 */
export function ProposalsPanel({
  candelId,
  reloadKey = 0,
}: {
  candelId: string;
  reloadKey?: number;
}) {
  const [proposals, setProposals] = useState<CandelProposal[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.proposals(candelId);
        if (!cancelled) {
          setProposals(next);
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

  const list = proposals ?? [];
  const ordered = [...list].sort((a, b) => b.proposedAt - a.proposedAt);

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<ListChecks className="size-4" />}
        title="Proposals"
        description="Intents this Candel prepared. Nothing here has touched an account."
        meta={<span className="text-xs text-muted-foreground">{list.length} total</span>}
      />
      <PanelBody
        data={proposals}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<ListChecks className="size-4" />}
            title="No proposals yet"
            description="When this Candel prepares a setup or an order intent it will be recorded here."
          />
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ordered.map((proposal) => (
            <li key={proposal.id} className="space-y-1.5 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">{proposal.type}</span>
                <Badge variant={PROPOSAL_STATUS_VARIANT[proposal.status]}>{proposal.status}</Badge>
                <Badge variant={RISK_VARIANT[proposal.riskLevel]}>{proposal.riskLevel}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {timeAgo(proposal.proposedAt)}
                </span>
              </div>
              {proposal.reason ? (
                <p className="text-xs text-muted-foreground">{proposal.reason}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {proposal.contextSymbol ? (
                  <span>
                    {proposal.contextSymbol}
                    {proposal.contextTimeframe ? ` · ${proposal.contextTimeframe}` : ""}
                  </span>
                ) : null}
                <span title="Self-reported by the Candel when it prepared this proposal — not a measured success rate.">model confidence {(proposal.confidence * 100).toFixed(0)}%</span>
                <span className="truncate">{summarize(proposal.payload)}</span>
              </div>
            </li>
          ))}
        </ul>
      </PanelBody>
    </div>
  );
}

// ─── Background jobs ────────────────────────────────────────────────────────

const JOB_STATUS_VARIANT: Record<CandelJob["status"], "outline" | "default" | "success" | "destructive"> = {
  queued: "outline",
  running: "default",
  completed: "success",
  failed: "destructive",
  cancelled: "outline",
};

/**
 * Background jobs — scheduled work registered for this Candel. Creating a job
 * only enqueues it; the runner is a separate, server-side concern.
 */
export function JobsPanel({ candelId }: { candelId: string }) {
  const [jobs, setJobs] = useState<CandelJob[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [cron, setCron] = useState("0 8 * * 1-5");
  const [action, setAction] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.jobs(candelId);
        if (!cancelled) {
          setJobs(next);
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
    if (!name.trim() || !cron.trim() || !action.trim()) return;
    setSaving(true);
    setError("");
    try {
      const job = await candelApi.createJob(candelId, {
        name: name.trim(),
        cron: cron.trim(),
        action: action.trim(),
      });
      setJobs((prev) => [...(prev ?? []), job]);
      setName("");
      setAction("");
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function cancel(jobId: string) {
    try {
      await candelApi.deleteJob(candelId, jobId);
      setJobs((prev) => (prev ?? []).filter((job) => job.id !== jobId));
    } catch (err) {
      setError(candelErrorMessage(err));
    }
  }

  /** Pausing a job keeps its run history and stops it being scheduled. */
  async function toggle(job: CandelJob) {
    setBusyId(job.id);
    setError("");
    try {
      const updated = await candelApi.updateJob(candelId, job.id, !job.enabled);
      setJobs((prev) => (prev ?? []).map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch (err) {
      setError(candelErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const list = jobs ?? [];

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<CalendarClock className="size-4" />}
        title="Background jobs"
        description="Work this Candel runs on a schedule, without you asking each time."
        meta={<span className="text-xs text-muted-foreground">{list.length} registered</span>}
      />

      <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_0.8fr_1fr_auto]">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Job name"
        />
        <Input
          value={cron}
          onChange={(event) => setCron(event.target.value)}
          placeholder="0 8 * * 1-5"
        />
        <Input
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder="Action / prompt to run"
        />
        <Button
          type="button"
          onClick={() => void create()}
          disabled={saving || !name.trim() || !cron.trim() || !action.trim()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Schedule
        </Button>
      </div>

      <PanelBody
        data={jobs}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<CalendarClock className="size-4" />}
            title="No background jobs"
            description="Schedule this Candel to run a prompt later — e.g. a morning market brief."
          />
        }
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <div className="min-w-40 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-numeric text-sm text-foreground">{job.spec}</span>
                  <Badge variant={JOB_STATUS_VARIANT[job.status]}>{job.status}</Badge>
                  {!job.enabled ? <Badge variant="outline">paused</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {job.lastRunAt ? `last ${timeAgo(job.lastRunAt)} · ` : "never run · "}
                  {job.enabled && job.nextRunAt
                    ? `next ${relativeTime(job.nextRunAt)}`
                    : "not scheduled"}
                  {job.error ? ` · ${job.error}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={busyId === job.id}
                  onClick={() => void toggle(job)}
                >
                  {busyId === job.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : job.enabled ? (
                    <Pause className="size-3" />
                  ) : (
                    <Play className="size-3" />
                  )}
                  {job.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Cancel job"
                  onClick={() => void cancel(job.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </PanelBody>
    </div>
  );
}

// ─── Tool calls ─────────────────────────────────────────────────────────────

const TOOL_STATUS_VARIANT: Record<
  CandelToolCall["status"],
  "outline" | "default" | "success" | "destructive"
> = {
  pending: "outline",
  running: "default",
  completed: "success",
  failed: "destructive",
  blocked: "destructive",
};

/**
 * Tool calls — the audit of every tool a Candel invoked. Read-only: the server
 * records these, the panel just proves what a Candel actually did.
 */
export function ToolCallsPanel({
  candelId,
  reloadKey = 0,
}: {
  candelId: string;
  reloadKey?: number;
}) {
  const [calls, setCalls] = useState<CandelToolCall[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await candelApi.toolCalls(candelId);
        if (!cancelled) {
          setCalls(next);
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

  const list = calls ?? [];
  const ordered = [...list].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Wrench className="size-4" />}
        title="Tool calls"
        description="Every tool this Candel invoked, with its permission check and result."
        meta={<span className="text-xs text-muted-foreground">{list.length} recorded</span>}
      />
      <PanelBody
        data={calls}
        error={error}
        empty={
          <EmptyState
            compact
            icon={<Wrench className="size-4" />}
            title="No tool calls yet"
            description="When this Candel reaches for market data, memory or an account, the call is recorded here."
          />
        }
      >
        <ol className="relative space-y-3 border-l border-border pl-4">
          {ordered.map((call) => (
            <li key={call.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-1.5 rounded-full bg-muted-foreground" />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-foreground">{call.toolName}</span>
                <Badge variant={TOOL_STATUS_VARIANT[call.status]}>{call.status}</Badge>
                {call.permissionChecked ? (
                  <Badge variant="outline">permission checked</Badge>
                ) : (
                  <Badge variant="warning">unchecked</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {timeAgo(call.startedAt)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {summarize(call.arguments)}
              </p>
              {call.error ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{call.error}</p>
              ) : call.result !== undefined ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {summarize(call.result)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </PanelBody>
    </div>
  );
}
