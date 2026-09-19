"use client";

import { cn } from "@/lib/utils";

export default function ConnectionStatus({
  status,
  lastHeartbeat,
}: {
  status: string;
  lastHeartbeat: number;
}) {
  const age = Math.floor((Date.now() - lastHeartbeat) / 1000);
  const isStable = status === "connected" && age < 60;
  const isUnstable = status === "connected" && age >= 60 && age <= 120;
  const isOffline = status === "offline" || age > 120 || status !== "connected";

  const dotClass = isStable
    ? "bg-emerald-500"
    : isUnstable
    ? "bg-yellow-500"
    : "bg-rose-500";

  const label = isStable ? "Connected" : isUnstable ? "Unstable" : "Offline";
  const labelClass = isStable
    ? "text-emerald-600 dark:text-emerald-400"
    : isUnstable
    ? "text-yellow-600 dark:text-yellow-400"
    : "text-rose-600 dark:text-rose-400";

  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {isStable && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", dotClass)} />
      </span>
      <span className={cn("text-xs font-medium", labelClass)}>{label}</span>
    </span>
  );
}
