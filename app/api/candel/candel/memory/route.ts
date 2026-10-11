import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import {
  getCandelMemory,
  saveCandelMemoryEntry,
  deleteCandelMemoryEntry,
} from "@/lib/candel/workspace/database";
import { requireCandelOwner, requireCandelReadable } from "@/lib/candel/authorization";
import type { CandelMemoryEntry } from "@/lib/candel/types";

// GET /api/candel/candel/memory/[candelId] — list memory entries
export async function GET(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });
    await requireCandelReadable(candelId, token.uid);

    const memory = await getCandelMemory(candelId, token.uid);
    return NextResponse.json({ success: true, memory });
  } catch (error) {
    console.error("[candel/memory GET]", error);
    return NextResponse.json({ success: false, error: "Failed to load memory" }, { status: 500 });
  }
}

// POST /api/candel/candel/memory/[candelId] — create a memory entry
export async function POST(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    if (!candelId) return NextResponse.json({ success: false, error: "candelId required" }, { status: 400 });

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { key, value, scope } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ success: false, error: "key and value required" }, { status: 400 });
    }

    const entry: CandelMemoryEntry = {
      id: crypto.randomUUID(),
      candelId,
      userId: token.uid,
      kind: (scope as CandelMemoryEntry["kind"]) || "preference",
      text: key ? `${key}: ${value ?? ""}` : typeof value === "string" ? value : JSON.stringify(value),
      source: "user",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveCandelMemoryEntry(entry);
    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch (error) {
    console.error("[candel/memory POST]", error);
    return NextResponse.json({ success: false, error: "Failed to save memory" }, { status: 500 });
  }
}

// PATCH /api/candel/candel/memory/[candelId] — correct a remembered entry
//
// Memory is injected into every system prompt, so a wrong preference silently
// skews every reply. The user owns the store and must be able to fix an entry
// in place rather than deleting it and hoping to retype it identically.
export async function PATCH(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const entryId = searchParams.get("entryId");
    if (!candelId || !entryId) {
      return NextResponse.json({ success: false, error: "candelId and entryId required" }, { status: 400 });
    }

    await requireCandelOwner(candelId, token.uid);

    const body = await request.json();
    const { text, kind } = body as { text?: string; kind?: CandelMemoryEntry["kind"] };
    const nextText = typeof text === "string" ? text.trim() : undefined;
    if (nextText === undefined && kind === undefined) {
      return NextResponse.json({ success: false, error: "Nothing to update" }, { status: 400 });
    }
    if (nextText !== undefined && !nextText) {
      return NextResponse.json(
        { success: false, error: "A memory entry cannot be empty." },
        { status: 400 },
      );
    }

    const entries = await getCandelMemory(candelId, token.uid);
    const existing = entries.find((entry) => entry.id === entryId);
    if (!existing) {
      return NextResponse.json({ success: false, error: "Memory entry not found" }, { status: 404 });
    }

    const entry: CandelMemoryEntry = {
      ...existing,
      text: nextText ?? existing.text,
      kind: kind ?? existing.kind,
      source: "user",
      updatedAt: Date.now(),
    };

    await saveCandelMemoryEntry(entry);
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error("[candel/memory PATCH]", error);
    return NextResponse.json({ success: false, error: "Failed to update memory" }, { status: 500 });
  }
}

// DELETE /api/candel/candel/memory/[candelId] — delete a memory entry
export async function DELETE(request: NextRequest) {
  try {
    const token = await authenticate(request);
    if (!token) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(request.url);
    const candelId = searchParams.get("candelId");
    const entryId = searchParams.get("entryId");
    if (!candelId || !entryId) {
      return NextResponse.json({ success: false, error: "candelId and entryId required" }, { status: 400 });
    }

    await requireCandelOwner(candelId, token.uid);

    await deleteCandelMemoryEntry(entryId, candelId, token.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[candel/memory DELETE]", error);
    return NextResponse.json({ success: false, error: "Failed to delete memory" }, { status: 500 });
  }
}
