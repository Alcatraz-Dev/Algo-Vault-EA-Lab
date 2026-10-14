import React from "react";
import DesktopChrome from "./DesktopChrome.js";
import DesktopNav from "./DesktopNav.js";
export default function DesktopLayout({ children }) {
    return (<div className="flex min-h-screen bg-[#0b0c0e] text-[#e4e4e7] antialiased">
      <DesktopNav />
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0b0c0e] min-w-0">
        <DesktopChrome />
        <section className="flex-1 overflow-y-auto pt-9 p-6">
          {children}
        </section>
      </main>
    </div>);
}
