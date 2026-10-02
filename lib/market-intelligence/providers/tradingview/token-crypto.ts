/**
 * Token encryption for the TradingView MCP OAuth connection (PHASE 3).
 *
 * Server-side only. AES-256-GCM with an AAD binding to the owning user id so
 * a ciphertext copied between users cannot be decrypted. The encryption key
 * comes exclusively from the TRADINGVIEW_TOKEN_ENCRYPTION_KEY environment
 * variable (32-byte hex or any passphrase ≥ 32 chars, hashed to 32 bytes).
 * There is NO fallback key: with encryption unconfigured the provider refuses
 * to store or use tokens (fail-closed) rather than storing plaintext.
 */
import crypto from "crypto";

const VERSION_BYTE = "v1";
const IV_BYTES = 12;
const SALT = "algovault-tradingview-mcp-token-v1";

export class TokenEncryptionUnavailableError extends Error {
    constructor() {
        super("TRADINGVIEW_TOKEN_ENCRYPTION_KEY is not configured; TradingView token storage is disabled.");
        this.name = "TokenEncryptionUnavailableError";
    }
}

function resolveKey(): Buffer | null {
    const raw = (process.env.TRADINGVIEW_TOKEN_ENCRYPTION_KEY || "").trim();
    if (!raw) return null;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        return Buffer.from(raw, "hex");
    }
    // Passphrase → deterministic 32-byte key via scrypt.
    return crypto.scryptSync(raw, SALT, 32);
}

export function isTokenEncryptionConfigured(): boolean {
    return resolveKey() !== null;
}

export interface EncryptedTokenPayload {
    /** Encoded envelope: v1:<iv-b64>:<tag-b64>:<ciphertext-b64> */
    ciphertext: string;
    version: "v1";
}

/**
 * Encrypt a JSON-serializable token bundle. AAD = userId, so records are
 * cryptographically bound to their owner.
 */
export function encryptTokenPayload(userId: string, payload: unknown): EncryptedTokenPayload {
    const key = resolveKey();
    if (!key) throw new TokenEncryptionUnavailableError();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(userId, "utf8"));
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        version: "v1",
        ciphertext: [
            VERSION_BYTE,
            iv.toString("base64"),
            tag.toString("base64"),
            encrypted.toString("base64"),
        ].join(":"),
    };
}

/** Decrypt a token envelope. Throws on tamper or wrong-user AAD. */
export function decryptTokenPayload<T>(userId: string, envelope: string): T {
    const key = resolveKey();
    if (!key) throw new TokenEncryptionUnavailableError();
    const parts = envelope.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION_BYTE) {
        throw new Error("Malformed token envelope.");
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAAD(Buffer.from(userId, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as T;
}

/** Test hook — wipe any derived key caching (none currently) — kept for API symmetry. */
export function _resetTokenCryptoForTests(): void {
    /* no-op: keys are derived per call, never cached */
}
