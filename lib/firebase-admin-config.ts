export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  rawPrivateKey: string;
  databaseURL: string;
}

import 'server-only';

/** Validate server-side Firebase Admin settings without logging their values. */
export function getFirebaseAdminConfig(
  source: NodeJS.ProcessEnv = process.env,
): FirebaseAdminConfig {
  const projectId = source.FIREBASE_PROJECT_ID || source.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = source.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = source.FIREBASE_PRIVATE_KEY;
  const databaseURL =
    source.FIREBASE_DATABASE_URL ||
    source.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined);

  const missing: string[] = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!rawPrivateKey) missing.push('FIREBASE_PRIVATE_KEY');
  if (!databaseURL) missing.push('NEXT_PUBLIC_FIREBASE_DATABASE_URL');

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase Admin environment variables: ${missing.join(', ')}. Please configure them in your server environment.`,
    );
  }

  return {
    projectId: projectId!,
    clientEmail: clientEmail!,
    rawPrivateKey: rawPrivateKey!,
    databaseURL: databaseURL!,
  };
}
