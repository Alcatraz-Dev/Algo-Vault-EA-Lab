import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrProductOwner, errMessage } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";
import fs from "fs/promises";
import path from "path";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

function safeFileName(fileName: string) {
    const base = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!/\.set$/i.test(base)) return null;
    return base;
}

function setFileDir(productId: string) {
    return path.join(process.cwd(), "private-files", "products", productId, "setfiles");
}

export async function GET() {
    try {
        const snapshot = await adminDatabase.ref("set_files").get();
        if (!snapshot.exists()) {
            return NextResponse.json({ success: true, setFiles: [] });
        }

        const data = snapshot.val() as Record<string, Record<string, unknown>>;
        const list: Array<{ id: string } & Record<string, unknown>> = Object.entries(data).map(([id, val]) => ({ id, ...val }));
        list.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));

        return NextResponse.json({ success: true, setFiles: list });
    } catch (error) {
        console.error("[admin/setfiles GET]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to load set files.") },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    let formData: FormData;
    try {
        formData = await request.formData();
    } catch {
        return NextResponse.json({ success: false, error: "Invalid form data." }, { status: 400 });
    }

    const productId = String(formData.get("productId") || "").trim();

    const token = await requireAdminOrProductOwner(request, productId);
    if (!token) {
        return NextResponse.json(
            { success: false, error: productId ? "You are not the owner of this product." : "Unauthorized" },
            { status: productId ? 403 : 401 }
        );
    }

    try {
        const name = String(formData.get("name") || "").trim();
        const productSlug = String(formData.get("productSlug") || "").trim();
        const pair = String(formData.get("pair") || "").trim();
        const timeframe = String(formData.get("timeframe") || "").trim();
        const riskLevel = String(formData.get("riskLevel") || "Medium").trim();
        const description = String(formData.get("description") || "").trim();
        const fileValue = formData.get("file");

        if (!name) {
            return NextResponse.json({ success: false, error: "Preset name is required." }, { status: 400 });
        }
        if (!productId) {
            return NextResponse.json({ success: false, error: "A product must be selected." }, { status: 400 });
        }
        if (!(fileValue instanceof File)) {
            return NextResponse.json({ success: false, error: ".set file is required." }, { status: 400 });
        }
        if (fileValue.size <= 0) {
            return NextResponse.json({ success: false, error: "The uploaded file is empty." }, { status: 400 });
        }
        if (fileValue.size > MAX_FILE_SIZE) {
            return NextResponse.json({ success: false, error: "File is too large. Maximum size is 5 MB." }, { status: 413 });
        }

        const fileName = safeFileName(fileValue.name);
        if (!fileName) {
            return NextResponse.json(
                { success: false, error: "Only .set files with safe filenames are allowed." },
                { status: 400 }
            );
        }

        const dir = setFileDir(productId);
        await fs.mkdir(dir, { recursive: true });

        const filePath = path.join(dir, fileName);
        const normalizedRoot = path.resolve(dir);
        const normalizedFile = path.resolve(filePath);
        if (!normalizedFile.startsWith(normalizedRoot + path.sep)) {
            return NextResponse.json({ success: false, error: "Invalid file path." }, { status: 400 });
        }

        const buffer = Buffer.from(await fileValue.arrayBuffer());
        await fs.writeFile(normalizedFile, buffer);

        const id = `set_${Date.now()}`;
        const now = Date.now();
        const record = {
            id,
            name,
            productId,
            productSlug: productSlug || productId,
            pair: pair.toUpperCase() || "EURUSD",
            timeframe: timeframe.toUpperCase() || "M15",
            riskLevel: ["Low", "Medium", "High", "Aggressive"].includes(riskLevel) ? riskLevel : "Medium",
            description,
            fileName,
            size: buffer.length,
            downloadUrl: `/api/download/setfile?productId=${encodeURIComponent(productId)}&file=${encodeURIComponent(fileName)}`,
            createdAt: now,
            updatedAt: now,
            uploadedBy: token.uid,
        };

        await adminDatabase.ref(`set_files/${id}`).set(record);

        return NextResponse.json({ success: true, setFile: record });
    } catch (error) {
        console.error("[admin/setfiles POST]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to upload .set file.") },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const { id, productId, fileName } = body as {
        id?: string;
        productId?: string;
        fileName?: string;
    };

    const token = await requireAdminOrProductOwner(request, productId);
    if (!token) {
        return NextResponse.json(
            { success: false, error: productId ? "You are not the owner of this product." : "Unauthorized" },
            { status: productId ? 403 : 401 }
        );
    }

    try {
        if (!id) {
            return NextResponse.json({ success: false, error: "id is required." }, { status: 400 });
        }

        await adminDatabase.ref(`set_files/${id}`).remove();

        if (productId && fileName) {
            const safeName = path.basename(String(fileName)).replace(/[^a-zA-Z0-9._-]/g, "_");
            const dir = setFileDir(String(productId));
            const filePath = path.resolve(path.join(dir, safeName));
            const normalizedRoot = path.resolve(dir);
            if (filePath.startsWith(normalizedRoot + path.sep)) {
                await fs.unlink(filePath).catch(() => {});
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[admin/setfiles DELETE]", error);
        return NextResponse.json(
            { success: false, error: errMessage(error, "Failed to delete .set file.") },
            { status: 500 }
        );
    }
}