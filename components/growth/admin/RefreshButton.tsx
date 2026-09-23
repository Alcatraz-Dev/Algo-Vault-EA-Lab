"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Small refresh control with pending state. Disabled while loading. */
export function RefreshButton({
    onRefresh,
    loading = false,
    label = "Refresh",
    className,
}: {
    onRefresh: () => void;
    loading?: boolean;
    label?: string;
    className?: string;
}) {
    const [spinning, setSpinning] = useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className={className}
            disabled={loading || spinning}
            onClick={() => {
                setSpinning(true);
                onRefresh();
                window.setTimeout(() => setSpinning(false), 600);
            }}
        >
            <RefreshCw className={spinning ? "animate-spin" : undefined} />
            {loading ? "Loading…" : label}
        </Button>
    );
}