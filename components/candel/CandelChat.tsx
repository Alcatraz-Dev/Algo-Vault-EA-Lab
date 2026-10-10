"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquarePlus, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormError } from "@/components/ui/form-field";
import { LoadingState } from "@/components/ui/loading-state";
import { CandelAvatar, timeAgo } from "@/components/candel/role-visuals";
import { ApprovalCard } from "@/components/candel/ApprovalCard";
import { isApprovalPending } from "@/lib/candel/approvals";
import { candelApi, candelErrorMessage } from "@/lib/candel/client";
import { getCandelRole } from "@/lib/candel/roles";
import type { CandelApprovalRequest, CandelConversation, CandelMessage } from "@/lib/candel/types";

interface ChatState {
  conversations: CandelConversation[];
  messages: Record<string, CandelMessage[]>;
}

/**
 * The interactive half of a Candel: conversation list, message thread and
 * composer. Every turn goes through `POST /conversation/message`, which runs the
 * agent server-side under the Candel's effective config.
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
  const scrollRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activeMessages.length, activeId, sending]);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || sending || disabled) return;

      setSending(true);
      setError("");
      setInput("");

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
        setInput(content);
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
      } catch (err) {
        setError(candelErrorMessage(err));
      }
    },
    [candelId]
  );

  const spec = getCandelRole(role);
  const starters = spec.skills.map((skill) => `Help me with ${skill.toLowerCase()}.`);
  const conversations = state?.conversations ?? [];

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Conversations */}
      <div className="hidden w-52 shrink-0 flex-col rounded-lg border border-border bg-card md:flex">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Threads</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="New conversation"
            onClick={() => {
              setActiveId(null);
              setInput("");
            }}
          >
            <MessageSquarePlus />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No threads yet.</p>
          ) : (
            conversations
              .slice()
              .reverse()
              .map((conversation) => (
                <div
                  key={conversation.id}
                  className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${
                    conversation.id === activeId ? "bg-accent/15 text-foreground" : "hover:bg-muted/60"
                  }`}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left"
                    onClick={() => setActiveId(conversation.id)}
                  >
                    <span className="block truncate">{conversation.title || "Untitled"}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {timeAgo(conversation.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    className="opacity-0 transition group-hover:opacity-100"
                    onClick={() => void handleDeleteConversation(conversation.id)}
                  >
                    <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {state === null ? (
            <LoadingState label="Loading conversation" rows={3} />
          ) : activeMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <EmptyState
                compact
                icon={<Sparkles className="size-4" />}
                title={`Talk to ${candelName}`}
                description={spec.tagline}
              />
              <div className="flex flex-wrap justify-center gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void handleSend(starter)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/25 hover:text-foreground"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            activeMessages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-2.5 ${message.role === "user" ? "justify-end" : ""}`}
              >
                {message.role !== "user" ? (
                  <CandelAvatar role={role} avatar={avatar} size="sm" />
                ) : null}
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  } ${message.status === "pending" ? "opacity-60" : ""}`}
                >
                  {message.content}
                </div>
              </div>
            ))
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CandelAvatar role={role} avatar={avatar} size="sm" />
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> {candelName} is thinking…
              </span>
            </div>
          ) : null}

          {pendingApprovals.length > 0 ? (
            <div className="space-y-2 pt-1">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-warning">
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
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={2}
              disabled={disabled || sending}
              placeholder={
                disabled
                  ? "This Candel is paused — resume it to chat."
                  : `Message ${candelName}…  (Enter to send, Shift+Enter for a new line)`
              }
              className="min-h-11 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
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
        </div>
      </div>
    </div>
  );
}
