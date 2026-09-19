import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/admin-auth";
import { adminDatabase } from "@/lib/firebase-admin";

type WhiteLabelConfig = {
    id: string;
    brandName: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    logoUrl: string;
    faviconUrl: string;
    customDomain: string;
    footerText: string;
    contactEmail: string;
    features: {
        copyTrading: boolean;
        marketplace: boolean;
        alerts: boolean;
        socialFeed: boolean;
        apiAccess: boolean;
        customDashboard: boolean;
    };
    createdAt: number;
    updatedAt: number;
};

export async function GET(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const wlRef = adminDatabase.ref(`whitelabel/${user.uid}`);
        const snapshot = await wlRef.get();

        if (!snapshot.exists()) {
            const defaultConfig: Omit<WhiteLabelConfig, "id"> = {
                brandName: "AlgoVault Trading",
                primaryColor: "#7c3aed",
                secondaryColor: "#3b82f6",
                accentColor: "#06b6d4",
                logoUrl: "",
                faviconUrl: "",
                customDomain: "",
                footerText: "Powered by AlgoVault",
                contactEmail: "",
                features: {
                    copyTrading: true,
                    marketplace: true,
                    alerts: true,
                    socialFeed: true,
                    apiAccess: true,
                    customDashboard: true,
                },
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            return NextResponse.json({ success: true, config: { id: "default", ...defaultConfig } });
        }

        const data = snapshot.val();
        return NextResponse.json({ success: true, config: { id: "default", ...data } });
    } catch (err) {
        console.error("White-label GET error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const user = await authenticate(request);
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await request.json();
        const { brandName, primaryColor, secondaryColor, accentColor, logoUrl, faviconUrl, customDomain, footerText, contactEmail, features } = body;

        const config = {
            brandName: brandName || "AlgoVault Trading",
            primaryColor: primaryColor || "#7c3aed",
            secondaryColor: secondaryColor || "#3b82f6",
            accentColor: accentColor || "#06b6d4",
            logoUrl: logoUrl || "",
            faviconUrl: faviconUrl || "",
            customDomain: customDomain || "",
            footerText: footerText || "Powered by AlgoVault",
            contactEmail: contactEmail || "",
            features: features || { copyTrading: true, marketplace: true, alerts: true, socialFeed: true, apiAccess: true, customDashboard: true },
            updatedAt: Date.now(),
        };

        await adminDatabase.ref(`whitelabel/${user.uid}`).update(config);

        return NextResponse.json({ success: true, config: { id: "default", ...config } });
    } catch (err) {
        console.error("White-label POST error:", err);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
}
