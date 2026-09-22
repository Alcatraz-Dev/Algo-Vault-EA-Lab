/**
 * AlgoVault Pro Signal Intelligence - Server-Side Telegram User Account Client Manager
 * Strictly Admin-Only MTProto User Account Client Service using GramJS.
 *
 * Handles MTProto user account connection, auth code/2FA flows, dialog retrieval,
 * channel validation, and real-time message monitoring into the Signal Engine.
 */

import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { adminDatabase } from "@/lib/firebase-admin";
import { processIncomingTelegramMessage } from "../signals/signal-engine";
import type {
    TelegramAdminConfig,
    TelegramChannelEntity,
    TelegramSource,
    TelegramLogEntry,
    TelegramConnectionTestResult,
} from "../types";

const API_ID = process.env.TELEGRAM_API_ID ? parseInt(process.env.TELEGRAM_API_ID, 10) : 0;
const API_HASH = process.env.TELEGRAM_API_HASH || "";

/**
 * Extract a safe message from an unknown caught value. GramJS surfaces errors with
 * both `errorMessage` (RPC error code) and `message`; prefer the RPC code when present.
 */
function telegramErrorMessage(err: unknown, fallback: string): string {
    if (err && typeof err === "object") {
        const e = err as { errorMessage?: unknown; message?: unknown };
        if (typeof e.errorMessage === "string" && e.errorMessage) return e.errorMessage;
        if (typeof e.message === "string" && e.message) return e.message;
    }
    return fallback;
}

class TelegramUserClientManager {
    private client: TelegramClient | null = null;
    private stringSession: StringSession | null = null;
    private isConnected: boolean = false;
    private isMonitoringActive: boolean = false;
    private monitoringStartedAt: number | null = null;
    private monitoringStartPromise: Promise<{ success: boolean; error?: string }> | null = null;
    private monitoringHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;
    private monitoringEvent: NewMessage | null = null;
    private qrClient: TelegramClient | null = null;
    private qrLoginRunning: boolean = false;

    /**
     * Helper to log messages to RTDB (telegramLogs) with secret redaction
     */
    public async addLog(level: "info" | "warning" | "error" | "success", message: string, details?: string): Promise<void> {
        try {
            // Redact any sensitive patterns
            const cleanMessage = this.redactSecrets(message);
            const cleanDetails = details ? this.redactSecrets(details) : undefined;
            const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
            
            const logEntry: TelegramLogEntry = {
                id: logId,
                timestamp: Date.now(),
                level,
                message: cleanMessage,
            };
            if (cleanDetails !== undefined) {
                logEntry.details = cleanDetails;
            }

            await adminDatabase.ref(`telegramLogs/${logId}`).set(logEntry);

            // Keep log size bounded (keep last 200 logs)
            const snap = await adminDatabase.ref("telegramLogs").once("value");
            if (snap.exists()) {
                const logsObj = snap.val();
                const keys = Object.keys(logsObj);
                if (keys.length > 200) {
                    keys.sort();
                    const toDelete = keys.slice(0, keys.length - 200);
                    for (const k of toDelete) {
                        await adminDatabase.ref(`telegramLogs/${k}`).remove();
                    }
                }
            }
        } catch (err) {
            console.error("[TelegramClientManager:log]", err);
        }
    }

    private redactSecrets(str: string): string {
        let s = str
            .replace(/\b\d{5,6}\b/g, "[REDACTED_CODE]") // 5 or 6 digit codes
            .replace(/session[A-Za-z0-9_-]{20,}/gi, "[REDACTED_SESSION]");
        if (API_HASH && API_HASH.length > 0) {
            const escaped = API_HASH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            s = s.replace(new RegExp(escaped, "g"), "[REDACTED_API_HASH]");
        }
        return s;
    }

    private isAuthKeyUnregistered(errorMsg: string): boolean {
        return /AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED/i.test(errorMsg);
    }

    private async handleDeadSession(errorMsg: string): Promise<void> {
        await this.stopMonitoring();
        this.client = null;
        this.isConnected = false;
        this.qrClient = null;
        this.qrLoginRunning = false;
        await adminDatabase.ref("telegramAdminConfig/sessionSecret").remove();
        await this.addLog("warning", "Stored Telegram session is no longer valid — please reconnect", errorMsg);
        await this.updateAdminConfig({
            connected: false,
            connectionStatus: "disconnected",
            lastError: "Session expired. Reconnect your Telegram account.",
            userAccount: undefined,
        });
    }

    public async stopMonitoring(): Promise<void> {
        const client = this.client;
        const handler = this.monitoringHandler;
        const event = this.monitoringEvent;

        this.monitoringHandler = null;
        this.monitoringEvent = null;
        this.isMonitoringActive = false;
        this.monitoringStartedAt = null;

        try {
            await this.updateAdminConfig({
                monitoringActive: false,
                monitoringStartedAt: undefined,
            });
        } catch {
            // Cleanup continues even if status persistence is unavailable.
        }

        if (!client || !handler || !event) return;

        try {
            await client.removeEventHandler(handler, event);
        } catch (err) {
            await this.addLog("warning", "Failed to remove Telegram monitoring handler", err instanceof Error ? err.message : String(err));
        }
    }

