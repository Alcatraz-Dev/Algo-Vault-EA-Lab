/**
 * ProGate — renders a premium upgrade prompt when the user isn't Pro, or a
 * feature-flag gate when a specific flag is off. Falls through to children
 * when access is granted.
 *
 * Never blocks on a client-side flag alone — it asks the server first.
 */
import React from "react";
import { ArrowRight, Loader2, Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getAlgoVaultUrl } from "@/config/environment";
import type { ProFeatureFlags } from "@/types/pro";

import { useProAccess } from "@/services/pro-service";

interface ProGateProps {
  isPro?: boolean;
  loading?: boolean;
  /** Optional feature flag to check (on top of isPro). */
  flag?: keyof ProFeatureFlags;
  flags?: ProFeatureFlags;
  flagEnabled?: boolean;
  featureName?: string;
  children: React.ReactNode;
}

const PRICING_PATH = "/pricing";

function openPricing() {
  const url = `${getAlgoVaultUrl()}${PRICING_PATH}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProGate({
  isPro: isProProp,
  loading: loadingProp,
  flag,
  flags: flagsProp,
  flagEnabled,
  featureName = "this feature",
  children,
}: ProGateProps) {
  const proState = useProAccess();
  const isPro = isProProp ?? proState.isPro;
  const loading = loadingProp ?? proState.loading;
  const flags = flagsProp ?? proState.flags;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Checking access…</span>
      </div>
    );
  }

  if (!isPro) {
    return <ProUpgradePrompt featureName={featureName} />;
  }

  if (flag && flags && !flags[flag]) {
    return <FeatureNotEnabledPrompt featureName={featureName} />;
  }

  if (flagEnabled === false) {
    return <FeatureNotEnabledPrompt featureName={featureName} />;
  }

  return <>{children}</>;
}

function ProUpgradePrompt({ featureName }: { featureName: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary">
        <Lock size={18} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">Pro required</p>
        <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
          {featureName.charAt(0).toUpperCase() + featureName.slice(1)} is exclusive to AlgoVault Pro subscribers.
        </p>
      </div>
      <div className="flex w-full max-w-[240px] flex-col gap-2">
        <Button variant="brand" onClick={openPricing} className="gap-1.5">
          Upgrade to Pro <ArrowRight size={11} />
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Entitlement is verified server-side. UI manipulation cannot bypass this gate.
        </p>
      </div>
    </div>
  );
}

function FeatureNotEnabledPrompt({ featureName }: { featureName: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-secondary">
        <ShieldCheck size={18} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">Coming soon</p>
        <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
          {featureName.charAt(0).toUpperCase() + featureName.slice(1)} is not yet enabled on your account.
        </p>
      </div>
    </div>
  );
}
