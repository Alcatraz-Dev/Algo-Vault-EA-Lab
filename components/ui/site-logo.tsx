"use client";

import { useEffect, useState } from "react";
import { ref as dbRef, onValue } from "firebase/database";
import { database } from "@/lib/firebase";

type SiteLogoProps = {
    size?: number;
    className?: string;
    showFallback?: boolean;
};

export default function SiteLogo({ size = 18, className }: SiteLogoProps) {
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const [imgError, setImgError] = useState(false);

    useEffect(() => {
        return onValue(dbRef(database, "settings/siteLogo"), (snap) => {
            setLogoUrl(snap.val() || null);
        });
    }, []);

    const src = logoUrl && !imgError ? logoUrl : "/logos/logo.png";

    return (
        <img
            src={src}
            alt="AlgoVault logo"
            className={`object-contain rounded-md ${className || ""}`}
            style={{ width: size, height: size }}
            onError={() => {
                if (logoUrl) setImgError(true);
            }}
        />
    );
}