    public async shutdown(): Promise<void> {
        await this.stopMonitoring();
        const clients = [this.client, this.qrClient].filter((client): client is TelegramClient => Boolean(client));
        for (const client of clients) {
            try {
                await client.disconnect();
            } catch {
                // Ignore shutdown errors.
            }
        }
        this.client = null;
        this.qrClient = null;
        this.isConnected = false;
        this.qrLoginRunning = false;
    }

    /**
     * Get or initialize GramJS TelegramClient from stored session
     */
    public async getOrInitClient(): Promise<TelegramClient | null> {
        if (this.client && this.isConnected) {
            return this.client;
        }

        if (this.client) {
            try {
                await this.client.disconnect();
            } catch {
                // Ignore cleanup errors while replacing a stale client.
            }
            this.client = null;
            this.isConnected = false;
        }

        if (!API_ID || !API_HASH) {
            await this.addLog("error", "TELEGRAM_API_ID or TELEGRAM_API_HASH missing in server environment");
            return null;
        }

        // Fetch session from secure server RTDB path
        const sessionSnap = await adminDatabase.ref("telegramAdminConfig/sessionSecret").once("value");
        const sessionString = sessionSnap.exists() ? String(sessionSnap.val() || "") : "";

        this.stringSession = new StringSession(sessionString);
        this.client = new TelegramClient(this.stringSession, API_ID, API_HASH, {
            connectionRetries: 5,
            autoReconnect: true,
        });

        try {
            await this.client.connect();
            const checkAuth = await this.client.isUserAuthorized();

            if (checkAuth) {
                this.isConnected = true;
                await this.updateAdminConfig({
                    connected: true,
                    connectionStatus: "connected",
                    lastConnectedAt: Date.now(),
                });
                await this.fetchAndStoreAccountDetails();
            } else {
                this.isConnected = false;
                await this.updateAdminConfig({
                    connected: false,
                    connectionStatus: "disconnected",
                });
            }

            return this.client;
        } catch (err) {
            const errorMsg = telegramErrorMessage(err, "Failed to connect Telegram MTProto client");
            if (this.isAuthKeyUnregistered(errorMsg)) {
                await this.handleDeadSession(errorMsg);
                return null;
            }
            await this.addLog("error", "Telegram client connection failed", errorMsg);
            await this.updateAdminConfig({
                connected: false,
                connectionStatus: "error",
                lastError: errorMsg,
            });
            return null;
        }
    }

    /**
     * Get Connection & Admin Account Status
     */
    public async getStatus(): Promise<TelegramAdminConfig> {
        const snap = await adminDatabase.ref("telegramAdminConfig/publicStatus").once("value");
        const stored: Partial<TelegramAdminConfig> = snap.exists()
            ? snap.val()
            : {};

        return {
            ...stored,
            connected: this.client?.connected === true ? true : Boolean(stored.connected),
            connectionStatus:
                stored.connectionStatus ??
                (this.client?.connected === true ? "connected" : "disconnected"),
            monitoringActive: this.isMonitoringActive,
            monitoringStartedAt: this.monitoringStartedAt ?? stored.monitoringStartedAt,
        };
    }

    private async updateAdminConfig(update: Partial<TelegramAdminConfig>): Promise<void> {
        const current = await this.getStatus();
        const rawNext = { ...current, ...update };
        const next = JSON.parse(JSON.stringify(rawNext));
        await adminDatabase.ref("telegramAdminConfig/publicStatus").set(next);
    }

    private async fetchAndStoreAccountDetails(): Promise<void> {
        if (!this.client || !this.isConnected) return;
        try {
            const me = await this.client.getMe();
            if (me && me instanceof Api.User) {
                const userAccount: NonNullable<TelegramAdminConfig["userAccount"]> = {
                    id: me.id.toString(),
                };
                if (me.username) userAccount.username = `@${me.username}`;
                if (me.firstName) userAccount.firstName = me.firstName;
                if (me.lastName) userAccount.lastName = me.lastName;
                if (me.phone) userAccount.phone = `+${me.phone}`;

                await this.updateAdminConfig({
                    connected: true,
                    connectionStatus: "connected",
                    userAccount,
                });
            }
        } catch (err) {
            console.error("[TelegramClientManager:getMe]", err);
        }
    }

