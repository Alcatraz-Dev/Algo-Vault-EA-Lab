import type { InvestigationContext } from "./types";
import { encodeContext, decodeContext } from "../../../components/market-intelligence/workspace-context";
export { encodeContext, decodeContext };

export function buildInvestigationContext(
  rootType: string, rootId: string, workspace?: Partial<InvestigationContext["workspace"]>, mode: InvestigationContext["mode"] = "live"
): InvestigationContext {
  return { root: { type: rootType as any, id: rootId }, workspace, mode, replayTimestamp: mode === "replay" ? Date.now() : undefined };
}
