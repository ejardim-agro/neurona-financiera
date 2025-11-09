import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { Episode } from "./interfaces/episode.interface";
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";

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

const EPISODES_FILE = path.join(__dirname, "..", "input", "episodes.json");
const TRANSCRIPTS_DIR = path.join(__dirname, "..", "output", "01_transcripts");
const PROCESSED_DIR = path.join(__dirname, "..", "output", "02_processed");
const TEMP_DIR = path.join(__dirname, "..", "output", "02_processed", ".temp");

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 10 * 1000; // 10 seconds (rate limit: 10 requests/min)
const TEST_MODE_BATCHES = null; // Set to null to process all batches

/**
 * Ensures a directory exists, creating it if necessary
 */
function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Reads transcript file content
 */
function readTranscriptFile(filePath: string): string {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Transcript file not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Generates a temporary batch file with transcripts in the specified format
 */
function generateBatchFile(batchNumber: number, episodes: Episode[]): string {
  ensureDirectoryExists(TEMP_DIR);
  const tempFilePath = path.join(TEMP_DIR, `batch_${batchNumber}_input.md`);

  let content = "";
  episodes.forEach((episode, index) => {
    const transcriptPath = episode.status.transcriptionPath;
    if (!transcriptPath) {
      throw new Error(
        `Episode ${episode.episode} does not have a transcriptionPath`
      );
    }

    const transcriptContent = readTranscriptFile(transcriptPath);
    const fileName = path.basename(transcriptPath);

    const suffix = index === 0 ? "" : `_${index + 1}`;
    content += `transcript_filename${suffix} : ${fileName}\n`;
    content += `transcript_content${suffix} : \`\`\`${transcriptContent}\`\`\`\n`;
    content += "/////////////\n";
  });

  fs.writeFileSync(tempFilePath, content, "utf-8");
  return tempFilePath;
}

/**
 * Calls Gemini API to rewrite transcripts
 */
async function processBatchWithGemini(batchFilePath: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const batchContent = fs.readFileSync(batchFilePath, "utf-8");

  const prompt = `Reescribe cada contenido de transcript_content de forma neutra, estructurada en formato markdown, formal, detallada. 

IMPORTANTE: Debes mantener el mismo idioma detectado en cada texto original. No traduzcas ni cambies el idioma del contenido.

REGLA ESPECIAL PARA CONVERSACIONES: Si detectas que el contenido es una conversación o diálogo entre dos o más personas, NO reescribas la conversación completa. En su lugar, genera un resumen detallado y estructurado de la charla que incluya:
- Los temas principales discutidos
- Los puntos clave mencionados por cada participante (si es relevante)
- Las conclusiones o ideas importantes
- Cualquier información relevante o datos mencionados
El resumen debe ser completo y detallado, pero presentado como un texto narrativo estructurado en markdown, no como un diálogo.

Para contenido que NO es una conversación (monólogo, narración, etc.), reescríbelo normalmente en formato markdown estructurado.

Debes mantener el mismo formato de respuesta que el archivo de entrada, devolviendo cada contenido reescrito dentro de codeblocks markdown.

Formato de entrada:
transcript_filename : <<transcript_file_name>>
transcript_content : \`\`\`<<transcript_content>>\`\`\`
/////////////

Formato de salida esperado (mantén el mismo formato):
transcript_filename : <<transcript_file_name>>
transcript_content : \`\`\`<<transcript_content_reescrito_en_markdown>>\`\`\`
/////////////

Archivo a procesar:
${batchContent}`;

  try {
    console.log(`🔄 Sending batch to Gemini API...`);

    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp", // Using 2.0 flash exp for better results
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
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

    const processedContent = parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n");

    return processedContent;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Gemini API call failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parses the processed batch response and extracts individual transcript contents
 */
function parseBatchResponse(
  responseContent: string,
  episodes: Episode[]
): Map<string, string> {
  const results = new Map<string, string>();

  // Split by separator
  const sections = responseContent
    .split("/////////////")
    .filter((s) => s.trim());

  sections.forEach((section, index) => {
    if (index >= episodes.length) {
      console.warn(
        `⚠️  More sections in response than episodes in batch (section ${
          index + 1
        })`
      );
      return;
    }

    const episode = episodes[index];
    const transcriptPath = episode.status.transcriptionPath;
    if (!transcriptPath) {
      return;
    }

    const fileName = path.basename(transcriptPath);

    // Extract transcript_content from the section
    const contentMatch = section.match(
      /transcript_content(?:_\d+)?\s*:\s*```([\s\S]*?)```/
    );

    if (contentMatch && contentMatch[1]) {
      results.set(fileName, contentMatch[1].trim());
    } else {
      console.warn(
        `⚠️  Could not extract content for ${fileName} from response`
      );
    }
  });

  return results;
}

/**
 * Removes "markdown" prefix from content if present
 */
function cleanMarkdownPrefix(content: string): string {
  const trimmed = content.trim();
  // Check if content starts with "markdown" (case insensitive)
  if (/^markdown\s+/i.test(trimmed)) {
    return trimmed.replace(/^markdown\s+/i, "").trim();
  }
  return trimmed;
}

/**
 * Saves processed transcript to final location
 */
function saveProcessedTranscript(
  episode: Episode,
  processedContent: string
): void {
  const processedPath = episode.status.processedPath;
  if (!processedPath) {
    throw new Error(`Episode ${episode.episode} does not have a processedPath`);
  }

  const fullPath = path.join(process.cwd(), processedPath);
  ensureDirectoryExists(path.dirname(fullPath));

  // Clean markdown prefix if present
  const cleanedContent = cleanMarkdownPrefix(processedContent);

  fs.writeFileSync(fullPath, cleanedContent, "utf-8");
  console.log(`✅ Processed transcript saved: ${processedPath}`);
}

/**
 * Cleans up temporary files
 */
function cleanupTempFiles(): void {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      const files = fs.readdirSync(TEMP_DIR);
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        fs.unlinkSync(filePath);
      }
      console.log(`🧹 Cleaned up ${files.length} temporary file(s)`);
    }
  } catch (error) {
    console.warn(
      `⚠️  Could not clean up temporary files:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Sleep utility function
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Partitions array into batches of specified size
 */
function partitionIntoBatches<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Main function to sync processed files
 */
async function syncProcessedFiles(): Promise<void> {
  try {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  📝 Sync Processed Files");
    console.log("═══════════════════════════════════════════════════════\n");

    // Load episodes from JSON file
    console.log(`📂 Loading episodes from: ${EPISODES_FILE}`);
    const episodes = loadExistingEpisodes(EPISODES_FILE);

    if (episodes.length === 0) {
      console.warn("⚠️  No episodes found in episodes.json");
      return;
    }

    console.log(`✅ Loaded ${episodes.length} episodes\n`);

    // Filter episodes that need processing: processed: false and have transcriptionPath
    const episodesToProcess = episodes.filter(
      (episode) =>
        episode.status.processed === false &&
        episode.status.transcriptionPath &&
        episode.status.processedPath
    );

    if (episodesToProcess.length === 0) {
      console.log("✅ All episodes are already processed!\n");
      return;
    }

    console.log(
      `📝 Found ${episodesToProcess.length} episode(s) to process:\n`
    );
    episodesToProcess.forEach((ep, index) => {
      console.log(`   ${index + 1}. ${ep.title} (Episode ${ep.episode})`);
    });

    // Partition into batches
    const batches = partitionIntoBatches(episodesToProcess, BATCH_SIZE);
    const batchesToProcess = TEST_MODE_BATCHES
      ? batches.slice(0, TEST_MODE_BATCHES)
      : batches;

    if (TEST_MODE_BATCHES) {
      console.log(
        `\n🧪 TEST MODE: Processing first ${TEST_MODE_BATCHES} batch(es)\n`
      );
    }

    console.log(
      `\n📦 Partitioned into ${batches.length} batch(es) of up to ${BATCH_SIZE} episodes`
    );
    console.log(`📦 Will process ${batchesToProcess.length} batch(es)\n`);

    let totalProcessed = 0;
    let totalErrors = 0;

    // Process each batch
    for (
      let batchIndex = 0;
      batchIndex < batchesToProcess.length;
      batchIndex++
    ) {
      const batch = batchesToProcess[batchIndex];
      const batchNumber = batchIndex + 1;

      console.log(
        `\n[Batch ${batchNumber}/${batchesToProcess.length}] Processing ${batch.length} episode(s)`
      );
      console.log("───────────────────────────────────────────────────────");

      try {
        // Generate temporary batch file
        console.log(`📄 Generating batch file...`);
        const batchFilePath = generateBatchFile(batchNumber, batch);
        console.log(`✅ Batch file created: ${batchFilePath}`);

        // Process batch with Gemini API
        console.log(`🤖 Processing batch with Gemini API...`);
        const processedContent = await processBatchWithGemini(batchFilePath);

        // Save processed response to temporary file
        const responseFilePath = path.join(
          TEMP_DIR,
          `batch_${batchNumber}_response.md`
        );
        fs.writeFileSync(responseFilePath, processedContent, "utf-8");
        console.log(`✅ Response saved: ${responseFilePath}`);

        // Parse response and save individual files
        console.log(`📝 Parsing response and saving processed files...`);
        const parsedResults = parseBatchResponse(processedContent, batch);

        // Update episodes and save processed files
        for (const episode of batch) {
          const transcriptPath = episode.status.transcriptionPath;
          if (!transcriptPath) {
            continue;
          }

          const fileName = path.basename(transcriptPath);
          const processedContentForEpisode = parsedResults.get(fileName);

          if (processedContentForEpisode) {
            // Save processed transcript
            saveProcessedTranscript(episode, processedContentForEpisode);

            // Update episode status
            episode.status.processed = true;

            // Update in the main episodes array
            const episodeIndexInArray = episodes.findIndex(
              (ep) => ep.url === episode.url
            );
            if (episodeIndexInArray !== -1) {
              episodes[episodeIndexInArray] = episode;
            }

            totalProcessed++;
          } else {
            console.warn(
              `⚠️  Could not find processed content for episode ${episode.episode}`
            );
            totalErrors++;
          }
        }

        // Save updated episodes to JSON file
        saveEpisodes(episodes, EPISODES_FILE);
        console.log(`✅ Episodes status updated in JSON file`);

        // Wait before processing next batch (except for the last batch)
        if (batchIndex < batchesToProcess.length - 1) {
          console.log(
            `\n⏳ Waiting ${
              DELAY_BETWEEN_BATCHES_MS / 1000
            } seconds before next batch...`
          );
          await sleep(DELAY_BETWEEN_BATCHES_MS);
        }
      } catch (error) {
        totalErrors += batch.length;
        console.error(
          `❌ Error processing batch ${batchNumber}:`,
          error instanceof Error ? error.message : String(error)
        );
        // Continue with next batch instead of stopping
      }
    }

    // Show summary
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("📊 Summary:");
    if (TEST_MODE_BATCHES) {
      console.log(
        `   • Mode: TEST MODE (first ${TEST_MODE_BATCHES} batch(es) processed)`
      );
    }
    console.log(`   • Episodes to process: ${episodesToProcess.length}`);
    console.log(`   • Batches available: ${batches.length}`);
    console.log(`   • Batches processed: ${batchesToProcess.length}`);
    console.log(`   • Successfully processed: ${totalProcessed}`);
    if (totalErrors > 0) {
      console.log(`   • Errors: ${totalErrors}`);
    }
    console.log("═══════════════════════════════════════════════════════\n");

    // Clean up temporary files if everything was successful
    if (totalErrors === 0 && totalProcessed > 0) {
      cleanupTempFiles();
    } else if (totalErrors > 0) {
      console.log("⚠️  Keeping temporary files due to errors for debugging");
    }
  } catch (error) {
    console.error("\n❌ Error syncing processed files:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the sync function
syncProcessedFiles().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
