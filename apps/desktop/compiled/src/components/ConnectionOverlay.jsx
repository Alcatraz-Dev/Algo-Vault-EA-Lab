import React, { useEffect, useState } from "react";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";
export default function ConnectionOverlay() {
    const [online, setOnline] = useState(true);
    useEffect(() => {
        const online = window.connection?.online ?? true;
        const offline = window.connection?.offline ?? false;
        setOnline(!offline);
        const onOnline = () => setOnline(true);
        const onOffline = () => setOnline(false);
        window.addEventListener("connection:online", onOnline);
        window.addEventListener("connection:offline", onOffline);
        return () => {
            window.removeEventListener("connection:online", onOnline);
            window.removeEventListener("connection:offline", onOffline);
        };
    }, []);
    if (online)
        return null;
    return (<div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0c0e]/90 backdrop-blur-sm text-[#f4f5f6]" data-slot="connection-overlay" role="alertdialog" aria-label="Connection lost">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#de661c]/10 ring-1 ring-[#de661c]/20">
        <WifiOff size={28} className="text-[#de661c]"/>
      </div>
      <h2 className="mt-4 text-xl font-semibold tracking-[-0.02em] text-foreground">Feed disconnected</h2>
      <p className="mt-2 max-w-xs text-center text-sm text-muted-foreground">
        The market data feed is offline. Your workspace data is preserved locally; reconnect when the network returns.
      </p>
      <button onClick={() => window.location.reload()} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#de661c] px-4 py-2.5 text-sm font-semibold text-[#1d1406] hover:bg-[#de661c]/90 transition-colors">
        <RefreshCw size={14}/> Retry connection
      </button>
      <div className="mt-8 flex items-center gap-1 text-[0.65rem] text-muted-foreground/60">
        <Wifi size={10}/> <span>Network status reflects the OS feed — never fabricated.</span>
      </div>
    </div>);
}
