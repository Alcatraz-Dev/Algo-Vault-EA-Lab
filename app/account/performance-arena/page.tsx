"use client";

// /account/performance-arena — Performance Arena mounted inside the customer
// area with protected routing. Redirects to /login when unauthenticated, then
// renders the same catalog experience inside AccountShell.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { Trophy, Users, Wallet } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { auth } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { ChallengeCard } from "@/components/performance-arena/ChallengeCard";
import {
  ArenaDisclaimer,
  ArenaError,
  ArenaLoading,
  ChallengeStatusBadge,
  SimulatedBadge,
} from "@/components/performance-arena/primitives";
import { useAuthToken } from "@/lib/scalping/client";
import type { CatalogItem } from "@/lib/performance-arena/service";
import type { ChallengeMetrics, ChallengeStatus } from "@/lib/performance-arena/types";
import { ARENA_DISCLAIMERS } from "@/lib/performance-arena/types";

interface ActiveAttemptRow {
  attempt: { id: string; definitionKey: string; status: ChallengeStatus };
  metrics: ChallengeMetrics | null;
}

interface Flags {
  performanceArenaEnabled: boolean;
  challengeCatalogEnabled: boolean;
  leaderboardsEnabled: boolean;
  platformRewardsEnabled: boolean;
  disclaimers?: string[];
}

export default function AccountPerformanceArenaPage() {
  const router = useRouter();
  const token = useAuthToken();
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [active, setActive] = useState<ActiveAttemptRow[]>([]);
  const [flags, setFlags] = useState<Flags | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth guard: redirect unauthenticated users to /login
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        router.replace("/login?redirect=/account/performance-arena");
      }
    });
    return () => unsub();
  }, [router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [flagsRes, catalogRes, attemptsRes] = await Promise.all([
        fetch("/api/performance-arena/flags", { cache: "no-store" }),
        fetch("/api/performance-arena/catalog", { headers, cache: "no-store" }),
        fetch("/api/performance-arena/attempts", { headers, cache: "no-store" }),
      ]);
      const flagsBody = (await flagsRes.json()) as Flags;
      setFlags(flagsBody);
      if (!catalogRes.ok) {
        const body = (await catalogRes.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to load the catalog.");
      }
      const catalogBody = (await catalogRes.json()) as { items?: CatalogItem[] };
      setItems(catalogBody.items ?? []);
      if (attemptsRes.ok) {
        const attemptsBody = (await attemptsRes.json()) as { attempts?: ActiveAttemptRow[] };
        setActive(
          (attemptsBody.attempts ?? []).filter(
            (a) => a.attempt.status === "ACTIVE" || a.attempt.status === "PAUSED"
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the Performance Arena.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const kick = setTimeout(() => void load(), 0);
    return () => clearTimeout(kick);
  }, [load]);

  // Show nothing while auth state is resolving
  if (user === undefined) return null;

  // Redirect already fired above; show spinner while navigating
  if (user === null) {
    return (
      <AccountShell title="Performance Arena" subtitle="Simulated challenge environment">
        <ArenaLoading label="Redirecting to login…" />
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Performance Arena"
      subtitle="Simulated trading challenges with virtual capital, deterministic rules and platform rewards."
      eyebrow={<SimulatedBadge />}
      headerActions={
        <div className="flex items-center gap-2">
          <Link
            href="/account/performance-arena/leaderboard"
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Users className="h-3.5 w-3.5" /> Leaderboard
          </Link>
          <Link
            href="/account/performance-arena/profile"
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
          >
            <Wallet className="h-3.5 w-3.5" /> Trader profile
          </Link>
        </div>
      }
    >
      <div className="mb-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Trophy className="h-4 w-4 text-primary" /> AlgoVault Performance Arena
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Take a simulated challenge with virtual starting capital, trade under configurable
              rules, and build a verified performance history inside AlgoVault. Rewards are platform
              rewards only.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {flags && !flags.leaderboardsEnabled ? (
              <Badge variant="outline">Leaderboards off</Badge>
            ) : null}
            <Badge variant="secondary">Cash rewards: disabled</Badge>
          </div>
        </div>
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          {(
            flags?.disclaimers ?? [
              ARENA_DISCLAIMERS.simulated,
              ARENA_DISCLAIMERS.noGuarantees,
              ARENA_DISCLAIMERS.aiInformational,
              ARENA_DISCLAIMERS.challengeScope,
            ]
          ).map((line) => (
            <ArenaDisclaimer key={line}>{line}</ArenaDisclaimer>
          ))}
        </div>
      </div>

      {loading ? <ArenaLoading label="Loading challenges…" /> : null}
      {error ? <ArenaError message={error} onRetry={() => void load()} /> : null}

      {!loading && !error && active.length > 0 ? (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">Your active challenges</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map(({ attempt, metrics }) => (
              <Link
                key={attempt.id}
                href={`/account/performance-arena/attempts/${attempt.id}`}
                className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex items-center justify-between">
                  <span className="font-numeric text-sm font-medium">{attempt.definitionKey}</span>
                  <ChallengeStatusBadge status={attempt.status} />
                </div>
                {metrics ? (
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Equity{" "}
                      <span className="font-numeric text-foreground">
                        ${(metrics.equityCents / 100).toLocaleString()}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Return{" "}
                      <span
                        className={`font-numeric ${metrics.totalReturnPct >= 0 ? "text-positive" : "text-negative"}`}
                      >
                        {metrics.totalReturnPct >= 0 ? "+" : ""}
                        {metrics.totalReturnPct.toFixed(2)}%
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Drawdown{" "}
                      <span className="font-numeric text-foreground">
                        {metrics.currentDrawdownPct.toFixed(2)}%
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Target{" "}
                      <span className="font-numeric text-foreground">
                        {metrics.targetProgressPct.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && !error ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Challenge catalog</h3>
            <span className="text-xs text-muted-foreground">{items?.length ?? 0} available</span>
          </div>
          {items && items.length === 0 ? (
            <ArenaLoading label="No challenges are published right now." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {(items ?? []).map((item) => (
                <ChallengeCard key={item.definition.id} item={item} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </AccountShell>
  );
}
