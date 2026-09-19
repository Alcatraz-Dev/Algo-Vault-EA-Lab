import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDatabase } from "@/lib/firebase-admin";

async function verifyDeveloper(request: NextRequest) {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return null;
    const token = await adminAuth.verifyIdToken(authorization.replace("Bearer ", ""));
    const userSnap = await adminDatabase.ref(`users/${token.uid}`).get();
    const userData = userSnap.val();
    if (!userData || !["developer", "admin"].includes(userData.role)) return null;
    return { uid: token.uid, user: userData };
}

export async function GET(request: NextRequest) {
    try {
        const dev = await verifyDeveloper(request);
        if (!dev) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const ordersSnap = await adminDatabase.ref("orders").get();

        let totalRevenue = 0;
        let totalSales = 0;
        const recentSales: { id: string; product: string; amount: number; date: number; buyer: string }[] = [];

        if (ordersSnap.exists()) {
            ordersSnap.forEach((child) => {
                const order = child.val();
                if (order.developerUid !== dev.uid) return;
                if (order.status === "paid" || order.status === "completed") {
                    totalRevenue += Number(order.amount || 0);
                    totalSales += 1;
                    recentSales.push({
                        id: child.key!,
                        product: order.productName || order.productSlug || "Unknown",
                        amount: Number(order.amount || 0),
                        date: Number(order.createdAt || 0),
                        buyer: order.buyerEmail || "Customer",
                    });
                }
            });
        }

        recentSales.sort((a, b) => b.date - a.date);

        return NextResponse.json({
            success: true,
            stats: {
                totalRevenue: Number(totalRevenue.toFixed(2)),
                totalSales,
                avgSale: totalSales > 0 ? Number((totalRevenue / totalSales).toFixed(2)) : 0,
            },
            recentSales: recentSales.slice(0, 20),
        });
    } catch (err) {
        console.error("Developer earnings error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
