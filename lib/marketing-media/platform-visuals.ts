/** Platform visuals — scene↔curated asset mapping for the AlgoVault
 *  marketing library. Maps each script scene to a deterministic curated
 *  asset (screenshot/chart/logo). Pure module: uses the existing
 *  `assets.ts` library; never invents new files.
 */

import { lookupAsset, MARKETING_ASSETS } from "./assets";
import { ScriptScene } from "./types";

/** Category hints used to select an asset for a scene. */
const CATEGORY_ORDER: Array<"market" | "ai" | "platform" | "trading" | "brand"> = [
  "market", "ai", "platform", "trading", "brand",
];

/** Pick a deterministic asset for a scene based on its visualType hint. */
export function assetForScene(scene: ScriptScene): { url: string; id: string; label: string } | null {
  const ref = scene.visualRef;
  const found = lookupAsset(ref);
  if (found) return { url: found.url, id: found.id, label: found.label };

  // Fallback: use category hints to pick a real asset deterministically.
  const category = sceneVisualCategory(scene);
  const candidates = MARKETING_ASSETS.filter((a) => a.category === category);
  if (candidates.length === 0) return null;
  // Deterministic pick by scene id hash.
  let hash = 0;
  for (let i = 0; i < scene.id.length; i++) hash = (hash * 31 + scene.id.charCodeAt(i)) >>> 0;
  const pick = candidates[hash % candidates.length];
  return { url: pick.url, id: pick.id, label: pick.label };
}

function sceneVisualCategory(scene: ScriptScene): "market" | "ai" | "platform" | "trading" | "brand" {
  switch (scene.visualType) {
    case "chart": return "market";
    case "screenshot": return "platform";
    case "graphic": return "ai";
    case "logo": return "brand";
    default: return "platform";
  }
}

/** Build a deterministic asset list for an entire script. */
export function assetIdsForScript(script: { scenes: ScriptScene[] }): string[] {
  const ids: string[] = [];
  for (const scene of script.scenes) {
    const asset = assetForScene(scene);
    if (asset && !ids.includes(asset.id)) ids.push(asset.id);
  }
  return ids;
}