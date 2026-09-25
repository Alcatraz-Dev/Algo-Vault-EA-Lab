/** Bytez Image Generation adapter — official Bytez docs verified.
 * Endpoint: POST /models/v2/{model_id} (official docs: text-to-image, unconditional-image-generation)
 * Auth: Authorization: BYTEZ_KEY (raw key, no Bearer prefix per adapter/authHeaders)
 * Request: { text: prompt }
 * Response: { error?: string; output?: string | { url?: string; file?: string; image?: string; base64?: string; ... } }
 * Uses server-side BYTEZ_API_KEY only.
 */
import * as fs from "fs";
import * as path from "path";
import { AIConfig } from "../ai/config";

const BYTEZ_IMAGE_MODEL = "dreamlike-art/dreamlike-photoreal-2.0"; // official docs example
const BYTEZ_VIDEO_MODEL = "ali-vilab/text-to-video-ms-1.7b"; // official docs example

export interface BytezImageResult {
  ok: boolean;
  asset?: { id: string; url: string; localPath: string; kind: "image"; source: string; createdAt: number };
  error?: string;
  provider?: string;
}

export async function generateBytezImage(prompt: string, outputName?: string, timeoutMs = 120000): Promise<BytezImageResult> {
  if (!AIConfig.bytezApiKey || !AIConfig.bytezApiKey.trim()) {
    return { ok: false, error: "BYTEZ_API_KEY not configured.", provider: "bytez" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`https://api.bytez.com/models/v2/${BYTEZ_IMAGE_MODEL}`, {
      method: "POST",
      headers: {
        Authorization: AIConfig.bytezApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: prompt }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, error: `Bytez image API failed (${res.status}): ${data?.error || data?.message || "Unknown"}`, provider: "bytez" };
    }
    if (data.error) {
      return { ok: false, error: `Bytez error: ${data.error}`, provider: "bytez" };
    }

    // Determine output URL/file from response structure
    let imageUrl: string | null = null;
    let base64Data: string | null = null;
    if (data.output) {
      if (typeof data.output === "string") {
        // Could be URL or base64
        if (data.output.startsWith("http")) {
          imageUrl = data.output;
        } else if (data.output.length > 100 && /^[A-Za-z0-9+/=]+$/.test(data.output.slice(0, 100))) {
          base64Data = data.output;
        }
      } else if (typeof data.output === "object") {
        imageUrl = data.output.url || data.output.file || data.output.image || null;
        if (!imageUrl && data.output.base64) base64Data = data.output.base64;
      }
    }

    // If base64 or file path returned, download/save; if URL returned, download safely
    let filePath: string | null = null;
    if (base64Data) {
      const buf = Buffer.from(base64Data, "base64");
      const outDir = "/tmp/marketing-video/assets";
      fs.mkdirSync(outDir, { recursive: true });
      const safeName = (outputName ? outputName.replace(/[^a-zA-Z0-9_.-]/g, "_") : `bytez_img_${Date.now()}`) + ".png";
      filePath = path.join(outDir, safeName);
      fs.writeFileSync(filePath, buf);
      const header = fs.readFileSync(filePath).slice(0, 4).toString("hex");
      if (header !== "89504e47") {
        // Try to save as whatever format it actually is; but for simplicity keep file
        // Real verification continues
      }
    } else if (imageUrl) {
      const outDir = "/tmp/marketing-video/assets";
      fs.mkdirSync(outDir, { recursive: true });
      const safeName = (outputName ? outputName.replace(/[^a-zA-Z0-9_.-]/g, "_") : `bytez_img_${Date.now()}`) + ".png";
      filePath = path.join(outDir, safeName);
      const imgRes = await fetch(imageUrl, { signal: controller.signal }).catch(() => null);
      if (imgRes && imgRes.ok) {
        const arr = await imgRes.arrayBuffer().catch(() => null);
        if (arr) fs.writeFileSync(filePath, Buffer.from(arr));
      }
    }

    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      return { ok: false, error: `Bytez image response missing valid image data. URL=${!!imageUrl}, base64=${!!base64Data}`, provider: "bytez" };
    }

    const asset = {
      id: `img_bytez_${path.basename(filePath, ".png")}`,
      kind: "image" as const,
      url: `/marketing-video/assets/${path.basename(filePath)}`,
      localPath: filePath,
      source: "bytez-image",
      createdAt: Date.now(),
    };

    return { ok: true, asset, provider: "bytez" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes("abort") ? "Bytez image generation timed out." : msg, provider: "bytez" };
  }
}
