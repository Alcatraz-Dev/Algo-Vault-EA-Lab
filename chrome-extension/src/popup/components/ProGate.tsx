/**
 * ProGate — renders a premium upgrade prompt when the user isn't Pro, or a
 * feature-flag gate when a specific flag is off. Falls through to children
 * when access is granted.
 *
 * Never blocks on a client-side flag alone — it asks the server first.
 */
import React from "react";
import { Loader2, Lock, ArrowRight, ShieldCheck } from "lucide-react";
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
        <Loader2 size={14} className="animate-spin text-brand-500" />
        <span className="text-xs text-ink-mute">Checking access…</span>
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
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4 py-6 text-center animate-fade-in">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/10">
        <Lock size={20} className="text-brand-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">Pro required</p>
        <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-ink-mute">
          {featureName.charAt(0).toUpperCase() + featureName.slice(1)} is exclusive to AlgoVault Pro subscribers.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-[240px]">
        <button
          onClick={openPricing}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-400 active:scale-95"
        >
          Upgrade to Pro <ArrowRight size={11} />
        </button>
        <p className="text-[9px] text-ink-faint">
          Entitlement is verified server-side. UI manipulation cannot bypass this gate.
        </p>
      </div>
    </div>
  );
}

function FeatureNotEnabledPrompt({ featureName }: { featureName: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-6 text-center animate-fade-in">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-raised">
        <ShieldCheck size={20} className="text-ink-mute" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">Coming soon</p>
        <p className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-ink-mute">
          {featureName.charAt(0).toUpperCase() + featureName.slice(1)} is not yet enabled on your account.
        </p>
      </div>
    </div>
  );
}
