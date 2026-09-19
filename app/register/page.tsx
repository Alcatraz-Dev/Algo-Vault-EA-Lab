"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
    createUserWithEmailAndPassword,
    updateProfile,
} from "firebase/auth";
import { ref as dbRef, onValue, set } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import {
    ArrowRight,
    Eye,
    EyeOff,
    Gift,
    Link as LinkIcon,
    Lock,
    Mail,
    ShieldCheck,
    User,
} from "lucide-react";
import SiteLogo from "@/components/ui/site-logo";

export default function RegisterPage() {
    return (
        <Suspense fallback={null}>
            <RegisterForm />
        </Suspense>
    );
}

function RegisterForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const refCode = (searchParams.get("ref") || "").trim().toUpperCase();

    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [referralCode, setReferralCode] = useState(refCode);

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] =
        useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [siteName, setSiteName] = useState("AlgoVault");

    useEffect(() => {
        return onValue(dbRef(database, "settings/siteName"), (snap) => {
            if (snap.exists()) setSiteName(snap.val());
        });
    }, []);

    async function handleRegister(
        e: FormEvent<HTMLFormElement>
    ) {
        e.preventDefault();

        setError("");

        const cleanName = displayName.trim();
        const cleanEmail = email.trim();

        if (!cleanName) {
            setError("Please enter your name.");
            return;
        }

        if (!cleanEmail) {
            setError("Please enter your email address.");
            return;
        }

        if (!password) {
            setError("Please enter a password.");
            return;
        }

        if (password.length < 6) {
            setError(
                "Password must contain at least 6 characters."
            );
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        try {
            setLoading(true);

            // Create Firebase Authentication account
            const userCredential =
                await createUserWithEmailAndPassword(
                    auth,
                    cleanEmail,
                    password
                );

            const user = userCredential.user;

            // Save display name in Firebase Authentication
            await updateProfile(user, {
                displayName: cleanName,
            });

            // Create user profile in Realtime Database
            const cleanRefCode = referralCode.trim().toUpperCase();
            await set(
                dbRef(database, `users/${user.uid}`),
                {
                    uid: user.uid,
                    email: user.email,
                    displayName: cleanName,
                    role: "customer",
                    referredBy: cleanRefCode || null,
                    createdAt: Date.now(),
                }
            );

            // Claim referral credit if the user arrived via a referral link
            if (cleanRefCode) {
                try {
                    const idToken = await user.getIdToken();
                    await fetch("/api/referrals", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`,
                        },
                        body: JSON.stringify({ code: cleanRefCode }),
                    });
                } catch (err) {
                    console.error("REFERRAL CLAIM ERROR:", err);
                }
            }

            // Send user to account page
            router.replace("/account");
        } catch (err: unknown) {
            console.error("REGISTER ERROR:", err);
            const code =
                typeof err === "object" && err !== null && "code" in err
                    ? String((err as { code?: unknown }).code)
                    : "";

            switch (code) {
                case "auth/email-already-in-use":
                    setError(
                        "An account with this email already exists."
                    );
                    break;

                case "auth/invalid-email":
                    setError(
                        "Please enter a valid email address."
                    );
                    break;

                case "auth/weak-password":
                    setError(
                        "Your password is too weak. Please use a stronger password."
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
                        "Unable to create your account. Please try again."
                    );
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="min-h-screen bg-background text-foreground">
            {/* Background effects */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
                            Create your account
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            Join {siteName} and manage your trading products,
                            licenses and purchases.
                        </p>
                    </div>

                    {/* Register Card */}
                    {referralCode && (
                        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
                            <Gift className="h-4 w-4 shrink-0 text-emerald-400" />
                            <p className="text-xs text-emerald-200/90">
                                You were invited by a friend. Creating your account will credit them with a referral.
                            </p>
                        </div>
                    )}

                    <div className="rounded-2xl border border-border/30 bg-muted p-6 shadow-2xl backdrop-blur-xl sm:p-8">
                        <form
                            onSubmit={handleRegister}
                            className="space-y-5"
                        >
                            {/* Name */}
                            <div>
                                <label className="mb-2 block text-sm font-medium text-foreground">
                                    Full name
                                </label>

                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) =>
                                            setDisplayName(e.target.value)
                                        }
                                        placeholder="Your name"
                                        autoComplete="name"
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                    />
                                </div>
                            </div>

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
                                        onChange={(e) =>
                                            setEmail(e.target.value)
                                        }
                                        placeholder="you@example.com"
                                        autoComplete="email"
                                        suppressHydrationWarning
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="mb-2 block text-sm font-medium text-foreground">
                                    Password
                                </label>

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
                                        placeholder="At least 6 characters"
                                        autoComplete="new-password"
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-12 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowPassword(!showPassword)
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-5 w-5" />
                                        ) : (
                                            <Eye className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Confirm Password */}
                            <div>
                                <label className="mb-2 block text-sm font-medium text-foreground">
                                    Confirm password
                                </label>

                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

                                    <input
                                        type={
                                            showConfirmPassword
                                                ? "text"
                                                : "password"
                                        }
                                        value={confirmPassword}
                                        onChange={(e) =>
                                            setConfirmPassword(
                                                e.target.value
                                            )
                                        }
                                        placeholder="Repeat your password"
                                        autoComplete="new-password"
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-12 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowConfirmPassword(
                                                !showConfirmPassword
                                            )
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                                    >
                                        {showConfirmPassword ? (
                                            <EyeOff className="h-5 w-5" />
                                        ) : (
                                            <Eye className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Referral Code */}
                            <div>
                                <label className="mb-2 block text-sm font-medium text-foreground">
                                    Referral code <span className="text-muted-foreground">(optional)</span>
                                </label>

                                <div className="relative">
                                    <LinkIcon className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />

                                    <input
                                        type="text"
                                        value={referralCode}
                                        onChange={(e) =>
                                            setReferralCode(e.target.value.toUpperCase())
                                        }
                                        placeholder="ALGV-XXXXXX"
                                        className="h-12 w-full rounded-xl border border-border/30 bg-background/70 pl-11 pr-4 text-sm font-mono text-foreground outline-none transition placeholder:text-muted-foreground focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/20"
                                    />
                                </div>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                                    {error}
                                </div>
                            )}

                            {/* Submit */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-foreground transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? (
                                    "Creating account..."
                                ) : (
                                    <>
                                        Create account
                                        <ArrowRight className="h-4 w-4" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Login */}
                        <div className="mt-6 text-center text-sm text-muted-foreground">
                            Already have an account?{" "}
                            <Link
                                href="/login"
                                className="font-medium text-foreground hover:underline"
                            >
                                Sign in
                            </Link>
                        </div>
                    </div>

                    {/* Security */}
                    <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" />
                        <span>
                            Secure authentication powered by Firebase
                        </span>
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