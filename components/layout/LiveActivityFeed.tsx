import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, TrendingUp } from "lucide-react";
import Link from "next/link";
import { ScrollProgressRail } from "./ScrollProgressRail";

export default function LiveActivityFeed({
  activities,
}: {
  activities: { id: string; title: string; message: string; type: "info" | "success" | "warning" | "error" }[];
}) {
  const { user } = useAuth();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4">
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Live Activity</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {activities.map((activity, i) => (
          <div
            key={activity.id}
            className="flex items-start gap-3 rounded-md border border-border bg-card p-3"
          >
            <span
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                activity.type === "success"
                  ? "bg-positive"
                  : activity.type === "warning"
                    ? "bg-warning"
                    : activity.type === "error"
                      ? "bg-negative"
                      : "bg-info"
              }`}
            />
            <div>
              <p className="text-sm font-semibold text-foreground">{activity.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{activity.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
