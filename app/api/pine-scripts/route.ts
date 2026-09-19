import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

export async function GET(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const uid = request.nextUrl.searchParams.get("uid") || user.uid;
    const snapshot = await adminDatabase.ref(`pineScripts/${uid}`).get();

    if (!snapshot.exists()) return NextResponse.json({ success: true, scripts: [] });

    const data = snapshot.val();
    const scripts = Object.entries(data).map(([id, val]) => ({ id, ...(val as Record<string, unknown>) }));

    return NextResponse.json({
      success: true,
      scripts: scripts.sort((a, b) => (b as { createdAt?: number }).createdAt ?? 0 - ((a as { createdAt?: number }).createdAt ?? 0)),
    });
  } catch (err) {
    console.error("Pine scripts GET error:", err);
    return NextResponse.json({ error: "Failed to fetch scripts" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { name, source, type, metadata } = body;

    if (!source) return NextResponse.json({ error: "source required" }, { status: 400 });

    const scriptRef = adminDatabase.ref(`pineScripts/${user.uid}`).push();
    const script = {
      name: name || "Untitled Script",
      source,
      type: type || "indicator",
      metadata: metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await scriptRef.set(script);

    return NextResponse.json({ success: true, script: { id: scriptRef.key, ...script } });
  } catch (err) {
    console.error("Pine script POST error:", err);
    return NextResponse.json({ error: "Failed to save script" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { scriptId } = await request.json();
    if (!scriptId) return NextResponse.json({ error: "scriptId required" }, { status: 400 });

    await adminDatabase.ref(`pineScripts/${user.uid}/${scriptId}`).remove();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Pine script DELETE error:", err);
    return NextResponse.json({ error: "Failed to delete script" }, { status: 500 });
  }
}
