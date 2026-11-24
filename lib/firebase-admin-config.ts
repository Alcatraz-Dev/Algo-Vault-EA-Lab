export interface FirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  rawPrivateKey: string;
  databaseURL: string;
}

import 'server-only';

function resolveFirebaseAdminConfig(source: NodeJS.ProcessEnv) {
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

  return { projectId, clientEmail, rawPrivateKey, databaseURL, missing };
}

/**
 * True when the server has everything needed to initialise the Admin SDK.
 * Callers that have a supported offline path (for example the homepage and
 * the packaged desktop app, which never receives Admin credentials) can use
 * this to skip the fetch instead of treating a missing config as a failure.
 */
export function isFirebaseAdminConfigured(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return resolveFirebaseAdminConfig(source).missing.length === 0;
}

/** Validate server-side Firebase Admin settings without logging their values. */
export function getFirebaseAdminConfig(
  source: NodeJS.ProcessEnv = process.env,
): FirebaseAdminConfig {
  const { projectId, clientEmail, rawPrivateKey, databaseURL, missing } =
    resolveFirebaseAdminConfig(source);

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
