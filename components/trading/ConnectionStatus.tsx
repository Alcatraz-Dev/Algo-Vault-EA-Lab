"use client";

import { StatusBadge } from "@/components/ui/status-badge";

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

  if (isStable) {
    return (
      <StatusBadge
        tone="connected"
        label="Connected"
        dot
        pulse
      />
    );
  }
  if (isUnstable) {
    return (
      <StatusBadge
        tone="warning"
        label="Unstable"
        dot
      />
    );
  }
  return (
    <StatusBadge
      tone="negative"
      label="Offline"
      dot
    />
  );
}