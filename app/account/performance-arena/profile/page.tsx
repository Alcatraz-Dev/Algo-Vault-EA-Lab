"use client";

// /account/performance-arena/profile
// Trader Profile page inside customer account area.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ArrowLeft, Award, Coins, History, Wallet } from "lucide-react";
import AccountShell from "@/components/account/AccountShell";
import { auth } from "@/lib/firebase";
import { MetricCard } from "@/components/ui/metric-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArenaDisclaimer, ArenaError, ArenaLoading, ChallengeStatusBadge, SimulatedBadge } from "@/components/performance-arena/primitives";
import { useAuthToken } from "@/lib/scalping/client";
import { ARENA_DISCLAIMERS, type CreditWallet, type RewardLedgerEntry, type TraderPerformanceProfile } from "@/lib/performance-arena/types";

interface ProfileResponse {
  profile: TraderPerformanceProfile;
  wallet: CreditWallet;
  recentRewards: RewardLedgerEntry[];
}

export default function AccountTraderProfilePage() {
  const router = useRouter();
  const token = useAuthToken();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        router.replace("/login?redirect=/account/performance-arena/profile");
      }
    });
    return () => unsub();
  }, [router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/performance-arena/profile", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = (await res.json()) as ProfileResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load the profile.");
      setData(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the profile.");
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
      <AccountShell title="Trader Profile">
        <ArenaLoading label="Redirecting to login…" />
      </AccountShell>
    );
  }

  const profile = data?.profile;

  return (
    <AccountShell
      title="Trader Profile"
      subtitle="Verified simulated performance history inside AlgoVault."
      eyebrow={<SimulatedBadge />}
      headerActions={
        <Link href="/account/performance-arena" className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
          <ArrowLeft className="h-3.5 w-3.5" /> Arena
        </Link>
      }
    >
      {loading ? <ArenaLoading label="Loading profile…" /> : null}
      {error ? <ArenaError message={error} onRetry={() => void load()} /> : null}

      {profile && data ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Challenges attempted" value={profile.attempted} />
            <MetricCard label="Completed" value={profile.completed} footnote={`${profile.passed} passed · ${profile.failed} failed`} />
            <MetricCard label="Best return" value={`${profile.bestReturnPct >= 0 ? "+" : ""}${profile.bestReturnPct.toFixed(2)}%`} deltaTone={profile.bestReturnPct >= 0 ? "up" : "down"} />
            <MetricCard label="Avg drawdown" value={`${profile.avgDrawdownPct.toFixed(2)}%`} />
            <MetricCard label="Consistency score" value={profile.consistencyScore} footnote="share of runs inside limits" />
            <MetricCard label="Total trades" value={profile.totalTrades} />
            <MetricCard label="AV Points" value={data.wallet.avPoints.toLocaleString()} icon={<Coins className="h-3.5 w-3.5" />} />
            <MetricCard label="AI credits" value={data.wallet.aiCredits.toLocaleString()} footnote={`${data.wallet.proDays} pro days banked`} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Award className="h-4 w-4" /> Badges & markets
              </h3>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {profile.badges.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No badges yet — pass a challenge to earn the Verified Trader badge.</span>
                ) : (
                  profile.badges.map((badge) => (
                    <Badge key={badge} variant="success">{badge.replace(/-/g, " ")}</Badge>
                  ))
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {profile.markets.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No markets traded yet.</span>
                ) : (
                  profile.markets.map((market) => <Badge key={market} variant="outline">{market}</Badge>)
                )}
              </div>
              <p className="mt-3 text-micro text-muted-foreground">Visibility: {profile.visibility}</p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Wallet className="h-4 w-4" /> Reward ledger
              </h3>
              {data.recentRewards.length === 0 ? (
                <p className="text-xs text-muted-foreground">No rewards granted yet.</p>
              ) : (
                <div className="max-h-56 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reward</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.recentRewards.map((entry) => (
                        <TableRow key={entry.rewardId}>
                          <TableCell className="text-xs">{entry.rewardType.replace(/_/g, " ")}</TableCell>
                          <TableCell className={`text-right font-mono text-xs ${entry.amount < 0 ? "text-red-500" : ""}`}>
                            {entry.amount > 0 ? "+" : ""}
                            {entry.amount} <span className="text-muted-foreground">{entry.unit}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={entry.status === "GRANTED" ? "success" : entry.status === "REVOKED" ? "destructive" : "secondary"}>
                              {entry.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>

          <div className="mb-4 rounded-lg border border-border bg-card">
            <h3 className="mb-2 flex items-center gap-2 border-b border-border p-4 text-sm font-semibold">
              <History className="h-4 w-4" /> Performance history
            </h3>
            {profile.history.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No challenges yet — join one from the catalog.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Challenge</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Return</TableHead>
                    <TableHead className="text-right">Max DD</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.history.map((item) => (
                    <TableRow key={item.attemptId}>
                      <TableCell>
                        <Link href={`/account/performance-arena/attempts/${item.attemptId}`} className="font-mono text-xs text-primary hover:underline">
                          {item.definitionKey}
                        </Link>
                      </TableCell>
                      <TableCell><ChallengeStatusBadge status={item.status} /></TableCell>
                      <TableCell className={`text-right font-mono text-xs ${item.totalReturnPct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {item.totalReturnPct >= 0 ? "+" : ""}
                        {item.totalReturnPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{item.maxDrawdownPct.toFixed(2)}%</TableCell>
                      <TableCell className="text-right font-mono text-xs">{item.tradingDays}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{item.tradeCount}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {new Date(item.startedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <ArenaDisclaimer>{profile.disclaimer ?? ARENA_DISCLAIMERS.challengeScope}</ArenaDisclaimer>
        </>
      ) : null}
    </AccountShell>
  );
}
