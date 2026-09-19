import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/admin-auth";
import fs from "fs/promises";
import path from "path";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const file = searchParams.get("file");

        if (!file) {
            return NextResponse.json({ success: false, error: "file is required." }, { status: 400 });
        }

        const dir = path.join(process.cwd(), "private-files", "backtests");
        const safeName = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, "_");

        if (!/\.html?$/i.test(safeName)) {
            return NextResponse.json({ success: false, error: "Invalid report file." }, { status: 400 });
        }

        const filePath = path.resolve(path.join(dir, safeName));
        const normalizedRoot = path.resolve(dir);

        if (!filePath.startsWith(normalizedRoot + path.sep)) {
            return NextResponse.json({ success: false, error: "Invalid file path." }, { status: 400 });
        }

        const buffer = await fs.readFile(filePath).catch(() => null);
        if (!buffer) {
            return NextResponse.json({ success: false, error: "Report not found." }, { status: 404 });
        }

        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": String(buffer.length),
                "Cache-Control": "public, max-age=300",
            },
        });
    } catch (error) {
        console.error("[backtests/report]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to load report.") },
            { status: 500 }
        );
    }
}