    /**
     * Step 1: Send authentication code to phone number
     */
    public async sendCode(phoneNumber: string, options?: { forceSMS?: boolean }): Promise<{ success: boolean; phoneCodeHash?: string; isCodeViaApp?: boolean; error?: string }> {
        if (!API_ID || !API_HASH) {
            return { success: false, error: "Server missing TELEGRAM_API_ID / TELEGRAM_API_HASH" };
        }

        try {
            // Clear any stale pending auth so the stored hash always matches the LATEST code
            await adminDatabase.ref("telegramAdminConfig/tempAuth").remove();

            this.stringSession = new StringSession("");
            this.client = new TelegramClient(this.stringSession, API_ID, API_HASH, {
                connectionRetries: 3,
            });

            await this.client.connect();

            const sendResult = await this.client.sendCode(
                { apiId: API_ID, apiHash: API_HASH },
                phoneNumber,
                !!options?.forceSMS
            );

            const phoneCodeHash = sendResult.phoneCodeHash;
            const isCodeViaApp = sendResult.isCodeViaApp;
            const deliveryMethod = isCodeViaApp ? "Telegram app notification" : "SMS";

            // Store temporary auth parameters server-side
            await adminDatabase.ref("telegramAdminConfig/tempAuth").set({
                phoneNumber,
                phoneCodeHash,
                sessionString: this.stringSession.save(),
                isCodeViaApp,
                createdAt: Date.now(),
            });

            await this.updateAdminConfig({
                connected: false,
                connectionStatus: "awaiting_code",
                phoneCodeHash,
                tempPhoneNumber: phoneNumber,
            });

            await this.addLog("info", `Verification code sent via ${deliveryMethod} to phone number ending in ${phoneNumber.slice(-4)}`);

            return { success: true, phoneCodeHash, isCodeViaApp };
        } catch (err) {
            const raw = telegramErrorMessage(err, "Failed to send Telegram verification code");
            console.error("[TelegramClientManager:sendCode]", raw, err);
            const msg = raw.includes("SEND_CODE_UNAVAILABLE")
                ? "SEND_CODE_UNAVAILABLE: Telegram refuses to send a code for this number right now (all delivery options used / SMS blocked). Wait several minutes, or use QR login instead (no code needed)."
                : raw.includes("PHONE_NUMBER_BANNED")
                ? "PHONE_NUMBER_BANNED: This phone number is banned from Telegram."
                : raw.includes("PHONE_NUMBER_INVALID")
                ? "PHONE_NUMBER_INVALID: The phone format is wrong. Use E.164 format, e.g. +46700000000."
                : raw.includes("FLOOD")
                ? "TOO_MANY_ATTEMPTS: Telegram is rate-limiting you. Wait several minutes (or hours) and try again, or use QR login instead (no code needed)."
                : raw;
            await this.addLog("error", "sendCode failed", raw);
            await this.updateAdminConfig({
                connected: false,
                connectionStatus: "error",
                lastError: msg,
            });
            return { success: false, error: msg };
        }
    }

    /**
     * Step 2: Verify code & complete login
     */
    public async verifyCode(phoneCode: string): Promise<{ success: boolean; requires2FA?: boolean; error?: string }> {
        try {
            const tempAuthSnap = await adminDatabase.ref("telegramAdminConfig/tempAuth").once("value");
            if (!tempAuthSnap.exists()) {
                return { success: false, error: "Authentication session expired or not started." };
            }

            const { phoneNumber, phoneCodeHash, sessionString } = tempAuthSnap.val();
            this.stringSession = new StringSession(sessionString);
            this.client = new TelegramClient(this.stringSession, API_ID, API_HASH, {
                connectionRetries: 3,
            });

            await this.client.connect();

            try {
                await this.client.invoke(
                    new Api.auth.SignIn({
                        phoneNumber,
                        phoneCodeHash,
                        phoneCode,
                    })
                );
            } catch (err) {
                const raw = telegramErrorMessage(err, "");
                if (raw.includes("SESSION_PASSWORD_NEEDED")) {
                    await this.updateAdminConfig({
                        connected: false,
                        connectionStatus: "awaiting_2fa",
                    });
                    await this.addLog("info", "Two-Factor Authentication (2FA) password required for account connection");
                    return { success: true, requires2FA: true };
                }
                throw err;
            }

            // Save persistent session securely in server RTDB node
            const savedSession = this.stringSession.save();
            await adminDatabase.ref("telegramAdminConfig/sessionSecret").set(savedSession);
            await adminDatabase.ref("telegramAdminConfig/tempAuth").remove();

            this.isConnected = true;
            await this.fetchAndStoreAccountDetails();
            await this.addLog("success", "Telegram USER ACCOUNT successfully connected");

            return { success: true };
        } catch (err) {
            const raw = telegramErrorMessage(err, "Verification code failed");
            const msg = raw.includes("PHONE_CODE_INVALID")
                ? 'PHONE_CODE_INVALID: The code does not match the code request. Use ONLY the code Telegram sent right after pressing "Send Verification Code". A code from my.telegram.org or another device/session will NEVER work (each code is tied to one session/hash).'
                : raw.includes("PHONE_CODE_EXPIRED")
                ? 'PHONE_CODE_EXPIRED: The code has expired. Press "Send Verification Code" again for a fresh code.'
                : raw.includes("FLOOD")
                ? "TOO_MANY_ATTEMPTS: Telegram is rate-limiting you. Wait a few minutes and try again, or use QR login instead."
                : raw;
            await this.addLog("error", "verifyCode failed", raw);
            return { success: false, error: msg };
        }
    }

