"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
    AlertTriangle,
    CheckCircle2,
    Cloud,
    Cpu,
    RefreshCw,
    ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";

type ProviderStatus =
    | "ready"
    | "not_configured"
    | "unreachable"
    | "catalog_unavailable"
    | "no_models";

interface ModelRow {
    id: string;
    name: string;
    free: boolean;
    confirmedFree: boolean;
    capabilities?: {
        text?: boolean;
        vision?: boolean;
        tools?: boolean;
        structuredOutput?: boolean;
        reasoning?: boolean;
        streaming?: boolean;
    };
    contextLength?: number;
    expiresAt?: string;
    deprecated?: boolean;
}

interface ProviderRow {
    id: string;
    name: string;
    type: "cloud" | "local";
    available: boolean;
    status: ProviderStatus;
    models: ModelRow[];
}

const PROVIDER_KEY = "algovault.ai.provider";
const MODEL_KEY = "algovault.ai.model";

function readPreference(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writePreference(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // A blocked localStorage must not break the selector.
    }
}

function statusTone(status: ProviderStatus) {
    if (status === "ready") return "positive" as const;
    if (status === "not_configured") return "warning" as const;
    if (status === "unreachable" || status === "catalog_unavailable") return "negative" as const;
    return "neutral" as const;
}

function statusLabel(status: ProviderStatus): string {
    switch (status) {
        case "ready":
            return "Ready";
        case "not_configured":
            return "Not configured";
        case "unreachable":
            return "Not running";
        case "catalog_unavailable":
            return "Catalog unavailable";
        default:
            return "No models";
    }
}

function formatContext(value: number | undefined): string | null {
    if (!value || value <= 0) return null;
    if (value >= 1000) return `${Math.round(value / 1000)}k context`;
    return `${value} context`;
}

