import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

/**
 * Batch transcriber for multiple audio files using Gemini API
 * Includes cost tracking, rate limiting (2 RPM for AI Pro), and progress reporting
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
const RATE_LIMIT_RPM = 2; // Google AI Pro limit
const RATE_LIMIT_MS = 60000 / RATE_LIMIT_RPM;

if (!GEMINI_API_KEY) {
  console.error(
    "Error: GEMINI_API_KEY or API_KEY environment variable is not set."
  );
  process.exit(1);
}

interface TranscriptionResult {
  filePath: string;
  fileName: string;
  durationSeconds: number;
  durationMinutes: number;
  transcript: string;
  costUSD: number;
  success: boolean;
  error?: string;
  timestamp: Date;
}

const PRICING = {
  inputPerMinute: 0.075, // Gemini 2.0 Flash
  outputPerMillionTokens: 0.3,
  tokensPerWord: 4, // Approximate
};

class GeminiBatchTranscriber {
  private results: TranscriptionResult[] = [];
  private totalCostUSD = 0;
  private processedCount = 0;
  private lastRequestTime = 0;
  private ai: InstanceType<typeof GoogleGenAI>;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }

  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < RATE_LIMIT_MS) {
      const waitTime = RATE_LIMIT_MS - timeSinceLastRequest;
      console.log(
        `⏳ Rate limiting: waiting ${(waitTime / 1000).toFixed(1)}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  private calculateCost(durationMinutes: number, outputWords: number): number {
    const inputCost = durationMinutes * PRICING.inputPerMinute;
    const outputTokens = outputWords * PRICING.tokensPerWord;
    const outputCost =
      (outputTokens / 1000000) * PRICING.outputPerMillionTokens;
    return inputCost + outputCost;
  }

  private getAudioDuration(buffer: Buffer): number {
    // Simplified estimation based on file size and bitrate
    // For MP3: typical bitrate is 128-320 kbps
    // This is a rough estimate; for exact duration, use ffprobe
    const bitrate = 192; // Average bitrate in kbps
    const bytes = buffer.byteLength;
    const bits = bytes * 8;
    const seconds = bits / (bitrate * 1000);
    return Math.max(seconds, 0);
  }

  async transcribeSingleFile(filePath: string): Promise<TranscriptionResult> {
    const fileName = path.basename(filePath);

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      console.log(`\n📄 Processing: ${fileName}`);

      const audioBuffer = fs.readFileSync(filePath);
      const durationSeconds = this.getAudioDuration(audioBuffer);
      const durationMinutes = durationSeconds / 60;

      console.log(
        `  └─ Duration: ${durationMinutes.toFixed(2)} min (${(
          audioBuffer.byteLength /
          1024 /
          1024
        ).toFixed(2)} MB)`
      );

      // Respect rate limits
      await this.respectRateLimit();

      // Convert to base64
      const base64Audio = audioBuffer.toString("base64");

      // Determine MIME type
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = "audio/mpeg";
      if (ext === ".wav") mimeType = "audio/wav";
      if (ext === ".m4a") mimeType = "audio/mp4";
      if (ext === ".ogg") mimeType = "audio/ogg";

      console.log(`  └─ Sending to API...`);

      // Call Gemini API
      const response = await this.ai.models.generateContent({
        model: "gemini-2.0-flash-exp",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Please transcribe the audio in this file. Automatically detect the language. 
                Return ONLY the transcription text without any additional commentary or metadata.`,
              },
              {
                inlineData: {
                  mimeType,
                  data: base64Audio,
                },
              },
            ],
          },
        ],
      });

      if (
        !response.candidates ||
        !response.candidates[0] ||
        !response.candidates[0].content
      ) {
        throw new Error("No response from API");
      }

      const parts = response.candidates[0].content.parts;
      if (!parts || parts.length === 0) {
        throw new Error("No text content in response");
      }

      const transcript = parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join("\n");

      const wordCount = transcript.split(/\s+/).length;
      const cost = this.calculateCost(durationMinutes, wordCount);

      const result: TranscriptionResult = {
        filePath,
        fileName,
        durationSeconds,
        durationMinutes,
        transcript,
        costUSD: cost,
        success: true,
        timestamp: new Date(),
      };

      this.results.push(result);
      this.totalCostUSD += cost;
      this.processedCount++;

      console.log(
        `  └─ ✅ Success | Cost: $${cost.toFixed(4)} | Words: ${wordCount}`
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const result: TranscriptionResult = {
        filePath,
        fileName,
        durationSeconds: 0,
        durationMinutes: 0,
        transcript: "",
        costUSD: 0,
        success: false,
        error: errorMessage,
        timestamp: new Date(),
      };

      this.results.push(result);
      console.log(`  └─ ❌ Failed: ${errorMessage}`);

      return result;
    }
  }

  async transcribeDirectory(
    dirPath: string,
    pattern: string = "*.mp3"
  ): Promise<void> {
    try {
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Directory not found: ${dirPath}`);
      }

      const files = fs
        .readdirSync(dirPath)
        .filter((file) => {
          const ext = path.extname(file).toLowerCase();
          return [".mp3", ".wav", ".m4a", ".ogg"].includes(ext);
        })
        .map((file) => path.join(dirPath, file));

      if (files.length === 0) {
        console.log("No audio files found in directory");
        return;
      }

      console.log(`\n🎙️  Found ${files.length} audio files to process`);
      console.log(
        `⏱️  Estimated time: ${(files.length * (RATE_LIMIT_MS / 1000)).toFixed(
          0
        )}s (respecting rate limits)`
      );

      for (const filePath of files) {
        await this.transcribeSingleFile(filePath);
      }
    } catch (error) {
      console.error("Directory processing failed:", error);
    }
  }

  printReport(): void {
    console.log("\n\n═══════════════════════════════════════════════════════");
    console.log("  📊 Transcription Report");
    console.log("═══════════════════════════════════════════════════════\n");

    const successful = this.results.filter((r) => r.success).length;
    const failed = this.results.filter((r) => !r.success).length;
    const totalDuration = this.results.reduce(
      (sum, r) => sum + r.durationMinutes,
      0
    );

    console.log(`✅ Successful:  ${successful}/${this.results.length}`);
    console.log(`❌ Failed:      ${failed}/${this.results.length}`);
    console.log(`⏱️  Total Duration: ${totalDuration.toFixed(2)} minutes`);
    console.log(`💰 Total Cost: $${this.totalCostUSD.toFixed(4)}`);
    console.log(
      `📊 Average Cost/Episode: $${(this.totalCostUSD / successful).toFixed(4)}`
    );

    if (failed > 0) {
      console.log("\n⚠️  Failed Files:");
      this.results
        .filter((r) => !r.success)
        .forEach((r) => {
          console.log(`  • ${r.fileName}: ${r.error}`);
        });
    }

    console.log("\n───────────────────────────────────────────────────────\n");
  }

  saveResults(outputPath: string): void {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.results.length,
        successful: this.results.filter((r) => r.success).length,
        failed: this.results.filter((r) => !r.success).length,
        totalDurationMinutes: this.results.reduce(
          (sum, r) => sum + r.durationMinutes,
          0
        ),
        totalCostUSD: this.totalCostUSD,
      },
      results: this.results,
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`📁 Report saved to: ${outputPath}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: ts-node src/gemini-batch-transcriber.ts <directory-path> [output-report-path]"
    );
    console.log(
      '\nExample: ts-node src/gemini-batch-transcriber.ts "./output/00_audio_files" "./transcription-report.json"'
    );
    process.exit(0);
  }

  const dirPath = args[0];
  const reportPath = args[1] || "./transcription-batch-report.json";

  const transcriber = new GeminiBatchTranscriber();

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  🎙️  Gemini Batch Audio Transcriber");
  console.log("═══════════════════════════════════════════════════════\n");

  await transcriber.transcribeDirectory(dirPath);
  transcriber.printReport();
  transcriber.saveResults(reportPath);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
