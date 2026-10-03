import { NextRequest } from "next/server";
import { authenticateTeams, badRequest, deny, flagDisabled, notFound, ok, readJson, unauthorized, serverError } from "../../_helpers";
import { isProUser } from "@/lib/ai-signals/access";
import { isAITeamsEnabled } from "@/lib/ai-trading-teams/flags";
import { clearMemory, emptyMemory, getMemory, getTeam, saveMemory } from "@/lib/ai-trading-teams/database";
import { sanitizeMemoryUpdates } from "@/lib/ai-trading-teams/memory";
import { isValidId } from "@/lib/ai-trading-teams/validation";

async function resolve(request: NextRequest) {
    const auth = await authenticateTeams(request);
    if (!auth.uid) return { response: unauthorized(auth.error) };
    const url = new URL(request.url);
    // /api/ai-trading-teams/{teamId}/memory
    const parts = url.pathname.split("/").filter(Boolean);
    const teamId = parts[parts.length - 2] ?? "";
    if (!isValidId(teamId)) return { response: badRequest("Invalid team id.") };
    const team = await getTeam(auth.uid, teamId);
    if (!team) return { response: notFound("Team not found.") };
    if (team.userId !== auth.uid && !auth.isAdmin) return { response: deny("You do not have access to this team.") };
    return { auth, teamId, uid: team.userId };
}

export async function GET(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const resolved = await resolve(request);
    if ("response" in resolved) return resolved.response;
    const { auth, teamId, uid } = resolved as { auth: { uid: string; isAdmin: boolean }; teamId: string; uid: string };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();
    try {
        const memory = (await getMemory(uid, teamId)) ?? emptyMemory(uid, teamId);
        return ok({ memory });
    } catch (err) {
        console.error("[ai-trading-teams] memory read failed:", err);
        return serverError("Failed to load memory.");
    }
}

export async function PUT(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const resolved = await resolve(request);
    if ("response" in resolved) return resolved.response;
    const { auth, teamId, uid } = resolved as { auth: { uid: string; isAdmin: boolean }; teamId: string; uid: string };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();

    const body = await readJson(request);
    const validation = sanitizeMemoryUpdates(body);
    if (!validation.valid) return badRequest("Invalid memory update.", validation.errors);

    try {
        const memory = (await getMemory(uid, teamId)) ?? emptyMemory(uid, teamId);
        const updated = { ...memory, ...validation.updates, teamId, userId: uid, updatedAt: Date.now() };
        await saveMemory(updated);
        return ok({ memory: updated });
    } catch (err) {
        console.error("[ai-trading-teams] memory write failed:", err);
        return serverError("Failed to save memory.");
    }
}

export async function DELETE(request: NextRequest) {
    if (!isAITeamsEnabled()) return flagDisabled();
    const resolved = await resolve(request);
    if ("response" in resolved) return resolved.response;
    const { auth, teamId, uid } = resolved as { auth: { uid: string; isAdmin: boolean }; teamId: string; uid: string };
    const isPro = auth.isAdmin ? true : await isProUser(auth.uid);
    if (!isPro) return deny();
    try {
        await clearMemory(uid, teamId);
        return ok({ cleared: true });
    } catch (err) {
        console.error("[ai-trading-teams] memory clear failed:", err);
        return serverError("Failed to clear memory.");
    }
}