export function AIProviderSettingsCard({ user }: { user: User | null }) {
    const [providers, setProviders] = useState<ProviderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [providerId, setProviderId] = useState<string>("");
    const [modelId, setModelId] = useState<string>("");

    const load = useCallback(async (refresh: boolean) => {
        if (refresh) setRefreshing(true);
        else setLoading(true);
        setError(null);
        try {
            const token = user ? await user.getIdToken().catch(() => null) : null;
            const res = await fetch(`/api/ai/models${refresh ? "?refresh=1" : ""}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                cache: "no-store",
            });
            const data = (await res.json().catch(() => null)) as
                | { success?: boolean; providers?: ProviderRow[]; error?: string }
                | null;
            if (!res.ok || !data?.success) {
                throw new Error(
                    data?.error === "UNAUTHENTICATED"
                        ? "Sign in to load AI provider settings."
                        : data?.error || "Failed to load AI providers.",
                );
            }

            const next = (data.providers ?? []).filter(
                (p) => p.models.length > 0 || p.id === "openrouter" || p.id === "ollama",
            );
            setProviders(next);

            const savedProvider = readPreference(PROVIDER_KEY);
            const chosenProvider =
                next.find((p) => p.id === savedProvider) ??
                next.find((p) => p.id === "openrouter") ??
                next[0];
            const savedModel = readPreference(MODEL_KEY);
            const chosenModel =
                chosenProvider?.models.find((m) => m.id === savedModel) ??
                chosenProvider?.models[0];

            setProviderId(chosenProvider?.id ?? "");
            setModelId(chosenModel?.id ?? "");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load AI providers.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [user]);

    useEffect(() => {
        // Defer the first read so the effect does not synchronously cascade
        // setState during commit (react-hooks/set-state-in-effect).
        const timer = setTimeout(() => {
            void load(false);
        }, 0);
        return () => clearTimeout(timer);
    }, [load]);

    const selectedProvider = useMemo(
        () => providers.find((p) => p.id === providerId) ?? null,
        [providers, providerId],
    );
    const selectedModel = useMemo(
        () => selectedProvider?.models.find((m) => m.id === modelId) ?? null,
        [selectedProvider, modelId],
    );

    const chooseProvider = (nextProviderId: string) => {
        const provider = providers.find((p) => p.id === nextProviderId);
        const nextModel = provider?.models[0]?.id ?? "";
        setProviderId(nextProviderId);
        setModelId(nextModel);
        writePreference(PROVIDER_KEY, nextProviderId);
        if (nextModel) writePreference(MODEL_KEY, nextModel);
    };

    const chooseModel = (nextModelId: string) => {
        setModelId(nextModelId);
        writePreference(MODEL_KEY, nextModelId);
    };

    const local = selectedProvider?.type === "local";
    const isHeuristic = selectedProvider?.id === "local-heuristic";
    const context = formatContext(selectedModel?.contextLength);

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <CardTitle>AI Provider & Model</CardTitle>
                        <CardDescription>
                            Choose which service processes your prompts. Automatic mode keeps the
                            existing free-first order and never selects a paid model.
                        </CardDescription>
                    </div>
                    {selectedProvider ? (
                        <StatusBadge
                            tone={statusTone(selectedProvider.status)}
                            label={statusLabel(selectedProvider.status)}
                            dot
                        />
                    ) : null}
                </div>
            </CardHeader>

            <CardContent className="space-y-5">
                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                        Loading providers…
                    </div>
                ) : null}

                {error ? (
                    <div className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative-muted p-3 text-xs text-negative-foreground">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span>{error}</span>
                    </div>
                ) : null}

                {!loading && !error && providers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        No AI provider is configured. Deterministic features keep working; configure
                        a server-side OpenRouter key or start Ollama to enable generative answers.
                    </p>
                ) : null}

                {selectedProvider && selectedProvider.models.length === 0 ? (
                    <div className="rounded-lg border border-warning/30 bg-warning-muted p-3 text-xs text-warning-foreground">
                        This provider has no selectable models right now. For Ollama, install a
                        model with <code className="font-numeric">ollama pull &lt;model&gt;</code> and
                        recheck. Nothing is downloaded automatically.
                    </div>
                ) : null}

                {providers.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label="Provider" htmlFor="ai-provider">
                            <Select
                                id="ai-provider"
                                value={providerId}
                                onChange={(event) => chooseProvider(event.target.value)}
                            >
                                {providers.map((provider) => (
                                    <option key={provider.id} value={provider.id}>
                                        {provider.name}
                                        {provider.type === "local" ? " — local" : ""}
                                    </option>
                                ))}
                            </Select>
                        </FormField>

                        <FormField label="Model" htmlFor="ai-model">
                            <Select
                                id="ai-model"
                                value={modelId}
                                onChange={(event) => chooseModel(event.target.value)}
                            >
                                {selectedProvider?.models.map((model) => (
                                    <option key={model.id} value={model.id}>
                                        {model.name}
                                        {model.confirmedFree ? " — free" : ""}
                                    </option>
                                ))}
                            </Select>
                        </FormField>
                    </div>
                ) : null}

                {selectedModel ? (
                    <div className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            {local ? <Cpu className="size-3" aria-hidden /> : <Cloud className="size-3" aria-hidden />}
                            {selectedModel.id}
                        </span>
                        {context ? <span>{context}</span> : null}
                        {selectedModel.capabilities?.vision ? <span>Vision</span> : null}
                        {selectedModel.capabilities?.tools ? <span>Tools</span> : null}
                        {selectedModel.capabilities?.structuredOutput ? <span>JSON</span> : null}
                        {selectedModel.capabilities?.reasoning ? <span>Reasoning</span> : null}
                    </div>
                ) : null}

                {selectedProvider?.status === "not_configured" && selectedProvider.id === "openrouter" ? (
                    <div className="rounded-lg border border-warning/30 bg-warning-muted p-3 text-xs text-warning-foreground">
                        The public model catalog is available, but the server has no OpenRouter key.
                        Completions will be reported as unavailable until an operator configures one.
                    </div>
                ) : null}

                {selectedProvider?.status === "unreachable" ? (
                    <div className="rounded-lg border border-warning/30 bg-warning-muted p-3 text-xs text-warning-foreground">
                        Ollama is enabled but not reachable. Start Ollama, pull a model you want to
                        use, then recheck. Models are never downloaded automatically.
                    </div>
                ) : null}

                <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
                    {isHeuristic ? (
                        <span className="flex items-start gap-2">
                            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
                            The deterministic engine runs in-process and makes no external request.
                        </span>
                    ) : local ? (
                        <span className="flex items-start gap-2">
                            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
                            Prompts stay on this computer. Ollama is reached through a loopback
                            endpoint and is never exposed to the public internet.
                        </span>
                    ) : (
                        <span className="flex items-start gap-2">
                            <Cloud className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
                            Prompts are sent to OpenRouter and the selected upstream model provider.
                            Free models are rate-limited and may be logged according to the upstream
                            provider&apos;s policy. Never include secrets or personal data.
                        </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-1.5 text-micro text-muted-foreground">
                        <CheckCircle2 className="size-3 text-positive" aria-hidden />
                        Saved on this device only. Automatic mode is unchanged — send this
                        provider and model with mode <code className="font-numeric">strict</code> to
                        pin them explicitly.
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void load(true)}
                        disabled={refreshing}
                    >
                        <RefreshCw className={refreshing ? "animate-spin" : ""} aria-hidden />
                        Recheck connection
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
