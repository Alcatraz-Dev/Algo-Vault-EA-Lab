/**
 * Marketing Agent — creative recipes (§71).
 *
 * Every completed creative yields a recipe: the recipe is what "Run this again
 * with the new feature" consumes. It references artifacts by id — expensive
 * captures and compositions are reused, never regenerated (§67).
 *
 * Pure module: no I/O.
 */

import type { MarketingLanguage, MarketingPlatform } from "../collections";
import type { CreativeRecipe } from "../types";
import type { Script } from "@/lib/marketing-media/types";

export type RecipeSource = {
  creativeId: string;
  name: string;
  objective: string;
  audience: string;
  products: string[];
  prompt: string;
  script: Script;
  shotList: string[];
  browserCapturePlanId?: string;
  assetKeys: string[];
  compositionTemplateId?: string;
  style: string;
  durationSec: number;
  platforms: MarketingPlatform[];
  languages: MarketingLanguage[];
  cta: string;
  disclaimer: string;
  variantKinds: string[];
  createdBy: string;
  now?: number;
};

export function extractRecipe(source: RecipeSource): CreativeRecipe {
  const now = source.now ?? Date.now();
  return {
    creativeId: source.creativeId,
    name: source.name,
    objective: source.objective,
    audience: source.audience,
    products: source.products,
    prompt: source.prompt,
    // The script template keeps placeholders so a re-run can swap the feature.
    scriptTemplate: source.script.scenes.map((s) => `${s.visualType}:${s.durationSec}s::${s.onScreenText}`).join("\n"),
    shotListTemplate: source.shotList.join("\n"),
    browserCapturePlanId: source.browserCapturePlanId,
    assetKeys: source.assetKeys,
    compositionTemplateId: source.compositionTemplateId,
    style: source.style,
    durationSec: source.durationSec,
    platforms: source.platforms,
    languages: source.languages,
    cta: source.cta,
    disclaimer: source.disclaimer,
    variantKinds: source.variantKinds,
    useCount: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: source.createdBy,
  };
}

/**
 * Rebind a recipe to a new product/prompt (§71 "Run this recipe again with
 * the new feature"). Everything not explicitly changed is preserved.
 */
export function rebindRecipe(
  recipe: CreativeRecipe,
  input: { productKeys?: string[]; prompt?: string; platforms?: MarketingPlatform[]; languages?: MarketingLanguage[]; durationSec?: number },
  now = Date.now()
): CreativeRecipe {
  return {
    ...recipe,
    products: input.productKeys?.length ? input.productKeys : recipe.products,
    prompt: input.prompt ?? recipe.prompt,
    platforms: input.platforms?.length ? input.platforms : recipe.platforms,
    languages: input.languages?.length ? input.languages : recipe.languages,
    durationSec: input.durationSec ?? recipe.durationSec,
    useCount: recipe.useCount + 1,
    updatedAt: now,
  };
}
