"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Loader2,
  MessageSquarePlus,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-field";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelAvatar, timeAgo } from "@/components/candel/role-visuals";
import { ApprovalCard } from "@/components/candel/ApprovalCard";
import { isApprovalPending } from "@/lib/candel/approvals";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { getCandelRole } from "@/lib/candel/roles";
import { cn } from "@/lib/utils";
import type { CandelApprovalRequest, CandelConversation, CandelMessage } from "@/lib/candel/types";

interface ChatState {
  conversations: CandelConversation[];
  messages: Record<string, CandelMessage[]>;
}

/**
 * The interactive half of a Candel: one continuous conversation with the
 * specialist's identity pinned above it, a thread rail, and the composer at the
 * bottom. Every turn goes through `POST /conversation/message`, which runs the
 * agent server-side under the Candel's effective config — nothing here can
 * widen what the agent may do.
 *
 * Layout note: the whole component is a flex column that fills whatever height
 * its parent gives it (`h-full min-h-0`). It never measures the viewport, so it
 * behaves the same inside the studio tab, a drawer, or a full-screen shell.
 */
export function CandelChat({
  candelId,
  candelName,
  role,
  avatar,
  disabled = false,
  onTurnComplete,
}: {
  candelId: string;
  candelName: string;
  role?: string;
  avatar?: string;
  disabled?: boolean;
  onTurnComplete?: () => void;
}) {
  const [state, setState] = useState<ChatState | null>(null);
  const [approvals, setApprovals] = useState<CandelApprovalRequest[]>([]);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  /** Thread rail is a drawer below `lg`, where the rail cannot be a column. */
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ conversations, messagesByConversation }, approvalList] = await Promise.all([
          candelApi.conversations(candelId, { includeMessages: true }),
          candelApi.approvals(candelId),
        ]);
        if (cancelled) return;
        setState({ conversations, messages: messagesByConversation });
        setApprovals(approvalList);
        setError("");
        setActiveId(conversations.length > 0 ? conversations[conversations.length - 1].id : null);
      } catch (err) {
        if (!cancelled) setError(candelErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candelId]);

  /** Pending requests raised in this Candel, oldest first. */
  const pendingApprovals = useMemo(
    () =>
      approvals
        .filter((request) => isApprovalPending(request))
        .sort((a, b) => a.createdAt - b.createdAt),
    [approvals]
  );

  const handleDecide = useCallback(
    async (approvalId: string, decision: "approved" | "rejected", reason: string) => {
      setDecidingId(approvalId);
      try {
        const updated = await candelApi.decideApproval(candelId, approvalId, decision, reason);
        setApprovals((prev) => prev.map((entry) => (entry.id === approvalId ? updated : entry)));
        onTurnComplete?.();
      } catch (err) {
        setError(candelErrorMessage(err));
      } finally {
        setDecidingId(null);
      }
    },
    [candelId, onTurnComplete]
  );

  const activeMessages = activeId ? state?.messages[activeId] ?? [] : [];
  const conversations = state?.conversations ?? [];

  // Keep the newest turn in view without stealing focus from the composer.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activeMessages.length, activeId, sending]);

  // The composer grows with the text up to a fixed ceiling, then scrolls, so a
  // long prompt stays readable on a phone instead of hiding behind a 2-row box.
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 160)}px`;
  }, [input]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || sending || disabled) return;

      setSending(true);
      setError("");
      setInput("");
      setThreadsOpen(false);

      // Optimistic echo so the thread reacts immediately.
      const pendingId = `pending-${Date.now()}`;
      const pending: CandelMessage = {
        id: pendingId,
        candelId,
        conversationId: activeId ?? "pending",
        userId: "",
        role: "user",
        content,
        status: "pending",
        createdAt: Date.now(),
      };

      if (activeId) {
        setState((prev) =>
          prev
            ? {
                ...prev,
                messages: { ...prev.messages, [activeId]: [...(prev.messages[activeId] ?? []), pending] },
              }
            : prev
        );
      }

      try {
        const result = await candelApi.sendMessage({
          candelId,
          content,
          conversationId: activeId ?? undefined,
        });
        const conversationId = result.conversation.id;
        setState((prev) => {
          const base: ChatState = prev ?? { conversations: [], messages: {} };
          const existing = (base.messages[conversationId] ?? []).filter((m) => m.id !== pendingId);
          const conversations = base.conversations.some((c) => c.id === conversationId)
            ? base.conversations.map((c) => (c.id === conversationId ? result.conversation : c))
            : [...base.conversations, result.conversation];
          return {
            conversations,
            messages: { ...base.messages, [conversationId]: [...existing, ...result.messages] },
          };
        });
        if (result.approvals && result.approvals.length > 0) {
          setApprovals((prev) => [...prev, ...result.approvals!]);
        }
        setActiveId(conversationId);
        onTurnComplete?.();
      } catch (err) {
        setError(candelErrorMessage(err));
        setInput(content);
        // A turn can fail *after* the server stored the user message (for
        // example when the Candel's template is missing), so dropping the
        // optimistic echo left the transcript disagreeing with the store until
        // a reload. Re-read the thread instead of guessing what was written.
        try {
          const { conversations, messagesByConversation } = await candelApi.conversations(
            candelId,
            { includeMessages: true },
          );
          setState({ conversations, messages: messagesByConversation });
          setActiveId((current) =>
            current && conversations.some((c) => c.id === current)
              ? current
              : conversations.length > 0
                ? conversations[conversations.length - 1].id
                : null
          );
        } catch {
          // Keep the current thread on screen if the refresh itself fails;
          // the composer error already tells the user what went wrong.
          setState((prev) => {
            if (!prev || !activeId) return prev;
            return {
              ...prev,
              messages: {
                ...prev.messages,
                [activeId]: (prev.messages[activeId] ?? []).filter((m) => m.id !== pendingId),
              },
            };
          });
        }
      } finally {
        setSending(false);
      }
    },
    [activeId, candelId, disabled, input, onTurnComplete, sending]
  );

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await candelApi.deleteConversation(candelId, conversationId);
        setState((prev) => {
          if (!prev) return prev;
          const messages = { ...prev.messages };
          delete messages[conversationId];
          return {
            conversations: prev.conversations.filter((c) => c.id !== conversationId),
            messages,
          };
        });
        setActiveId((current) => (current === conversationId ? null : current));
        setConfirmDeleteId(null);
      } catch (err) {
        setError(candelErrorMessage(err));
      }
    },
    [candelId]
  );

  const spec = getCandelRole(role);
  const starters = spec.skills.slice(0, 4).map((skill) => `${skill}: what stands out right now?`);

  const statusLine = disabled
    ? "Paused — resume this Candel to keep working"
    : sending
      ? "Working on your request…"
      : activeMessages.length > 0
        ? `Last turn ${timeAgo(activeMessages[activeMessages.length - 1]?.createdAt)}`
        : spec.tagline;

  /** Thread rail content — shared by the desktop column and the mobile drawer. */
  const threadList = (
    <>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-micro font-medium uppercase tracking-wider text-muted-foreground">
          Threads
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="New conversation"
          onClick={() => {
            setActiveId(null);
            setInput("");
            setThreadsOpen(false);
            setError("");
          }}
        >
          <MessageSquarePlus />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No threads yet. Your first message starts one.
          </p>
        ) : (
          [...conversations]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((conversation) => {
              const active = conversation.id === activeId;
              const confirming = confirmDeleteId === conversation.id;
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-1.5",
                    active ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      setActiveId(conversation.id);
                      setThreadsOpen(false);
                      setConfirmDeleteId(null);
                    }}
                  >
                    <span className="block truncate text-xs">{conversation.title || "Untitled"}</span>
                    <span className="block text-micro text-muted-foreground">
                      {timeAgo(conversation.updatedAt)}
                    </span>
                  </button>
                  {confirming ? (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        aria-label="Confirm delete conversation"
                        className="rounded p-1 text-destructive hover:bg-destructive/10"
                        onClick={() => void handleDeleteConversation(conversation.id)}
                      >
                        <Check className="size-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel delete conversation"
                        className="rounded p-1 text-muted-foreground hover:bg-muted"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete ${conversation.title || "conversation"}`}
                      className="shrink-0 rounded p-1 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => setConfirmDeleteId(conversation.id)}
                    >
                      <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  )}
                </div>
              );
            })
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Thread rail — a column only where there is room for one. */}
      <aside className="hidden w-56 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card lg:flex">
        {threadList}
      </aside>

      {/* Below `lg` the rail becomes a drawer, so threads stay reachable. */}
      {threadsOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-background/70"
            role="presentation"
            onClick={() => setThreadsOpen(false)}
          />
          <div className="relative ml-0 flex h-full w-72 max-w-[85%] flex-col border-r border-border bg-popover shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-medium text-foreground">Conversations</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close conversations"
                onClick={() => setThreadsOpen(false)}
              >
                <X />
              </Button>
            </div>
            {threadList}
          </div>
        </div>
      ) : null}

      {/* Conversation */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <header className="flex items-center gap-2.5 border-b border-border px-3 py-2">
          <CandelAvatar role={role} avatar={avatar} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{candelName}</p>
            <p
              className={cn(
                "truncate text-micro",
                sending ? "text-primary" : "text-muted-foreground"
              )}
            >
              {statusLine}
            </p>
          </div>
          {sending ? <Loader2 className="size-3.5 animate-spin text-primary" /> : null}
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="lg:hidden"
            aria-expanded={threadsOpen}
            onClick={() => setThreadsOpen(true)}
          >
            <MessageSquarePlus className="size-3" />
            Threads
            {conversations.length > 0 ? (
              <span className="font-numeric text-muted-foreground">{conversations.length}</span>
            ) : null}
          </Button>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {state === null ? (
            <LoadingState label="Loading conversation" rows={3} />
          ) : activeMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <EmptyState compact icon={<Sparkles className="size-4" />} title={`Talk to ${candelName}`} description={spec.tagline} />
              <div className="flex flex-wrap justify-center gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    disabled={disabled || sending}
                    onClick={() => void handleSend(starter)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            activeMessages.map((message) => {
              const mine = message.role === "user";
              return (
                <div key={message.id} className={cn("flex gap-2.5", mine ? "justify-end" : "")}>
                  {!mine ? <CandelAvatar role={role} avatar={avatar} size="sm" /> : null}
                  <div className={cn("min-w-0 max-w-[85%] sm:max-w-[80%]", mine && "text-right")}>
                    <div
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left",
                        mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                        message.status === "pending" && "opacity-60"
                      )}
                    >
                      {message.content}
                    </div>
                    <p className="mt-1 text-micro text-muted-foreground">
                      {mine ? "You" : candelName} · {timeAgo(message.createdAt)}
                      {message.status === "pending" ? " · sending" : ""}
                    </p>
                  </div>
                </div>
              );
            })
          )}

          {sending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CandelAvatar role={role} avatar={avatar} size="sm" />
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin text-primary" /> {candelName} is working…
              </span>
            </div>
          ) : null}

          {pendingApprovals.length > 0 ? (
            <div className="space-y-2 pt-1">
              <p className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-wider text-warning">
                <ShieldCheck className="size-3.5" /> Waiting on you
              </p>
              {pendingApprovals.map((request) => (
                <ApprovalCard
                  key={request.id}
                  request={request}
                  busy={decidingId === request.id}
                  onDecide={(id, decision, reason) => void handleDecide(id, decision, reason)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="border-t border-border p-3">
          {error ? (
            <div className="mb-2">
              <FormError>{error}</FormError>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              ref={composerRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={1}
              disabled={disabled || sending}
              aria-label={`Message ${candelName}`}
              placeholder={
                disabled ? "This Candel is paused — resume it to chat." : `Message ${candelName}…`
              }
              className="min-h-10 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
            />
            <Button
              type="button"
              size="icon"
              aria-label="Send message"
              disabled={disabled || sending || !input.trim()}
              onClick={() => void handleSend()}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
          <p className="mt-1.5 hidden text-micro text-muted-foreground sm:block">
            Enter sends · Shift+Enter adds a line
          </p>
        </div>
      </div>
    </div>
  );
}
