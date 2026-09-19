"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";
import TradingAccessCard, {
    TradingAccessLicense,
} from "@/components/trading/TradingAccessCard";
import { Badge } from "@/components/ui/badge";
import {
    WifiOff,
    Download,
    ExternalLink,
    Shield,
    Activity,
    KeyRound,
    Copy,
    Check,
    Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ConnectedAccount = {
    accountId: string;
    mt5Account: string;
    broker: string;
    server: string;
    status: string;
    balance: number;
    equity: number;
    lastHeartbeatAt: number;
    gatewayVersion: string;
};

function formatCurrency(value: number): string {
    return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function formatRelativeTime(timestamp: number): string {
    if (!timestamp) return "Never";
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 5) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function StatusDot({ status }: { status: string }) {
    const isActive = status === "connected";
    return (
        <span className="relative flex h-2 w-2">
            {isActive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            )}
            <span
                className={cn(
                    "relative inline-flex h-2 w-2 rounded-full",
                    isActive ? "bg-emerald-500" : "bg-rose-500"
                )}
            />
        </span>
    );
}

export default function TradingAccessPage() {
    const router = useRouter();
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [license, setLicense] = useState<TradingAccessLicense | null>(null);
    const [licenseLoading, setLicenseLoading] = useState(true);
    const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
    const [activating, setActivating] = useState(false);
    const [gatewayToken, setGatewayToken] = useState<string | null>(null);
    const [tokenLoading, setTokenLoading] = useState(true);
    const [tokenMinting, setTokenMinting] = useState(false);
    const [tokenRevoking, setTokenRevoking] = useState(false);
    const [copied, setCopied] = useState(false);
    const [refreshingAccounts, setRefreshingAccounts] = useState(false);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user) {
                router.replace("/login");
                return;
            }
            setFirebaseUser(user);
        });
        return () => unsubscribe();
    }, [router]);

    // Fetch trading access license
    useEffect(() => {
        if (!firebaseUser) return;

        async function fetchLicense() {
            setLicenseLoading(true);
            try {
                const token = await firebaseUser!.getIdToken();
                const res = await fetch("/api/trading/access", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setLicense(data.license ?? null);
                } else {
                    setLicense(null);
                }
            } catch {
                setLicense(null);
            } finally {
                setLicenseLoading(false);
                setLoading(false);
            }
        }

        fetchLicense();
    }, [firebaseUser]);

    // Fetch connected accounts: prefer the server-side status endpoint
    // (admin-SDK read, immune to RTDB client rules), and keep the realtime
    // client subscription as a live refresh when rules allow it.
    useEffect(() => {
        if (!firebaseUser) return;

        let cancelled = false;

        async function fetchAccounts() {
            try {
                const token = await firebaseUser!.getIdToken();
                const res = await fetch("/api/trading/gateway/status", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const data = await res.json();
                if (cancelled) return;
                if (data.success && Array.isArray(data.accounts)) {
                    setAccounts(data.accounts as ConnectedAccount[]);
                }
            } catch {
                // non-fatal; realtime listener below still runs
            }
        }

        void fetchAccounts();

        const accountsRef = ref(
            database,
            `trading_accounts/${firebaseUser.uid}`
        );
        const unsubscribeRealtime = onValue(accountsRef, (snap) => {
            if (cancelled) return;
            const val = snap.val();
            if (val) {
                const list = Array.isArray(val)
                    ? val
                    : Object.values(val);
                setAccounts(list as ConnectedAccount[]);
            }
        });

        return () => {
            cancelled = true;
            unsubscribeRealtime();
        };
    }, [firebaseUser]);

    async function handleRefreshAccounts() {
        if (!firebaseUser || refreshingAccounts) return;
        setRefreshingAccounts(true);
        try {
            const token = await firebaseUser.getIdToken();
            const res = await fetch("/api/trading/gateway/status", {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.accounts)) {
                    setAccounts(data.accounts as ConnectedAccount[]);
                }
            }
        } catch {
            // non-fatal
        } finally {
            setRefreshingAccounts(false);
        }
    }

    // Fetch gateway token
    useEffect(() => {
        if (!firebaseUser) return;

        async function fetchToken() {
            setTokenLoading(true);
            try {
                const token = await firebaseUser!.getIdToken();
                const res = await fetch("/api/trading/gateway/token", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                    const data = await res.json();
                    setGatewayToken(data.token ?? null);
                }
            } catch {
                // non-fatal
            } finally {
                setTokenLoading(false);
            }
        }

        fetchToken();
    }, [firebaseUser]);

    async function handleMintToken() {
        if (!firebaseUser) return;
        setTokenMinting(true);
        try {
            const token = await firebaseUser.getIdToken();
            const res = await fetch("/api/trading/gateway/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            if (res.ok) {
                const data = await res.json();
                setGatewayToken(data.token ?? null);
            }
        } catch (err) {
            console.error("Failed to mint gateway token:", err);
        } finally {
            setTokenMinting(false);
        }
    }

    async function handleRevokeToken() {
        if (!firebaseUser) return;
        setTokenRevoking(true);
        try {
            const token = await firebaseUser.getIdToken();
            const res = await fetch("/api/trading/gateway/token", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                setGatewayToken(null);
            }
        } catch (err) {
            console.error("Failed to revoke gateway token:", err);
        } finally {
            setTokenRevoking(false);
        }
    }

    async function handleCopyToken() {
        if (!gatewayToken) return;
        await navigator.clipboard.writeText(gatewayToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    async function handleActivate() {
        if (!firebaseUser) return;
        setActivating(true);
        try {
            const token = await firebaseUser.getIdToken();
            const res = await fetch("/api/trading/access", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            if (res.ok) {
                const data = await res.json();
                setLicense(data.license ?? null);
            }
        } catch (err) {
            console.error("Failed to activate trading access:", err);
        } finally {
            setActivating(false);
        }
    }

    if (loading) {
        return (
            <AccountShell
                title="Trading Access"
                subtitle="Manage your MT5 trading connection"
            >
                <div className="flex h-[40vh] items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell
            title="Trading Access"
            subtitle="Manage your MT5 trading connection"
        >
            <div className="space-y-8" data-guide="page-header">
                {/* License Status */}
                <TradingAccessCard
                    license={license}
                    loading={licenseLoading}
                    onActivate={handleActivate}
                />

                {activating && (
                    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                        Activating trading access...
                    </div>
                )}

                {/* Connected Accounts */}
                {license?.status === "active" && (
                    <div className="rounded-2xl border border-border bg-muted/30 p-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="font-semibold">Connected Accounts</h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    MT5 accounts linked via the Gateway EA
                                </p>
                            </div>
                            <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                                {accounts.length} account{accounts.length !== 1 ? "s" : ""}
                            </span>
                        </div>

                        {accounts.length === 0 ? (
                            <div className="mt-6 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
                                <WifiOff
                                    size={24}
                                    className="text-muted-foreground"
                                />
                                <div>
                                    <p className="text-sm font-medium">
                                        No accounts connected
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Install the Gateway EA on your MT5 terminal to
                                        connect, then make sure the token in the EA matches
                                        the gateway token on this page.
                                    </p>
                                </div>
                                <button
                                    onClick={handleRefreshAccounts}
                                    disabled={refreshingAccounts}
                                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                >
                                    <Activity
                                        size={14}
                                        className={refreshingAccounts ? "animate-spin" : ""}
                                    />
                                    {refreshingAccounts ? "Checking..." : "Refresh connection"}
                                </button>
                            </div>
                        ) : (
                            <div className="mt-5 space-y-3">
                                {accounts.map((acc) => (
                                    <div
                                        key={acc.accountId}
                                        className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4"
                                    >
                                        <StatusDot status={acc.status} />
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold">
                                                {acc.broker}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {acc.mt5Account} · {acc.server}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap gap-5">
                                            <div>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Balance
                                                </p>
                                                <p className="font-mono text-sm tabular-nums">
                                                    ${formatCurrency(acc.balance)}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Equity
                                                </p>
                                                <p className="font-mono text-sm tabular-nums">
                                                    ${formatCurrency(acc.equity)}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Gateway
                                                </p>
                                                <p className="text-sm">
                                                    v{acc.gatewayVersion}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] text-muted-foreground">
                                                    Last Seen
                                                </p>
                                                <p className="flex items-center gap-1.5 text-sm">
                                                    <Activity
                                                        size={11}
                                                        className="text-muted-foreground"
                                                    />
                                                    {formatRelativeTime(acc.lastHeartbeatAt)}
                                                </p>
                                            </div>
                                        </div>
                                        <Badge
                                            className={cn(
                                                "ml-auto border-none",
                                                acc.status === "connected"
                                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                            )}
                                        >
                                            {acc.status}
                                        </Badge>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Gateway Download & Setup */}
                {license?.status === "active" && (
                    <div className="rounded-2xl border border-border bg-muted/30 p-6">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                                <Download
                                    size={20}
                                    className="text-emerald-600 dark:text-emerald-400"
                                />
                            </div>
                            <div>
                                <h2 className="font-semibold">
                                    Gateway EA Installation
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    Connect your MT5 terminal to the trading platform
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div className="rounded-xl border border-border bg-card p-4">
                                <h3 className="text-sm font-semibold">
                                    Step 1: Download the Gateway EA
                                </h3>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Download the latest version of the AlgoVault Gateway
                                    Expert Advisor for MetaTrader 5.
                                </p>
                                <a
                                    href="/download/gateway-ea"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90"
                                >
                                    <Download size={13} />
                                    Download Gateway EA v2.0
                                    <ExternalLink size={11} />
                                </a>
                            </div>

                            <div className="rounded-xl border border-border bg-card p-4">
                                <h3 className="text-sm font-semibold">
                                    Step 2: Install on MT5
                                </h3>
                                <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                                    <li>
                                        1. Copy{" "}
                                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                                            AlgoVaultGateway.ex5
                                        </code>{" "}
                                        to your MT5{" "}
                                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                                            Experts/Indicators
                                        </code>{" "}
                                        folder.
                                    </li>
                                    <li>2. Restart MT5 or refresh the Expert Advisors list.</li>
                                    <li>
                                        3. Drag the EA onto any chart. It will run in the
                                        background.
                                    </li>
                                </ol>
                            </div>

                            <div className="rounded-xl border border-border bg-card p-4">
                                <h3 className="text-sm font-semibold">
                                    Step 3: Connect
                                </h3>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    The Gateway EA needs a token to authenticate. Generate one below, then paste it into the EA&apos;s{" "}
                                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
                                        GatewayToken
                                    </code>{" "}
                                    input field.
                                </p>

                                {tokenLoading ? (
                                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                                        <div className="h-3 w-3 animate-spin rounded-full border border-border border-t-foreground" />
                                        Loading token...
                                    </div>
                                ) : gatewayToken ? (
                                    <div className="mt-3 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <KeyRound size={14} className="text-emerald-500" />
                                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                                Token Ready
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 overflow-x-auto rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs text-foreground">
                                                {gatewayToken}
                                            </code>
                                            <button
                                                onClick={handleCopyToken}
                                                className="shrink-0 rounded-lg border border-border bg-muted p-2 hover:bg-muted/70"
                                                title="Copy to clipboard"
                                            >
                                                {copied ? (
                                                    <Check size={14} className="text-emerald-500" />
                                                ) : (
                                                    <Copy size={14} className="text-muted-foreground" />
                                                )}
                                            </button>
                                        </div>
                                        <button
                                            onClick={handleRevokeToken}
                                            disabled={tokenRevoking}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition disabled:opacity-50"
                                        >
                                            <Trash2 size={12} />
                                            {tokenRevoking ? "Revoking..." : "Revoke Token"}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="mt-3">
                                        <button
                                            onClick={handleMintToken}
                                            disabled={tokenMinting}
                                            className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90 transition disabled:opacity-50"
                                        >
                                            <KeyRound size={13} />
                                            {tokenMinting ? "Generating..." : "Generate Gateway Token"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Info Section */}
                <div className="rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-5">
                    <div className="flex items-start gap-3">
                        <Shield
                            size={18}
                            className="mt-0.5 shrink-0 text-amber-500"
                        />
                        <div>
                            <p className="text-sm font-semibold">About Trading Access</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                Trading Access connects your MT5 broker account to the
                                AlgoVault platform via a secure Gateway EA. Your broker
                                credentials are never shared — the Gateway runs locally on your
                                machine and communicates via encrypted channels.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </AccountShell>
    );
}
