/** OpenRouter Image Generation adapter — uses existing configured credentials.
 * Only active when OpenRouter API key is present.
 * Calls /api/v1/images (documented unified endpoint) with a text prompt.
 * Downloads base64 image, writes to server-local storage, returns asset ref.
 * Never exposes key; validates response; handles timeout/rate-limit.
 */
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { AIConfig } from "../ai/config";

const IMAGE_API_URL = `${AIConfig.openrouterBaseUrl || "https://openrouter.ai/api/v1"}/images`;

export interface ImageGenResult {
  ok: boolean;
  asset?: { id: string; url: string; localPath: string; kind: "image"; source: string; createdAt: number };
  error?: string;
  provider?: string;
}

export async function generateImageFromOpenRouter(prompt: string, outputName?: string, timeoutMs = 120000): Promise<ImageGenResult> {
  if (!AIConfig.openrouterApiKey || !AIConfig.openrouterApiKey.trim()) {
    return { ok: false, error: "OpenRouter API key not configured.", provider: "openrouter" };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(IMAGE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIConfig.openrouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        prompt,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `OpenRouter image API failed (${res.status}): ${text.slice(0, 200)}`, provider: "openrouter" };
    }

    const data = await res.json() as { data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>; error?: { message?: string } };

    if (data.error) {
      return { ok: false, error: `OpenRouter error: ${data.error.message || "Unknown"}`, provider: "openrouter" };
    }
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      return { ok: false, error: "OpenRouter image response missing data array.", provider: "openrouter" };
    }

    const first = data.data[0];
    let imageBytes: Buffer | null = null;
    if (first.b64_json) {
      imageBytes = Buffer.from(first.b64_json, "base64");
    } else if (first.url && first.url.startsWith("http")) {
      // Remote URL returned instead of base64 — download safely
      const imgRes = await fetch(first.url, { signal: controller.signal });
      if (imgRes.ok) imageBytes = Buffer.from(await imgRes.arrayBuffer());
    }

    if (!imageBytes || imageBytes.length === 0) {
      return { ok: false, error: "No image bytes returned by OpenRouter.", provider: "openrouter" };
    }

    // Write securely to intended storage directory
    const outDir = "/tmp/marketing-video/assets";
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${outputName || `ai_img_${Date.now()}`}.png`;
    const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const localPath = path.join(outDir, safeName);
    fs.writeFileSync(localPath, imageBytes);

    // Validate it's a real PNG (magic bytes)
    const header = fs.readFileSync(localPath).slice(0, 4).toString("hex");
    if (header !== "89504e47") {
      // Not PNG — could be other format; still keep but report
      console.log("OpenRouter image format header:", header);
    }

    const asset = {
      id: `img_${path.basename(localPath, ".png")}`,
      kind: "image" as const,
      url: `/marketing-video/assets/${safeName}`,
      localPath,
      source: "openrouter-image",
      createdAt: Date.now(),
    };

    return { ok: true, asset, provider: "openrouter" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.includes("abort") ? "Image generation timed out." : msg, provider: "openrouter" };
  }
}
