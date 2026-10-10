import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import {
  ensureDefaultCandelTemplates,
  getAllCandelTemplates,
  getCandelInstancesByUser,
} from "@/lib/candel/workspace/database";
import { createCandelForUser } from "@/lib/candel/workspace/create";

/**
 * GET /api/candel/candel/builder
 *
 * Everything the builder screen needs in one round trip: the template catalog
 * (seeded on first use) and the caller's own Candels.
 */
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    await ensureDefaultCandelTemplates();
    const [templates, personalCandels] = await Promise.all([
      getAllCandelTemplates(),
      getCandelInstancesByUser(token.uid),
    ]);

    return NextResponse.json({ success: true, templates, personalCandels });
  } catch (error) {
    console.error("[candel/builder GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load builder data" }, { status: 500 });
  }
}

/**
 * POST /api/candel/candel/builder
 *
 * Create a Candel from a template. This intentionally delegates to the same
 * helper as `POST /api/candel/candel` so there is exactly one creation path:
 * the template is validated, customization is narrowed against the template
 * ceiling, and execution access is never granted here.
 */
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const created = await createCandelForUser(token.uid, await request.json());
    if (!created.ok) {
      return NextResponse.json({ success: false, error: created.error }, { status: created.status });
    }

    return NextResponse.json({ success: true, instance: created.instance }, { status: 201 });
  } catch (error) {
    console.error("[candel/builder POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create Candel" }, { status: 500 });
  }
}
