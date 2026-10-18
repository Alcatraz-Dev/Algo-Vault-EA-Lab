import { setAuthToken, clearAuthToken, setUser, clearUser, getSettings } from "@/storage/storage";
import { resolveAlgovaultUrl } from "@/config/environment";

let firebaseAuth: unknown = null;

export interface AuthResult {
  success: boolean;
  user?: { uid: string; email: string | null; displayName: string | null; photoURL: string | null };
  token?: string;
  error?: string;
}

export async function signInWithFirebaseToken(token: string): Promise<AuthResult> {
  try {
    const settings = await getSettings();
    const baseUrl = resolveAlgovaultUrl(settings.algovaultUrl);
    const res = await fetch(`${baseUrl}/api/trading/gateway/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Invalid token");

    await setAuthToken(token);
    return { success: true, token };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Token validation failed",
    };
  }
}

/** How long the pre-login reachability probe waits before giving up. */
const SERVER_PROBE_TIMEOUT_MS = 10_000;

/**
 * Verify the configured backend is reachable before attempting Firebase
 * sign-in. Probes the cheap `/api/health` endpoint (200 + {"ok":true})
 * instead of the full HTML homepage, with a timeout so black-hole
 * networks fail fast instead of spinning forever.
 *
 * Throws a categorized error — callers surface `err.message` directly:
 *   - misconfigured address  → configuration hint (not "cannot reach")
 *   - timeout / TypeError    → genuine connection failure
 *   - non-2xx                → server-side HTTP error with status
 *
 * Never includes tokens, passwords, or response bodies in messages.
 *
 * Returns the resolved origin to use for subsequent requests.
 */
export async function checkServerReachable(rawBaseUrl: string): Promise<string> {
  const cleaned = rawBaseUrl.trim().replace(/\/+$/, "");
  const url = resolveAlgovaultUrl(cleaned);
  if (url !== cleaned) {
    throw new Error(
      "AlgoVault server address is misconfigured. Resetting to the default server — please try again."
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(
        `AlgoVault server error (HTTP ${res.status}). Please try again later.`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("AlgoVault server")) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        "AlgoVault server is not responding (connection timed out). Check your internet connection and try again."
      );
    }
    throw new Error(
      "Cannot reach AlgoVault server. Check your internet connection and try again."
    );    } finally {
    clearTimeout(timer);
  }
  return url;
}

/**
 * Map a Firebase Authentication failure to a safe, user-facing message.
 * Mirrors the website login page's mapping. Raw SDK messages (e.g.
 * "Firebase: Error (auth/invalid-credential).") are never surfaced — they
 * leak implementation detail and confuse traders. Only the Firebase
 * sign-in step uses this; probe/network errors keep their own messages.
 */
export function mapFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many login attempts. Please try again later.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled. Please contact support.";
    default:
      return "Authentication failed. Please try again.";
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  try {
    const settings = await getSettings();
    // Probe first (also validates the address), then reuse the resolved
    // origin for token validation so both talk to the same server.
    const baseUrl = await checkServerReachable(settings.algovaultUrl);

    const { initializeApp, getApps, getApp } = await import("firebase/app");
    const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");

    // Reuse the initialized app across retries in the same popup session —
    // a second initializeApp() throws duplicate-app and would turn a simple
    // password retry into a generic "Authentication failed".
    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    const auth = getAuth(app);
    firebaseAuth = auth;

    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      // Firebase step only: map SDK codes to safe messages. Probe errors
      // above already carry precise messages and must pass through untouched.
      throw new Error(mapFirebaseAuthError(err));
    }
    const token = await cred.user.getIdToken();

    const validationRes = await fetch(`${baseUrl}/api/trading/gateway/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!validationRes.ok) {
      throw new Error("Token not authorized by AlgoVault");
    }

    await setAuthToken(token);
    await setUser({
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: cred.user.displayName,
      photoURL: cred.user.photoURL,
    });

    return {
      success: true,
      user: {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName,
        photoURL: cred.user.photoURL,
      },
      token,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Authentication failed",
    };
  }
}

export async function signOut(): Promise<void> {
  try {
    if (firebaseAuth) {
      const { getAuth, signOut: fbSignOut } = await import("firebase/auth");
      await fbSignOut(getAuth(firebaseAuth as never));
    }
  } catch {
    // Ignore firebase signout errors
  }
  await clearAuthToken();
  await clearUser();
}

export async function getCurrentUser(): Promise<AuthResult["user"] | null> {
  try {
    const user = (await import("@/storage/storage")).getUser();
    return user as unknown as AuthResult["user"] | null;
  } catch {
    return null;
  }
}

export async function refreshSession(): Promise<boolean> {
  try {
    if (firebaseAuth) {
      const { getAuth } = await import("firebase/auth");
      const auth = getAuth(firebaseAuth as never);
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken(true);
        await setAuthToken(token);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}
