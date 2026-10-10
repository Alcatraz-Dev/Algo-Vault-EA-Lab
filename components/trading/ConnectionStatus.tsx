"use client";

import { cn } from "@/lib/utils";

function currentTimestamp(): number {
  return Date.now();
}

export default function ConnectionStatus({
  status,
  lastHeartbeat,
}: {
  status: string;
  lastHeartbeat: number;
}) {
  const age = Math.floor((currentTimestamp() - lastHeartbeat) / 1000);
  const isStable = status === "connected" && age < 60;
  const isUnstable = status === "connected" && age >= 60 && age <= 120;
  const isOffline = status === "offline" || age > 120 || status !== "connected";

  const dotClass = isStable
    ? "bg-positive"
    : isUnstable
    ? "bg-warning"
    : "bg-negative";

  const label = isStable ? "Connected" : isUnstable ? "Unstable" : "Offline";
  const labelClass = isStable
    ? "text-positive dark:text-positive"
    : isUnstable
    ? "text-warning dark:text-warning"
    : "text-negative dark:text-negative";

  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex h-2 w-2">
        {isStable && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-60" />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", dotClass)} />
      </span>
      <span className={cn("text-xs font-medium", labelClass)}>{label}</span>
    </span>
  );
}
