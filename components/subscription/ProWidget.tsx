"use client";

import { Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

interface ProWidgetProps {
  show: boolean;
  onDismiss: () => void;
  className?: string;
}

const PRO_FEATURES = [
  "Advanced Analysis",
  "Pine Script",
  "AI Signals",
  "Copy Trading",
  "Real-time Alerts",
  "Priority Support",
];

export function ProWidget({
  show,
  onDismiss,
  className,
}: ProWidgetProps) {
  const router = useRouter();

  if (!show) return null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-violet-500/10 p-4 shadow-lg shadow-violet-500/5",
        className
      )}
    >
      {/* Glow accent */}
      <div className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-500/20 via-transparent to-transparent opacity-60" />

      <div className="relative flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Unlock Pro Features</h3>
              <p className="text-xs text-muted-foreground">
                Upgrade to unlock advanced tools
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X size={14} />
          </Button>
        </div>

        <ul className="flex flex-col gap-1.5">
          {PRO_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-xs">
              <Sparkles size={12} className="shrink-0 text-violet-400" />
              <span className="text-foreground/90">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1 bg-violet-500 text-foreground hover:bg-violet-400"
            onClick={() => router.push("/pricing")}
          >
            Upgrade Now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}