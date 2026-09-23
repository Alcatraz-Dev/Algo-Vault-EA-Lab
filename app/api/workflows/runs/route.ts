import { NextRequest } from "next/server";
import { authenticateWorkflow, deny, ok } from "../_helpers";
import {
    listRuns,
    getRun,
    getRunNodeTraces,
    updateRun,
} from "@/lib/workflows/database";
import { isProUser } from "@/lib/ai-signals/access";

export async function GET(request: NextRequest) {
    const auth = await authenticateWorkflow(request);
    if (!auth.uid) return deny("Authentication required.");
    const isPro = await isProUser(auth.uid);
    if (!isPro && !auth.isAdmin) return deny();
    const runs = await listRuns(auth.uid);
    return ok(runs);
}