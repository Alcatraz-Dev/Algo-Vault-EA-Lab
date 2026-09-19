"use client";

import {
    MousePointer2,
    Minus,
    ArrowRight,
    ArrowDown,
    Square,
    GitPullRequest,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DrawingTool } from "./types";

interface DrawingToolbarProps {
    activeTool: DrawingTool;
    onChangeTool: (tool: DrawingTool) => void;
}

const TOOLS: { tool: DrawingTool; label: string; icon: React.ReactNode; shortcut: string }[] = [
    { tool: "cursor", label: "Cursor", icon: <MousePointer2 size={14} />, shortcut: "V" },
    { tool: "trendline", label: "Trend Line", icon: <ArrowRight size={14} />, shortcut: "" },
    { tool: "horizontal", label: "Horizontal", icon: <Minus size={14} />, shortcut: "" },
    { tool: "vertical", label: "Vertical", icon: <ArrowDown size={14} />, shortcut: "" },
    { tool: "ray", label: "Ray", icon: <GitPullRequest size={14} />, shortcut: "" },
    { tool: "rectangle", label: "Rectangle", icon: <Square size={14} />, shortcut: "" },
    { tool: "fibonacci", label: "Fibonacci", icon: <GitPullRequest size={14} />, shortcut: "" },
    { tool: "delete", label: "Delete", icon: <Trash2 size={14} />, shortcut: "X" },
];

export default function DrawingToolbar({ activeTool, onChangeTool }: DrawingToolbarProps) {
    return (
        <div className="flex items-center gap-1 border-b border-border/20 px-3 py-1.5">
            {TOOLS.map(({ tool, label, icon, shortcut }) => (
                <Button
                    key={tool}
                    variant={activeTool === tool ? "secondary" : "ghost"}
                    size="sm"
                    className="gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={() => onChangeTool(tool)}
                    title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
                >
                    {icon}
                    <span className="hidden lg:inline">{label}</span>
                </Button>
            ))}
        </div>
    );
}