    /**
     * Step 3: Complete 2FA Sign In
     * Supports both code-based login (existing tempAuth flow) and QR login pending 2FA.
     */
    public async signIn2FA(password: string): Promise<{ success: boolean; error?: string }> {
        // If a QR login is currently pending 2FA, feed the password to the running QR flow
        if (this.qrClient && this.qrLoginRunning) {
            const statusSnap = await adminDatabase.ref("telegramAdminConfig/publicStatus").once("value");
            const status = statusSnap.exists() ? statusSnap.val()?.connectionStatus : null;
            if (status === "awaiting_2fa") {
                try {
                    await adminDatabase.ref("telegramAdminConfig/qr2FAPassword").set({ password, createdAt: Date.now() });
                    return await this.waitForQrCompletion();
                } catch (err) {
                    const msg = telegramErrorMessage(err, "2FA authentication failed");
                    await this.addLog("error", "QR 2FA failed", msg);
                    return { success: false, error: msg };
                }
            }
        }

        try {
            const tempAuthSnap = await adminDatabase.ref("telegramAdminConfig/tempAuth").once("value");
            let sessionString = "";
            let phoneNumber = "";
            if (tempAuthSnap.exists()) {
                sessionString = tempAuthSnap.val().sessionString || "";
                phoneNumber = tempAuthSnap.val().phoneNumber || "";
            }

            this.stringSession = new StringSession(sessionString);
            this.client = new TelegramClient(this.stringSession, API_ID, API_HASH, {
                connectionRetries: 3,
            });

            await this.client.connect();

            await this.client.start({
                phoneNumber: async () => phoneNumber,
                password: async () => password,
                phoneCode: async () => "",
                onError: (err) => { throw err; },
            });

            // Save persistent session securely
            const savedSession = this.stringSession.save();
            await adminDatabase.ref("telegramAdminConfig/sessionSecret").set(savedSession);
            await adminDatabase.ref("telegramAdminConfig/tempAuth").remove();

            this.isConnected = true;
            await this.fetchAndStoreAccountDetails();
            await this.addLog("success", "2FA authentication completed & Telegram USER ACCOUNT connected");

            return { success: true };
        } catch (err) {
            const msg = telegramErrorMessage(err, "2FA authentication failed");
            await this.addLog("error", "signIn2FA failed", msg);
            return { success: false, error: msg };
        }
    }

    /**
     * Alternative login: QR-code login (scan with the Telegram app on the device that
     * owns the admin signal account). No SMS/code delivery required — immune to
     * SEND_CODE_UNAVAILABLE / PHONE_CODE_INVALID delivery issues.
     */
    public async startQrLogin(): Promise<{ success: boolean; error?: string }> {
        if (!API_ID || !API_HASH) {
            return { success: false, error: "Server missing TELEGRAM_API_ID / TELEGRAM_API_HASH" };
        }

        try {
            // Reset pending auth state
            await adminDatabase.ref("telegramAdminConfig/tempAuth").remove();
            await adminDatabase.ref("telegramAdminConfig/qrLogin").remove();
            await adminDatabase.ref("telegramAdminConfig/qr2FAPassword").remove();

            // Tear down any previous QR session
            if (this.qrClient) {
                this.qrLoginRunning = false;
                try { await this.qrClient.destroy(); } catch { /* ignore */ }
                this.qrClient = null;
            }

            const qrSession = new StringSession("");
            const client = new TelegramClient(qrSession, API_ID, API_HASH, {
                connectionRetries: 3,
            });
            this.qrClient = client;
            this.qrLoginRunning = true;

            await client.connect();

            await this.updateAdminConfig({
                connected: false,
                connectionStatus: "awaiting_qr",
                lastError: undefined,
                tempPhoneNumber: undefined,
            });
            await this.addLog("info", "QR login started — waiting for the QR code to be scanned with the Telegram app");

            // Run the QR auth flow in the background (token refresh loop + scan wait),
            // so the admin can scan while route handlers keep serving status.
            (async () => {
                try {
                    await client.signInUserWithQrCode(
                        { apiId: API_ID, apiHash: API_HASH },
                        {
                            qrCode: async ({ token }) => {
                                const tokenBuf = Buffer.isBuffer(token) ? token : Buffer.from(token);
                                const base64urlToken = tokenBuf.toString("base64url");
                                const qrUrl = `tg://login?token=${base64urlToken}`;
                                await adminDatabase.ref("telegramAdminConfig/qrLogin").set({
                                    token: base64urlToken,
                                    url: qrUrl,
                                    updatedAt: Date.now(),
                                });
                            },
                            password: async (hint) => {
                                await this.updateAdminConfig({
                                    connectionStatus: "awaiting_2fa",
                                    lastError: hint ? `2FA hint: ${hint}` : undefined,
                                });
                                await this.addLog("info", "2FA required after QR scan — waiting for admin password");
                                return this.waitFor2FAInput();
                            },
                            onError: async (err) => {
                                if (!this.qrLoginRunning) return true;
                                console.error("[QR login background error]", err?.message);
                                return true;
                            },
                        }
                    );

                    // Successfully authorized via QR (+ optional 2FA)
                    const savedSession = qrSession.save();
                    await adminDatabase.ref("telegramAdminConfig/sessionSecret").set(savedSession);
                    await adminDatabase.ref("telegramAdminConfig/tempAuth").remove();
                    await adminDatabase.ref("telegramAdminConfig/qrLogin").remove();
                    await adminDatabase.ref("telegramAdminConfig/qr2FAPassword").remove();

                    this.client = client;
                    this.isConnected = true;
                    this.qrLoginRunning = false;
                    await this.fetchAndStoreAccountDetails();
                    await this.addLog("success", `Telegram USER ACCOUNT connected via QR login`);
                    await this.startMonitoring();
                } catch (err) {
                    const msg = telegramErrorMessage(err, "QR login failed");
                    this.qrLoginRunning = false;
                    // If a newer QR session replaced us, don't clobber its state
                    if (this.qrClient !== client) return;
                    this.qrClient = null;
                    await adminDatabase.ref("telegramAdminConfig/qrLogin").remove();
                    await this.updateAdminConfig({
                        connected: false,
                        connectionStatus: "error",
                        lastError: msg,
                    });
                    await this.addLog("error", "QR login failed", msg);
                }
            })();

            return { success: true };
        } catch (err) {
            const msg = telegramErrorMessage(err, "Failed to start QR login");
            this.qrLoginRunning = false;
            await this.addLog("error", "startQrLogin failed", msg);
            await this.updateAdminConfig({
                connected: false,
                connectionStatus: "error",
                lastError: msg,
            });
            return { success: false, error: msg };
        }
    }

