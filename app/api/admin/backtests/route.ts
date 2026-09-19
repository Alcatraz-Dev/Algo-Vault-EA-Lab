import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, errMessage } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function reportDir() {
    return path.join(process.cwd(), "private-files", "backtests");
}

function safeReportName(fileName: string) {
    const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!/\.html?$/i.test(base)) return null;
    return base;
}

export async function GET() {
    try {
        const snapshot = await adminDatabase.ref("backtests").get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, backtests: [] });
        }

        const data = snapshot.val() as Record<string, Record<string, unknown>>;
        const list: Array<{ id: string } & Record<string, unknown>> = Object.entries(data).map(([id, val]) => ({ id, ...val }));
        list.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

        return NextResponse.json({ success: true, backtests: list });
    } catch (error) {
        console.error("[admin/backtests GET]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to load backtests.") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const token = await requireAdmin(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const formData = await request.formData();

        const title = String(formData.get("title") || "").trim();
        const productSlug = String(formData.get("productSlug") || "").trim();
        const pair = String(formData.get("pair") || "").trim();
        const timeframe = String(formData.get("timeframe") || "").trim();
        const period = String(formData.get("period") || "").trim();
        const initialBalance = Number(formData.get("initialBalance") || 0);
        const netProfit = Number(formData.get("netProfit") || 0);
        const winRate = Number(formData.get("winRate") || 0);
        const maxDrawdown = Number(formData.get("maxDrawdown") || 0);
        const fileValue = formData.get("file");

        if (!title) {
            return NextResponse.json({ success: false, error: "Report title is required." }, { status: 400 });
        }
        if (!(fileValue instanceof File)) {
            return NextResponse.json({ success: false, error: "HTML report file is required." }, { status: 400 });
        }
        if (fileValue.size <= 0) {
            return NextResponse.json({ success: false, error: "The uploaded file is empty." }, { status: 400 });
        }
        if (fileValue.size > MAX_FILE_SIZE) {
            return NextResponse.json({ success: false, error: "File is too large. Maximum size is 20 MB." }, { status: 413 });
        }

        const fileName = safeReportName(fileValue.name);
        if (!fileName) {
            return NextResponse.json(
                { success: false, error: "Only .html or .htm report files with safe filenames are allowed." },
                { status: 400 }
            );
        }

        const dir = reportDir();
        await fs.mkdir(dir, { recursive: true });

        const filePath = path.join(dir, fileName);
        const normalizedRoot = path.resolve(dir);
        const normalizedFile = path.resolve(filePath);
        if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
            return NextResponse.json({ success: false, error: "Invalid file path." }, { status: 400 });
        }

        const buffer = Buffer.from(await fileValue.arrayBuffer());
        await fs.writeFile(normalizedFile, buffer);

        const id = `bt_${Date.now()}`;
        const now = Date.now();
        const record = {
            id,
            title,
            productSlug: productSlug || "general",
            pair: pair.toUpperCase() || "XAUUSD",
            timeframe: timeframe.toUpperCase() || "M15",
            period: period || `${new Date(now - 5 * 365 * 86400 * 1000).getFullYear()} - ${new Date(now).getFullYear()}`,
            initialBalance,
            netProfit,
            winRate,
            maxDrawdown,
            reportFile: fileName,
            reportUrl: `/api/backtests/report?file=${encodeURIComponent(fileName)}`,
            createdAt: now,
            updatedAt: now,
            uploadedBy: token.uid,
        };

        await adminDatabase.ref(`backtests/${id}`).set(record);

        return NextResponse.json({ success: true, backtest: record });
    } catch (error) {
        console.error("[admin/backtests POST]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to publish backtest.") },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    const token = await requireAdmin(request);
    if (!token) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json().catch(() => ({}));
        const { id, reportFile } = body as { id?: string; reportFile?: string };

        if (!id) {
            return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });
        }

        await adminDatabase.ref(`backtests/${id}`).remove();

        if (reportFile) {
            const safeName = path.basename(String(reportFile)).replace(/[^a-zA-Z0-9._-]/g, "_");
            const dir = reportDir();
            const filePath = path.resolve(path.join(dir, safeName));
            const normalizedRoot = path.resolve(dir);
            if (filePath.startsWith(normalizedRoot + path.sep)) {
                await fs.unlink(filePath).catch(() => {});
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[admin/backtests DELETE]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to delete backtest.") },
            { status: 500 }
        );
    }
}