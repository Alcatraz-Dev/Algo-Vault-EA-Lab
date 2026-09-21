"use client";

import { useEffect, useRef, useState } from "react";
import type { User as FirebaseUser } from "firebase/auth";
import { child, onValue, ref, remove, update, type Unsubscribe } from "firebase/database";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { database } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type AppNotification = {
  id: string;
  title?: string;
  message?: string;
  level?: "info" | "success" | "warning" | "error";
  link?: string;
  read?: boolean;
  createdAt?: number;
};

type NotificationsMenuProps = {
  user: FirebaseUser | null;
};

export function NotificationsMenu({ user }: NotificationsMenuProps) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const notifUnsub = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    const notifPath = ref(database, `notifications/${user.uid}`);
    notifUnsub.current = onValue(notifPath, (snap) => {
      const val = snap.val();
      if (!val) {
        setNotifications([]);
        return;
      }

      const list = Object.entries(val as Record<string, unknown>).map(([id, n]) => ({
        id,
        ...(typeof n === "object" && n !== null ? (n as Record<string, unknown>) : {}),
      })) as AppNotification[];
      list.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
      setNotifications(list);
    });

    return () => {
      notifUnsub.current?.();
      notifUnsub.current = null;
    };
  }, [user]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const visibleNotifications = notifications.slice(0, 8);

  const markAllRead = async () => {
    if (!user) return;

    const uid = user.uid;
    const unread = notifications.filter((notification) => !notification.read);
    if (unread.length === 0) return;

    const previous = notifications;
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true }))
    );

    try {
      const updates: Record<string, boolean> = {};
      unread.forEach((notification) => {
        updates[`${notification.id}/read`] = true;
      });
      const notificationsRef = ref(database, `notifications/${uid}`);
      await update(notificationsRef, updates);
    } catch (error) {
      setNotifications(previous);
      console.error("[NotificationsMenu] Failed to mark notifications as read", error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    if (!user) return;

    const uid = user.uid;
    const previous = notifications;
    setNotifications((current) =>
      current.filter((notification) => notification.id !== notificationId)
    );

    try {
      const notificationsRef = ref(database, `notifications/${uid}`);
      await remove(child(notificationsRef, notificationId));
    } catch (error) {
      setNotifications(previous);
      console.error("[NotificationsMenu] Failed to delete notification", error);
    }
  };

  if (!user) return null;

  return (
    <div ref={menuRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen((current) => !current)}
        aria-label={open ? "Notifications" : `Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        className={cn("h-9 w-9 rounded-button transition-colors", open && "bg-muted")}
      >
        <Bell size={16} className="text-muted-foreground" />
        {unreadCount > 0 && !open ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-pill bg-negative px-1 text-[10px] font-bold text-negative-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-card-lg border border-border bg-popover shadow-lg">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-foreground">Notifications</p>
              <p className="mt-0.5 text-micro text-muted-foreground">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void markAllRead()}
                className="shrink-0 text-micro"
              >
                <CheckCheck size={13} />
                Mark all read
              </Button>
            ) : null}
          </div>

          <div className="max-h-72 overflow-y-auto">
            {visibleNotifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-meta text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              visibleNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    "flex gap-3 border-b border-border/50 px-4 py-3 text-body-sm",
                    !notification.read && "bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                      notification.level === "success" && "bg-positive",
                      notification.level === "warning" && "bg-warning",
                      notification.level === "error" && "bg-negative",
                      (!notification.level || notification.level === "info") && "bg-info"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {notification.title || "Notification"}
                    </p>
                    {notification.message ? (
                      <p className="line-clamp-2 text-meta text-muted-foreground">
                        {notification.message}
                      </p>
                    ) : null}
                    {notification.createdAt ? (
                      <p className="mt-0.5 text-micro text-muted-foreground">
                        {new Date(notification.createdAt).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => void deleteNotification(notification.id)}
                    aria-label={`Delete notification${notification.title ? `: ${notification.title}` : ""}`}
                    title="Delete notification"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-negative"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
