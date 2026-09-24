"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Vertical menu helper for table row actions (simple popover-free layout is avoided; this is a dialog-based confirm). */

/**
 * ConfirmDialog — canonical destructive/confirm action modal with busy state.
 * Prevents double submission while the parent handler runs.
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    destructive = false,
    busy = false,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: React.ReactNode;
    confirmLabel?: string;
    destructive?: boolean;
    busy?: boolean;
    onConfirm: () => void | Promise<void>;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md md:max-w-xl lg:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description ? <DialogDescription>{description}</DialogDescription> : null}
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant={destructive ? "destructive" : "default"}
                        disabled={busy}
                        onClick={() => {
                            void onConfirm();
                        }}
                    >
                        {busy ? "Working…" : confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}