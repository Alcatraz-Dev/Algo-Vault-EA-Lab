import React, { useRef, useState, useCallback } from "react";
import { Bot, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function DraggableFloatingPanel({
  title = "AI Copilot",
  label = "Quick read",
  open,
  onClose,
}: {
  title?: string;
  label?: string;
  open: boolean;
  onClose?: () => void;
}) {
  const [pos, setPos] = useState({ x: 220, y: 80 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number }>({
    x: 0, y: 0, px: 0, py: 0,
  });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      const onMove = (me: MouseEvent) => {
        setPos({ x: dragStart.current.px + (me.clientX - dragStart.current.x), y: dragStart.current.py + (me.clientY - dragStart.current.y) });
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [pos]
  );

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute z-50 w-72 rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl select-none",
        dragging ? "cursor-grabbing" : "cursor-default",
        "transition-shadow duration-200"
      )}
      style={{ left: pos.x, top: pos.y }}
      aria-label="Draggable AI Copilot panel"
      role="dialog"
      aria-modal="false"
    >
      <div
        className="flex items-center gap-2 rounded-t-2xl border-b border-border bg-secondary/40 px-3 py-2.5 cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        title="Drag to move"
      >
        <button
          aria-label="AlgorithmVault AI"
          className="shrink-0 rounded-full bg-brand/15 p-1.5 text-brand-foreground ring-1 ring-brand/20 transition-colors hover:bg-brand/25 hover:ring-brand/40"
          onClick={() => window.open(`${(window as any).location?.origin ?? "https://algovault.io"}/strategy-research`, "_blank")}
          title="AlgoVault AI"
        >
          <Bot size={14} strokeWidth={2.5} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">{title}</span>
        <button
          onClick={onClose}
          className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
          aria-label="Close panel"
        >
          <X size={12} />
        </button>
      </div>

      <div className="px-3 py-3 space-y-2.5">
        <p className="text-[11px] leading-snug text-muted-foreground">{label}</p>
        <div className="rounded-xl border border-border bg-secondary/40 px-2.5 py-2 text-[10px] text-foreground font-numeric">
          Drag header to reposition · click × to close
        </div>
        <button
          onClick={() => window.open(`${(window as any).location?.origin ?? "https://algovault.io"}/strategy-research`, "_blank")}
          className="w-full rounded-lg bg-brand-fill text-white text-[11px] font-medium py-1.5 hover:bg-brand-fill-hover transition-colors"
        >
          Open full copilot
        </button>
      </div>
    </div>
  );
}
