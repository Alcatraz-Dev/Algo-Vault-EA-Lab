"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BookOpen, Camera, CheckCircle2, Clapperboard, Globe, Mail, MessageCircle, Plug, Radio, RefreshCw, Rss, Tv, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/loading-state";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAdminFetch } from "@/components/growth/admin/useAdminFetch";
import { adminFetch } from "@/components/growth/admin/session";
import { RefreshButton } from "@/components/growth/admin/RefreshButton";
import { GrowthStatusBadge } from "@/components/growth/admin/GrowthStatusBadge";
import { fmtTime } from "@/components/growth/admin/format";
import { NoticeBanner } from "@/components/growth/admin/NoticeBanner";
import { CHANNEL_LABELS, ChannelType } from "@/lib/growth/constants";

type ChannelStatusRow = {
    type: string;
    state: "CONFIGURED" | "NOT_CONFIGURED" | "ERROR" | "DISABLED";
    configured: boolean;
    reason?: string;
    capabilities: string[];
};

type TestResult = {
    type: string;
    state: string;
    reason?: string;
    checkedAt?: number;
    error?: string;
};

/**
 * Instructions are environment-variable names and setup steps only — never
 * secrets, never values. Configuration is applied server-side and verified by
 * the real channel adapters.
 */
const CHANNEL_SETUP: Record<string, { env: string[]; steps: string[] }> = {
    X: {
        env: ["X_API_KEY", "X_API_SECRET"],
        steps: [
            "Create a project and an app in the X developer portal.",
            "Set X_API_KEY and X_API_SECRET in the server environment (Vercel/your host).",
            "Restart the server, then press Test here to verify.",
        ],
    },
    INSTAGRAM: {
        env: ["INSTAGRAM_ACCESS_TOKEN"],
        steps: ["Generate a long-lived Instagram access token (Meta Graph API).", "Set INSTAGRAM_ACCESS_TOKEN in the server environment.", "Restart, then test."],
    },
    FACEBOOK: {
        env: ["FACEBOOK_ACCESS_TOKEN"],
        steps: ["Create a Meta app and page token.", "Set FACEBOOK_ACCESS_TOKEN in the server environment.", "Restart, then test."],
    },
    LINKEDIN: {
        env: ["LINKEDIN_ACCESS_TOKEN"],
        steps: ["Create a LinkedIn app and request the Posts API scopes.", "Set LINKEDIN_ACCESS_TOKEN in the server environment.", "Restart, then test."],
    },
    YOUTUBE: {
        env: ["YOUTUBE_API_KEY"],
        steps: ["Enable the YouTube Data API in Google Cloud.", "Set YOUTUBE_API_KEY in the server environment.", "Restart, then test."],
    },
    TIKTOK: {
        env: ["TIKTOK_ACCESS_TOKEN"],
        steps: ["Create a TikTok developer app and generate a token.", "Set TIKTOK_ACCESS_TOKEN in the server environment.", "Restart, then test."],
    },
    DISCORD: {
        env: ["DISCORD_WEBHOOK_URL"],
        steps: ["Create a webhook in your server's channel settings.", "Set DISCORD_WEBHOOK_URL in the server environment.", "Restart, then test."],
    },
    EMAIL: {
        env: ["RESEND_API_KEY (or SENDGRID_API_KEY)", "GROWTH_EMAIL_RECIPIENTS (comma-separated)"],
        steps: [
            "Set an email provider API key.",
            "Define GROWTH_EMAIL_RECIPIENTS for campaign sends.",
            "Restart, then test.",
        ],
    },
    BLOG: {
        env: [],
        steps: [
            "The Blog channel publishes into the platform's own growth content collection.",
            "It requires no external credentials and is always available.",
        ],
    },
};

const CHANNEL_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    X: Tv,
    INSTAGRAM: Camera,
    FACEBOOK: Globe,
    LINKEDIN: Rss,
    YOUTUBE: Clapperboard,
    TIKTOK: Video,
    DISCORD: MessageCircle,
    EMAIL: Mail,
    BLOG: BookOpen,
};

