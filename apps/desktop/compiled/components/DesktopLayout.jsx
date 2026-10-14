import React, { useEffect, useState } from "react";
import DesktopChrome from "./DesktopChrome.js";
export default function DesktopLayout({ children }) {
    const [isDesktop, setIsDesktop] = useState(false);
    useEffect(() => {
        if (typeof window !== "undefined" && window.__ALGOVAULT_DESKTOP__ === true) {
            setIsDesktop(true);
        }
    }, []);
    if (!isDesktop)
        return <>{children}</>;
    return (<div className="min-h-screen bg-[#0b0c0e] text-[#e4e4e7] antialiased">
      <DesktopChrome />
      <main className="pt-9">
        {children}
      </main>
    </div>);
}
