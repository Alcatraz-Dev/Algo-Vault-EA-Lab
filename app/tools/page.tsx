import Link from "next/link";
import {
    Calculator, TrendingDown, Shield, TrendingUp, Coins, DollarSign,
    Grid3x3, Zap, Clock, Globe, ArrowRight, Crown, Sparkles, Telescope,
    Layers, Copy, FlaskConical,
} from "lucide-react";
import {
    TOOL_CATALOG,
    type ToolCatalogEntry,
    type ToolGroup,
} from "@/lib/tools-catalog";
import { ToolBadge } from "@/components/tools/tier-ui";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    Calculator, TrendingDown, Shield, TrendingUp, Coins, DollarSign,
    Grid3x3, Zap, Clock, Globe, Telescope, Layers, Copy, FlaskConical,
};

const GROUP_LABELS: Record<ToolGroup, { label: string; icon: any; description: string }> = {
    calculator: { label: "Calculators", icon: Calculator, description: "Size, risk and portfolio math." },
    reference: { label: "Reference", icon: Telescope, description: "Lookups and static tables." },
    analysis: { label: "Analysis", icon: Layers, description: "Cross-pair and instrument intelligence." },
    market: { label: "Market Timing", icon: Clock, description: "Sessions and liquidity windows." },
    terminal: { label: "Terminals", icon: Zap, description: "Pro-only AI workspaces." },
};

export default function ToolsLandingPage() {
    const free = TOOL_CATALOG.filter((t) => t.tier === "free");
    const pro = TOOL_CATALOG.filter((t) => t.tier === "pro");
    const groups = (Object.keys(GROUP_LABELS) as ToolGroup[]).filter((g) =>
        TOOL_CATALOG.some((t) => t.group === g),
    );

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
                <header className="mb-10">
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.04] px-2.5 py-1 text-micro font-semibold uppercase tracking-wider text-primary">
                        <Sparkles className="size-3" /> Tool Library
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                        Every trading tool we ship, side by side.
                    </h1>
                    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                        <span className="font-semibold text-foreground">{free.length} Lite tools</span> work on the free plan — useful on their own.
                        <span className="ml-1 font-semibold text-primary">{pro.length} Pro tools</span> unlock the deep workspace,
                        persistence, replay and AI explanations that turn these into a daily trading aid.
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                        <Link
                            href="/pricing"
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                        >
                            <Crown className="size-4" />
                            Compare Pro plans
                        </Link>
                        <Link
                            href="/account/tools"
                            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                        >
                            Member tools <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                </header>

                {/* Section: by group */}
                {groups.map((groupKey) => {
                    const group = GROUP_LABELS[groupKey];
                    const tools = TOOL_CATALOG.filter((t) => t.group === groupKey);
                    if (tools.length === 0) return null;
                    const GroupIcon = group.icon;
                    return (
                        <section className="mb-12" key={groupKey}>
                            <div className="mb-4 flex items-end justify-between">
                                <div>
                                    <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                                        <GroupIcon size={18} className="text-primary" />
                                        {group.label}
                                    </h2>
                                    <p className="mt-1 text-xs text-muted-foreground">{group.description}</p>
                                </div>
                                <span className="text-micro uppercase tracking-wider text-muted-foreground">
                                    {tools.length} tool{tools.length > 1 ? "s" : ""}
                                </span>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                {tools.map((tool) => (
                                    <ToolCard key={tool.id} tool={tool} />
                                ))}
                            </div>
                        </section>
                    );
                })}

                <section className="rounded-lg border border-primary/20 bg-gradient-to-br from-primary/[0.06] via-card to-primary/[0.02] p-6 sm:p-8">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="max-w-2xl">
                            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                                <Crown className="size-5 text-primary" />
                                Ready for Pro?
                            </h2>
                            <p className="mt-2 text-sm text-muted-foreground">
                                Every tool above has a clear Free / Lite path that respects your time. Pro adds the deep workspace —
                                the chart, replay, persistence, AI explanations, and exports — that turn these into a daily trading aid.
                            </p>
                        </div>
                        <Link
                            href="/pricing"
                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
                        >
                            See pricing <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    );
}

function ToolCard({ tool }: { tool: ToolCatalogEntry }) {
    const Icon = ICONS[tool.title.split(" ")[0]] || Calculator;
    const isPro = tool.tier === "pro";

    return (
        <Link
            href={tool.href}
            className={cn(
                "group relative flex flex-col gap-3 rounded-lg border bg-card p-5 transition-all",
                isPro
                    ? "border-primary/15 hover:border-primary/30 hover:bg-card/80"
                    : "border-border hover:border-primary/20 hover:bg-card/80",
            )}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted text-foreground">
                    <Icon size={18} />
                </div>
                <ToolBadge kind={isPro ? "pro" : "lite"} size="sm" />
            </div>
            <div>
                <h3 className="text-sm font-semibold text-foreground">{tool.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                    {tool.description}
                </p>
            </div>
            <ul className="space-y-1.5">
                {(isPro ? tool.proFeatures : tool.liteFeatures).slice(0, 3).map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-micro text-muted-foreground">
                        <span className={cn("mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full", isPro ? "bg-primary" : "bg-muted-foreground/50")} />
                        <span>{f}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-auto flex items-center justify-between border-t border-border/40 pt-3">
                <span className={cn("text-micro font-semibold uppercase tracking-wider", isPro ? "text-primary" : "text-muted-foreground")}>
                    {isPro ? "Pro" : "Lite"}
                </span>
                <span className="inline-flex items-center gap-1 text-micro font-medium text-foreground transition group-hover:gap-1.5">
                    Open <ArrowRight className="size-3" />
                </span>
            </div>
        </Link>
    );
}