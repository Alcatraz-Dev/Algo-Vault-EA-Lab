"use client";

// /account/performance-arena/leaderboard
// Leaderboard page inside customer account area.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ArrowLeft, Medal, Users } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { auth } from "@/lib/firebase";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArenaDisclaimer, ArenaError, ArenaLoading, SimulatedBadge } from "@/components/performance-arena/primitives";
import { useAuthToken } from "@/lib/scalping/client";
import { ARENA_DISCLAIMERS, type LeaderboardSnapshot } from "@/lib/performance-arena/types";

export default function AccountLeaderboardPage() {
  const router = useRouter();
  const token = useAuthToken();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        router.replace("/login?redirect=/account/performance-arena/leaderboard");
      }
    });
    return () => unsub();
  }, [router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/performance-arena/leaderboard", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await res.json()) as { snapshot?: LeaderboardSnapshot; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load the leaderboard.");
      setSnapshot(body.snapshot ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the leaderboard.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const kick = setTimeout(() => void load(), 0);
    return () => clearTimeout(kick);
  }, [load]);

  if (user === undefined) return null;
  if (user === null) {
    return (
      <AccountShell title="Leaderboard">
        <ArenaLoading label="Redirecting to login…" />
      </AccountShell>
    );
  }

  return (
    <AccountShell title="Leaderboard" subtitle="Composite performance ranking across simulated challenges." eyebrow={<SimulatedBadge />}>
      <Link href="/account/performance-arena" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Performance Arena
      </Link>

      <div className="mb-4 rounded-lg border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" /> Season ranking
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Score combines return ({Math.round((snapshot?.policy.weights.return ?? 0.35) * 100)}%), drawdown control (
          {Math.round((snapshot?.policy.weights.drawdown ?? 0.25) * 100)}%), consistency, risk discipline and completion — raw profit
          alone never determines rank. Minimum {snapshot?.policy.minTrades ?? 5} trades to qualify.
        </p>
      </div>

      {loading ? <ArenaLoading label="Loading leaderboard…" /> : null}
      {error ? <ArenaError message={error} onRetry={() => void load()} /> : null}

      {!loading && !error ? (
        snapshot && snapshot.entries.length > 0 ? (
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Trader</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  <TableHead className="text-right">Max DD</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Consistency</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.entries.slice(0, 50).map((entry, index) => (
                  <TableRow key={entry.attemptId}>
                    <TableCell className="font-numeric text-xs">
                      {index < 3 ? <Medal className={`h-3.5 w-3.5 ${index === 0 ? "text-warning" : index === 1 ? "text-muted-foreground" : "text-warning"}`} /> : index + 1}
                    </TableCell>
                    <TableCell className="font-numeric text-xs">{entry.displayLabel}</TableCell>
                    <TableCell><Badge variant="outline">{entry.tier}</Badge></TableCell>
                    <TableCell><Badge variant={entry.status === "PASSED" ? "success" : "secondary"}>{entry.status}</Badge></TableCell>
                    <TableCell className={`text-right font-numeric text-xs ${entry.totalReturnPct >= 0 ? "text-positive" : "text-negative"}`}>
                      {entry.totalReturnPct >= 0 ? "+" : ""}
                      {entry.totalReturnPct.toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right font-numeric text-xs">{entry.maxDrawdownPct.toFixed(2)}%</TableCell>
                    <TableCell className="text-right font-numeric text-xs">{entry.tradingDays}</TableCell>
                    <TableCell className="text-right font-numeric text-xs">{entry.consistencyScore.toFixed(0)}</TableCell>
                    <TableCell className="text-right font-numeric text-sm font-semibold">{entry.score.toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t border-border px-4 py-2 text-micro text-muted-foreground">{snapshot.disclaimer || ARENA_DISCLAIMERS.leaderboard}</p>
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No qualifying attempts yet. Complete a challenge with at least {snapshot?.policy.minTrades ?? 5} trades to appear here.
          </p>
        )
      ) : null}

      <ArenaDisclaimer className="mt-4">{ARENA_DISCLAIMERS.leaderboard}</ArenaDisclaimer>
    </AccountShell>
  );
}
