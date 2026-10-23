"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { executeUnified } from "@/lib/trading/unified/client";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Bot,
    Play,
    Square,
    Zap,
    TrendingUp,
    TrendingDown,
    Clock,
    Trash2,
    Edit3,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WindowWithBotIntervals extends Window {
    __botIntervals?: Record<string, ReturnType<typeof setInterval>>;
}

interface BotTemplateLike {
    id: string;
    name: string;
    description: string;
    direction: "long" | "short";
    symbol?: string;
    timeframe?: string;
    accountId?: string;
    magicNumber?: string;
}

interface BotStudioBotCardProps {
    template: BotTemplateLike;
    currentPrice?: number;
    hasToken?: boolean;
    authToken?: string;
    accountId?: string;
    className?: string;
    onDelete?: (botId: string) => Promise<void>;
    onEdit?: (
        botId: string,
        updates: Partial<{
            name: string;
            symbol: string;
            timeframe: string;
            magicNumber: string;
            commentFilter: string;
            description: string;
            mt5Account: string;
        }>,
    ) => Promise<void>;
    /** Called when this card's running state changes. */
    onRunningChange?: (running: boolean) => void;
}

export function BotStudioBotCard({
    template,
    currentPrice,
    hasToken,
    authToken,
    accountId,
    className,
    onDelete,
    onEdit,
    onRunningChange,
}: BotStudioBotCardProps) {
    const [running, setRunning] = useState(() => {
        try {
            const saved = localStorage.getItem(`bot-studio-running-${template.id}`);
            return saved === "true";
        } catch {
            return false;
        }
    });
    const [errorReason, setErrorReason] = useState<string | null>(null);
    const [signalCount, setSignalCount] = useState(0);
    const [executionCount, setExecutionCount] = useState(0);
    const [lastTickAt, setLastTickAt] = useState<number | undefined>(undefined);
    const [currentPosition, setCurrentPosition] = useState<{
        ticket: string;
        side: "BUY" | "SELL";
        volume: number;
        entry: number;
        sl: number;
        tp: number;
        openAt: number;
    } | null>(null);
    const [editing, setEditing] = useState(false);
    const [editForm, setEditForm] = useState({
        name: template.name,
        symbol: template.symbol ?? "",
        timeframe: template.timeframe ?? "",
        magicNumber: template.magicNumber ?? "",
        commentFilter: "",
        description: template.description,
        mt5Account: (template.accountId && template.accountId !== "default" ? template.accountId : null) ?? (accountId && accountId !== "default" ? accountId : ""),
    });
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const currentPriceRef = useRef<number | null>(null);
    useEffect(() => {
        currentPriceRef.current = currentPrice != null && currentPrice > 0 ? currentPrice : null;
    }, [currentPrice]);

    // Keep the edit form in sync with the server template when opening edit mode,
    // so reopened edits always reflect the latest saved values. We only sync when
    // entering edit mode (editing === true), never when leaving it, so in-progress
    // edits are not clobbered by a stale template ref.
    useEffect(() => {
        if (!editing) return;
        setEditForm({
            name: template.name,
            symbol: template.symbol ?? "",
            timeframe: template.timeframe ?? "",
            magicNumber: template.magicNumber ?? "",
            commentFilter: "",
            description: template.description,
            mt5Account: (template.accountId && template.accountId !== "default" ? template.accountId : null) ?? (accountId && accountId !== "default" ? accountId : ""),
        });
    }, [editing, template.name, template.symbol, template.timeframe, template.magicNumber, template.description, template.accountId, accountId]);

    const direction = template.direction === "long" ? "BUY" : "SELL";
    const rawTemplateAccount = template.accountId?.trim();
    const rawPropAccount = accountId?.trim();
    const resolvedAccount =
        (rawTemplateAccount && rawTemplateAccount !== "default" ? rawTemplateAccount : null) ??
        (rawPropAccount && rawPropAccount !== "default" ? rawPropAccount : "");

    // Guard: never call the execution API without a real account id — an empty
    // accountId hits PROVIDER_NOT_CONFIGURED (501) instead of a clear error.
    const hasAccount = Boolean(resolvedAccount && resolvedAccount.length > 0);

    const estimatedTp = currentPrice != null && currentPrice > 0
        ? template.direction === "long"
            ? currentPrice * 1.0015
            : currentPrice * 0.9985
        : null;
    const estimatedSl = currentPrice != null && currentPrice > 0
        ? template.direction === "long"
            ? currentPrice * 0.9990
            : currentPrice * 1.0010
        : null;

    const handleTestTrade = useCallback(async () => {
        let token = authToken;
        if (!token || token.trim() === "") {
            try {
                token = (await auth.currentUser?.getIdToken(true)) ?? "";
            } catch {
                token = "";
            }
        }
        if (!token) {
            setErrorReason("not authenticated — wait for token");
            setTimeout(() => setErrorReason(null), 3000);
            return;
        }
        if (!hasAccount) {
            setErrorReason("no MT5 account linked — select an account or edit bot");
            setTimeout(() => setErrorReason(null), 3000);
            return;
        }
        const entry = currentPriceRef.current;
        if (!entry || entry <= 0) {
            setErrorReason("no live price — wait for market data");
            setTimeout(() => setErrorReason(null), 3000);
            return;
        }
        const side: "BUY" | "SELL" = direction;
        const sl = estimatedSl ?? entry * (template.direction === "long" ? 0.999 : 1.001);
        const tp = estimatedTp ?? entry * (template.direction === "long" ? 1.0015 : 0.9985);
        const ticket = `BOT-${template.id}-${Date.now()}`;
        const volume = 0.01;
        try {
            const result = await executeUnified(
                {
                    accountId: resolvedAccount,
                    clientRequestId: `BOT-STUDIO-${template.id}-${ticket}`,
                    executionType: "PLACE_ORDER",
                    symbol: template.symbol ?? "XAUUSD",
                    side,
                    volume,
                    kind: "MARKET",
                    price: entry,
                    stopLoss: sl,
                    takeProfit: tp,
                    source: "bot-studio",
                },
                token,
            );
            const ok = result.status === "SUCCEEDED" || result.status === "EXECUTED_PENDING_SYNC";
            if (!ok) {
                setErrorReason(`order rejected: ${result.error?.code ?? "unknown"}`);
                setTimeout(() => setErrorReason(null), 3000);
                return;
            }
            const newPos = { ticket, side, volume, entry, sl, tp, openAt: Date.now() };
            setCurrentPosition(newPos);
            setExecutionCount((c) => c + 1);
            setNotice(`Test trade placed: ${ticket} @ ${entry.toFixed(2)}`);
            setTimeout(() => setNotice(null), 3000);
        } catch (err) {
            setErrorReason(err instanceof Error ? err.message : "execution error");
            setTimeout(() => setErrorReason(null), 3000);
        }
    }, [hasToken, authToken, hasAccount, template.id, direction, estimatedSl, estimatedTp, resolvedAccount, template.symbol, template.direction]);

    const handleToggle = useCallback(
        async (next: boolean) => {
            if (!hasToken) {
                setErrorReason("not authenticated — wait for token");
                setTimeout(() => setErrorReason(null), 3000);
                return;
            }
            if (!hasAccount) {
                setErrorReason("no MT5 account linked — add one in the edit form");
                setTimeout(() => setErrorReason(null), 3000);
                return;
            }
            setRunning(next);
        },
        [hasToken, hasAccount],
    );

    const handleConfirmDelete = async () => {
        setDeleteConfirm(false);
        setDeleting(true);
        try {
            await onDelete?.(template.id);
            setNotice(`Deleted: ${template.name}`);
            setTimeout(() => setNotice(null), 3000);
        } catch (err) {
            setErrorReason(err instanceof Error ? err.message : "Delete failed");
            setTimeout(() => setErrorReason(null), 3000);
        } finally {
            setDeleting(false);
        }
    };

    const handleEditSave = async () => {
        if (!onEdit) return;
        setSaving(true);
        try {
            await onEdit(template.id, {
                name: editForm.name.trim() || template.name,
                symbol: editForm.symbol.trim() || undefined,
                timeframe: editForm.timeframe.trim() || undefined,
                magicNumber: editForm.magicNumber.trim() || undefined,
                commentFilter: editForm.commentFilter.trim() || undefined,
                description: editForm.description.trim() || undefined,
                mt5Account: editForm.mt5Account.trim() || undefined,
            });
            setEditing(false);
            setNotice(`Updated: ${editForm.name}`);
            setTimeout(() => setNotice(null), 3000);
        } catch (err) {
            setErrorReason(err instanceof Error ? err.message : "Update failed");
            setTimeout(() => setErrorReason(null), 3000);
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        try {
            localStorage.setItem(`bot-studio-running-${template.id}`, String(running));
        } catch {
            // localStorage may be unavailable — ignore.
        }
    }, [running, template.id]);

    // Auto-resume the bot's tick loop on reload when it was left running.
    useEffect(() => {
        if (!running || !hasToken || !hasAccount) return;
        const interval = setInterval(() => {
            setLastTickAt(Date.now());
            if (Math.random() < 0.15 && !currentPosition) {
                const entry = currentPriceRef.current;
                if (entry && entry > 0) {
                    setSignalCount((c) => c + 1);
                    void handleTestTrade();
                }
            }
        }, 5000);
        const wbi = window as unknown as WindowWithBotIntervals;
        wbi.__botIntervals = wbi.__botIntervals || {};
        wbi.__botIntervals[template.id] = interval;
        onRunningChange?.(true);
        return () => {
            clearInterval(interval);
            wbi.__botIntervals && delete wbi.__botIntervals[template.id];
            onRunningChange?.(false);
        };
    }, [running, hasToken, hasAccount, template.id, handleTestTrade, currentPosition, onRunningChange]);

    useEffect(() => {
        return () => {
            const wbi = window as unknown as WindowWithBotIntervals;
            const interval = wbi.__botIntervals?.[template.id];
            if (interval) clearInterval(interval);
        };
    }, [template.id]);

    return (
        <Card className={cn(
            "border border-border bg-card overflow-hidden shadow-sm compact-card transition-all hover:shadow-md",
            className,
        )}>
            {notice && (
                <div className="px-4 py-2 bg-positive/5 border-b border-positive/10">
                    <div className="flex items-center gap-2">
                        <TrendingUp className="size-3 text-positive" />
                        <span className="text-[9px] font-medium text-positive">{notice}</span>
                    </div>
                </div>
            )}

            {/* Header — name, meta chips */}
            <CardHeader className="px-4 py-3">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 sm:flex-nowrap sm:min-w-0">
                        <div className="flex size-7 items-center justify-center rounded-xl bg-primary/5 text-primary shrink-0">
                            <Bot className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                {editing ? (
                                    <div className="flex items-start gap-1">
                                        <span className="text-sm font-semibold leading-tight truncate flex-1">
                                            {editForm.name}
                                        </span>
                                        <Badge variant="secondary" className="px-2 py-0.5 text-[10px] shrink-0">
                                            editing
                                        </Badge>
                                    </div>
                                ) : (
                                    <>
                                        <CardTitle className="text-sm font-semibold leading-tight truncate">
                                            {editForm.name || template.name}
                                        </CardTitle>
                                        <CardDescription className="text-[9px] text-muted-foreground truncate">
                                            {template.description || "Deployed strategy"}
                                        </CardDescription>
                                    </>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1 mt-1 sm:mt-0 text-[9px]">
                                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                                    {template.direction.toUpperCase()}
                                </span>
                                {template.symbol && (
                                    <span className="rounded-full bg-muted/50 px-2 py-0.5 font-medium text-foreground">
                                        {template.symbol}
                                    </span>
                                )}
                                {template.timeframe && (
                                    <span className="rounded-full bg-muted/50 px-2 py-0.5 font-medium text-foreground">
                                        {template.timeframe}
                                    </span>
                                )}
                                <Badge variant={running ? "default" : "secondary"} className="px-2 py-0.5 shrink-0">
                                    {running ? "running" : "idle"}
                                </Badge>
                                {errorReason && (
                                    <Badge variant="destructive" className="px-2 py-0.5 text-[10px] shrink-0">
                                        {errorReason}
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                </div>
            </CardHeader>

            <CardContent className="px-4 py-3">
                {editing ? (
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <h3 className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                                Bot details
                            </h3>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">Name</label>
                                    <Input
                                        value={editForm.name}
                                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">Symbol</label>
                                    <Input
                                        value={editForm.symbol}
                                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                        placeholder="e.g. XAUUSD"
                                        onChange={(e) => setEditForm({ ...editForm, symbol: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">Timeframe</label>
                                    <Input
                                        value={editForm.timeframe}
                                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                        placeholder="e.g. M15"
                                        onChange={(e) => setEditForm({ ...editForm, timeframe: e.target.value })}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">Magic #</label>
                                    <Input
                                        value={editForm.magicNumber}
                                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                        placeholder="e.g. 70001"
                                        onChange={(e) => setEditForm({ ...editForm, magicNumber: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <h3 className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                                MT5 connection
                            </h3>
                            <div className="space-y-1">
                                <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">MT5 Account</label>
                                <Input
                                    value={editForm.mt5Account}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                    placeholder="Account number"
                                    onChange={(e) => setEditForm({ ...editForm, mt5Account: e.target.value })}
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">Comment filter</label>
                                <Input
                                    value={editForm.commentFilter}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                    placeholder="Optional comment filter"
                                    onChange={(e) => setEditForm({ ...editForm, commentFilter: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-[9px] uppercase tracking-wider text-muted-foreground block">Description</label>
                            <textarea
                                value={editForm.description}
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                rows={3}
                                placeholder="Describe what this bot does…"
                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="grid gap-2 sm:grid-cols-2 text-center">
                            <div className="rounded-xl border border-border/50 bg-muted/50 p-2">
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Entry</div>
                                <div className="mt-0.5 text-xs font-semibold font-mono tabular-nums text-foreground">
                                    {currentPrice != null && currentPrice > 0 ? currentPrice.toFixed(2) : "—"}
                                </div>
                            </div>
                            <div className="rounded-xl border border-border/50 bg-muted/50 p-2">
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">TP</div>
                                <div className="mt-0.5 text-xs font-semibold font-mono tabular-nums text-positive">
                                    {estimatedTp ? estimatedTp.toFixed(2) : "—"}
                                </div>
                            </div>
                            <div className="rounded-xl border border-border/50 bg-muted/50 p-2">
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">SL</div>
                                <div className="mt-0.5 text-xs font-semibold font-mono tabular-nums text-negative">
                                    {estimatedSl ? estimatedSl.toFixed(2) : "—"}
                                </div>
                            </div>
                            <div className="rounded-xl border border-border/50 bg-muted/50 p-2">
                                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Direction</div>
                                <div className="mt-0.5 text-xs font-semibold font-mono tabular-nums text-foreground">
                                    {direction}
                                </div>
                            </div>
                        </div>

                        {template.description && (
                            <p className="mt-3 text-[9px] text-muted-foreground leading-relaxed">
                                {template.description}
                            </p>
                        )}

                        <div className="mt-4 pt-3 border-t border-border/50 flex gap-3 text-[9px] text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <TrendingUp className="size-3" />
                                {signalCount} signals
                            </span>
                            <span className="flex items-center gap-1">
                                <TrendingDown className="size-3" />
                                {executionCount} executions
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="size-3" />
                                {lastTickAt ? new Date(lastTickAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                            </span>
                        </div>
                    </>
                )}
            </CardContent>

            {/* Bottom action bar — small, aligned */}
            <div className="px-4 py-3 border-t border-border/50 flex items-center justify-center gap-2">
                {editing ? (
                    <>
                        <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setEditing(false)} className="h-7 px-2 text-xs disabled:opacity-50">Cancel</Button>
                        <Button type="button" size="sm" disabled={saving} onClick={handleEditSave} className="h-6 px-2.5 text-[10px] bg-primary text-white disabled:opacity-50">{saving ? "Saving…" : "Save"}</Button>
                    </>
                ) : (
                    <>
                        {running ? (
                            <Button type="button" variant="outline" size="sm" disabled={!hasToken} onClick={() => handleToggle(false)} className="h-6 px-2 text-[10px] flex items-center gap-1"><Square className="size-3" /> Stop</Button>
                        ) : (
                            <>
                                <Button type="button" size="sm" disabled={!hasToken} onClick={() => handleToggle(true)} className={cn("h-6 px-2 text-[10px] bg-primary text-white disabled:opacity-60 flex items-center gap-1", !hasToken ? "opacity-60" : "")}><Play className="size-3" /> Start</Button>
                                {!running && (
                                    <Button type="button" variant="outline" size="sm" disabled={!hasToken} onClick={handleTestTrade} className={cn("h-6 px-2 text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30 flex items-center gap-1", !hasToken ? "opacity-60" : "")}><Zap className="size-3" /> Test</Button>
                                )}
                            </>
                        )}
                        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1" onClick={() => setDeleteConfirm(true)}><Trash2 className="size-3" /> Delete</Button>
                        <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 hidden sm:inline-flex" onClick={() => setEditing(true)}><Edit3 className="size-3" /> Edit</Button>
                    </>
                )}
            </div>

            {deleteConfirm && (
                <CardFooter className="px-4 py-3 border-t border-border/50 bg-muted/50">
                    <p className="text-[9px] text-muted-foreground mb-3">
                        Delete <span className="font-medium text-foreground">{template.name}</span>?
                        <br className="hidden sm:block" />
                        This action cannot be undone.
                    </p>
                    <div className="flex items-center justify-end gap-1.5">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deleting}
                            onClick={() => setDeleteConfirm(false)}
                            className="h-8 px-3 text-xs disabled:opacity-50"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={deleting}
                            onClick={handleConfirmDelete}
                            className="h-8 px-3.5 text-xs disabled:opacity-50"
                        >
                            {deleting ? "Deleting…" : "Delete"}
                        </Button>
                    </div>
                </CardFooter>
            )}
        </Card>
    );
}
