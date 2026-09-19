"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function LoginPage() {
    const router = useRouter();

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
            router.replace("/account");
        } catch (err: any) {
            console.error("LOGIN ERROR:", err);

            switch (err?.code) {
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
                        `Unable to sign in. ${err?.message || "Please try again."
                        }`
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
        } catch (err: any) {
            console.error("PASSWORD RESET ERROR:", err);
            console.error("Firebase error code:", err?.code);
            console.error("Firebase error message:", err?.message);

            switch (err?.code) {
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
                        `Password reset failed. Firebase error: ${err?.code || "unknown"
                        }`
                    );
            }
        } finally {
            setResetting(false);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute left-1/2 top-[-300px] h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-violet-500/10 blur-[120px]" />
                <div className="absolute bottom-[-200px] right-[-100px] h-[400px] w-[400px] rounded-full bg-purple-500/10 blur-[120px]" />
            </div>

            <div className="relative flex min-h-screen items-center justify-center px-4 py-12">
                <div className="w-full max-w-md">
                    {/* Logo */}
                    <div className="mb-8 text-center">
                        <Link
                            href="/"
                            className="inline-flex items-center gap-3"
                        >
                            <SiteLogo size={22} />
                            <span className="text-2xl font-bold tracking-tight">
                                {siteName}
                            </span>
                        </Link>

                        <h1 className="mt-8 text-3xl font-bold">
                            Welcome back
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Sign in to manage your products, licenses and account.
                        </p>
                    </div>

                    {/* Card */}
                    <div className="rounded-2xl border border-border/30 bg-muted p-6 shadow-2xl backdrop-blur-xl sm:p-8">
                        <form onSubmit={handleLogin} className="space-y-5">
                            {/* Email */}
                            <div>
                                <label className="mb-2 block text-sm font-medium text-foreground">
                                    Email
                                </label>

                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="you@example.com"
                                        autoComplete="email"
                                        suppressHydrationWarning
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <label className="block text-sm font-medium text-foreground">
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
                                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

                                    <input
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
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-12 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
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
                                            <EyeOff className="h-5 w-5" />
                                        ) : (
                                            <Eye className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Remember */}
                            <label className="flex cursor-pointer items-center gap-3 text-sm text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) =>
                                        setRememberMe(e.target.checked)
                                    }
                                    className="h-4 w-4 rounded border-border/50 bg-background/70"
                                />

                                <span>Remember me</span>
                            </label>

                            {/* Error */}
                            {error && (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                    {error}
                                </div>
                            )}

                            {/* Success */}
                            {message && (
                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                                    {message}
                                </div>
                            )}

                            {/* Login */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-foreground transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? (
                                    "Signing in..."
                                ) : (
                                    <>
                                        Sign in
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Register */}
                        <div className="mt-6 text-center text-sm text-muted-foreground">
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
                    <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" />
                        <span>Secure authentication powered by Firebase</span>
                    </div>

                    <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">
                        Trading involves significant risk. Past performance,
                        backtests and simulated results do not guarantee future
                        results.
                    </p>
                </div>
            </div>
        </main>
    );
}