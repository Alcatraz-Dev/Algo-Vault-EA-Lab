import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import fs from "fs/promises";
import path from "path";

export async function GET(request: NextRequest) {
    const token = await requireAdmin(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const productId = searchParams.get("productId");
        const file = searchParams.get("file");

        if (!productId || !file) {
            return NextResponse.json({ success: false, error: "productId and file are required." }, { status: 400 });
        }

        const dir = path.join(process.cwd(), "private-files", "products", productId, "setfiles");
        const safeName = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "_");
        const filePath = path.resolve(path.join(dir, safeName));
        const normalizedRoot = path.resolve(dir);

        if (!filePath.startsWith(normalizedRoot + path.sep)) {
            return NextResponse.json({ success: false, error: "Invalid file path." }, { status: 400 });
        }

        const buffer = await fs.readFile(filePath).catch(() => null);
        if (!buffer) {
            return NextResponse.json({ success: false, error: "Set file not found." }, { status: 404 });
        }

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename="${safeName}"`,
                "Content-Length": String(buffer.length),
                "Cache-Control": "private, no-store, max-age=0",
            },
        });
    } catch (error) {
        console.error("[admin/setfiles/download]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Download failed.") },
            { status: 500 }
        );
    }
}