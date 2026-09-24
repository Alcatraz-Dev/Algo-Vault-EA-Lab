/** TTS provider wrapper (say-based). */

import { MarketingMediaProvider, GenerateVoiceoverInput, GenerateVoiceoverResult } from "../types";
import { generateVoiceoverWithSay, isTtsAvailable } from "../tts";

export class TtsProvider implements MarketingMediaProvider {
  readonly id = "tts-local";
  readonly capabilities: MarketingMediaProvider["capabilities"] = ["voiceover"];

  async isAvailable(): Promise<boolean> {
    return isTtsAvailable();
  }

  async generateVoiceover(input: GenerateVoiceoverInput): Promise<GenerateVoiceoverResult> {
    return generateVoiceoverWithSay(input);
  }
}

export function registerTtsProvider(): void {
  (async () => {
    if (await isTtsAvailable()) {
      const { registerMarketingMediaProvider } = await import("./index");
      registerMarketingMediaProvider(new TtsProvider());
    }
  })();
}