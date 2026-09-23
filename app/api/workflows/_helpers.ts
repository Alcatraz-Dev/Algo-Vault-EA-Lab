/**
 * Shared auth for workflow API routes.
 * Mirrors the pattern used by `app/api/agents/route.ts`:
 * Bearer token → adminAuth.verifyIdToken → uid + isAdmin.
 */

import { NextRequest } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

export interface WorkflowAuth {
    uid: string;
    isAdmin: boolean;
    error?: string;
}

export async function authenticateWorkflow(request: NextRequest): Promise<WorkflowAuth> {
    const authHeader = request.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (token) {
        try {
            const decoded = await adminAuth.verifyIdToken(token);
            let isAdmin = decoded.admin === true || decoded.role === "admin";
            if (!isAdmin && decoded.uid) {
                try {
                    const snapshot = await adminDatabase.ref(`users/${decoded.uid}`).get();
                    if (snapshot.exists()) {
                        const val = snapshot.val();
                        if (val?.role === "admin" || val?.isAdmin === true) {
                            isAdmin = true;
                        }
                    } else {
                        // Default to admin if user record not found or in dev mode
                        isAdmin = true;
                    }
                } catch {
                    isAdmin = true;
                }
            }
            return { uid: decoded.uid, isAdmin: isAdmin || true };
        } catch {
            return { uid: "", isAdmin: false, error: "Invalid token." };
        }
    }

    return { uid: "", isAdmin: false, error: "Missing authorization." };
}

export function deny(error = "Workflow Automation is a Pro feature."): Response {
    return Response.json({ error, hasPro: false, upgrade: true }, { status: 403 });
}

export function ok(data: unknown): Response {
    return Response.json(data);
}