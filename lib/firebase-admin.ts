import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey =
    process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

const databaseURL =
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;

if (
    !projectId ||
    !clientEmail ||
    !privateKey ||
    !databaseURL
) {
    throw new Error(
        "Missing Firebase Admin environment variables."
    );
}

const adminApp =
    getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey,
            }),
            databaseURL,
        });

export const adminAuth = getAuth(adminApp);

export const adminDatabase =
    getDatabase(adminApp);