import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { GEMINI_CONFIG } from "../config/gemini.config";

// Load environment variables from .env file
dotenv.config();

/**
 * Transcribes an MP3 file using the Gemini API
 * Supports automatic language detection and outputs results to console
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!GEMINI_API_KEY) {
  console.error(
    "Error: GEMINI_API_KEY or API_KEY environment variable is not set."
  );
  console.error("Please set your API key before running this script.");
  process.exit(1);
}

async function transcribeAudioFile(filePath: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  try {
    // Read the audio file
    console.log(`📁 Reading file: ${filePath}`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const audioBuffer = fs.readFileSync(filePath);
    console.log(
      `✓ File loaded (${(audioBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`
    );

    // Convert to base64
    const base64Audio = audioBuffer.toString("base64");

    // Determine MIME type based on file extension
    const ext = path.extname(filePath).toLowerCase();
    let mimeType = "audio/mpeg"; // Default for mp3
    if (ext === ".wav") mimeType = "audio/wav";
    if (ext === ".m4a") mimeType = "audio/mp4";
    if (ext === ".ogg") mimeType = "audio/ogg";

    console.log(`🎵 MIME Type: ${mimeType}`);
    console.log(`\n🔄 Sending to Gemini API for transcription...`);

    // Create the request using Files API or direct inline data
    const response = await ai.models.generateContent({
      model: GEMINI_CONFIG.MODEL,
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
      throw new Error("No response received from Gemini API");
    }

    const parts = response.candidates[0].content.parts;
    if (!parts || parts.length === 0) {
      throw new Error("No text content in response");
    }

    const transcription = parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n");

    return transcription;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Transcription failed: ${error.message}`);
    }
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(
      "Usage: ts-node src/gemini-transcriber.ts <path-to-audio-file>"
    );
    console.log(
      "\nExample: ts-node src/gemini-transcriber.ts ./output/00_audio_files/episode_001.mp3"
    );
    console.log("\nSupported formats: MP3, WAV, M4A, OGG");
    process.exit(0);
  }

  const filePath = args[0];

  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  🎙️  Gemini Audio Transcriber");
    console.log("═══════════════════════════════════════════════════════\n");

    const transcription = await transcribeAudioFile(filePath);

    console.log("\n✅ Transcription Complete!\n");
    console.log("───────────────────────────────────────────────────────");
    console.log("\n📝 TRANSCRIPTION:\n");
    console.log(transcription);
    console.log("\n───────────────────────────────────────────────────────\n");
  } catch (error) {
    console.error(
      "\n❌ Error:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

main();
