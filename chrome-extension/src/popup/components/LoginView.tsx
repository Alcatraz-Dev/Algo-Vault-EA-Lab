import React, { useState } from "react";
import { Eye, EyeOff, ExternalLink, Loader2 } from "lucide-react";
import { signInWithEmail } from "@/auth/auth";
import { canAttemptSignIn, PRIVACY_POLICY_PATH } from "@/auth/consent";
import { DataConsentNotice } from "@/components/DataConsentNotice";
import { getAlgoVaultUrl } from "@/config/environment";
import { Alert, Button, Input, Label } from "./ui";

/** The real AlgoVault logo, same asset the website header uses. */
const LOGO_URL = chrome.runtime.getURL("logos/logo.png");

interface LoginViewProps {
  onAuth: () => void;
}

export function LoginView({ onAuth }: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = canAttemptSignIn({ email, password, consentGiven: consent, loading });

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    // Consent + credential gate: sign-in cannot proceed without explicit
    // data-handling consent (unchecked by default). Re-checked here so a
    // submit event can never bypass the disabled button state.
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const result = await signInWithEmail(email, password);
    if (result.success) {
      onAuth();
    } else {
      setError(result.error || "Authentication failed");
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-base px-6 py-8">
      <div className="mx-auto w-full max-w-[300px]">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg border border-edge/70 bg-raised/50">
            <img
              src={LOGO_URL}
              alt="AlgoVault logo"
              className="h-5 w-5 object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </span>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">AlgoVault</h1>
            <p className="text-[11px] text-ink-mute">Trading Intelligence</p>
          </div>
        </div>

        <h2 className="mt-6 text-base font-semibold tracking-tight">Sign in</h2>
        <p className="mt-1 text-[11px] leading-snug text-ink-mute">
          Use your AlgoVault account to access analysis, signals, and trading tools.
        </p>

        <form onSubmit={handleSignIn} className="mt-4 space-y-3">
          <div>
            <Label htmlFor="av-login-email">Email</Label>
            <Input
              id="av-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <Label htmlFor="av-login-password">Password</Label>
            <div className="relative">
              <Input
                id="av-login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint transition-colors hover:text-ink"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {error && <Alert variant="error">{error}</Alert>}

          <DataConsentNotice
            checked={consent}
            onChange={setConsent}
            privacyUrl={`${getAlgoVaultUrl()}${PRIVACY_POLICY_PATH}`}
          />

          <Button type="submit" size="lg" disabled={!canSubmit} className="w-full">
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <a
          href={`${getAlgoVaultUrl()}/login`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-mute transition-colors hover:text-ink"
        >
          Sign in on the AlgoVault website
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
