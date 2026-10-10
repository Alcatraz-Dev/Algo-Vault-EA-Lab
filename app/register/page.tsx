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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-field";

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
                            Create your account
                        </h1>

                        <p className="mt-1.5 text-sm text-muted-foreground">
                            Join {siteName} and manage your trading products,
                            licenses and purchases.
                        </p>
                    </div>

                    {/* Register Card */}
                    {referralCode && (
                        <div className="mb-4 flex items-center gap-3 rounded-lg border border-positive/30 bg-positive-muted px-4 py-3">
                            <Gift className="h-4 w-4 shrink-0 text-positive" />
                            <p className="text-xs text-positive-foreground">
                                You were invited by a friend. Creating your account will credit them with a referral.
                            </p>
                        </div>
                    )}

                    <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
                        <form
                            onSubmit={handleRegister}
                            className="space-y-5"
                        >
                            {/* Name */}
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="register-name"
                                    className="block text-xs font-medium text-foreground"
                                >
                                    Full name
                                </label>

                                <div className="relative">
                                    <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="register-name"
                                        type="text"
                                        value={displayName}
                                        onChange={(e) =>
                                            setDisplayName(e.target.value)
                                        }
                                        placeholder="Your name"
                                        autoComplete="name"
                                        className="h-11 pl-9"
                                    />
                                </div>
                            </div>

                            {/* Email */}
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="register-email"
                                    className="block text-xs font-medium text-foreground"
                                >
                                    Email
                                </label>

                                <div className="relative">
                                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="register-email"
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
                                <label
                                    htmlFor="register-password"
                                    className="block text-xs font-medium text-foreground"
                                >
                                    Password
                                </label>

                                <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="register-password"
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

                            {/* Confirm Password */}
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="register-confirm-password"
                                    className="block text-xs font-medium text-foreground"
                                >
                                    Confirm password
                                </label>

                                <div className="relative">
                                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="register-confirm-password"
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
                                        className="h-11 pl-9 pr-10"
                                    />

                                    <button
                                        type="button"
                                        onClick={() =>
                                            setShowConfirmPassword(
                                                !showConfirmPassword
                                            )
                                        }
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                                        aria-label={
                                            showConfirmPassword
                                                ? "Hide password confirmation"
                                                : "Show password confirmation"
                                        }
                                    >
                                        {showConfirmPassword ? (
                                            <EyeOff className="h-4 w-4" />
                                        ) : (
                                            <Eye className="h-4 w-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                            {/* Referral Code */}
                            <div className="space-y-1.5">
                                <label
                                    htmlFor="register-referral"
                                    className="block text-xs font-medium text-foreground"
                                >
                                    Referral code{" "}
                                    <span className="font-normal text-muted-foreground">(optional)</span>
                                </label>

                                <div className="relative">
                                    <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                                    <Input
                                        id="register-referral"
                                        type="text"
                                        value={referralCode}
                                        onChange={(e) =>
                                            setReferralCode(e.target.value.toUpperCase())
                                        }
                                        placeholder="ALGV-XXXXXX"
                                        className="h-11 pl-9 font-mono"
                                    />
                                </div>
                            </div>

                            {/* Error */}
                            {error && <FormError>{error}</FormError>}

                            {/* Submit */}
                            <Button
                                type="submit"
                                size="lg"
                                disabled={loading}
                                className="h-11 w-full"
                            >
                                {loading ? (
                                    "Creating account..."
                                ) : (
                                    <>
                                        Create account
                                        <ArrowRight data-icon="inline-end" />
                                    </>
                                )}
                            </Button>
                        </form>

                        {/* Login */}
                        <div className="mt-6 border-t border-border pt-5 text-center text-xs text-muted-foreground">
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
                    <div className="mt-6 flex items-center justify-center gap-2 text-micro text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>
                            Secure authentication powered by Firebase
                        </span>
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
