import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { Episode } from "./interfaces/episode.interface";
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";
import { PATHS } from "./config/paths.config";
import { GEMINI_CONFIG } from "./config/gemini.config";

// Load environment variables from .env file
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;

if (!GEMINI_API_KEY) {
  console.error(
    "Error: GEMINI_API_KEY or API_KEY environment variable is not set."
  );
  console.error("Please set your API key before running this script.");
  process.exit(1);
}

const EPISODES_FILE = PATHS.input.episodesFile;

/**
 * Transcribes an MP3 file using the Gemini API
 * Supports automatic language detection and returns the transcription text
 */
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
    console.log(`🔄 Sending to Gemini API for transcription...`);

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

/**
 * Saves transcription text to a file
 */
function saveTranscription(
  transcriptionPath: string,
  transcription: string
): void {
  // Ensure directory exists
  const dir = path.dirname(transcriptionPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write transcription to file
  fs.writeFileSync(transcriptionPath, transcription, "utf-8");
  console.log(`✅ Transcription saved to: ${transcriptionPath}`);
}

/**
 * Syncs transcripts for episodes that are downloaded but not yet transcribed
 */
async function syncTranscripts(): Promise<void> {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  🎙️  Sync Transcripts");
    console.log("═══════════════════════════════════════════════════════\n");

    // Load episodes from JSON file
    console.log(`📂 Loading episodes from: ${EPISODES_FILE}`);
    const episodes = loadExistingEpisodes(EPISODES_FILE);

    if (episodes.length === 0) {
      console.warn("⚠️  No episodes found in episodes.json");
      return;
    }

    console.log(`✅ Loaded ${episodes.length} episodes\n`);

    // Filter episodes that need transcription: downloaded: true, transcribed: false
    const episodesToTranscribe = episodes.filter(
      (episode) =>
        episode.status.downloaded === true &&
        episode.status.transcribed === false &&
        episode.status.downloadPath &&
        episode.status.transcriptionPath
    );

    if (episodesToTranscribe.length === 0) {
      console.log("✅ All downloaded episodes are already transcribed!\n");
      return;
    }

    console.log(
      `📝 Found ${episodesToTranscribe.length} episode(s) to transcribe:\n`
    );
    episodesToTranscribe.forEach((ep, index) => {
      console.log(`   ${index + 1}. ${ep.title}`);
      console.log(`      Episode: ${ep.episode}`);
      console.log(`      Audio: ${ep.status.downloadPath}`);
      console.log(`      Output: ${ep.status.transcriptionPath}\n`);
    });

    let successCount = 0;
    let errorCount = 0;

    // Process each episode
    for (let i = 0; i < episodesToTranscribe.length; i++) {
      const episode = episodesToTranscribe[i];
      const episodeIndex = i + 1;

      console.log(
        `\n[${episodeIndex}/${episodesToTranscribe.length}] Processing: ${episode.title}`
      );
      console.log("───────────────────────────────────────────────────────");

      try {
        // Get full paths
        const audioPath = path.join(
          process.cwd(),
          episode.status.downloadPath!
        );
        const transcriptionPath = path.join(
          process.cwd(),
          episode.status.transcriptionPath!
        );

        // Check if audio file exists
        if (!fs.existsSync(audioPath)) {
          throw new Error(`Audio file not found: ${audioPath}`);
        }

        // Transcribe audio file
        const transcription = await transcribeAudioFile(audioPath);

        // Save transcription to file
        saveTranscription(transcriptionPath, transcription);

        // Update episode status
        episode.status.transcribed = true;

        // Update in the main episodes array
        const episodeIndexInArray = episodes.findIndex(
          (ep) => ep.url === episode.url
        );
        if (episodeIndexInArray !== -1) {
          episodes[episodeIndexInArray] = episode;
        }

        // Save updated episodes to JSON file
        saveEpisodes(episodes, EPISODES_FILE);

        successCount++;
        console.log(`✅ Successfully transcribed episode ${episode.episode}`);
      } catch (error) {
        errorCount++;
        console.error(
          `❌ Error transcribing episode ${episode.episode}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue with next episode instead of stopping
      }
    }

    // Show summary
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📊 Summary:");
    console.log(`   • Episodes processed: ${episodesToTranscribe.length}`);
    console.log(`   • Successful transcriptions: ${successCount}`);
    if (errorCount > 0) {
      console.log(`   • Errors: ${errorCount}`);
    }
    console.log("═══════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("\n❌ Error syncing transcripts:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the sync function
syncTranscripts().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
