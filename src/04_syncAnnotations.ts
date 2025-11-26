import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import yaml from "js-yaml";
import { Episode } from "./interfaces/episode.interface";
import { EpisodeFrontmatter } from "./interfaces/episode-frontmatter.interface";
import { loadExistingEpisodes, saveEpisodes } from "./utils/file.utils";
import {
  loadRateLimitTracker,
  saveRateLimitTracker,
  canMakeRequest,
  respectRateLimitPerMinute,
  recordRequest,
  RATE_LIMIT_PER_DAY,
  RateLimitTracker,
} from "./utils/rate-limit.utils";
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
const PROCESSED_DIR = PATHS.output.processed;
const ANNOTATED_DIR = PATHS.output.annotated;
const EXAMPLE_FILE = PATHS.config.exampleFrontmatter;

// Test mode: Set to a number to process only that many episodes, or null to process all
const TEST_MODE_LIMIT = null; // Set to null to process all episodes

/**
 * Converts duration from "HH:MM" or "HH:MM:SS" format to seconds
 */
function durationToSeconds(duration: string): number {
  if (!duration) return 0;

  // If it's already a number (seconds), return it
  const seconds = parseInt(duration, 10);
  if (!isNaN(seconds) && !duration.includes(":")) {
    return seconds;
  }

  // Parse HH:MM:SS or MM:SS format
  const parts = duration.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 2) {
    // MM:SS format
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS format
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return 0;
}

/**
 * Generates basic frontmatter YAML with TODO comments for empty fields
 */
function generateBasicFrontmatter(episode: Episode): string {
  const durationSeconds = durationToSeconds(episode.duration);

  // Build YAML manually to have better control over formatting
  const lines: string[] = [];

  // Escape quotes and handle multiline strings
  const escapeYamlString = (str: string): string => {
    if (!str) return '""';
    // Replace quotes and newlines
    const escaped = str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n");
    return `"${escaped}"`;
  };

  lines.push(`title: ${escapeYamlString(episode.title)}`);
  lines.push(`summary: ${escapeYamlString(episode.description || "")}`);
  lines.push(`episodeNumber: "${episode.episode}"`);

  if (episode.pubDate) {
    lines.push(`pubDate: "${episode.pubDate}"`);
  }

  if (durationSeconds > 0) {
    lines.push(`duration: ${durationSeconds}`);
  }

  // Add TODO fields
  lines.push("# TODO: Complete with Gemini");
  lines.push("category: null");
  lines.push("# TODO: Complete with Gemini");
  lines.push("topics: null");
  lines.push("# TODO: Complete with Gemini");
  lines.push("tags: null");
  lines.push("# TODO: Complete with Gemini");
  lines.push("difficulty: null");
  lines.push("# TODO: Complete with Gemini");
  lines.push("glossaryTerms: null");
  lines.push("# TODO: Complete with Gemini");
  lines.push("mainConcepts: null");
  lines.push("# TODO: Complete with Gemini");
  lines.push("mainTakeaways: null");

  return lines.join("\n");
}

/**
 * Reads markdown file and separates frontmatter from content
 */
function readMarkdownWithFrontmatter(filePath: string): {
  frontmatter: string;
  content: string;
} {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const fileContent = fs.readFileSync(fullPath, "utf-8");
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = fileContent.match(frontmatterRegex);

  if (match) {
    return {
      frontmatter: match[1],
      content: match[2],
    };
  }

  // If no frontmatter, return empty frontmatter and full content
  return {
    frontmatter: "",
    content: fileContent,
  };
}

/**
 * Writes markdown file with frontmatter
 */
