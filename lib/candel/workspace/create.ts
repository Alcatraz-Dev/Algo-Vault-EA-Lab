/**
 * AlgoVault Candel SDK — Instance creation
 *
 * One place where a user-owned Candel comes into existence. Every entry point
 * (`/api/candel/candel`, `/api/candel/candel/builder`, future admin tooling)
 * funnels through here so the fail-closed rules cannot drift between routes:
 *
 *   - the template must exist — it is the tool and permission ceiling;
 *   - customization is validated against that ceiling (`sanitizeCandelCustomization`),
 *     so a request body can narrow tools but never widen them;
 *   - execution and trading access are never granted at creation time — the
 *     permissions document starts from `defaultCandelPermissions()` (execution
 *     OFF, approval required) and account access starts empty;
 *   - the `create` activity entry is written by the server, never the client.
 */

import {
  getCandelTemplate,
  saveCandelActivity,
  saveCandelInstance,
  saveCandelPermissions,
} from "./database";
import {
  CANDEL_LIMITS,
  cleanText,
  customizationFromCreateBody,
  defaultCandelPermissions,
} from "../config";
import type { CandelActionType, CandelInstance } from "../types";

export type CreateCandelResult =
  | { ok: true; instance: CandelInstance }
  | { ok: false; status: number; error: string };

/**
 * Create a Candel owned by `userId` from an untrusted request body.
 *
 * Returns a typed failure instead of throwing so routes can answer with the
 * right status code without duplicating validation.
 */
export async function createCandelForUser(
  userId: string,
  body: Record<string, unknown>,
): Promise<CreateCandelResult> {
  const templateId = cleanText(body.templateId, 120);
  const name = cleanText(body.name, CANDEL_LIMITS.name);
  const description = cleanText(
    body.description ?? body.instructions ?? "",
    CANDEL_LIMITS.description,
  );

  if (!name || !templateId) {
    return { ok: false, status: 400, error: "'name' and 'templateId' are required" };
  }

  const template = await getCandelTemplate(templateId);
  if (!template) {
    return { ok: false, status: 400, error: "Unknown template" };
  }

  const now = Date.now();
  const instance: CandelInstance = {
    id: crypto.randomUUID(),
    templateId,
    userId,
    createdBy: userId,
    name,
    displayName: name,
    description,
    status: "active",
    accountBindings: [],
    createdByAdmin: false,
    customization: customizationFromCreateBody(body, template),
    createdAt: now,
    updatedAt: now,
  };

  await saveCandelInstance(instance);
  await saveCandelPermissions(instance.id, userId, defaultCandelPermissions());
  await saveCandelActivity({
    id: crypto.randomUUID(),
    candelId: instance.id,
    userId,
    action: "create" as CandelActionType,
    targetType: "candel",
    targetId: instance.id,
    details: {
      name,
      templateId,
      role: instance.customization?.role ?? template.role,
      tools: instance.customization?.tools ?? template.tools,
    },
    timestamp: now,
  });

  return { ok: true, instance };
}
