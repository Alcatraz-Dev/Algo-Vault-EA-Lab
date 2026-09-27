import React, { useState } from "react";
import { Zap, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { signInWithEmail } from "@/auth/auth";
import { getAlgoVaultUrl } from "@/config/environment";

interface LoginViewProps {
  onAuth: () => void;
}

export function LoginView({ onAuth }: LoginViewProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-base p-6">
      <div className="w-full max-w-[300px] space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15">
            <Zap size={22} className="text-brand-500" />
          </div>
          <h1 className="text-base font-semibold text-ink">AlgoVault</h1>
          <p className="text-center text-[11px] text-ink-mute">
            Sign in to access your trading dashboard
          </p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-mute">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand-500/60"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-ink-mute">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-lg border border-edge bg-raised px-3 py-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand-500/60"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-400">
              <AlertCircle size={12} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-400 disabled:opacity-40"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <a
          href={`${getAlgoVaultUrl()}/login`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-[11px] text-ink-mute transition-colors hover:text-brand-400"
        >
          Sign in on AlgoVault website
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