function writeMarkdownWithFrontmatter(
  filePath: string,
  frontmatter: string,
  content: string
): void {
  const fullPath = path.join(process.cwd(), filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fileContent = `---\n${frontmatter}\n---\n\n${content}`;
  fs.writeFileSync(fullPath, fileContent, "utf-8");
}

/**
 * Reads processed file content
 */
function readProcessedFile(processedPath: string): string {
  const fullPath = path.join(process.cwd(), processedPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Processed file not found: ${fullPath}`);
  }
  return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Calls Gemini API to complete frontmatter fields
 */
async function completeFrontmatterWithGemini(
  frontmatter: string,
  content: string,
  exampleContent?: string
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const exampleSection = exampleContent
    ? `\n\nEjemplo de frontmatter completo:\n\`\`\`\n${exampleContent}\n\`\`\``
    : "";

  const prompt = `Analiza el siguiente archivo markdown de un episodio de podcast sobre finanzas personales y completa los campos del frontmatter que están marcados como "TODO: Complete with Gemini".

El frontmatter actual es:
\`\`\`yaml
${frontmatter}
\`\`\`

El contenido del episodio es:
\`\`\`markdown
${content}
\`\`\`
${exampleSection}

Debes completar los siguientes campos del frontmatter:
- category: Una categoría principal (ej: "fundamentos", "inversión", "ahorro", "ingresos", "deuda", "planificación")
- topics: Array de tópicos principales cubiertos en el episodio (para clustering)
- tags: Array de etiquetas adicionales para búsqueda y filtrado
- difficulty: Nivel de dificultad ("principiante", "intermedio", o "avanzado")
- glossaryTerms: Array de términos que se definen o explican en el episodio
- mainConcepts: Array de conceptos clave enseñados en el episodio
- mainTakeaways: Array de puntos clave principales o conclusiones del episodio

FORMATO YAML REQUERIDO (CRÍTICO - DEBES SEGUIR ESTE FORMATO EXACTO):
- Todos los arrays DEBEN usar formato bullet list (block style) con guiones y indentación de 2 espacios
- NO uses formato inline array (no uses [])
- Formato correcto para arrays:
  topics:
    - "tema 1"
    - "tema 2"
    - "tema 3"
- Arrays vacíos se escriben como: prerequisites: []
- Todos los strings deben usar comillas dobles
- Mantén el orden de campos: title, summary, episodeNumber, pubDate, duration, category, topics, tags, difficulty, prerequisites, relatedEpisodes, learningPathOrder, glossaryTerms, mainConcepts, mainTakeaways

IMPORTANTE:
- Mantén TODOS los campos existentes del frontmatter (title, summary, episodeNumber, pubDate, duration)
- Solo completa los campos que están marcados como TODO o son null
- Devuelve SOLO el frontmatter completo en formato YAML válido, sin el bloque de código markdown
- NO incluyas los delimitadores --- al inicio o final
- Usa EXACTAMENTE el formato bullet list para todos los arrays (no inline arrays)
- Mantén el formato YAML limpio, consistente y bien estructurado`;

  try {
    console.log(`🔄 Sending request to Gemini API...`);

    const response = await ai.models.generateContent({
      model: GEMINI_CONFIG.MODEL,
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

    let completedFrontmatter = parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n")
      .trim();

    // Remove markdown code blocks if present
    completedFrontmatter = completedFrontmatter.replace(/^```yaml?\n?/gm, "");
    completedFrontmatter = completedFrontmatter.replace(/^```\n?/gm, "");
    completedFrontmatter = completedFrontmatter.trim();

    // Remove YAML frontmatter delimiters if present
    completedFrontmatter = completedFrontmatter.replace(/^---\s*\n?/gm, "");
    completedFrontmatter = completedFrontmatter.replace(/\n?---\s*$/gm, "");
    completedFrontmatter = completedFrontmatter.trim();

    return completedFrontmatter;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Gemini API call failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Main function to sync annotations
 */
async function syncAnnotations(): Promise<void> {
  try {
    // Load rate limit tracker
    let rateLimitTracker = loadRateLimitTracker();
    console.log(
      `📊 Rate limit status: ${rateLimitTracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Load episodes
    const episodes = loadExistingEpisodes(EPISODES_FILE);
    console.log(`📂 Loaded ${episodes.length} episodes`);

    // Filter episodes with processed: true
    let processedEpisodes = episodes.filter(
      (ep) => ep.status.processed === true && ep.status.annotated === false
    );
    console.log(
      `✅ Found ${processedEpisodes.length} processed episodes to annotate`
    );

    // Limit to TEST_MODE_LIMIT episodes if configured
    if (TEST_MODE_LIMIT !== null && TEST_MODE_LIMIT > 0) {
      processedEpisodes = processedEpisodes.slice(0, TEST_MODE_LIMIT);
      console.log(
        `🧪 TEST MODE: Processing only ${processedEpisodes.length} episode(s)`
      );
    }

    // Check how many episodes need Gemini API calls
    let episodesNeedingGemini = 0;
    for (const episode of processedEpisodes) {
      const annotatedPath = episode.status.annotatedPath;
      if (!annotatedPath) continue;

      const fullAnnotatedPath = path.join(process.cwd(), annotatedPath);
      const fileExists = fs.existsSync(fullAnnotatedPath);

      if (!fileExists) {
        episodesNeedingGemini++;
      } else {
        const { frontmatter } = readMarkdownWithFrontmatter(annotatedPath);
        const needsCompletion =
          frontmatter.includes("TODO: Complete with Gemini") ||
          frontmatter.includes("category: null") ||
          frontmatter.includes("topics: null") ||
          frontmatter.includes("tags: null") ||
          frontmatter.includes("difficulty: null") ||
          frontmatter.includes("glossaryTerms: null") ||
          frontmatter.includes("mainConcepts: null") ||
          frontmatter.includes("mainTakeaways: null");

        if (needsCompletion) {
          episodesNeedingGemini++;
        }
      }
    }

    // Check daily rate limit
    const { canMake, remaining } = canMakeRequest(rateLimitTracker);
    if (!canMake) {
      console.error(
        `❌ Daily rate limit reached! Used ${rateLimitTracker.requestCount}/${RATE_LIMIT_PER_DAY} requests today.`
      );
      console.error(`   Please try again tomorrow.`);
      process.exit(1);
    }

    if (episodesNeedingGemini > remaining) {
      console.warn(
        `⚠️  Warning: ${episodesNeedingGemini} episodes need Gemini API calls, but only ${remaining} requests remaining today.`
      );
      console.warn(
        `   Will process ${remaining} episodes now. Run again tomorrow to continue.`
      );
      // Limit episodes to what we can process today
      let count = 0;
      processedEpisodes = processedEpisodes.filter((ep) => {
        if (count >= remaining) return false;
        const annotatedPath = ep.status.annotatedPath;
        if (!annotatedPath) return false;

        const fullAnnotatedPath = path.join(process.cwd(), annotatedPath);
        const fileExists = fs.existsSync(fullAnnotatedPath);

        if (!fileExists) {
          count++;
          return true;
        } else {
          const { frontmatter } = readMarkdownWithFrontmatter(annotatedPath);
          const needsCompletion =
            frontmatter.includes("TODO: Complete with Gemini") ||
            frontmatter.includes("category: null") ||
            frontmatter.includes("topics: null") ||
            frontmatter.includes("tags: null") ||
            frontmatter.includes("difficulty: null") ||
            frontmatter.includes("glossaryTerms: null") ||
            frontmatter.includes("mainConcepts: null") ||
            frontmatter.includes("mainTakeaways: null");

          if (needsCompletion) {
            count++;
            return true;
          }
        }
        return false;
      });
    }

    // Ensure annotated directory exists
    if (!fs.existsSync(ANNOTATED_DIR)) {
      fs.mkdirSync(ANNOTATED_DIR, { recursive: true });
    }

    // Read example file if it exists
    let exampleContent: string | undefined;
    if (fs.existsSync(EXAMPLE_FILE)) {
      try {
        const exampleFile = fs.readFileSync(EXAMPLE_FILE, "utf-8");
        // Extract YAML frontmatter from the file (between --- delimiters)
        const frontmatterMatch = exampleFile.match(/^---\s*\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          exampleContent = frontmatterMatch[1].trim();
        }
      } catch (error) {
        console.warn(`⚠️  Could not read example file: ${error}`);
      }
    }

    let createdCount = 0;
    let completedCount = 0;
    let errorCount = 0;

    // Process each episode
    for (const episode of processedEpisodes) {
      const annotatedPath = episode.status.annotatedPath;
      if (!annotatedPath) {
        console.warn(
          `⚠️  Episode ${episode.episode} does not have annotatedPath`
        );
        continue;
      }

      const processedPath = episode.status.processedPath;
      if (!processedPath) {
        console.warn(
          `⚠️  Episode ${episode.episode} does not have processedPath`
        );
        continue;
      }

      const fullAnnotatedPath = path.join(process.cwd(), annotatedPath);
      const fileExists = fs.existsSync(fullAnnotatedPath);

      try {
        if (!fileExists) {
          // Create new annotated file with basic frontmatter
          console.log(
            `📝 Creating annotated file for episode ${episode.episode}: ${episode.title}`
          );

          const frontmatter = generateBasicFrontmatter(episode);
          const processedContent = readProcessedFile(processedPath);

          writeMarkdownWithFrontmatter(
            annotatedPath,
            frontmatter,
            processedContent
          );

          createdCount++;
          console.log(`✅ Created: ${annotatedPath}`);

          // Check rate limit before calling Gemini
          const { canMake: canMakeRequestNow } =
            canMakeRequest(rateLimitTracker);
          if (!canMakeRequestNow) {
            console.warn(
              `⚠️  Daily rate limit reached. Skipping Gemini completion for this episode.`
            );
            console.warn(
              `   Run the script again tomorrow to complete remaining episodes.`
            );
            break; // Stop processing
          }

          // Respect rate limit per minute
          await respectRateLimitPerMinute(rateLimitTracker);

          // Immediately complete frontmatter with Gemini
          console.log(
            `🤖 Completing frontmatter with Gemini for episode ${episode.episode}...`
          );

          const completedFrontmatter = await completeFrontmatterWithGemini(
            frontmatter,
            processedContent,
            exampleContent
          );

          // Record the request
          rateLimitTracker = recordRequest(rateLimitTracker);
          saveRateLimitTracker(rateLimitTracker);

          writeMarkdownWithFrontmatter(
            annotatedPath,
            completedFrontmatter,
            processedContent
          );

          completedCount++;
          console.log(`✅ Completed frontmatter for: ${annotatedPath}`);

          // Update episode status in both arrays
          episode.status.annotated = true;
          // Also update in the main episodes array
          const episodeIndexInArray = episodes.findIndex(
            (ep) => ep.url === episode.url
          );
          if (episodeIndexInArray !== -1) {
            episodes[episodeIndexInArray].status.annotated = true;
          }

          // Save immediately to persist the annotated status
          saveEpisodes(episodes, EPISODES_FILE);
        } else {
          // File exists, check if it needs completion
          console.log(
            `🔍 Checking episode ${episode.episode}: ${episode.title}`
          );

          const { frontmatter: currentFrontmatter, content } =
            readMarkdownWithFrontmatter(annotatedPath);

          // Check if frontmatter has TODO comments or null values
          const needsCompletion =
            currentFrontmatter.includes("TODO: Complete with Gemini") ||
            currentFrontmatter.includes("category: null") ||
            currentFrontmatter.includes("topics: null") ||
            currentFrontmatter.includes("tags: null") ||
            currentFrontmatter.includes("difficulty: null") ||
            currentFrontmatter.includes("glossaryTerms: null") ||
            currentFrontmatter.includes("mainConcepts: null") ||
            currentFrontmatter.includes("mainTakeaways: null");

          if (needsCompletion) {
            // Check rate limit before calling Gemini
            const { canMake: canMakeRequestNow } =
              canMakeRequest(rateLimitTracker);
            if (!canMakeRequestNow) {
              console.warn(
                `⚠️  Daily rate limit reached. Skipping Gemini completion for this episode.`
              );
              console.warn(
                `   Run the script again tomorrow to complete remaining episodes.`
              );
              break; // Stop processing
            }

            // Respect rate limit per minute
            await respectRateLimitPerMinute(rateLimitTracker);

            console.log(
              `🤖 Completing frontmatter with Gemini for episode ${episode.episode}...`
            );

            const completedFrontmatter = await completeFrontmatterWithGemini(
              currentFrontmatter,
              content,
              exampleContent
            );

            // Record the request
            rateLimitTracker = recordRequest(rateLimitTracker);
            saveRateLimitTracker(rateLimitTracker);

            writeMarkdownWithFrontmatter(
              annotatedPath,
              completedFrontmatter,
              content
            );

            completedCount++;
            console.log(`✅ Completed frontmatter for: ${annotatedPath}`);

            // Update episode status in both arrays
            episode.status.annotated = true;
            // Also update in the main episodes array
            const episodeIndexInArray = episodes.findIndex(
              (ep) => ep.url === episode.url
            );
            if (episodeIndexInArray !== -1) {
              episodes[episodeIndexInArray].status.annotated = true;
            }

            // Save immediately to persist the annotated status
            saveEpisodes(episodes, EPISODES_FILE);
          } else {
            console.log(`⏭️  Frontmatter already complete: ${annotatedPath}`);
            // Mark as annotated if not already marked
            if (!episode.status.annotated) {
              episode.status.annotated = true;
              const episodeIndexInArray = episodes.findIndex(
                (ep) => ep.url === episode.url
              );
              if (episodeIndexInArray !== -1) {
                episodes[episodeIndexInArray].status.annotated = true;
              }
              // Save immediately to persist the annotated status
              saveEpisodes(episodes, EPISODES_FILE);
            }
          }
        }
      } catch (error) {
        errorCount++;
        console.error(
          `❌ Error processing episode ${episode.episode}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    // Save updated episodes after each successful annotation
    // This ensures we don't lose progress if the script is interrupted
    saveEpisodes(episodes, EPISODES_FILE);

    // Show summary
    console.log(`\n📊 Summary:`);
    if (TEST_MODE_LIMIT !== null && TEST_MODE_LIMIT > 0) {
      console.log(
        `   🧪 TEST MODE: Processed ${processedEpisodes.length} episode(s) (limit: ${TEST_MODE_LIMIT})`
      );
    }
    console.log(`   • Files created: ${createdCount}`);
    console.log(`   • Files completed: ${completedCount}`);
    if (errorCount > 0) {
      console.log(`   • Errors: ${errorCount}`);
    }
    console.log(
      `\n📊 Rate limit status: ${
        rateLimitTracker.requestCount
      }/${RATE_LIMIT_PER_DAY} requests used today (${
        RATE_LIMIT_PER_DAY - rateLimitTracker.requestCount
      } remaining)`
    );
  } catch (error) {
    console.error("\n❌ Error syncing annotations:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the sync function
syncAnnotations().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
