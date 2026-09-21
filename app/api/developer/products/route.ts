import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";
import { stripeClient, formatStripeError } from "@/lib/stripe";

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

/**
 * Returns the developer's connected Stripe account ID when their merchant
 * `card_payments` capability is active (i.e. they can accept payments), or
 * null otherwise.
 */
async function getPaymentsReadyAccountId(uid: string) {
    const userSnap = await adminDatabase.ref(`users/${uid}`).get();
    const user = userSnap.val();
    const accountId = user?.stripeConnect?.accountId;

    if (!accountId) return null;

    try {
        const account =
            await stripeClient.v2.core.accounts.retrieve(accountId, {
                include: ["configuration.merchant"],
            });
        const cardPayments =
            account.configuration?.merchant?.capabilities?.card_payments;
        return cardPayments?.status === "active" ? accountId : null;
    } catch (error) {
        console.error("Stripe account readiness check failed:", error);
        return null;
    }
}

/**
 * Creates the Stripe Product + Price on the developer's connected account so
 * the product appears on their public storefront (`/store/[accountId]`).
 * Direct charges on the connected account carry an application fee set by the
 * platform (see /api/store/checkout).
 */
async function createStripeListing(uid: string, accountId: string, product: {
    id: string;
    slug: string;
    name: string;
    description: string;
    currency: string;
    unitAmount: number;
    subscriptionPeriod?: string;
}) {
    const stripeProduct = await stripeClient.products.create(
        {
            name: product.name,
            description: product.description || undefined,
            metadata: {
                firebaseProductId: product.id,
                firebaseSlug: product.slug,
                developerUid: uid,
            },
        },
        { stripeAccount: accountId }
    );

    const stripePrice = await stripeClient.prices.create(
        {
            product: stripeProduct.id,
            currency: product.currency,
            unit_amount: product.unitAmount,
            ...(product.subscriptionPeriod
                ? { recurring: { interval: "month" as const } }
                : {}),
            metadata: {
                firebaseProductId: product.id,
            },
        },
        { stripeAccount: accountId }
    );

    return {
        stripeProductId: stripeProduct.id,
        stripePriceId: stripePrice.id,
        stripeAccountId: accountId,
    };
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
        const { name, description, productType, platform, symbol, timeframe, price, currency, imageUrl, images, videoUrl, subscriptionPeriod } = body;

        if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

        const priceNum = Number(price) || 0;
        const currencyLower = String(currency || "usd").toLowerCase();
        const isSubscription = subscriptionPeriod === "month";
        const isPaid = priceNum > 0 || isSubscription;

        // Connected-account Stripe listing requires an active merchant
        // `card_payments` capability. Free products don't touch Stripe.
        const accountId = isPaid ? await getPaymentsReadyAccountId(dev.uid) : null;
        if (isPaid && !accountId) {
            return NextResponse.json({
                error: "Complete Stripe onboarding before accepting payments.",
            }, { status: 400 });
        }

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
                type: isSubscription ? "subscription" : priceNum > 0 ? "paid" : "free",
                price: priceNum,
                currency: currencyLower,
                ...(isSubscription ? { period: "month" } : {}),
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

        // Create the Stripe Product + Price on the connected account (only
        // for paid / subscription products).
        if (isPaid && accountId) {
            try {
                const listing = await createStripeListing(dev.uid, accountId, {
                    id: productRef.key!,
                    slug,
                    name,
                    description,
                    currency: currencyLower,
                    unitAmount: Math.round(priceNum * 100),
                    subscriptionPeriod: isSubscription ? "month" : undefined,
                });

                await productRef.update(listing);
            } catch (stripeError) {
                // The product page exists but the Stripe listing failed —
                // surface it so the developer can fix onboarding/retry.
                console.error("Stripe listing creation failed:", stripeError);
                await adminDatabase.ref(`products/${productRef.key}/stripeError`).set({
                    message: formatStripeError(stripeError),
                    at: Date.now(),
                });
            }
        }

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

        const existing = productSnap.val();

        updates.updatedAt = Date.now();
        if (imageUrl !== undefined) updates.imageUrl = imageUrl;
        if (images !== undefined) updates.images = Array.isArray(images) ? images : [images];
        if (videoUrl !== undefined) updates.videoUrl = videoUrl;

        if (updates.price !== undefined || updates.subscriptionPeriod !== undefined) {
            const newPrice = Number(updates.price !== undefined ? updates.price : existing.pricing?.price || 0);
            const isSubscription = String(updates.subscriptionPeriod || existing.pricing?.period || "") === "month";
            updates.pricing = {
                ...(existing.pricing || {}),
                type: isSubscription ? "subscription" : newPrice > 0 ? "paid" : "free",
                price: newPrice,
                ...(isSubscription ? { period: "month" } : { period: undefined }),
            };
            delete updates.price;
            delete updates.subscriptionPeriod;
        }

        await adminDatabase.ref(`products/${productId}`).update(updates);

        // Keep the connected-account Stripe listing in sync when the price or
        // visibility changed. Free products have no Stripe listing.
        const refreshedSnap = await adminDatabase.ref(`products/${productId}`).get();
        const refreshed = refreshedSnap.val();
        const isPaid = refreshed.pricing?.type === "paid" || refreshed.pricing?.type === "subscription";

        if (isPaid) {
            const accountId = await getPaymentsReadyAccountId(dev.uid);
            if (accountId) {
                const unitAmount = Math.round(Number(refreshed.pricing?.price || 0) * 100);
                const currency = String(refreshed.pricing?.currency || "usd").toLowerCase();
                const isSub = refreshed.pricing?.type === "subscription";

                try {
                    if (refreshed.stripeProductId) {
                        // Price changed → create a new price on the connected
                        // account and point the listing at it.
                        const stripePrice = await stripeClient.prices.create(
                            {
                                product: refreshed.stripeProductId as string,
                                currency,
                                unit_amount: unitAmount,
                                ...(isSub ? { recurring: { interval: "month" as const } } : {}),
                                metadata: { firebaseProductId: productId },
                            },
                            { stripeAccount: accountId }
                        );
                        await adminDatabase.ref(`products/${productId}`).update({
                            stripePriceId: stripePrice.id,
                            stripeAccountId: accountId,
                        });
                    } else {
                        // Lazy backfill for products created before Stripe
                        // listing support existed.
                        const listing = await createStripeListing(dev.uid, accountId, {
                            id: productId,
                            slug: refreshed.slug || slugify(refreshed.name),
                            name: refreshed.name,
                            description: refreshed.description,
                            currency,
                            unitAmount,
                            subscriptionPeriod: isSub ? "month" : undefined,
                        });
                        await adminDatabase.ref(`products/${productId}`).update(listing);
                    }
                    await adminDatabase.ref(`products/${productId}/stripeError`).remove();
                } catch (stripeError) {
                    console.error("Stripe listing update failed:", stripeError);
                    await adminDatabase.ref(`products/${productId}/stripeError`).set({
                        message: formatStripeError(stripeError),
                        at: Date.now(),
                    });
                }
            }
        }

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

        // Archive the Stripe listing (if any) so it disappears from the
        // storefront. Never fail the Firebase delete because of Stripe.
        const existing = productSnap.val();
        if (existing.stripeProductId) {
            try {
                const accountId = existing.stripeAccountId || (await getPaymentsReadyAccountId(dev.uid));
                if (accountId) {
                    await stripeClient.products.update(
                        existing.stripeProductId as string,
                        { active: false, metadata: { archived: "true" } },
                        { stripeAccount: accountId }
                    );
                }
            } catch (err) {
                console.error("Stripe product archive failed:", err);
            }
        }

        await adminDatabase.ref(`products/${productId}`).remove();
        return NextResponse.json({ success: true });
    } catch (err) {
        console.error("Developer products DELETE error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}