/**
 * AlgoVault Gateway EA — distributable resolution.
 *
 * The Trading Access page links to a Gateway download. There is exactly ONE
 * Gateway source in this repository (`MQL5/AlgoVaultTradeGateway`) and no
 * compiled `.ex5` is checked in (MQL5 binaries are bound to a MetaEditor build
 * and terminal install, so shipping a renamed source as `.ex5` would be a fake
 * binary). This module therefore resolves the real, buildable distributable:
 * the `.mq5` SOURCE, which the user compiles in MetaEditor.
 *
 * `kind` is explicit so callers cannot present a source file as a compiled
 * artifact. If a genuine compiled artifact is added later it must be added
 * here with `kind: "compiled"` — never inferred from a file extension.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

/** Repository-relative path of the Gateway EA source. */
export const GATEWAY_SOURCE_PATH = "MQL5/AlgoVaultTradeGateway/AlgoVaultTradeGateway.mq5";

/** Filename presented to the user — matches the `#property version` file. */
export const GATEWAY_DOWNLOAD_FILENAME = "AlgoVaultTradeGateway.mq5";

/** Octet-stream forces a file download instead of rendering in the tab. */
export const GATEWAY_CONTENT_TYPE = "application/octet-stream";

export type GatewayArtifactKind = "source" | "compiled";

export interface GatewayDistributable {
    kind: GatewayArtifactKind;
    filename: string;
    contentType: string;
    body: Uint8Array;
    contentLength: number;
    /** `#property version` from the source, or "unknown" when absent. */
    version: string;
    etag: string;
}

/** Read `#property version "1.3"` from an MQL5 source file. */
export function parseGatewayVersion(source: string): string | null {
    const match = /#property\s+version\s+"([^"]+)"/.exec(source);
    return match ? match[1].trim() : null;
}

/**
 * Load the distributable Gateway EA.
 *
 * Throws when the source is missing or is not an MQL5 expert (no `#property
 * version`) — the route turns that into a real error response instead of a
 * 404 page or an empty download.
 */
export async function readGatewayDistributable(
    root: string = process.cwd(),
): Promise<GatewayDistributable> {
    const absolutePath = path.join(root, GATEWAY_SOURCE_PATH);
    const body = new Uint8Array(await readFile(absolutePath));
    const text = Buffer.from(body).toString("utf8");

    const version = parseGatewayVersion(text);
    if (!version) {
        throw new Error(
            `Gateway source at ${GATEWAY_SOURCE_PATH} has no #property version — refusing to serve an unrecognised file.`,
        );
    }
    if (!text.includes("#property strict")) {
        throw new Error(
            `Gateway source at ${GATEWAY_SOURCE_PATH} is not an MQL5 expert — refusing to serve it.`,
        );
    }

    return {
        kind: "source",
        filename: GATEWAY_DOWNLOAD_FILENAME,
        contentType: GATEWAY_CONTENT_TYPE,
        body,
        contentLength: body.byteLength,
        version,
        etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`,
    };
}
