/**
 * Shared auth for workflow API routes.
 * Mirrors the pattern used by `app/api/agents/route.ts`:
 * Bearer token → adminAuth.verifyIdToken → uid + isAdmin.
 */

import { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";

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
            const isAdmin = decoded.admin === true || decoded.role === "admin";
            return { uid: decoded.uid, isAdmin };
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