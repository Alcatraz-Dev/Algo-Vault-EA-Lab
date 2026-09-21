// Step-by-step trace of the compile boot sequence with milestone logging.
import { existsSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { promisify } from "util";
import { execFile } from "child_process";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);
const log = (...a: unknown[]) => console.error(`[trace ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PREFIX = "/Users/haythem_dhahri/Library/Application Support/net.metaquotes.wine.metatrader5";
const WINE = "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine";
const ME = path.join(PREFIX, "drive_c", "Program Files", "MetaTrader 5", "metaeditor64.exe");
const TERMINAL = path.join(PREFIX, "drive_c", "Program Files", "MetaTrader 5", "terminal64.exe");
const EXPERTS = path.join(PREFIX, "drive_c", "Program Files", "MetaTrader 5", "MQL5", "Experts");
const MQ5 = path.join(EXPERTS, "_algo_trace8.mq5");
const EX5 = MQ5.replace(/\.mq5$/, ".ex5");
const LOG = path.join(os.tmpdir(), "algovault_trace8.log");

writeFileSync(MQ5, `#property strict\ninput int Magic = 1;\nint OnInit(){ return INIT_SUCCEEDED; }\nvoid OnDeinit(const int r){}\nvoid OnTick(){ Print("t"); }\n`, "utf8");

async function main() {
    log("start");
    log("spawn metaeditor");
    const metaProc = spawn(WINE, [ME, `/compile:${MQ5}`, `/log:${LOG}`], {
        env: { ...process.env, WINEPREFIX: PREFIX },
        stdio: ["ignore", "ignore", "pipe"],
    });
    metaProc.stderr?.on("data", (d) => log("meta-stderr:", String(d).slice(0, 200)));
    metaProc.on("exit", (c, s) => log("metaeditor exited", c, s));
    await sleep(4000);
    log("spawn terminal");
    const termProc = spawn(WINE, [TERMINAL, "/portable"], {
        env: { ...process.env, WINEPREFIX: PREFIX },
        detached: true,
        stdio: "ignore",
    });
    termProc.unref();
    log("waiting for ex5...");
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !existsSync(EX5)) {
        await sleep(1500);
    }
    log("ex5 exists:", existsSync(EX5));
    log("log exists:", existsSync(LOG));
    try {
        log("log size:", (await import("fs")).statSync(LOG).size);
    } catch (e) {
        log("log stat failed:", String(e).slice(0, 120));
    }
    log("done");
    process.exit(0);
}

main().catch((e) => {
    log("FATAL", String(e));
    process.exit(1);
});