/**
 * Transactional email transport for alert delivery.
 *
 * Provider-agnostic and dependency-free: uses plain `fetch`, picking Resend
 * when RESEND_API_KEY is set, otherwise SendGrid when SENDGRID_API_KEY is set.
 * When neither is configured, sendEmail() resolves with { ok: false } instead
 * of throwing, so notification audits report "email not configured" rather
 * than crashing the caller.
 */

export type SendEmailOptions = {
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
};

export type SendEmailResult = {
    ok: boolean;
    error?: string;
    provider?: "resend" | "sendgrid";
};

function getFromAddress(): string {
    return (
        process.env.EMAIL_FROM ||
        process.env.MAIL_FROM ||
        "AlgoVault Alerts <onboarding@resend.dev>"
    ).trim();
}

function extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return (match ? match[1] : from).trim();
}

function extractName(from: string): string {
    const match = from.match(/^([^<]+)</);
    return match ? match[1].trim().replace(/^"|"$/g, "") : "AlgoVault";
}

/** True when an email provider key is present in the environment. */
export function isEmailConfigured(): boolean {
    return Boolean((process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY || "").trim());
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const to = String(options.to || "").trim();
    if (!to) return { ok: false, error: "No recipient email address." };

    const resendKey = (process.env.RESEND_API_KEY || "").trim();
    const sendgridKey = (process.env.SENDGRID_API_KEY || "").trim();

    if (!resendKey && !sendgridKey) {
        return {
            ok: false,
            error: "Email is not configured on the server (set RESEND_API_KEY or SENDGRID_API_KEY).",
        };
    }

    const from = getFromAddress();

    try {
        if (resendKey) {
            const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${resendKey}`,
                },
                body: JSON.stringify({
                    from,
                    to: [to],
                    subject: options.subject,
                    text: options.text,
                    html: options.html,
                    reply_to: options.replyTo || undefined,
                }),
                cache: "no-store",
            });

            if (!res.ok) {
                const data = (await res.json().catch(() => ({}))) as {
                    message?: string;
                    error?: string;
                };
                return {
                    ok: false,
                    provider: "resend",
                    error: data.message || data.error || `Resend send failed (${res.status}).`,
                };
            }
            return { ok: true, provider: "resend" };
        }

        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${sendgridKey}`,
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: to }] }],
                from: { email: extractEmail(from), name: extractName(from) },
                subject: options.subject,
                content: [
                    { type: "text/plain", value: options.text },
                    ...(options.html ? [{ type: "text/html", value: options.html }] : []),
                ],
                reply_to: options.replyTo ? { email: options.replyTo } : undefined,
            }),
            cache: "no-store",
        });

        if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
                errors?: Array<{ message?: string }>;
            };
            return {
                ok: false,
                provider: "sendgrid",
                error: data.errors?.[0]?.message || `SendGrid send failed (${res.status}).`,
            };
        }
        return { ok: true, provider: "sendgrid" };
    } catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : "Email send failed.",
        };
    }
}
