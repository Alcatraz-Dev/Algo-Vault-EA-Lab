"use client";

import { useState } from "react";
import { Copy, Maximize2, RotateCcw, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChartContextMenuProps {
    onCopy?: () => void;
    onFullscreen?: () => void;
    onReset?: () => void;
    onSave?: () => void;
    onClear?: () => void;
}

export default function ChartContextMenu({
    onCopy,
    onFullscreen,
    onReset,
    onSave,
    onClear,
}: ChartContextMenuProps) {
    const [open, setOpen] = useState(false);

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger>
                <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-2 z-10 opacity-0 hover:opacity-100 transition-opacity"
                    aria-label="Chart options"
                >
                    <Copy size={14} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-background border-border/20">
                {onCopy && <DropdownMenuItem onSelect={onCopy}><Copy size={14} className="mr-2" />Copy chart</DropdownMenuItem>}
                {onSave && <DropdownMenuItem onSelect={onSave}><Save size={14} className="mr-2" />Save layout</DropdownMenuItem>}
                {onFullscreen && <DropdownMenuItem onSelect={onFullscreen}><Maximize2 size={14} className="mr-2" />Fullscreen</DropdownMenuItem>}
                <DropdownMenuSeparator />
                {onReset && <DropdownMenuItem onSelect={onReset}><RotateCcw size={14} className="mr-2" />Reset zoom</DropdownMenuItem>}
                {onClear && <DropdownMenuItem onSelect={onClear} className="text-rose-400 focus:text-rose-400"><Trash2 size={14} className="mr-2" />Clear drawings</DropdownMenuItem>}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
