// Replicate compileWithMetaEditor's boot sequence with raw node spawn and
// capture ALL stderr + the log, to find why node spawn differs from shell.
import { spawn } from "child_process";
import { existsSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const PREFIX = "/Users/haythem_dhahri/Library/Application Support/net.metaquotes.wine.metatrader5";
const WINE = "/Applications/MetaTrader 5.app/Contents/SharedSupport/wine/bin/wine";
const ME = path.join(PREFIX, "drive_c", "Program Files", "MetaTrader 5", "metaeditor64.exe");
const TERMINAL = path.join(PREFIX, "drive_c", "Program Files", "MetaTrader 5", "terminal64.exe");
const EXPERTS = path.join(PREFIX, "drive_c", "Program Files", "MetaTrader 5", "MQL5", "Experts");
const MQ5 = path.join(EXPERTS, "_repro_node7.mq5");
const EX5 = MQ5.replace(/\.mq5$/, ".ex5");
const LOG = path.join(os.tmpdir(), "algovault_repro7.log");

const code = `#property strict\ninput int M = 1;\nint OnInit(){return INIT_SUCCEEDED;}\nvoid OnTick(){}\n`;
writeFileSync(MQ5, code, "utf8");
try { writeFileSync(LOG, ""); } catch { /* */ }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const env = { ...process.env, WINEPREFIX: PREFIX };
    const metaErr: string[] = [];
    console.log("[node] spawning metaeditor at", new Date().toISOString());
    const meProc = spawn(WINE, [ME, `/compile:${MQ5}`, `/log:${LOG}`], { env, stdio: ["ignore", "ignore", "pipe"] });
    meProc.stderr?.on("data", (d) => metaErr.push(String(d)));
    meProc.on("exit", (c, s) => console.log("[node] metaeditor exit code", c, "signal", s));

    await sleep(4000);
    console.log("[node] spawning terminal at", new Date().toISOString());
    const termProc = spawn(WINE, [TERMINAL, "/portable"], { env, detached: true, stdio: "ignore" });
    termProc.unref();

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (existsSync(EX5)) { console.log("[node] EX5 FOUND after", Date.now() - (Date.now() - 60_000 + 60_000) + "ms (poll)"); break; }
        await sleep(1500);
    }
    writeFileSync("/tmp/repro7_meta_stderr.txt", metaErr.join("\n"));
    console.log("[node] ex5 exists:", existsSync(EX5));
    process.exit(0);
}

main();