import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getAllCandelTemplates,
  saveCandelTemplate,
  getCandelTemplate,
  deleteCandelTemplate,
} from "@/lib/candel/workspace/database";
import { isAdmin } from "@/lib/candel/authorization";
import type { CandelTemplate } from "@/lib/candel/types";

// GET /api/candel/candel/template — list templates (admin + owner)
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const all = searchParams.get("all") === "true";

    let templates: CandelTemplate[];
    if (all) {
      templates = await getAllCandelTemplates();
    } else {
      templates = await getAllCandelTemplates();
      templates = templates.filter((t: CandelTemplate) =>
        t.status === "active" || t.status === "draft"
      );
    }

    return NextResponse.json({ success: true, templates });
  } catch (error) {
    console.error("[candel/template GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load templates" }, { status: 500 });
  }
}

// POST /api/candel/candel/template — create a new template (admin)
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const isAdminUser = await isAdmin(token.uid);
    if (!isAdminUser) {
      return NextResponse.json({ success: false, error: "Admin only" }, { status: 403 });
    }

    const body = await request.json();
    const { name, displayName, description, role, instructions, capabilities, tools, model, mcpConnections, memoryPolicy, workspaceAccess, tradingAccess, accountAccess, approvalRequirements, backgroundPermissions, proOnly, availability, status, version } = body;

    if (!name || !displayName || !role || !instructions) {
      return NextResponse.json({ success: false, error: "name, displayName, role, instructions required" }, { status: 400 });
    }

    const existing = await getCandelTemplate(name);
    if (existing) {
      return NextResponse.json({ success: false, error: `Template ${name} already exists` }, { status: 409 });
    }

    const template: CandelTemplate = {
      id: name,
      name,
      displayName,
      description: description || "",
      role: role || "general",
      instructions: instructions || "",
      capabilities: capabilities || [],
      tools: tools || [],
      model: model || "",
      mcpConnections: mcpConnections || [],
      memoryPolicy: memoryPolicy || "owner",
      workspaceAccess: workspaceAccess || "owner",
      tradingAccess: tradingAccess || "none",
      accountAccess: accountAccess || [],
      approvalRequirements: approvalRequirements || {
        createOrder: false,
        modifyOrder: false,
        closePosition: false,
        cancelOrder: false,
        tradeJournalWrite: false,
      },
      backgroundPermissions: backgroundPermissions || { run: false, monitor: false, notify: false },
      proOnly: Boolean(proOnly),
      availability: availability || "always",
      status: status || "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: token.uid,
      version: version || "1.0.0",
    };

    await saveCandelTemplate(template);
    return NextResponse.json({ success: true, template }, { status: 201 });
  } catch (error) {
    console.error("[candel/template POST]", error);
    return NextResponse.json({ success: false, error: "Failed to create template" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/template/[templateId] — delete a template (admin)
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const isAdminUser = await isAdmin(token.uid);
    if (!isAdminUser) {
      return NextResponse.json({ success: false, error: "Admin only" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get("templateId");
    if (!templateId) return NextResponse.json({ success: false, error: "templateId required" }, { status: 400 });

    await deleteCandelTemplate(templateId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/template DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete template" }, { status: 500 });
  }
}
