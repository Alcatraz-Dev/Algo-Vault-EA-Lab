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
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-[300px] space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
            <Zap size={20} className="text-violet-400" />
          </div>
          <h1 className="text-base font-semibold text-[#f0f0f5]">AlgoVault</h1>
          <p className="text-[11px] text-[#8888aa] text-center">
            Sign in to access your trading dashboard
          </p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-3">
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#f0f0f5] placeholder:text-[#55556a] outline-none focus:border-violet-500/30"
              required
            />
          </div>
          <div>
            <label className="text-[10px] text-[#8888aa] uppercase tracking-wider mb-1 block">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-[#f0f0f5] placeholder:text-[#55556a] outline-none focus:border-violet-500/30"
              required
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 text-rose-400 text-[11px] border border-rose-500/20">
              <AlertCircle size={12} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full py-2.5 rounded-lg bg-violet-500 text-white text-xs font-semibold hover:bg-violet-600 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <a
          href={`${getAlgoVaultUrl()}/login`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-[11px] text-[#8888aa] hover:text-violet-400 transition-colors"
        >
          Sign in on AlgoVault website
          <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