export default function AdminGrowthChannelsPage() {
    const statuses = useAdminFetch<ChannelStatusRow[]>("/api/growth/channels/status");
    const [configureFor, setConfigureFor] = useState<ChannelStatusRow | null>(null);
    const [testing, setTesting] = useState<string | null>(null);
    const [testResult, setTestResult] = useState<TestResult | null>(null);
    const [testDialogOpen, setTestDialogOpen] = useState(false);
    const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const flash = (kind: "ok" | "error", text: string) => {
        setNotice({ kind, text });
        window.setTimeout(() => setNotice(null), 5000);
    };

    const testChannel = async (type: string) => {
        if (testing) return;
        setTesting(type);
        try {
            const result = await adminFetch<{ statuses: ChannelStatusRow[]; checkedAt: number }>("/api/growth/channels/manage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "test", type }),
            });
            const row = result.statuses[0];
            setTestResult({ type, state: row.state, reason: row.reason, checkedAt: result.checkedAt });
            setTestDialogOpen(true);
            statuses.refresh();
        } catch (err) {
            flash("error", err instanceof Error ? err.message : "Test failed.");
        } finally {
            setTesting(null);
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                title="Channels"
                subtitle="Distribution channels and their real configuration state."
                actions={<RefreshButton onRefresh={statuses.refresh} loading={statuses.loading} />}
            />

            {notice && <NoticeBanner variant={notice.kind === "ok" ? "success" : "error"}>{notice.text}</NoticeBanner>}

            {statuses.loading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading channel status">
                    {Array.from({ length: 9 }).map((_, i) => (
                        <Skeleton key={i} className="h-40" />
                    ))}
                </div>
            ) : statuses.error ? (
                <ErrorState
                    title="Couldn't load channel status"
                    description={statuses.error}
                    action={<Button type="button" variant="outline" onClick={statuses.refresh}>Retry</Button>}
                />
            ) : !statuses.data || statuses.data.length === 0 ? (
                <EmptyState icon={<Radio size={18} />} title="No channel status" description="Channel configuration state is computed by the server adapters." />
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {statuses.data.map((c) => {
                        const Icon = CHANNEL_ICONS[c.type] || Radio;
                        const setup = CHANNEL_SETUP[c.type];
                        return (
                            <div key={c.type} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="flex items-center gap-2 font-medium text-foreground">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                            <Icon size={16} />
                                        </span>
                                        {CHANNEL_LABELS[c.type as ChannelType] || c.type}
                                    </span>
                                    <GrowthStatusBadge kind="channel" value={c.state} />
                                </div>

                                <div className="flex flex-wrap gap-1">
                                    {c.capabilities.map((cap) => (
                                        <Badge key={cap} variant="outline" className="text-[10px] normal-case">
                                            {cap}
                                        </Badge>
                                    ))}
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    {c.state === "CONFIGURED" ? (
                                        <span className="inline-flex items-center gap-1 text-success-foreground">
                                            <CheckCircle2 size={12} /> Adapter is live — content can be published.
                                        </span>
                                    ) : (
                                        c.reason || "Not configured."
                                    )}
                                </p>

                                <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3">
                                    <Button type="button" variant="outline" size="sm" onClick={() => setConfigureFor(c)}>
                                        <Plug /> Configure
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={testing !== null}
                                        onClick={() => void testChannel(c.type)}
                                    >
                                        {testing === c.type ? "Testing…" : <><RefreshCw /> Test</>}
                                    </Button>
                                    <span className="ml-auto text-[10px] text-muted-foreground">
                                        {c.state === "NOT_CONFIGURED" || c.state === "DISABLED" ? "env-based" : "live"}
                                    </span>
                                </div>
                                <ChannelSetupProgress channel={c} setup={setup} />
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-2 text-sm font-medium text-foreground">Enable / disable</h2>
                <p className="text-xs text-muted-foreground">
                    Channel availability comes from real server configuration — there is no database-level on/off switch, so no toggle is shown
                    here (a fake switch would just lie about whether content can actually be published). To change a channel, update its
                    environment variables and press <b>Test</b>.
                </p>
            </div>

            {/* Configure dialog */}
            <Dialog open={configureFor !== null} onOpenChange={(o) => { if (!o) setConfigureFor(null); }}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            Configure {configureFor ? CHANNEL_LABELS[configureFor.type as ChannelType] || configureFor.type : ""}
                        </DialogTitle>
                        <DialogDescription>
                            Environment-based setup. Values stay in the server — secrets are never stored or shown here.
                        </DialogDescription>
                    </DialogHeader>
                    {configureFor && (
                        <div className="space-y-4 text-sm">
                            <div className="flex items-center gap-2">
                                <GrowthStatusBadge kind="channel" value={configureFor.state} />
                                <span className="text-xs text-muted-foreground">
                                    {configureFor.reason || "Adapter is live."}
                                </span>
                            </div>
                            <div>
                                <p className="mb-2 text-xs font-medium text-foreground">Required environment variables</p>
                                {(CHANNEL_SETUP[configureFor.type]?.env || []).length === 0 ? (
                                    <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                                        No environment variables required for this channel.
                                    </p>
                                ) : (
                                    <ul className="space-y-1">
                                        {CHANNEL_SETUP[configureFor.type]?.env.map((v) => (
                                            <li key={v} className="rounded border border-border bg-muted/40 px-3 py-1.5 font-mono text-xs text-foreground">
                                                {v}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div>
                                <p className="mb-2 text-xs font-medium text-foreground">Steps</p>
                                <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                                    {(CHANNEL_SETUP[configureFor.type]?.steps || []).map((s, i) => (
                                        <li key={i}>{s}</li>
                                    ))}
                                </ol>
                            </div>
                            <p className="text-xs text-muted-foreground">After setting the values and restarting, use <b>Test</b> on the channel card to verify.</p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Test result dialog */}
            <Dialog open={testDialogOpen} onOpenChange={setTestDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Connection test</DialogTitle>
                        <DialogDescription>
                            Result from the real channel adapter — {" "}
                            {testResult ? CHANNEL_LABELS[testResult.type as ChannelType] || testResult.type : "channel"}.
                        </DialogDescription>
                    </DialogHeader>
                    {testResult && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <GrowthStatusBadge kind="channel" value={testResult.state} />
                                <span className="text-xs text-muted-foreground">
                                    {testResult.checkedAt ? `checked ${fmtTime(testResult.checkedAt)}` : ""}
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {testResult.state === "CONFIGURED"
                                    ? "The adapter has the credentials it needs and can publish."
                                    : testResult.reason || "Channel is not configured."}
                            </p>
                            {testResult.state === "CONFIGURED" && (
                                <p className="rounded-md border border-success/30 bg-success/10 p-3 text-xs text-success-foreground">
                                    <CheckCircle2 size={14} className="mr-1 inline" /> Verified — content published to this channel goes through the real adapter.
                                </p>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

function ChannelSetupProgress({
    channel,
    setup,
}: {
    channel: ChannelStatusRow;
    setup?: { env: string[]; steps: string[] };
}) {
    const checks = (setup?.env || []).map((env) => {
        const isSet = Boolean(process.env[env]);
        return { label: env.replace(/^GROWTH_/, ""), passed: isSet };
    });

    if (checks.length === 0) {
        return (
            <p className="text-[10px] text-muted-foreground">
                No external credentials required — adapter is built-in.
            </p>
        );
    }

    const passed = checks.filter((c) => c.passed).length;
    const total = checks.length;
    const pct = total > 0 ? (passed / total) * 100 : 0;

    return (
        <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between text-xs">
                <span>Setup progress</span>
                <span>{passed}/{total}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-1.5">
                {checks.map((c) => (
                    <span
                        key={c.label}
                        className={cn(
                            "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px]",
                            c.passed
                                ? "bg-positive/10 text-positive-foreground"
                                : "bg-muted text-muted-foreground"
                        )}
                    >
                        <span className={cn("h-1.5 w-1.5 rounded-full", c.passed ? "bg-positive" : "bg-muted-foreground")} />
                        {c.label}
                    </span>
                ))}
            </div>
        </div>
    );
}
