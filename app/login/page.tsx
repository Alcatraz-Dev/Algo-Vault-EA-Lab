"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    browserLocalPersistence,
    browserSessionPersistence,
    sendPasswordResetEmail,
    setPersistence,
    signInWithEmailAndPassword,

} from "firebase/auth";
import { ref as dbRef, onValue } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import SiteLogo from "@/components/ui/site-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-field";

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginForm />
        </Suspense>
    );
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(true);

    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        return onValue(dbRef(database, "settings/siteName"), (snap) => {
            if (snap.exists()) setSiteName(snap.val());
        });
    }, []);

    async function handleLogin(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();

        setError("");
        setMessage("");

        if (!email.trim() || !password) {
            setError("Please enter your email and password.");
            return;
        }

        try {
            setLoading(true);

            // Set Firebase authentication persistence BEFORE signing in.
            if (rememberMe) {
                await setPersistence(auth, browserLocalPersistence);
            } else {
                await setPersistence(auth, browserSessionPersistence);
            }

            // Sign in after persistence has been configured.
            await signInWithEmailAndPassword(
                auth,
                email.trim(),
                password
            );

            // Firebase now keeps the session according to the
            // persistence selected above.
            const redirect = (searchParams.get("redirect") || "").trim();
            router.replace(redirect.startsWith("/") ? redirect : "/account");
        } catch (err: unknown) {
            console.error("LOGIN ERROR:", err);
            const code =
                typeof err === "object" && err !== null && "code" in err
                    ? String((err as { code?: unknown }).code)
                    : "";

            switch (code) {
                case "auth/invalid-credential":
                case "auth/wrong-password":
                case "auth/user-not-found":
                    setError("Incorrect email or password.");
                    break;

                case "auth/invalid-email":
                    setError("Please enter a valid email address.");
                    break;

                case "auth/too-many-requests":
                    setError(
                        "Too many login attempts. Please try again later."
                    );
                    break;

                case "auth/network-request-failed":
                    setError(
                        "Network error. Please check your internet connection."
                    );
                    break;

                default:
                    setError(
                        (err instanceof Error ? err.message : null) ||
                        "Unable to sign in. Please try again."
                    );
            }
        } finally {
            setLoading(false);
        }
    }

    async function handleForgotPassword() {
        setError("");
        setMessage("");

        const cleanEmail = email.trim();

        if (!cleanEmail) {
            setError(
                "Enter your email address first, then click Forgot password."
            );
            return;
        }

        try {
            setResetting(true);

            await sendPasswordResetEmail(auth, cleanEmail);

            setMessage(
                "Password reset email sent. Please check your inbox and spam folder."
            );
        } catch (err: unknown) {
            console.error("PASSWORD RESET ERROR:", err);
            const code =
                typeof err === "object" && err !== null && "code" in err
                    ? String((err as { code?: unknown }).code)
                    : "";

            switch (code) {
                case "auth/invalid-email":
                    setError("Please enter a valid email address.");
                    break;

                case "auth/user-not-found":
                    setError("No account was found with this email.");
                    break;

                case "auth/operation-not-allowed":
                    setError(
                        "Password reset is not enabled for Email/Password authentication."
                    );
                    break;

                case "auth/too-many-requests":
                    setError(
                        "Too many attempts. Please wait a little and try again."
                    );
                    break;

                case "auth/network-request-failed":
                    setError(
                        "Network error. Please check your internet connection."
                    );
                    break;

                default:
                    setError(
                        `Password reset failed. Firebase error: ${code || "unknown"
                        }`
                    );
            }
        } finally {
            setResetting(false);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground">
            {/* Ambient background, brand-toned like the home hero */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="hero-radial left-1/2 top-[-320px] h-[560px] w-[820px] -translate-x-1/2" />
                <div className="hero-radial hero-radial-positive bottom-[-260px] right-[-160px] h-[420px] w-[420px]" />
            </div>

            <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
                <div className="w-full max-w-md animate-page-enter">
                    {/* Logo */}
                    <div className="mb-8 text-center">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-2.5"
                        >
                            <SiteLogo size={20} />
                            <span className="text-lg font-semibold tracking-tight">
                                {siteName}
                            </span>
                        </Link>

                        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
                            Welcome back
                        </h1>

                        <p className="mt-1.5 text-sm text-muted-foreground">
                            Sign in to manage your products, licenses and account.
                        </p>
                    </div>

                    {/* Card */}
                    <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
                        <form onSubmit={handleLogin} className="space-y-5">
                            {/* Email */}
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="login-email"
                                    className="block text-xs font-medium text-foreground"
                                >
                                    Email
                                </label>

                                <div className="relative">
                                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="login-email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        autoComplete="email"
                                        suppressHydrationWarning
                                        className="h-11 pl-9"
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                    <label
                                        htmlFor="login-password"
                                        className="block text-xs font-medium text-foreground"
                                    >
                                        Password
                                    </label>

                                    <button
                                        type="button"
                                        onClick={handleForgotPassword}
                                        disabled={resetting}
                                        className="text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                                    >
                                        {resetting
                                            ? "Sending..."
                                            : "Forgot password?"}
                                    </button>
                                </div>

                                <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="login-password"
                                        type={
                                            showPassword
                                                ? "text"
                                                : "password"
                                        }
                                        value={password}
                                        onChange={(e) =>
                                            setPassword(e.target.value)
                                        }
                                        placeholder="••••••••"
                                        autoComplete="current-password"
                                        className="h-11 pl-9 pr-10"
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                                        aria-label={
                                            showPassword
                                                ? "Hide password"
                                                : "Show password"
                                        }
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Remember */}
                            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) =>
                                        setRememberMe(e.target.checked)
                                    }
                                    className="h-3.5 w-3.5 rounded accent-primary"
                                />

                                <span>Remember me on this device</span>
                            </label>

                            {/* Error */}
                            {error && <FormError>{error}</FormError>}

                            {/* Success */}
                            {message && (
                                <div
                                    role="status"
                                    className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400"
                                >
                                    {message}
                                </div>
                            )}

                            {/* Login */}
                            <Button
                                type="submit"
                                size="lg"
                                disabled={loading}
                                className="h-11 w-full"
                            >
                                {loading ? (
                                    "Signing in..."
                                ) : (
                                    <>
                                        Sign in
                                        <ArrowRight data-icon="inline-end" />
                                    </>
                                )}
                            </Button>
                        </form>

                        {/* Register */}
                        <div className="mt-6 border-t border-border pt-5 text-center text-xs text-muted-foreground">
                            Don&apos;t have an account?{" "}
                            <Link
                                href="/register"
                                className="font-medium text-foreground hover:underline"
                            >
                                Create account
                            </Link>
                        </div>
                    </div>

                    {/* Security */}
                    <div className="mt-6 flex items-center justify-center gap-2 text-micro text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Secure authentication powered by Firebase</span>
                    </div>

                    <p className="mt-4 text-center text-micro leading-5 text-muted-foreground">
                        Trading involves significant risk. Past performance,
                        backtests and simulated results do not guarantee future
                        results.
                    </p>
                </div>
            </div>
        </main>
    );
}
