import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Shared interaction system — state machine.
 *
 * One provider per top-level page/route, consumed by panels and chrome.
 * Holds the cross-cutting states the task list asks for; the state machine is
 * deliberately thin: no reducers, no event bus, no new routes.
 *
 * States:
 *   - navCollapsed  :: boolean   (sidebar group collapsed)
 *   - modalOpen     :: boolean   (dialogs/modal)
 *   - sheetOpen     :: boolean   (mobile bottom sheet)
 *   - chatSending   :: boolean   (chat typing/optimistic)
 *   - conversation  :: { id?: string, loading: boolean } (active thread)
 */

export type Conversation = {
  id?: string;
  loading: boolean;
  error?: string;
};

export type InteractionState = {
  navCollapsed: boolean;
  setNavCollapsed: (open: boolean) => void;
  modalOpen: boolean;
  setModalOpen: (open: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  chatSending: boolean;
  setChatSending: (sending: boolean) => void;
  conversation: Conversation | null;
  setConversation: (c: Conversation | null) => void;
};

const InteractionContext = createContext<InteractionState | null>(null);

/** Load persisted sidebar collapsed state (reads `algovault.nav.collapsed` if present). */
export function usePersistedNavCollapsed(): [boolean, (open: boolean) => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const raw = window.localStorage.getItem("algovault.nav.collapsed");
      if (!raw) return false;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "boolean") return parsed;
      if (Array.isArray(parsed)) return parsed.length > 0;
      return false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "algovault.nav.collapsed",
        JSON.stringify(collapsed),
      );
    } catch {
      // Storage unavailable — ignore.
    }
  }, [collapsed]);

  const setNavCollapsed = useCallback(
    (open: boolean) => setCollapsed((prev) => open !== prev),
    [],
  );

  return [collapsed, setNavCollapsed];
}

/**
 * Provider: wraps a page shell and exposes the shared state machine.
 * Keys: navCollapsed, modalOpen, sheetOpen, chatSending, conversation.
 * Each panel/component reads the machine — no prop drilling.
 */
export function InteractionProvider({
  children,
  initialNavCollapsed = false,
}: {
  children: ReactNode;
  initialNavCollapsed?: boolean;
}) {
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed);
  const [modalOpen, setModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [chatSending, setChatSending] = useState(false);
  const [conversation, setConversation] =
    useState<Conversation | null>(null);

  const value = useMemo<InteractionState>(
    () => ({
      navCollapsed,
      setNavCollapsed,
      modalOpen,
      setModalOpen,
      sheetOpen,
      setSheetOpen,
      chatSending,
      setChatSending,
      conversation,
      setConversation,
    }),
    [
      navCollapsed,
      modalOpen,
      sheetOpen,
      chatSending,
      conversation,
    ],
  );

  return (
    <InteractionContext.Provider value={value}>
      {children}
    </InteractionContext.Provider>
  );
}

export function useInteraction() {
  const ctx = useContext(InteractionContext);
  if (!ctx) {
    throw new Error(
      "useInteraction must be used within an InteractionProvider",
    );
  }
  return ctx;
}

/** A small shared helper for the chat optimistic-sending UI (no prop drilling). */
export function useChatSubmission() {
  const { chatSending, setChatSending } = useInteraction();
  return {
    sending: chatSending,
    beginSending: () => setChatSending(true),
    endSending: () => setChatSending(false),
  };
}

/** Convenience: expose the conversation topic id when the route carries one. */
export function useConversationId() {
  const { setConversation } = useInteraction();
  const pathname = usePathname();
  // `usePathname` returns `string | null`; on the server it is `null` until
  // hydration, so fall back to the empty string here rather than treating
  // `null` as a route topic.
  const id =
    pathname === null ? null : new URLSearchParams(pathname.split("?")[1] ?? "").get("candelId");

  return id;
}