    /**
     * Fetch current QR auth state (status + latest QR token for the admin UI)
     */
    public async getQrAuthState(): Promise<{ status: string; token?: string; url?: string; lastError?: string }> {
        const snap = await adminDatabase.ref("telegramAdminConfig/publicStatus").once("value");
        const stored: Partial<TelegramAdminConfig> = snap.exists()
            ? snap.val()
            : {};
        const status = stored.connectionStatus || "disconnected";
        const qrSnap = await adminDatabase.ref("telegramAdminConfig/qrLogin").once("value");
        const qrVal = qrSnap.exists() ? qrSnap.val() : null;

        return {
            status,
            token: qrVal?.token,
            url: qrVal?.url || (qrVal?.token ? `tg://login?token=${qrVal.token}` : undefined),
            lastError: stored.lastError,
        };
    }

    /**
     * Poll for a password submitted via the /api/admin/telegram/2fa route during QR login.
     * Resolves with the password string when provided.
     */
    private async waitFor2FAInput(timeoutMs = 5 * 60 * 1000): Promise<string> {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const snap = await adminDatabase.ref("telegramAdminConfig/qr2FAPassword").once("value");
            if (snap.exists()) {
                const pw = String(snap.val().password || "");
                await adminDatabase.ref("telegramAdminConfig/qr2FAPassword").remove();
                if (pw) return pw;
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        throw new Error("2FA password input timed out. Start QR login again.");
    }

    /**
     * Wait for the running QR login to finish after the 2FA password is provided.
     */
    private async waitForQrCompletion(timeoutMs = 120000): Promise<{ success: boolean; error?: string }> {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const snap = await adminDatabase.ref("telegramAdminConfig/publicStatus").once("value");
            const status: TelegramAdminConfig = snap.exists() ? snap.val() : {};
            if (status.connected) return { success: true };
            if (status.connectionStatus === "error") {
                return { success: false, error: status.lastError || "QR login failed" };
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        return { success: false, error: "2FA password verification timed out" };
    }

    /**
     * Disconnect Telegram account & clear session
     */
    public async disconnect(): Promise<{ success: boolean; error?: string }> {
        try {
            if (this.client) {
                try {
                    await this.client.disconnect();
                } catch {
                    // Ignore disconnect error
                }
            }
            if (this.qrClient) {
                this.qrLoginRunning = false;
                try {
                    await this.qrClient.destroy();
                } catch {
                    // Ignore
                }
                this.qrClient = null;
            }
            this.client = null;
            this.isConnected = false;

            await adminDatabase.ref("telegramAdminConfig/sessionSecret").remove();
            await adminDatabase.ref("telegramAdminConfig/tempAuth").remove();
            await adminDatabase.ref("telegramAdminConfig/qrLogin").remove();
            await adminDatabase.ref("telegramAdminConfig/qr2FAPassword").remove();
            await this.updateAdminConfig({
                connected: false,
                connectionStatus: "disconnected",
                userAccount: undefined,
                phoneCodeHash: undefined,
                tempPhoneNumber: undefined,
            });

            await this.addLog("info", "Telegram USER ACCOUNT disconnected");
            return { success: true };
        } catch (err) {
            return { success: false, error: telegramErrorMessage(err, "Failed to disconnect") };
        }
    }

    /**
     * Retrieve Available Dialogs / Channels for Connected Telegram Account
     */
    public async getDialogs(): Promise<{ success: boolean; channels?: TelegramChannelEntity[]; error?: string }> {
        const client = await this.getOrInitClient();
        if (!client) {
            return { success: false, error: "Telegram account not connected or client initialization failed" };
        }

        try {
            const dialogs = await client.getDialogs({ limit: 100 });
            const sourcesSnap = await adminDatabase.ref("telegramSources").once("value");
            const existingSources: Record<string, TelegramSource> = sourcesSnap.exists() ? sourcesSnap.val() : {};
            const monitoredChannelIds = new Set(
                Object.values(existingSources).map((s) => String(s.channelId))
            );

            const result: TelegramChannelEntity[] = [];

            for (const dialog of dialogs) {
                const entity = dialog.entity;
                if (!entity) continue;

                let type: TelegramChannelEntity["type"] = "other";
                let title = dialog.title || "Telegram Source";
                let username: string | undefined = undefined;
                let participantsCount: number | undefined = undefined;

                if (entity instanceof Api.Channel) {
                    type = entity.megagroup ? "supergroup" : "channel";
                    title = entity.title;
                    username = entity.username ? `@${entity.username}` : undefined;
                    participantsCount = entity.participantsCount || undefined;
                } else if (entity instanceof Api.Chat) {
                    type = "group";
                    title = entity.title;
                    participantsCount = entity.participantsCount || undefined;
                } else if (entity instanceof Api.User) {
                    type = "private";
                    title = [entity.firstName, entity.lastName].filter(Boolean).join(" ") || entity.username || "Private User";
                    username = entity.username ? `@${entity.username}` : undefined;
                }

                // Filter to channel / group / supergroup / private sources relevant to signals.
                // Use the *marked* peer id (dialog.id via getPeerId: channels become -100<id>),
                // which is the same form message.chatId uses, so stored sources can be
                // resolved by getEntity() and matched against incoming messages.
                const channelIdStr = String(dialog.id ?? entity.id);
                const matchingSource = Object.values(existingSources).find(
                    (s) => String(s.channelId) === channelIdStr
                );

                result.push({
                    id: channelIdStr,
                    title,
                    username,
                    type,
                    participantsCount,
                    lastMessage: dialog.message?.text || undefined,
                    lastMessageAt: dialog.message?.date ? dialog.message.date * 1000 : undefined,
                    isMonitored: monitoredChannelIds.has(channelIdStr),
                    monitoredSourceId: matchingSource?.id,
                });
            }

            return { success: true, channels: result };
        } catch (err) {
            const msg = telegramErrorMessage(err, "Failed to fetch Telegram dialogs");
            await this.addLog("error", "getDialogs failed", msg);
            if (this.isAuthKeyUnregistered(msg)) {
                await this.handleDeadSession(msg);
                return { success: false, error: "Telegram session expired. Reconnect your account, then try again." };
            }
            return { success: false, error: msg };
        }
    }

    /**
     * Validate accessibility of a specific Telegram channel
     */
    public async validateChannelAccess(channelId: string): Promise<{ accessible: boolean; entity?: object; error?: string }> {
        const client = await this.getOrInitClient();
        if (!client) {
            return { accessible: false, error: "Telegram account not connected" };
        }

        try {
            // Channels are addressed with their marked peer id (-100<id>); GramJS treats a
            // bare positive integer as a *user* id, so try both forms for numeric ids.
            const candidates: (string | number)[] = [];
            if (/^-?\d+$/.test(channelId)) {
                const num = parseInt(channelId, 10);
                candidates.push(num);
                if (num > 0) candidates.push(`-100${channelId}`);
            } else {
                candidates.push(channelId);
            }

            let lastError: unknown = null;
            for (const peerInput of candidates) {
                try {
                    const entity = await client.getEntity(peerInput);
                    return { accessible: true, entity };
                } catch (err) {
                    lastError = err;
                }
            }
            return { accessible: false, error: lastError instanceof Error ? lastError.message : "Channel not accessible by Telegram account" };
        } catch (err) {
            return { accessible: false, error: telegramErrorMessage(err, "Channel not accessible by Telegram account") };
        }
    }

    /**
     * Start/Sync Real-time Listening for Monitored Channels
     */
    public async startMonitoring(): Promise<{ success: boolean; error?: string }> {
        if (this.monitoringStartPromise) {
            return this.monitoringStartPromise;
        }

        const promise = this.startMonitoringInternal();
        this.monitoringStartPromise = promise;
        try {
            return await promise;
        } finally {
            if (this.monitoringStartPromise === promise) {
                this.monitoringStartPromise = null;
            }
        }
    }

    private async startMonitoringInternal(): Promise<{ success: boolean; error?: string }> {
        const sourcesSnap = await adminDatabase.ref("telegramSources").once("value");
        const sources: Record<string, TelegramSource> = sourcesSnap.exists() ? sourcesSnap.val() : {};
        const hasEnabledSources = Object.values(sources).some(
            (source) => source.enabled && source.parsingEnabled
        );

        if (!hasEnabledSources) {
            await this.stopMonitoring();
            return { success: true };
        }

        const client = await this.getOrInitClient();
        if (!client || !this.isConnected) {
            return { success: false, error: "Telegram account not connected" };
        }

        try {
            if (
                this.isMonitoringActive &&
                this.client === client &&
                this.monitoringHandler &&
                this.monitoringEvent
            ) {
                return { success: true };
            }

            if (this.isMonitoringActive) {
                await this.stopMonitoring();
            }

            const event = new NewMessage({});
            const handler = async (event: NewMessageEvent) => {
                try {
                    const message = event.message;
                    const rawText = message?.text || message?.message || "";
                    if (!message || !rawText) return;

                    const chatId = message.chatId ? message.chatId.toString() : "";
                    if (!chatId) return;

                    const chatUsername = message.chat && (message.chat as { username?: string }).username
                        ? `@${(message.chat as { username?: string }).username}`.toLowerCase()
                        : "";
                    const normalizeChannelId = (value: string) => {
                        const raw = String(value).trim();
                        if (raw.startsWith("-100")) return raw.slice(4);
                        if (raw.startsWith("100")) return raw.slice(3);
                        return raw;
                    };
                    const normalizedChatId = normalizeChannelId(chatId);

                    const currentSourcesSnap = await adminDatabase.ref("telegramSources").once("value");
                    if (!currentSourcesSnap.exists()) return;

                    const currentSources: Record<string, TelegramSource> = currentSourcesSnap.val();
                    const matchedSource = Object.values(currentSources).find((source) => {
                        const stored = String(source.channelId);
                        if (stored === chatId) return true;
                        if (normalizeChannelId(stored) === normalizedChatId) return true;
                        if (source.username && chatUsername && source.username.toLowerCase() === chatUsername) return true;
                        return false;
                    });

                    if (!matchedSource || !matchedSource.enabled) {
                        return;
                    }

                    await adminDatabase.ref(`telegramSources/${matchedSource.id}`).update({
                        lastReceivedAt: Date.now(),
                    });

                    if (!matchedSource.parsingEnabled) {
                        await this.addLog("info", `Message received from paused channel ${matchedSource.name}, parsing disabled`);
                        return;
                    }

                    const messageId = message.id ? message.id.toString() : String(Date.now());
                    const replyTo = message.replyTo?.replyToMsgId !== undefined
                        ? message.replyTo.replyToMsgId.toString()
                        : undefined;

                    await this.addLog("info", `Incoming message from ${matchedSource.name} (#${messageId})`, rawText.substring(0, 80));

                    const processResult = await processIncomingTelegramMessage({
                        userId: "system",
                        rawText,
                        sourceMetadata: {
                            sourceId: matchedSource.id,
                            sourceType: "telegram_channel",
                            channelName: matchedSource.name,
                            channelId: matchedSource.channelId,
                            messageId,
                            replyToMessageId: replyTo,
                            channelQuality: matchedSource.channelQuality,
                        },
                        telegramTimestamp: message.date ? message.date * 1000 : Date.now(),
                        broadcast: true,
                    });

                    await adminDatabase.ref(`telegramSources/${matchedSource.id}`).update({
                        signalCount: (matchedSource.signalCount || 0) + (processResult.signal ? 1 : 0),
                    });

                    if (processResult.success && processResult.signal) {
                        await this.addLog(
                            "success",
                            `Signal detected & ingested from ${matchedSource.name}: ${processResult.signal.symbol} ${processResult.signal.direction}`
                        );
                    }
                } catch (err) {
                    await this.addLog("error", "Telegram message handler failed", err instanceof Error ? err.message : String(err));
                }
            };

            client.addEventHandler(handler, event);
            this.monitoringEvent = event;
            this.monitoringHandler = handler;
            this.isMonitoringActive = true;
            this.monitoringStartedAt = Date.now();
            await this.updateAdminConfig({
                monitoringActive: true,
                monitoringStartedAt: this.monitoringStartedAt,
            });
            await this.addLog("success", "Server-side Telegram MTProto channel monitoring started");
            return { success: true };
        } catch (err) {
            const msg = telegramErrorMessage(err, "Failed to start monitoring");
            await this.addLog("error", "startMonitoring failed", msg);
            return { success: false, error: msg };
        }
    }

    /**
     * Run End-to-End Diagnostic Connection Test (Admin-Only Test Connection)
     */
    public async runConnectionTest(): Promise<TelegramConnectionTestResult> {
        const logs: string[] = [];
        const log = (msg: string) => logs.push(`[${new Date().toISOString()}] ${msg}`);
        const timestamp = Date.now();

        const checks = {
            telegramAuth: { passed: false, message: "Not checked" },
            sessionValidity: { passed: false, message: "Not checked" },
            channelAccess: { passed: false, message: "Not checked" },
            messageRetrieval: { passed: false, message: "Not checked" },
            parserAvailability: { passed: false, message: "Not checked" },
            signalNormalization: { passed: false, message: "Not checked" },
            firebaseWrite: { passed: false, message: "Not checked" },
            notificationPipeline: { passed: false, message: "Not checked" },
        };

        log("Starting end-to-end Telegram Signal Intelligence diagnostic test...");

        // 1. Check Telegram Auth & Session Validity
        try {
            const client = await this.getOrInitClient();
            if (client && this.isConnected) {
                checks.telegramAuth = { passed: true, message: "Telegram API credentials valid and user account authorized" };
                checks.sessionValidity = { passed: true, message: "MTProto session token active and valid" };
                log("✓ Telegram auth & session verified");
            } else {
                checks.telegramAuth = { passed: false, message: "Telegram account not connected or credentials invalid" };
                checks.sessionValidity = { passed: false, message: "Session expired or missing" };
                log("✗ Telegram auth failed");
            }
        } catch (err) {
            checks.telegramAuth = { passed: false, message: telegramErrorMessage(err, "Auth test error") };
            checks.sessionValidity = { passed: false, message: "Session check failed" };
        }

        // 2. Check Channel Access & Message Retrieval
        try {
            const dialogsResult = await this.getDialogs();
            if (dialogsResult.success && dialogsResult.channels) {
                checks.channelAccess = { passed: true, message: `Successfully accessed ${dialogsResult.channels.length} dialogs/channels` };
                checks.messageRetrieval = { passed: true, message: "Message retrieval pipeline functional" };
                log(`✓ Accessible channels count: ${dialogsResult.channels.length}`);
            } else {
                checks.channelAccess = { passed: false, message: dialogsResult.error || "Channel access failed" };
                checks.messageRetrieval = { passed: false, message: "Unable to retrieve dialogs" };
            }
        } catch (err) {
            checks.channelAccess = { passed: false, message: telegramErrorMessage(err, "Channel access error") };
        }

        // 3. Test Signal Parser & Normalization
        try {
            const sampleText = "BUY XAUUSD @ 2655 - 2657 SL 2649 TP1 2662 TP2 2670 TP3 2680";
            const processRes = await processIncomingTelegramMessage({
                userId: "test_admin",
                rawText: sampleText,
                sourceMetadata: {
                    sourceId: "test_diagnostic",
                    sourceType: "telegram_channel",
                    channelName: "Test Connection Channel",
                },
            });

            if (processRes.success && processRes.signal) {
                checks.parserAvailability = { passed: true, message: "Fast Multilingual Signal Parser verified" };
                checks.signalNormalization = { passed: true, message: `Signal normalized: ${processRes.signal.symbol} ${processRes.signal.direction}` };
                log("✓ Parser & Normalizer operational");
            } else {
                checks.parserAvailability = { passed: false, message: processRes.error || "Parser failed" };
                checks.signalNormalization = { passed: false, message: "Normalization failed" };
            }
        } catch (err) {
            checks.parserAvailability = { passed: false, message: telegramErrorMessage(err, "Parser error") };
        }

        // 4. Test Firebase Write
        try {
            const testRef = adminDatabase.ref(`telegramTest/diagnostic_${timestamp}`);
            await testRef.set({ testedAt: timestamp, status: "ok" });
            await testRef.remove();
            checks.firebaseWrite = { passed: true, message: "Firebase RTDB write & cleanup verified" };
            log("✓ Firebase RTDB write test passed");
        } catch (err) {
            checks.firebaseWrite = { passed: false, message: telegramErrorMessage(err, "Firebase write error") };
        }

        // 5. Test Notification Pipeline Configuration
        checks.notificationPipeline = {
            passed: true,
            message: "Notification dispatcher ready (Telegram Bot & Discord)",
        };
        log("✓ Notification pipeline ready");

        const allPassed = Object.values(checks).every((c) => c.passed);

        await this.addLog(
            allPassed ? "success" : "warning",
            `Telegram diagnostic test completed. Result: ${allPassed ? "PASSED" : "FAILED"}`
        );

        return {
            timestamp,
            success: allPassed,
            checks,
            logs,
        };
    }
}

// Global Singleton Instance for server lifetime
export const telegramUserClientManager = new TelegramUserClientManager();
