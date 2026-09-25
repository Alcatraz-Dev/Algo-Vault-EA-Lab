import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getAuth,
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  sendPasswordResetEmail,
  updateProfile,
  GoogleAuthProvider,
  signInWithCredential,
} from "firebase/auth";
import {
  getDatabase,
  Database,
  ref,
  onValue,
  off,
  set,
  update,
  remove,
  push,
  query,
  orderByChild,
  limitToLast,
  equalTo,
} from "firebase/database";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getReactNativePersistence,
  initializeAuth,
  indexedDBLocalPersistence,
} from "firebase/auth/react-native";

// Firebase configuration from environment
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase App
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Auth with persistence
let auth: Auth;
if (Platform.OS === "web") {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    auth = getAuth(app);
  }
}

const database = getDatabase(app);

// Auth helpers
export const authMethods = {
  signIn: (email: string, password: string) =>
    signInWithEmailAndPassword(auth, email, password),

  signUp: (email: string, password: string) =>
    createUserWithEmailAndPassword(auth, email, password),

  signOut: () => signOut(auth),

  resetPassword: (email: string) => sendPasswordResetEmail(auth, email),

  updateProfile: (data: { displayName?: string; photoURL?: string }) =>
    updateProfile(auth.currentUser!, data),

  onAuthStateChanged: (callback: (user: User | null) => void) =>
    onAuthStateChanged(auth, callback),

  getCurrentUser: () => auth.currentUser,
};

// Database helpers
export const dbMethods = {
  subscribe: <T>(
    path: string,
    callback: (data: T | null) => void,
    options?: { queryConstraints?: ReturnType<typeof query> }
  ) => {
    const dbRef = options?.queryConstraints || ref(database, path);
    const unsubscribe = onValue(dbRef, (snapshot) => {
      callback(snapshot.val() as T | null);
    });
    return () => off(dbRef, "value", unsubscribe);
  },

  set: <T>(path: string, data: T) => set(ref(database, path), data),

  update: <T>(path: string, data: Partial<T>) => update(ref(database, path), data),

  remove: (path: string) => remove(ref(database, path)),

  push: <T>(path: string, data: T) => push(ref(database, path), data),

  query: {
    byChild: (path: string, child: string) => query(ref(database, path), orderByChild(child)),
    limitToLast: (path: string, limit: number) => query(ref(database, path), limitToLast(limit)),
    equalTo: (path: string, child: string, value: unknown) =>
      query(ref(database, path), orderByChild(child), equalTo(value)),
  },
};

// Database paths
export const DB_PATHS = {
  users: (uid: string) => `users/${uid}`,
  tradingAccounts: (uid: string) => `users/${uid}/trading_accounts`,
  userBots: (uid: string) => `users/${uid}/user_bots`,
  userBotsIndex: () => `user_bots_index`,
  aiSignals: () => `aiSignals`,
  alerts: (uid: string) => `users/${uid}/alerts`,
  licenses: (uid: string) => `users/${uid}/licenses`,
  subscriptions: (uid: string) => `users/${uid}/subscriptions`,
  notifications: (uid: string) => `users/${uid}/notifications`,
  riskMetrics: (accountId: string) => `risk_metrics/${accountId}`,
};

export { app, auth, database };
export type { FirebaseApp, Auth, Database, User };