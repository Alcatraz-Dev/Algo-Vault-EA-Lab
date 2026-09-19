"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Activity,
    AlertCircle,
    Bell,
    CheckCircle2,
    ChevronRight,
    ExternalLink,
    Globe,
    HardDrive,
    History,
    KeyRound,
    Loader2,
    Lock,
    Phone,
    Plus,
    Save,
    Send,
    ShieldCheck,
    SlidersHorizontal,
    Trash2,
    User as UserIcon,
} from "lucide-react";
import {
    EmailAuthProvider,
    onAuthStateChanged,
    reauthenticateWithCredential,
    sendPasswordResetEmail,
    updatePassword,
    updateProfile,
    User,
} from "firebase/auth";
import { onValue, ref, remove, set, update } from "firebase/database";
import { auth, database } from "@/lib/firebase";
import AccountShell from "@/components/account/AccountShell";

type Mt5AccountItem = {
    id: string;
    accountNumber: string;
    broker: string;
    server: string;
    accountType: "Live" | "Demo" | "Prop Firm";
    currency: string;
    isPrimary?: boolean;
    createdAt?: number;
};

type UserSettings = {
    displayName?: string;
    email?: string;
    role?: string;
    phone?: string;
    country?: string;
    timeZone?: string;
    experience?: string;
    bio?: string;
    
    // MT5 Accounts
    mt5Accounts?: Record<string, Mt5AccountItem>;

    // Risk
    riskPerTrade?: number;
    maxDrawdownAlert?: number;
    maxDailyLossAlert?: number;
    autoCutoff?: boolean;

    // Notifications
    emailTradeAlerts?: boolean;
    emailWeeklyDigest?: boolean;
    emailSecurityAlerts?: boolean;
    discordUsername?: string;
    telegramUsername?: string;
    discordWebhook?: string;
    telegramChatId?: string;

    createdAt?: number;
    updatedAt?: number;
};

type TabType = "profile" | "mt5" | "security" | "risk" | "notifications";

type NotificationRecord = {
    id: string;
    title?: string;
    message?: string;
    level?: string;
    channels?: string[];
    status?: string;
    results?: Array<{ channel: string; status: string; source?: string; error: string }>;
    createdAt?: number;
};

