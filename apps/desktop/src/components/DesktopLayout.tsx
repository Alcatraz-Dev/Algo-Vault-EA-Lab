import React from "react";
import DesktopNav from "./DesktopNav";
import DesktopChrome from "./DesktopChrome";

/**
 * DesktopLayout — Premium macOS desktop shell for AlgoVault.
 * Provides native window chrome with integrated navigation rail.
 * Designed to feel like a professional trading terminal, not a website in a window.
 */
export default function DesktopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[#0b0c0e] text-[#e4e4e7] antialiased">
      {/* Navigation Rail */}
      <DesktopNav />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0b0c0e]">
        {/* Title Bar / App Chrome */}
        <DesktopChrome />
        
        {/* Page Content */}
        <section className="flex-1 overflow-y-auto p-6 bg-[#0b0c0e]">
          {children}
        </section>
      </main>
    </div>
  );
}
