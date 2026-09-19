"use client";

import { usePathname } from "next/navigation";
import TourGuide from "./TourGuide";
import { findGuide } from "./guide-configs";

export default function GuideHost() {
    const pathname = usePathname();
    const guide = pathname ? findGuide(pathname) : undefined;
    if (!guide || guide.steps.length === 0) return null;
    return (
        <TourGuide
            key={guide.key}
            steps={guide.steps}
            storageKey={`algovault-guide:${guide.key}`}
            pageTitle={guide.pageTitle}
            legacySeenKeys={guide.legacySeenKeys}
        />
    );
}