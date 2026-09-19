import { setAuthToken, clearAuthToken, setUser, clearUser, getSettings } from "@/storage/storage";

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
    const res = await fetch(`${settings.algovaultUrl}/api/trading/gateway/status`, {
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

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  try {
    const settings = await getSettings();
    try {
      await fetch(`${settings.algovaultUrl}/api/account-health`);
    } catch {
      throw new Error("Cannot reach AlgoVault server");
    }

    const { initializeApp } = await import("firebase/app");
    const { getAuth, signInWithEmailAndPassword } = await import("firebase/auth");

    const app = initializeApp({
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    });
    const auth = getAuth(app);
    firebaseAuth = auth;

    const cred = await signInWithEmailAndPassword(auth, email, password);
    const token = await cred.user.getIdToken();

    const validationRes = await fetch(`${settings.algovaultUrl}/api/trading/gateway/status`, {
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