export default function AccountSettingsPage() {
    const router = useRouter();

    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<TabType>("profile");

    // Profile State
    const [displayName, setDisplayName] = useState("");
    const [phone, setPhone] = useState("");
    const [country, setCountry] = useState("");
    const [timeZone, setTimeZone] = useState("");
    const [experience, setExperience] = useState("");
    const [bio, setBio] = useState("");
    const [savingProfile, setSavingProfile] = useState(false);

    // MT5 State
    const [mt5Accounts, setMt5Accounts] = useState<Mt5AccountItem[]>([]);
    const [showAddMt5Modal, setShowAddMt5Modal] = useState(false);
    const [newAccountNumber, setNewAccountNumber] = useState("");
    const [newBroker, setNewBroker] = useState("");
    const [newServer, setNewServer] = useState("");
    const [newAccountType, setNewAccountType] = useState<"Live" | "Demo" | "Prop Firm">("Live");
    const [newCurrency, setNewCurrency] = useState("USD");
    const [newIsPrimary, setNewIsPrimary] = useState(false);
    const [addingMt5, setAddingMt5] = useState(false);

    // Security State
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [updatingPasswordState, setUpdatingPasswordState] = useState(false);
    const [sendingPasswordReset, setSendingPasswordReset] = useState(false);

    // Risk Management State
    const [riskPerTrade, setRiskPerTrade] = useState<number>(0);
    const [maxDrawdownAlert, setMaxDrawdownAlert] = useState<number>(0);
    const [maxDailyLossAlert, setMaxDailyLossAlert] = useState<number>(0);
    const [autoCutoff, setAutoCutoff] = useState(false);
    const [savingRisk, setSavingRisk] = useState(false);

    // Notifications State
    const [emailTradeAlerts, setEmailTradeAlerts] = useState(false);
    const [emailWeeklyDigest, setEmailWeeklyDigest] = useState(false);
    const [emailSecurityAlerts, setEmailSecurityAlerts] = useState(false);
    const [discordUsername, setDiscordUsername] = useState("");
    const [telegramUsername, setTelegramUsername] = useState("");
    const [discordWebhook, setDiscordWebhook] = useState("");
    const [telegramChatId, setTelegramChatId] = useState("");
    const [savingNotifications, setSavingNotifications] = useState(false);
    const [sendingTest, setSendingTest] = useState(false);
    const [serverDiscordConfigured, setServerDiscordConfigured] = useState(false);
    const [recentNotifications, setRecentNotifications] = useState<NotificationRecord[]>([]);

    // Discord OAuth connect flow
    const [discordConnecting, setDiscordConnecting] = useState(false);
    const [showDiscordModal, setShowDiscordModal] = useState(false);
    const [discordGuilds, setDiscordGuilds] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedGuildId, setSelectedGuildId] = useState("");
    const [discordChannels, setDiscordChannels] = useState<Array<{ id: string; name: string }>>([]);
    const [selectedChannelId, setSelectedChannelId] = useState("");
    const [creatingWebhook, setCreatingWebhook] = useState(false);
    const [loadingDiscordGuilds, setLoadingDiscordGuilds] = useState(false);

    // Toast Notice State
    const [toastMessage, setToastMessage] = useState<{
        type: "success" | "error";
        text: string;
    } | null>(null);

    function showToast(type: "success" | "error", text: string) {
        setToastMessage({ type, text });
        setTimeout(() => {
            setToastMessage(null);
        }, 4500);
    }

    /*
     * ---------------------------------------------------------
     * AUTH & REALTIME DB SYNC
     * ---------------------------------------------------------
     */
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (!currentUser) {
                router.replace("/login");
                return;
            }

            setUser(currentUser);
            setDisplayName(currentUser.displayName || "");

            // Attach Realtime DB listener on users/${uid}
            const userRef = ref(database, `users/${currentUser.uid}`);
            const unsubscribeProfile = onValue(
                userRef,
                (snapshot) => {
                    if (snapshot.exists()) {
                        const data: UserSettings = snapshot.val();
                        
                        // Profile
                        if (data.displayName) setDisplayName(data.displayName);
                        if (data.phone) setPhone(data.phone);
                        if (data.country) setCountry(data.country);
                        if (data.timeZone) setTimeZone(data.timeZone);
                        if (data.experience) setExperience(data.experience);
                        if (data.bio) setBio(data.bio);

                        // MT5 Accounts
                        if (data.mt5Accounts) {
                            const accountsList = Object.entries(data.mt5Accounts).map(
                                ([id, val]) => ({
                                    ...val,
                                    id,
                                })
                            );
                            setMt5Accounts(accountsList);
                        } else {
                            setMt5Accounts([]);
                        }

                        // Risk
                        if (data.riskPerTrade !== undefined) setRiskPerTrade(data.riskPerTrade);
                        if (data.maxDrawdownAlert !== undefined) setMaxDrawdownAlert(data.maxDrawdownAlert);
                        if (data.maxDailyLossAlert !== undefined) setMaxDailyLossAlert(data.maxDailyLossAlert);
                        if (data.autoCutoff !== undefined) setAutoCutoff(data.autoCutoff);

                        // Notifications
                        if (data.emailTradeAlerts !== undefined) setEmailTradeAlerts(data.emailTradeAlerts);
                        if (data.emailWeeklyDigest !== undefined) setEmailWeeklyDigest(data.emailWeeklyDigest);
                        if (data.emailSecurityAlerts !== undefined) setEmailSecurityAlerts(data.emailSecurityAlerts);
                        setDiscordUsername(data.discordUsername || "");
                        setTelegramUsername(data.telegramUsername || "");
                        setDiscordWebhook(data.discordWebhook || "");
                        setTelegramChatId(data.telegramChatId || "");
                    }
                    setLoading(false);
                },
                (error) => {
                    console.error("REALTIME DB SYNC ERROR:", error);
                    setLoading(false);
                }
            );

            return () => unsubscribeProfile();
        });

        return () => unsubscribe();
    }, [router]);

    // ── Recent delivered notifications ─────────────────────────────────────
    useEffect(() => {
        if (!user) return;
        const notificationsRef = ref(database, `notifications/${user.uid}`);
        return onValue(notificationsRef, (snap) => {
            const data = snap.val() || {};
            const list = Object.entries(data)
                .map(([id, val]) => ({ id, ...(val as Partial<NotificationRecord>) }))
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .slice(0, 8);
            setRecentNotifications(list);
        });
    }, [user]);

    useEffect(() => {
        if (!user) return;

        let cancelled = false;
        (async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch("/api/notifications/test", {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (!cancelled && res.ok) {
                    setServerDiscordConfigured(Boolean(data.discordServerConfigured));
                }
            } catch {
                if (!cancelled) setServerDiscordConfigured(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [user]);

    // ── Send test alert ─────────────────────────────────────────────────────
    async function handleSendTestNotification() {
        if (!user) return;
        try {
            setSendingTest(true);
            const token = await user.getIdToken();
            const res = await fetch("/api/notifications/test", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.error || "Failed to send test notification.");
            }
            const delivered = Array.isArray(data?.results)
                ? data.results
                    .filter((r: { ok?: boolean }) => r.ok)
                    .map((r: { channel?: string; source?: string }) =>
                        r.channel === "discord" && r.source === "server_webhook"
                            ? "Discord server webhook"
                            : r.channel
                    )
                    .filter(Boolean)
                : [];
            showToast(
                "success",
                delivered.length > 0
                    ? `Test notification sent to ${delivered.join(" + ")}.`
                    : "Test notification sent to your connected channels!"
            );
        } catch (err: unknown) {
            showToast("error", err instanceof Error ? err.message : "Failed to send test notification.");
        } finally {
            setSendingTest(false);
        }
    }

    /*
     * ---------------------------------------------------------
     * SAVE PROFILE (Realtime DB + Firebase Auth)
     * ---------------------------------------------------------
     */
    async function handleSaveProfile(e: React.FormEvent) {
        e.preventDefault();
        if (!user) return;

        try {
            setSavingProfile(true);

            // Update Firebase Auth profile
            await updateProfile(user, {
                displayName: displayName.trim(),
            });

            // Update Realtime DB node
            const userRef = ref(database, `users/${user.uid}`);
            await update(userRef, {
                displayName: displayName.trim(),
                phone: phone.trim(),
                country,
                timeZone,
                experience,
                bio: bio.trim(),
                updatedAt: Date.now(),
            });

            showToast("success", "Profile settings saved successfully!");
        } catch (err: unknown) {
            console.error("SAVE PROFILE ERROR:", err);
            showToast("error", err instanceof Error ? err.message : "Failed to update profile.");
        } finally {
            setSavingProfile(false);
        }
    }

    /*
     * ---------------------------------------------------------
     * ADD NEW MT5 ACCOUNT (Realtime DB)
     * ---------------------------------------------------------
     */
    async function handleAddMt5Account(e: React.FormEvent) {
        e.preventDefault();
        if (!user) return;

        if (!newAccountNumber.trim()) {
            showToast("error", "Please enter a valid MT5 Account Number.");
            return;
        }

        try {
            setAddingMt5(true);
            const accountId = `mt5_${Date.now()}`;
            const accountRef = ref(database, `users/${user.uid}/mt5Accounts/${accountId}`);

            // If new account is primary, un-primary others
            if (newIsPrimary && mt5Accounts.length > 0) {
                const updates: Record<string, boolean> = {};
                mt5Accounts.forEach((acc) => {
                    updates[`users/${user.uid}/mt5Accounts/${acc.id}/isPrimary`] = false;
                });
                await update(ref(database), updates);
            }

            const newAcc: Mt5AccountItem = {
                id: accountId,
                accountNumber: newAccountNumber.trim(),
                broker: newBroker.trim(),
                server: newServer.trim(),
                accountType: newAccountType,
                currency: newCurrency,
                isPrimary: newIsPrimary || mt5Accounts.length === 0,
                createdAt: Date.now(),
            };

            await set(accountRef, newAcc);

            showToast("success", `MT5 Account #${newAccountNumber} added successfully!`);
            setShowAddMt5Modal(false);
            setNewAccountNumber("");
        } catch (err: unknown) {
            console.error("ADD MT5 ERROR:", err);
            showToast("error", err instanceof Error ? err.message : "Failed to add MT5 Account.");
        } finally {
            setAddingMt5(false);
        }
    }

    /*
     * ---------------------------------------------------------
     * DELETE MT5 ACCOUNT (Realtime DB)
     * ---------------------------------------------------------
     */
    async function handleDeleteMt5Account(accountId: string, accNum: string) {
        if (!user) return;

        try {
            const accountRef = ref(database, `users/${user.uid}/mt5Accounts/${accountId}`);
            await remove(accountRef);
            showToast("success", `MT5 Account #${accNum} removed.`);
        } catch (err: unknown) {
            console.error("DELETE MT5 ERROR:", err);
            showToast("error", "Failed to remove MT5 account.");
        }
    }

    /*
     * ---------------------------------------------------------
     * SET PRIMARY MT5 ACCOUNT
     * ---------------------------------------------------------
     */
    async function handleSetPrimaryMt5(accountId: string) {
        if (!user) return;

        try {
            const updates: Record<string, boolean> = {};
            mt5Accounts.forEach((acc) => {
                updates[`users/${user.uid}/mt5Accounts/${acc.id}/isPrimary`] = acc.id === accountId;
            });
            await update(ref(database), updates);
            showToast("success", "Primary MT5 account updated.");
        } catch (err: unknown) {
            console.error("SET PRIMARY ERROR:", err);
            showToast("error", "Failed to set primary MT5 account.");
        }
    }

    /*
     * ---------------------------------------------------------
     * CHANGE PASSWORD (Firebase Auth)
     * ---------------------------------------------------------
     */
    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault();
        if (!user || !user.email) return;

        if (newPassword.length < 6) {
            showToast("error", "New password must be at least 6 characters long.");
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast("error", "New passwords do not match.");
            return;
        }

        try {
            setUpdatingPasswordState(true);

            // Re-authenticate user if current password provided
            if (currentPassword) {
                const credential = EmailAuthProvider.credential(user.email, currentPassword);
                await reauthenticateWithCredential(user, credential);
            }

            // Update password
            await updatePassword(user, newPassword);

            showToast("success", "Password updated successfully!");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err: unknown) {
            console.error("UPDATE PASSWORD ERROR:", err);
            const code =
                typeof err === "object" && err !== null && "code" in err
                    ? String((err as { code?: unknown }).code)
                    : "";
            if (code === "auth/wrong-password") {
                showToast("error", "Current password is incorrect.");
            } else if (code === "auth/requires-recent-login") {
                showToast("error", "Please re-enter your current password for security.");
            } else {
                showToast("error", err instanceof Error ? err.message : "Failed to update password.");
            }
        } finally {
            setUpdatingPasswordState(false);
        }
    }

    /*
     * ---------------------------------------------------------
     * SEND PASSWORD RESET LINK
     * ---------------------------------------------------------
     */
    async function handleSendResetEmail() {
        if (!user?.email) return;

        try {
            setSendingPasswordReset(true);
            await sendPasswordResetEmail(auth, user.email);
            showToast("success", `Password reset email sent to ${user.email}`);
        } catch (err: unknown) {
            console.error("RESET EMAIL ERROR:", err);
            showToast("error", err instanceof Error ? err.message : "Failed to send password reset email.");
        } finally {
            setSendingPasswordReset(false);
        }
    }

    /*
     * ---------------------------------------------------------
     * SAVE RISK PREFERENCES
     * ---------------------------------------------------------
     */
    async function handleSaveRisk(e: React.FormEvent) {
        e.preventDefault();
        if (!user) return;

        try {
            setSavingRisk(true);
            const userRef = ref(database, `users/${user.uid}`);
            await update(userRef, {
                riskPerTrade: Number(riskPerTrade),
                maxDrawdownAlert: Number(maxDrawdownAlert),
                maxDailyLossAlert: Number(maxDailyLossAlert),
                autoCutoff,
                updatedAt: Date.now(),
            });
            showToast("success", "Risk management rules saved!");
        } catch (err: unknown) {
            console.error("SAVE RISK ERROR:", err);
            showToast("error", "Failed to save risk settings.");
        } finally {
            setSavingRisk(false);
        }
    }

    /*
     * ---------------------------------------------------------
     * SAVE NOTIFICATION PREFERENCES
     * ---------------------------------------------------------
     */
    async function handleSaveNotifications(e: React.FormEvent) {
        e.preventDefault();
        if (!user) return;

        try {
            setSavingNotifications(true);
            const userRef = ref(database, `users/${user.uid}`);
            await update(userRef, {
                emailTradeAlerts,
                emailWeeklyDigest,
                emailSecurityAlerts,
                discordUsername: discordUsername.trim().replace(/^@/, ""),
                telegramUsername: telegramUsername.trim().replace(/^@/, ""),
                discordWebhook: discordWebhook.trim(),
                telegramChatId: telegramChatId.trim(),
                updatedAt: Date.now(),
            });
            showToast("success", "Notification preferences saved!");
        } catch (err: unknown) {
            console.error("SAVE NOTIFICATIONS ERROR:", err);
            showToast("error", "Failed to save notification preferences.");
        } finally {
            setSavingNotifications(false);
        }
    }

    function normalizeUsername(raw: string) {
        return raw.trim().replace(/^@/, "");
    }

    const discordBotInviteUrl = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID
        ? `https://discord.com/api/oauth2/authorize?client_id=${process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID}&permissions=536870912&scope=bot`
        : null;

    const loadDiscordGuilds = useCallback(async () => {
        if (!user) return;
        setLoadingDiscordGuilds(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/discord/guilds", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to load Discord servers.");
            setDiscordGuilds(data.guilds || []);
            if ((data.guilds || []).length === 1) {
                setSelectedGuildId(data.guilds[0].id);
            }
        } catch (err: unknown) {
            showToast("error", err instanceof Error ? err.message : "Failed to load Discord servers.");
        } finally {
            setLoadingDiscordGuilds(false);
        }
    }, [user]);

    async function handleConnectDiscord() {
        if (!user) return;
        setDiscordConnecting(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/discord/connect", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Discord connect failed.");
            window.location.href = data.url;
        } catch (err: unknown) {
            showToast("error", err instanceof Error ? err.message : "Discord connect failed.");
            setDiscordConnecting(false);
        }
    }

    async function handleCreateDiscordWebhook() {
        if (!user || !selectedChannelId) return;
        setCreatingWebhook(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/discord/webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    channelId: selectedChannelId,
                    guildId: selectedGuildId,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error || "Failed to create webhook.");
            setDiscordWebhook(data.webhookUrl || "");
            setSelectedChannelId(data.channelId || selectedChannelId);
            setShowDiscordModal(false);
            showToast("success", "Discord connected! Webhook created and saved.");
        } catch (err: unknown) {
            showToast("error", err instanceof Error ? err.message : "Failed to create webhook.");
        } finally {
            setCreatingWebhook(false);
        }
    }

    async function handleDisconnectDiscord() {
        if (!user) return;
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/discord/webhook", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data?.error || "Failed to disconnect.");
            }
            setDiscordWebhook("");
            setSelectedGuildId("");
            setSelectedChannelId("");
            setDiscordChannels([]);
            showToast("success", "Discord disconnected.");
        } catch (err: unknown) {
            showToast("error", err instanceof Error ? err.message : "Failed to disconnect Discord.");
        }
    }

    async function handleDisconnectTelegram() {
        if (!user) return;
        try {
            const userRef = ref(database, `users/${user.uid}`);
            await update(userRef, {
                telegramUsername: null,
                telegramChatId: null,
                updatedAt: Date.now(),
            });
            setTelegramUsername("");
            setTelegramChatId("");
            showToast("success", "Telegram disconnected.");
        } catch (err: unknown) {
            showToast("error", err instanceof Error ? err.message : "Failed to disconnect Telegram.");
        }
    }

    useEffect(() => {
        const t = setTimeout(() => {
            const params = new URLSearchParams(window.location.search);
            const requested = params.get("tab");
            const valid: TabType[] = ["profile", "mt5", "security", "risk", "notifications"];
            if (valid.includes(requested as TabType)) {
                setActiveTab(requested as TabType);
            }

            const discordStep = params.get("discord");
            const discordError = params.get("discord_error");
            if (discordError) {
                showToast("error", `Discord: ${decodeURIComponent(discordError)}`);
            }
            if (discordStep === "select-channel") {
                setShowDiscordModal(true);
                void loadDiscordGuilds();
            }
        }, 0);
        return () => clearTimeout(t);
    }, [loadDiscordGuilds]);

    useEffect(() => {
        if (!selectedGuildId || !user) {
            const timeout = setTimeout(() => {
                setDiscordChannels([]);
                setSelectedChannelId("");
            }, 0);
            return () => clearTimeout(timeout);
        }

        let cancelled = false;
        (async () => {
            try {
                const token = await user.getIdToken();
                const res = await fetch(`/api/discord/channels?guildId=${encodeURIComponent(selectedGuildId)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data?.error || "Failed to load channels.");
                if (!cancelled) {
                    setDiscordChannels(data.channels || []);
                    if ((data.channels || []).length === 1) {
                        setSelectedChannelId(data.channels[0].id);
                    }
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    showToast("error", err instanceof Error ? err.message : "Failed to load channels.");
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [selectedGuildId, user]);

    if (loading) {
        return (
            <AccountShell title="Account Settings" subtitle="Manage your profile details, MT5 connections, security credentials, risk thresholds, and alert notifications">
                <div className="flex min-h-[50vh] items-center justify-center">
                    <div className="text-center">
                        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-foreground" />
                        <p className="mt-4 text-sm text-muted-foreground">
                            Loading account settings...
                        </p>
                    </div>
                </div>
            </AccountShell>
        );
    }

    return (
        <AccountShell title="Account Settings" subtitle="Manage your profile details, MT5 connections, security credentials, risk thresholds, and alert notifications">
            
            {/* Background Gradient Blurs */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden">
                <div className="absolute left-1/2 top-[-250px] h-[550px] w-[550px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-[130px]" />
                <div className="absolute bottom-[-200px] right-[-100px] h-[450px] w-[450px] rounded-full bg-purple-600/10 blur-[130px]" />
            </div>

            <div className="relative mx-auto max-w-5xl">
                {/* Sync badge */}
                <div className="mb-4 flex justify-end">
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground">
                        <ShieldCheck size={14} className="text-emerald-600" />
                        <span>Realtime Database Synced</span>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <div className="mb-8 flex border-b border-border overflow-x-auto no-scrollbar gap-2 scrollbar-none" data-guide="tabs">
                        <button
                            type="button"
                            onClick={() => setActiveTab("profile")}
                            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                                activeTab === "profile"
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <UserIcon size={16} />
                            <span>General Profile</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("mt5")}
                            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                                activeTab === "mt5"
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <HardDrive size={16} />
                            <span>MT5 Connections</span>
                            {mt5Accounts.length > 0 && (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                                    {mt5Accounts.length}
                                </span>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("security")}
                            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                                activeTab === "security"
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <ShieldCheck size={16} />
                            <span>Security & Password</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("risk")}
                            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                                activeTab === "risk"
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <SlidersHorizontal size={16} />
                            <span>Risk Controls</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab("notifications")}
                            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                                activeTab === "notifications"
                                    ? "border-foreground text-foreground"
                                    : "border-transparent text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <Bell size={16} />
                            <span>Notifications</span>
                        </button>
                    </div>

                {/* Main Content Area */}
                <div className="pt-2" data-guide="content">

                {/* Toast Notification Alert */}
                {toastMessage && (
                    <div
                        className={`mb-8 flex items-center justify-between rounded-xl border p-4 text-sm transition-all ${
                            toastMessage.type === "success"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                                : "border-red-500/30 bg-red-500/10 text-red-600"
                        }`}
                    >
                        <div className="flex items-center gap-2.5">
                            {toastMessage.type === "success" ? (
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            ) : (
                                <AlertCircle className="h-5 w-5 text-red-500" />
                            )}
                            <span>{toastMessage.text}</span>
                        </div>
                    </div>
                )}

                {/* TAB 1: GENERAL PROFILE */}
                {activeTab === "profile" && (
                    <div className="grid gap-8 lg:grid-cols-3">
                        <div className="lg:col-span-2 space-y-6">
                            <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl" data-guide="profile-form">
                                <h2 className="text-lg font-semibold text-foreground mb-1">
                                    Personal Details
                                </h2>
                                <p className="text-xs text-muted-foreground mb-6">
                                    Update your account display name, location, and experience profile.
                                </p>

                                <form onSubmit={handleSaveProfile} className="space-y-5">
                                    <div className="grid gap-5 sm:grid-cols-2">
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-2">
                                                Display Name / Full Name
                                            </label>
                                            <input
                                                type="text"
                                                value={displayName}
                                                onChange={(e) => setDisplayName(e.target.value)}
                                                placeholder="e.g. John Trader"
                                                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-border/50"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-2">
                                                Phone Number
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type="tel"
                                                    value={phone}
                                                    onChange={(e) => setPhone(e.target.value)}
                                                    placeholder="+1 (555) 000-0000"
                                                    className="w-full rounded-xl border border-border bg-muted/50 pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-border/50"
                                                />
                                                <Phone className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid gap-5 sm:grid-cols-2">
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-2">
                                                Country of Residence
                                            </label>
                                            <div className="relative">
                                                <select
                                                    value={country}
                                                    onChange={(e) => setCountry(e.target.value)}
                                                    className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-border/50"
                                                >
                                                    <option value="">Select country...</option>
                                                    <option value="United States">United States</option>
                                                    <option value="United Kingdom">United Kingdom</option>
                                                    <option value="Germany">Germany</option>
                                                    <option value="France">France</option>
                                                    <option value="United Arab Emirates">United Arab Emirates</option>
                                                    <option value="Singapore">Singapore</option>
                                                    <option value="Australia">Australia</option>
                                                    <option value="Canada">Canada</option>
                                                    <option value="Japan">Japan</option>
                                                    <option value="Other">Other Country</option>
                                                </select>
                                                <Globe className="absolute left-3.5 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-2">
                                                Preferred Timezone
                                            </label>
                                            <select
                                                value={timeZone}
                                                onChange={(e) => setTimeZone(e.target.value)}
                                                className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-border/50"
                                            >
                                                <option value="">Select timezone...</option>
                                                <option value="UTC-5 (New York EST)">UTC-5 (New York EST)</option>
                                                <option value="UTC+0 (London GMT)">UTC+0 (London GMT)</option>
                                                <option value="UTC+1 (Frankfurt CET)">UTC+1 (Frankfurt CET)</option>
                                                <option value="UTC+4 (Dubai GST)">UTC+4 (Dubai GST)</option>
                                                <option value="UTC+8 (Singapore SGT)">UTC+8 (Singapore SGT)</option>
                                                <option value="UTC+9 (Tokyo JST)">UTC+9 (Tokyo JST)</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-2">
                                            Trading Experience Level
                                        </label>
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                            {["Beginner", "Intermediate", "Professional", "Institutional"].map((lvl) => (
                                                <button
                                                    key={lvl}
                                                    type="button"
                                                    onClick={() => setExperience(lvl)}
                                                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                                                        experience === lvl
                                                            ? "border-foreground bg-muted text-foreground"
                                                            : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/70"
                                                    }`}
                                                >
                                                    {lvl}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-2">
                                            Bio / Strategy Focus
                                        </label>
                                        <textarea
                                            rows={3}
                                            value={bio}
                                            onChange={(e) => setBio(e.target.value)}
                                            placeholder="Specify your primary pairs, preferred EA strategies, or prop firm goals..."
                                            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-border/50"
                                        />
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            type="submit"
                                            disabled={savingProfile}
                                            className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-muted disabled:opacity-50"
                                        >
                                            {savingProfile ? (
                                                <Loader2 size={16} className="animate-spin" />
                                            ) : (
                                                <Save size={16} />
                                            )}
                                            <span>Save Profile Changes</span>
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        {/* Side Account Overview Card */}
                        <div className="space-y-6">
                            <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
                                <div className="flex items-center gap-4">
                                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-foreground font-bold text-xl">
                                        {displayName.substring(0, 2).toUpperCase() || "TR"}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-foreground text-base">
                                            {displayName || "Trader"}
                                        </h3>
                                        <p className="text-xs text-muted-foreground">{user?.email}</p>
                                    </div>
                                </div>

                                <div className="mt-6 space-y-3 border-t border-border pt-4 text-xs">
                                    <div className="flex justify-between py-1">
                                        <span className="text-muted-foreground">Account Role</span>
                                        <span className="font-medium text-emerald-600 capitalize">Customer</span>
                                    </div>
                                    <div className="flex justify-between py-1">
                                        <span className="text-muted-foreground">Status</span>
                                        <span className="inline-flex items-center gap-1 font-medium text-emerald-600">
                                            <CheckCircle2 size={12} /> Active
                                        </span>
                                    </div>
                                    <div className="flex justify-between py-1">
                                        <span className="text-muted-foreground">User ID</span>
                                        <span className="font-mono text-muted-foreground text-[11px] truncate max-w-[140px]">
                                            {user?.uid}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: MT5 CONNECTIONS */}
                {activeTab === "mt5" && (
                    <div className="space-y-6" data-guide="mt5-accounts">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-xl font-semibold text-foreground">
                                    Connected MT5 Accounts
                                </h2>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Manage MT5 trading accounts linked to your licenses and performance telemetry.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowAddMt5Modal(true)}
                                className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-xs font-semibold text-background transition hover:bg-muted"
                            >
                                <Plus size={15} />
                                <span>Add MT5 Account</span>
                            </button>
                        </div>

                        {mt5Accounts.length === 0 ? (
                            <div className="rounded-2xl border border-border bg-muted/30 p-12 text-center">
                                <HardDrive className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
                                <h3 className="text-base font-medium text-foreground">No MT5 Accounts Added</h3>
                                <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                                    Add your MetaTrader 5 account number to enable live performance tracking, automated licensing, and backtest comparison.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setShowAddMt5Modal(true)}
                                    className="mt-5 inline-flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-2 text-xs text-foreground transition hover:bg-muted hover:text-foreground"
                                >
                                    <Plus size={14} />
                                    Add First Account
                                </button>
                            </div>
                        ) : (
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {mt5Accounts.map((acc) => (
                                    <div
                                        key={acc.id}
                                        className="relative rounded-2xl border border-border bg-foreground/[0.035] p-5 backdrop-blur-xl transition hover:border-border"
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                                                    <Activity size={18} />
                                                </div>
                                                <div>
                                                    <p className="font-semibold text-foreground text-base">
                                                        MT5 #{acc.accountNumber}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">{acc.broker}</p>
                                                </div>
                                            </div>

                                            {acc.isPrimary && (
                                                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 uppercase tracking-wider">
                                                    Primary
                                                </span>
                                            )}
                                        </div>

                                        <div className="mt-5 grid grid-cols-2 gap-2 text-xs border-t border-border/60 pt-4">
                                            <div>
                                                <span className="text-muted-foreground block text-[11px]">Server</span>
                                                <span className="text-foreground font-medium">{acc.server}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground block text-[11px]">Type</span>
                                                <span className="text-foreground font-medium">{acc.accountType}</span>
                                            </div>
                                            <div className="mt-2">
                                                <span className="text-muted-foreground block text-[11px]">Currency</span>
                                                <span className="text-foreground font-medium">{acc.currency}</span>
                                            </div>
                                        </div>

                                        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                                            {!acc.isPrimary ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSetPrimaryMt5(acc.id)}
                                                    className="text-xs text-muted-foreground hover:text-foreground transition"
                                                >
                                                    Set as Primary
                                                </button>
                                            ) : (
                                                <span className="text-xs text-emerald-600 font-medium">Default Live Account</span>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => handleDeleteMt5Account(acc.id, acc.accountNumber)}
                                                className="text-muted-foreground hover:text-red-500 transition"
                                                title="Remove Account"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ADD MT5 MODAL */}
                        {showAddMt5Modal && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/80 p-4 backdrop-blur-sm">
                                <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
                                    <h3 className="text-lg font-semibold text-foreground">
                                        Connect New MT5 Account
                                    </h3>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Enter your MetaTrader 5 account details for EA telemetry.
                                    </p>

                                    <form onSubmit={handleAddMt5Account} className="mt-5 space-y-4">
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                MT5 Account Number *
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                value={newAccountNumber}
                                                onChange={(e) => setNewAccountNumber(e.target.value)}
                                                placeholder="e.g. 8839201"
                                                className="w-full rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                Broker Name
                                            </label>
                                            <input
                                                type="text"
                                                value={newBroker}
                                                onChange={(e) => setNewBroker(e.target.value)}
                                                placeholder="e.g. IC Markets"
                                                className="w-full rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                Server Name
                                            </label>
                                            <input
                                                type="text"
                                                value={newServer}
                                                onChange={(e) => setNewServer(e.target.value)}
                                                placeholder="e.g. ICMarkets-Live01"
                                                className="w-full rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                            />
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                    Account Type
                                                </label>
                                                <select
                                                    value={newAccountType}
                                                    onChange={(e) => setNewAccountType(e.target.value as Mt5AccountItem["accountType"])}
                                                    className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
                                                >
                                                    <option value="Live">Live Real</option>
                                                    <option value="Demo">Demo</option>
                                                    <option value="Prop Firm">Prop Firm</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                    Currency
                                                </label>
                                                <select
                                                    value={newCurrency}
                                                    onChange={(e) => setNewCurrency(e.target.value)}
                                                    className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
                                                >
                                                    <option value="USD">USD ($)</option>
                                                    <option value="EUR">EUR (€)</option>
                                                    <option value="GBP">GBP (£)</option>
                                                    <option value="AUD">AUD ($)</option>
                                                </select>
                                            </div>
                                        </div>

                                        <label className="flex items-center gap-2 text-xs text-foreground pt-1 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={newIsPrimary}
                                                onChange={(e) => setNewIsPrimary(e.target.checked)}
                                                className="rounded border-border bg-card text-foreground focus:ring-0"
                                            />
                                            <span>Set as Primary MT5 Account</span>
                                        </label>

                                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                                            <button
                                                type="button"
                                                onClick={() => setShowAddMt5Modal(false)}
                                                className="rounded-xl border border-border px-4 py-2 text-xs text-muted-foreground hover:text-foreground"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={addingMt5}
                                                className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2 text-xs font-semibold text-background transition hover:bg-muted disabled:opacity-50"
                                            >
                                                {addingMt5 && <Loader2 size={14} className="animate-spin" />}
                                                <span>Save MT5 Account</span>
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 3: SECURITY & PASSWORD */}
                {activeTab === "security" && (
                    <div className="max-w-2xl space-y-6">
                        <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
                            <h2 className="text-lg font-semibold text-foreground mb-1">
                                Change Password
                            </h2>
                            <p className="text-xs text-muted-foreground mb-6">
                                Update your login password using Firebase Authentication.
                            </p>

                            <form onSubmit={handleChangePassword} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                        Current Password (Optional if newly logged in)
                                    </label>
                                    <input
                                        type="password"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        placeholder="••••••••••••"
                                        className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                    />
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            New Password *
                                        </label>
                                        <input
                                            type="password"
                                            required
                                            value={newPassword}
                                            onChange={(e) => setNewPassword(e.target.value)}
                                            placeholder="At least 6 characters"
                                            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            Confirm New Password *
                                        </label>
                                        <input
                                            type="password"
                                            required
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                            placeholder="Repeat new password"
                                            className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                        />
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={updatingPasswordState}
                                        className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-muted disabled:opacity-50"
                                    >
                                        {updatingPasswordState ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Lock size={16} />
                                        )}
                                        <span>Update Password</span>
                                    </button>
                                </div>
                            </form>
                        </div>

                        <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-foreground text-sm">
                                        Send Reset Password Email
                                    </h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        Send a password reset link to <span className="text-foreground">{user?.email}</span>
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleSendResetEmail}
                                    disabled={sendingPasswordReset}
                                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-4 py-2 text-xs font-medium text-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                                >
                                    {sendingPasswordReset ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                        <KeyRound size={14} />
                                    )}
                                    <span>Send Reset Email</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 4: RISK CONTROLS */}
                {activeTab === "risk" && (
                    <div className="max-w-2xl space-y-6">
                        <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
                            <h2 className="text-lg font-semibold text-foreground mb-1">
                                Automated Risk Parameters
                            </h2>
                            <p className="text-xs text-muted-foreground mb-6">
                                Configure system-wide risk limits for telemetry alerts and live bot execution safety.
                            </p>

                            <form onSubmit={handleSaveRisk} className="space-y-6">
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Risk Per Trade (% of Account Balance)
                                        </label>
                                        <span className="text-xs font-mono font-bold text-emerald-600">
                                            {riskPerTrade}%
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0.25}
                                        max={5}
                                        step={0.25}
                                        value={riskPerTrade}
                                        onChange={(e) => setRiskPerTrade(Number(e.target.value))}
                                        className="w-full accent-white"
                                    />
                                    <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                                        <span>0.25% (Conservative)</span>
                                        <span>1.0% (Standard)</span>
                                        <span>5.0% (Aggressive)</span>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Max Drawdown Alert Limit (%)
                                        </label>
                                        <span className="text-xs font-mono font-bold text-amber-400">
                                            {maxDrawdownAlert}%
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={3}
                                        max={25}
                                        step={1}
                                        value={maxDrawdownAlert}
                                        onChange={(e) => setMaxDrawdownAlert(Number(e.target.value))}
                                        className="w-full accent-white"
                                    />
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="text-xs font-medium text-muted-foreground">
                                            Max Daily Loss Alert (%)
                                        </label>
                                        <span className="text-xs font-mono font-bold text-red-500">
                                            {maxDailyLossAlert}%
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min={1}
                                        max={15}
                                        step={0.5}
                                        value={maxDailyLossAlert}
                                        onChange={(e) => setMaxDailyLossAlert(Number(e.target.value))}
                                        className="w-full accent-white"
                                    />
                                </div>

                                <label className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4 cursor-pointer">
                                    <div>
                                        <p className="text-xs font-medium text-foreground">
                                            Emergency Auto-Cutoff Protocol
                                        </p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                            Send immediate emergency halt signal to EA if Max Drawdown is breached
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={autoCutoff}
                                        onChange={(e) => setAutoCutoff(e.target.checked)}
                                        className="h-4 w-4 rounded border-border bg-card text-foreground focus:ring-0"
                                    />
                                </label>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={savingRisk}
                                        className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-muted disabled:opacity-50"
                                    >
                                        {savingRisk ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Save size={16} />
                                        )}
                                        <span>Save Risk Parameters</span>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}

                {/* TAB 5: NOTIFICATIONS */}
                {activeTab === "notifications" && (
                    <div className="max-w-2xl space-y-6">
                        <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
                            <h2 className="text-lg font-semibold text-foreground mb-1">
                                Notification Channels
                            </h2>
                            <p className="text-xs text-muted-foreground mb-6">
                                Configure email digest settings and click-to-connect Discord or Telegram alerts.
                            </p>

                            <form onSubmit={handleSaveNotifications} className="space-y-5">
                                <label className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4 cursor-pointer hover:bg-muted/50">
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            Trade Execution Emails
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Receive instant email alerts when positions open or close
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={emailTradeAlerts}
                                        onChange={(e) => setEmailTradeAlerts(e.target.checked)}
                                        className="h-4 w-4 rounded border-border bg-card text-foreground focus:ring-0"
                                    />
                                </label>

                                <label className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4 cursor-pointer hover:bg-muted/50">
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            Weekly Performance Digest
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Weekly email report with Sharpe ratio, drawdown, and total gain
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={emailWeeklyDigest}
                                        onChange={(e) => setEmailWeeklyDigest(e.target.checked)}
                                        className="h-4 w-4 rounded border-border bg-card text-foreground focus:ring-0"
                                    />
                                </label>

                                <label className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-4 cursor-pointer hover:bg-muted/50">
                                    <div>
                                        <p className="text-sm font-medium text-foreground">
                                            Security & System Alerts
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            Alerts for license renewals, IP logins, and security events
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={emailSecurityAlerts}
                                        onChange={(e) => setEmailSecurityAlerts(e.target.checked)}
                                        className="h-4 w-4 rounded border-border bg-card text-foreground focus:ring-0"
                                    />
                                </label>

                                <div className="rounded-xl border border-border bg-muted/30 p-4">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5865F2]/15 text-sm font-bold text-[#8b94ff]">
                                            DC
                                        </span>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-foreground">
                                                Discord Notifications
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                Click Connect Discord — authorize once, pick a channel, and we create the webhook automatically (same flow as Telegram).
                                            </p>
                                        </div>
                                        {(discordWebhook.trim() || serverDiscordConfigured) && (
                                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                                                {discordWebhook.trim() ? "Connected" : "Server Ready"}
                                            </span>
                                        )}
                                    </div>

                                    {serverDiscordConfigured && !discordWebhook.trim() && (
                                        <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                                            Discord alerts will use the server webhook from .env.local until you connect a personal channel.
                                        </div>
                                    )}

                                    {process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ? (
                                        <div className="mt-3 space-y-2 rounded-xl bg-card p-3">
                                            {discordBotInviteUrl && (
                                                <a
                                                    href={discordBotInviteUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#5865F2]/30 bg-[#5865F2]/10 px-4 py-2.5 text-xs font-semibold text-[#8b94ff] transition hover:bg-[#5865F2]/20"
                                                >
                                                    <ExternalLink size={13} />
                                                    Step 1 — Add AlgoVault Bot to your server
                                                </a>
                                            )}
                                            <button
                                                type="button"
                                                onClick={handleConnectDiscord}
                                                disabled={discordConnecting}
                                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-[#4752c4] disabled:opacity-50"
                                            >
                                                {discordConnecting ? (
                                                    <Loader2 size={13} className="animate-spin" />
                                                ) : (
                                                    <ExternalLink size={13} />
                                                )}
                                                {discordWebhook.trim()
                                                    ? "Reconnect Discord"
                                                    : "Step 2 — Connect Discord & create webhook"}
                                            </button>
                                            {discordWebhook.trim() && (
                                                <button
                                                    type="button"
                                                    onClick={handleDisconnectDiscord}
                                                    className="w-full rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/60"
                                                >
                                                    Disconnect Discord
                                                </button>
                                            )}
                                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                1. Add the bot to your server.{" "}
                                                2. Click Connect and authorize Discord.{" "}
                                                3. Pick a channel — webhook is created automatically.{" "}
                                                4. Save below and send a test alert. If no personal webhook is saved, the server webhook is used.
                                            </p>
                                        </div>
                                    ) : null}

                                    {discordUsername.trim() && (
                                        <p className="mt-3 text-xs text-muted-foreground">
                                            Discord account: <span className="font-medium text-foreground">{discordUsername}</span>
                                        </p>
                                    )}
                                </div>

                                <div className="rounded-xl border border-border bg-muted/30 p-4">
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#229ED9]/15 text-sm font-bold text-[#4fc3f7]">
                                            TG
                                        </span>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-foreground">
                                                Telegram Notifications
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                Click Connect Telegram — open the bot, press Start once, and trade alerts arrive in your chat automatically.
                                            </p>
                                        </div>
                                        {(telegramUsername.trim() || telegramChatId.trim()) && (
                                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
                                                Connected
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        value={telegramUsername}
                                        onChange={(e) => setTelegramUsername(e.target.value)}
                                        placeholder="e.g. ghostfxcoder"
                                        className="mt-3 w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                    />
                                    {process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ? (
                                        <div className="mt-3 space-y-2 rounded-xl bg-card p-3">
                                            <a
                                                href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME}?start=connect`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-[#1b83b5]"
                                            >
                                                <ExternalLink size={13} />
                                                {telegramUsername.trim() || telegramChatId.trim()
                                                    ? "Reconnect Telegram"
                                                    : `Step 1 — Open @${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME} & press Start`}
                                            </a>
                                            {(telegramUsername.trim() || telegramChatId.trim()) && (
                                                <button
                                                    type="button"
                                                    onClick={handleDisconnectTelegram}
                                                    className="w-full rounded-xl border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/60"
                                                >
                                                    Disconnect Telegram
                                                </button>
                                            )}
                                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                                1. Enter your Telegram username above.{" "}
                                                2. Click Connect — it opens the bot in Telegram.{" "}
                                                3. Press <span className="font-semibold text-foreground">Start</span> once.{" "}
                                                4. Save below and send a test alert.
                                            </p>
                                        </div>
                                    ) : null}
                                    {telegramUsername.trim() && (
                                        <p className="mt-3 text-xs text-muted-foreground">
                                            Telegram account: <span className="font-medium text-foreground">@{normalizeUsername(telegramUsername)}</span>
                                        </p>
                                    )}
                                </div>

                                <details className="group rounded-xl border border-border bg-muted/20 p-4">
                                    <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground">
                                        <span>Advanced — Manual Webhook / Chat ID (optional)</span>
                                        <ChevronRight size={14} className="transition group-open:rotate-90" />
                                    </summary>
                                    <div className="mt-4 space-y-4">
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                Discord Webhook URL (manual override)
                                            </label>
                                            <input
                                                type="url"
                                                value={discordWebhook}
                                                onChange={(e) => setDiscordWebhook(e.target.value)}
                                                placeholder="https://discord.com/api/webhooks/..."
                                                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                Telegram Chat ID (Optional)
                                            </label>
                                            <input
                                                type="text"
                                                value={telegramChatId}
                                                onChange={(e) => setTelegramChatId(e.target.value)}
                                                placeholder="e.g. 123456789"
                                                className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/40 focus:outline-none"
                                            />
                                        </div>
                                    </div>
                                </details>

                                <div className="flex flex-wrap items-center gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={savingNotifications}
                                        className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-muted disabled:opacity-50"
                                    >
                                        {savingNotifications ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Save size={16} />
                                        )}
                                        <span>Save Notification Rules</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSendTestNotification}
                                        disabled={sendingTest}
                                        className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                                    >
                                        {sendingTest ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Send size={16} />
                                        )}
                                        <span>Send Test Alert</span>
                                    </button>
                                </div>
                            </form>
                        </div>

                        {/* Recent Alerts */}
                        <div className="rounded-2xl border border-border bg-foreground/[0.035] p-6 backdrop-blur-xl">
                            <div className="flex items-center justify-between mb-1">
                                <h2 className="text-lg font-semibold text-foreground">
                                    Recent Alerts
                                </h2>
                                <Bell size={16} className="text-muted-foreground" />
                            </div>
                            <p className="text-xs text-muted-foreground mb-5">
                                Latest notifications delivered to your connected channels.
                            </p>

                            {recentNotifications.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border py-10 text-center">
                                    <History className="mx-auto h-7 w-7 text-muted-foreground" />
                                    <p className="mt-3 text-sm text-muted-foreground">
                                        No alerts delivered yet. Save your channels and press{" "}
                                        <span className="font-medium text-foreground">Send Test Alert</span>.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {recentNotifications.map((n) => {
                                        const level = n.level ?? "info";
                                        const color =
                                            level === "error"
                                                ? "border-rose-500/25 bg-rose-500/[0.06]"
                                                : level === "success"
                                                  ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                                                  : level === "warning"
                                                    ? "border-amber-500/25 bg-amber-500/[0.06]"
                                                    : "border-border bg-muted/30";
                                        const dot =
                                            level === "error"
                                                ? "bg-rose-500"
                                                : level === "success"
                                                  ? "bg-emerald-500"
                                                  : level === "warning"
                                                    ? "bg-amber-500"
                                                    : "bg-violet-500";
                                        return (
                                            <div
                                                key={n.id}
                                                className={`rounded-xl border p-4 ${color}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                                                            {n.title}
                                                        </p>
<p className="mt-1 text-xs text-muted-foreground leading-5 whitespace-pre-wrap">
                                                    {n.message}
                                                </p>
                                                {n.results && n.results.length > 0 && (
                                                    <p className="mt-2 space-y-0.5">
                                                        {n.results.map((r) => (
                                                            <span
                                                                key={r.channel}
                                                                className={`mr-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                                                                    r.status === "sent"
                                                                        ? "bg-emerald-500/15 text-emerald-500"
                                                                        : "bg-rose-500/15 text-rose-400"
                                                                }`}
                                                            >
                                                                {r.channel}
                                                                {r.source === "server_webhook" ? " server" : ""}
                                                                {r.status === "failed" && r.error ? ` — ${r.error}` : " — sent"}
                                                            </span>
                                                        ))}
                                                    </p>
                                                )}
                                            </div>
                                            <span
                                                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                                    n.status === "no_channel"
                                                        ? "bg-amber-500/15 text-amber-500"
                                                        : n.status === "failed"
                                                          ? "bg-rose-500/15 text-rose-400"
                                                          : "bg-emerald-500/15 text-emerald-500"
                                                }`}
                                            >
                                                {n.status === "no_channel"
                                                    ? "No channel"
                                                    : n.status === "failed"
                                                      ? "Failed"
                                                      : "Delivered"}
                                            </span>
                                                </div>
                                                <p className="mt-2 text-[11px] text-muted-foreground">
                                                    {n.createdAt
                                                        ? new Date(n.createdAt).toLocaleString()
                                                        : ""}
                                                    {n.channels && n.channels.length > 0
                                                        ? ` · ${n.channels.join(" + ")}`
                                                        : ""}
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                </div>

                {showDiscordModal && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
                        onClick={(e) => e.target === e.currentTarget && setShowDiscordModal(false)}
                    >
                        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h2 className="text-lg font-semibold text-foreground">Choose Discord Channel</h2>
                                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                        Pick a server where the AlgoVault bot is installed, then choose the channel that should receive alerts.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowDiscordModal(false)}
                                    className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="mt-5 space-y-4">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Server
                                    </label>
                                    <select
                                        value={selectedGuildId}
                                        onChange={(e) => {
                                            setSelectedGuildId(e.target.value);
                                            setSelectedChannelId("");
                                        }}
                                        disabled={loadingDiscordGuilds}
                                        className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
                                    >
                                        <option value="">
                                            {loadingDiscordGuilds ? "Loading servers..." : "Select a server"}
                                        </option>
                                        {discordGuilds.map((guild) => (
                                            <option key={guild.id} value={guild.id}>
                                                {guild.name}
                                            </option>
                                        ))}
                                    </select>
                                    {!loadingDiscordGuilds && discordGuilds.length === 0 && (
                                        <p className="mt-2 text-[11px] leading-5 text-amber-600">
                                            No shared servers found. Add the bot to your Discord server first, then connect again.
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Channel
                                    </label>
                                    <select
                                        value={selectedChannelId}
                                        onChange={(e) => setSelectedChannelId(e.target.value)}
                                        disabled={!selectedGuildId || discordChannels.length === 0}
                                        className="w-full rounded-xl border border-border bg-muted/50 px-4 py-2.5 text-sm text-foreground focus:border-foreground/40 focus:outline-none"
                                    >
                                        <option value="">
                                            {!selectedGuildId
                                                ? "Select a server first"
                                                : discordChannels.length === 0
                                                  ? "No text channels available"
                                                  : "Select a channel"}
                                        </option>
                                        {discordChannels.map((channel) => (
                                            <option key={channel.id} value={channel.id}>
                                                #{channel.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                    {discordBotInviteUrl && (
                                        <a
                                            href={discordBotInviteUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-muted"
                                        >
                                            <ExternalLink size={13} />
                                            Add bot
                                        </a>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleCreateDiscordWebhook}
                                        disabled={!selectedChannelId || creatingWebhook}
                                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-[#4752c4] disabled:opacity-50"
                                    >
                                        {creatingWebhook ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                        Create webhook
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </AccountShell>
    );
}
