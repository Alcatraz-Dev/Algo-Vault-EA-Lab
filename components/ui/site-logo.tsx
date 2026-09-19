"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import { ref as dbRef, onValue } from "firebase/database";
import { database } from "@/lib/firebase";

type SiteLogoProps = {
    size?: number;
    className?: string;
    showFallback?: boolean;
};

export default function SiteLogo({ size = 18, className, showFallback = true }: SiteLogoProps) {
    const [logoUrl, setLogoUrl] = useState<string | null>(null);

    useEffect(() => {
        return onValue(dbRef(database, "settings/siteLogo"), (snap) => {
            setLogoUrl(snap.val() || null);
        });
    }, []);

    if (logoUrl) {
        return (
            <img
                src={logoUrl}
                alt="Site logo"
                className={`object-contain ${className || ""}`}
                style={{ width: size, height: size }}
            />
        );
    }

    if (!showFallback) return null;

    return (
        <div
            className={`flex items-center justify-center rounded-xl bg-foreground text-background ${className || ""}`}
            style={{ width: size + 14, height: size + 14 }}
        >
            <Bot size={size} />
        </div>
    );
}
