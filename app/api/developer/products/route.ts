import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

async function verifyDeveloper(request: NextRequest) {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = await adminAuth.verifyIdToken(authorization.replace("Bearer ", ""));
    const userSnap = await adminDatabase.ref(`users/${token.uid}`).get();
    const userData = userSnap.val();
    if (!userData || !["developer", "admin"].includes(userData.role)) return null;

    const isApproved = userData.role === "admin" || userData.developerApproved === true || userData.developerStatus === "approved";
    const devSubSnap = await adminDatabase.ref(`users/${token.uid}/developerSubscription`).get();
    const devSub = devSubSnap.val();
    const hasActiveSub = userData.role === "admin" || (devSub?.status === "active" && Boolean(devSub?.plan));

    return {
        uid: token.uid,
        user: userData,
        isApproved,
        hasActiveSub,
        canManageProducts: isApproved && hasActiveSub,
    };
}

function slugify(text: string) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(request: NextRequest) {
    try {
        const dev = await verifyDeveloper(request);
        if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const productsRef = adminDatabase.ref("products");
        const snapshot = await productsRef.get();

        if (!snapshot.exists()) return NextResponse.json({ success: true, products: [], devStatus: { isApproved: dev.isApproved, hasActiveSub: dev.hasActiveSub } });

        const products: { id: string; [key: string]: unknown }[] = [];
        snapshot.forEach((child) => {
            const val = child.val();
            if (val.developerUid === dev.uid) {
                products.push({ id: child.key!, ...val });
            }
        });

        return NextResponse.json({
            success: true,
            products,
            devStatus: {
                isApproved: dev.isApproved,
                hasActiveSub: dev.hasActiveSub,
                canManageProducts: dev.canManageProducts,
            },
        });
    } catch (err) {
        console.error("Developer products GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const dev = await verifyDeveloper(request);
        if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (!dev.canManageProducts) {
            return NextResponse.json({
                error: !dev.isApproved
                    ? "Your developer account requires Admin Verification before uploading products."
                    : "An active Developer Subscription is required to upload or sell products.",
            }, { status: 403 });
        }

        const body = await request.json();
        const { name, description, productType, platform, symbol, timeframe, price, currency, imageUrl, images, videoUrl } = body;

        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

        const slug = slugify(name) + "-" + Date.now().toString(36);

        const productRef = adminDatabase.ref("products").push();
        const product = {
            name,
            slug,
            description: description || "",
            productType: productType || "ea",
            platform: platform || "mt5",
            symbol: symbol || "EURUSD",
            timeframe: timeframe || "H1",
            developer: dev.user.displayName || dev.user.email || "Developer",
            developerUid: dev.uid,
            sellerType: dev.user.role === "admin" ? "admin" : "developer",
            imageUrl: imageUrl || "",
            images: Array.isArray(images) ? images : imageUrl ? [imageUrl] : [],
            videoUrl: videoUrl || "",
            version: "1.0.0",
            pricing: {
                type: price > 0 ? "paid" : "free",
                price: Number(price) || 0,
                currency: currency || "usd",
            },
            performance: {},
            risk: { level: "Medium" },
            rating: { average: 0, count: 0 },
            downloads: 0,
            status: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await productRef.set(product);

        return NextResponse.json({ success: true, id: productRef.key, slug });
    } catch (err) {
        console.error("Developer products POST error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const dev = await verifyDeveloper(request);
        if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (!dev.canManageProducts) {
            return NextResponse.json({
                error: !dev.isApproved
                    ? "Your developer account requires Admin Verification before editing products."
                    : "An active Developer Subscription is required to edit products.",
            }, { status: 403 });
        }

        const body = await request.json();
        const { productId, imageUrl, images, videoUrl, ...updates } = body;

        if (!productId) return NextResponse.json({ error: "Product ID required" }, { status: 400 });

        const productSnap = await adminDatabase.ref(`products/${productId}`).get();
        if (!productSnap.exists() || productSnap.val().developerUid !== dev.uid) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        updates.updatedAt = Date.now();
        if (imageUrl !== undefined) updates.imageUrl = imageUrl;
        if (images !== undefined) updates.images = Array.isArray(images) ? images : [images];
        if (videoUrl !== undefined) updates.videoUrl = videoUrl;

        if (updates.price !== undefined) {
            updates.pricing = {
                ...productSnap.val().pricing,
                type: Number(updates.price) > 0 ? "paid" : "free",
                price: Number(updates.price),
            };
            delete updates.price;
        }

        await adminDatabase.ref(`products/${productId}`).update(updates);
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Developer products PUT error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const dev = await verifyDeveloper(request);
        if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (!dev.canManageProducts) {
            return NextResponse.json({
                error: !dev.isApproved
                    ? "Your developer account requires Admin Verification before deleting products."
                    : "An active Developer Subscription is required to delete products.",
            }, { status: 403 });
        }

        const body = await request.json();
        const { productId } = body;

        if (!productId) return NextResponse.json({ error: "Product ID required" }, { status: 400 });

        const productSnap = await adminDatabase.ref(`products/${productId}`).get();
        if (!productSnap.exists() || productSnap.val().developerUid !== dev.uid) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        await adminDatabase.ref(`products/${productId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Developer products DELETE error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
