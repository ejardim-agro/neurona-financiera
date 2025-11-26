import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import yaml from "js-yaml";
import { EpisodeFrontmatter } from "./interfaces/episode-frontmatter.interface";
import { Episode } from "./interfaces/episode.interface";
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

const ANNOTATED_DIR = PATHS.output.annotated;
const NORMALIZED_DIR = PATHS.output.normalized;
const EPISODES_FILE = PATHS.input.episodesFile;

/**
 * Reads markdown file and separates frontmatter from content
 */
function readMarkdownWithFrontmatter(filePath: string): {
  frontmatter: string;
  content: string;
} {
  // Resolve path - handle both absolute and relative paths
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

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
 * Parses frontmatter YAML string into EpisodeFrontmatter object
 */
function parseFrontmatter(
  frontmatterYaml: string
): Partial<EpisodeFrontmatter> {
  try {
    return (yaml.load(frontmatterYaml) as Partial<EpisodeFrontmatter>) || {};
  } catch (error) {
    console.warn(`⚠️  Error parsing frontmatter: ${error}`);
    return {};
  }
}

/**
 * Suggests a category for an episode using Gemini API
 */
async function suggestCategoryForEpisode(
  episode: Episode,
  tracker: RateLimitTracker
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // Check rate limit
  const { canMake } = canMakeRequest(tracker);
  if (!canMake) {
    throw new Error("Daily rate limit reached. Please try again tomorrow.");
  }

  // Respect rate limit per minute
  await respectRateLimitPerMinute(tracker);

  // Read episode content
  if (!episode.status.annotatedPath) {
    throw new Error(`Episode ${episode.episode} has no annotated path`);
  }

  const filePath = episode.status.annotatedPath;
  const { content } = readMarkdownWithFrontmatter(filePath);

  const prompt = `Analiza el siguiente contenido de un episodio de podcast sobre finanzas personales y sugiere UNA categoría apropiada.

Título del episodio: ${episode.title}
Descripción: ${episode.description}

Contenido:
${content.substring(0, 3000)}...

IMPORTANTE:
- Responde SOLO con el nombre de la categoría
- La categoría debe ser una sola palabra o frase corta
- Ejemplos: "fundamentos", "inversión", "ahorro", "psicología financiera", "ingresos", "retiro"
- No incluyas explicaciones adicionales, solo el nombre de la categoría`;

  try {
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

    const category = parts
      .filter((part: any) => part.text)
      .map((part: any) => part.text)
      .join("\n")
      .trim()
      .split("\n")[0]
      .trim();

    // Record the request
    tracker = recordRequest(tracker);
    saveRateLimitTracker(tracker);

    return category;
  } catch (error) {
    console.error(
      `Error suggesting category for episode ${episode.episode}:`,
      error instanceof Error ? error.message : error
    );
    return "Sin categoría";
  }
}

/**
 * Validates and ensures each episode has exactly one category
 */
async function validateAndFixCategories(
  episodes: Episode[],
  tracker: RateLimitTracker
): Promise<void> {
  console.log("\n🔍 Validating categories...");

  let fixedCount = 0;
  let errorCount = 0;

  for (const episode of episodes) {
    if (!episode.status.annotatedPath) {
      continue;
    }

    const filePath = episode.status.annotatedPath;
    const { frontmatter } = readMarkdownWithFrontmatter(filePath);
    const parsed = parseFrontmatter(frontmatter);

    // Check if category is missing
    if (!parsed.category) {
      console.log(
        `  ⚠️  Episode ${episode.episode} missing category, suggesting one...`
      );
      try {
        const suggestedCategory = await suggestCategoryForEpisode(
          episode,
          tracker
        );
        tracker = loadRateLimitTracker(); // Reload after API call

        // Update the file - resolve path first
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(process.cwd(), filePath);
        const content = fs.readFileSync(resolvedPath, "utf-8");
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

        if (frontmatterMatch) {
          let updatedFrontmatter = frontmatterMatch[1];
          // Add category if it doesn't exist
          if (!updatedFrontmatter.includes("category:")) {
            updatedFrontmatter += `\ncategory: "${suggestedCategory}"`;
          } else {
            // Replace existing empty category
            updatedFrontmatter = updatedFrontmatter.replace(
              /category:\s*["']?[^"'\n]*["']?/,
              `category: "${suggestedCategory}"`
            );
          }

          const updatedContent = content.replace(
            frontmatterMatch[0],
            `---\n${updatedFrontmatter}\n---`
          );
          fs.writeFileSync(resolvedPath, updatedContent, "utf-8");
          fixedCount++;
        }
      } catch (error) {
        console.error(
          `  ❌ Error fixing category for episode ${episode.episode}:`,
          error instanceof Error ? error.message : error
        );
        errorCount++;
      }
    }
  }

  console.log(`✅ Fixed ${fixedCount} missing categories`);
  if (errorCount > 0) {
    console.log(`⚠️  ${errorCount} episodes had errors`);
  }
}

/**
 * Extracts unique values for a specific field from episodes
 */
function extractUniqueValues(
  episodes: Episode[],
  field: "category" | "topics" | "tags"
): Set<string> {
  const values = new Set<string>();

  for (const episode of episodes) {
    if (!episode.status.annotatedPath) {
      continue;
    }

    const filePath = episode.status.annotatedPath;
    try {
      const { frontmatter } = readMarkdownWithFrontmatter(filePath);
      const parsed = parseFrontmatter(frontmatter);

      if (field === "category") {
        if (parsed.category) {
          values.add(parsed.category);
        }
      } else if (field === "topics" && parsed.topics) {
        if (!Array.isArray(parsed.topics)) {
          console.warn(
            `⚠️  Episode ${episode.episode}: topics is not an array:`,
            typeof parsed.topics,
            parsed.topics
          );
        } else {
          for (const topic of parsed.topics) {
            if (topic && typeof topic === "string") {
              values.add(topic);
            } else {
              console.warn(
                `⚠️  Episode ${episode.episode}: invalid topic value:`,
                topic,
                typeof topic
              );
            }
          }
        }
      } else if (field === "tags" && parsed.tags) {
        if (!Array.isArray(parsed.tags)) {
          console.warn(
            `⚠️  Episode ${episode.episode}: tags is not an array:`,
            typeof parsed.tags,
            parsed.tags
          );
        } else {
          for (const tag of parsed.tags) {
            if (tag && typeof tag === "string") {
              values.add(tag);
            } else {
              console.warn(
                `⚠️  Episode ${episode.episode}: invalid tag value:`,
                tag,
                typeof tag
              );
            }
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Error processing ${episode.episode}: ${error}`);
    }
  }

  return values;
}

/**
 * Generates cleaning mapping using Gemini API
 * Processes values in batches to avoid response truncation
 */
async function generateCleaningMapping(
  values: string[],
  field: string,
  tracker: RateLimitTracker
): Promise<Map<string, string>> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const BATCH_SIZE = 150; // Process 150 values at a time to avoid truncation
  const allMappings = new Map<string, string>();

  console.log(
    `  📦 Processing ${values.length} values in batches of ${BATCH_SIZE}...`
  );

  // Process in batches
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(values.length / BATCH_SIZE);

    console.log(
      `  📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} values)...`
    );

    // Check rate limit
    const { canMake } = canMakeRequest(tracker);
    if (!canMake) {
      throw new Error("Daily rate limit reached. Please try again tomorrow.");
    }

    // Respect rate limit per minute
    await respectRateLimitPerMinute(tracker);

    const valuesList = batch.map((v, idx) => `${idx + 1}. ${v}`).join("\n");

    const prompt = `Analiza los siguientes ${field} de un podcast sobre finanzas personales y genera un mapeo que corrija:
- Faltas de ortografía
- Capitalización incorrecta (usa título case: primera letra de cada palabra en mayúscula)
- Tildes faltantes
- Plurales/singulares inconsistentes (prioriza plural si corresponde)

${field}:
${valuesList}

IMPORTANTE:
- Responde SOLO con un JSON válido y completo en el formato:
{
  "${field}_original_1": "${field}_corregido_1",
  "${field}_original_2": "${field}_corregido_2",
  ...
}
- Si un ${field} no necesita corrección, inclúyelo como: "${field}": "${field}"
- Prioriza plural sobre singular cuando corresponda
- Usa tildes correctas en español
- Capitaliza como título (primera letra de cada palabra en mayúscula)
- Asegúrate de que el JSON esté completo y bien formado

Ejemplo:
{
  "operacion financiera": "Operaciones Financieras",
  "operación financiera": "Operaciones Financieras",
  "operaciones financieras": "Operaciones Financieras"
}`;

    try {
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

      const responseText = parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join("\n")
        .trim();

      console.log(
        `  📥 Raw response length: ${responseText.length} characters`
      );
      console.log(`  📥 First 500 chars: ${responseText.substring(0, 500)}...`);
      console.log(
        `  📥 Last 200 chars: ...${responseText.substring(
          Math.max(0, responseText.length - 200)
        )}`
      );

      // Extract JSON from response - try multiple strategies
      let jsonText: string | null = null;

      // Strategy 1: Try to extract JSON from markdown code blocks with json tag
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonText = jsonMatch[1].trim();
        console.log(
          `  ✅ Strategy 1: Extracted JSON from markdown code block with json tag`
        );
      } else {
        // Strategy 2: Try to extract JSON from code blocks without language tag
        const codeBlockMatch = responseText.match(/```\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          const extracted = codeBlockMatch[1].trim();
          // Check if it looks like JSON (starts with {)
          if (extracted.startsWith("{")) {
            jsonText = extracted;
            console.log(
              `  ✅ Strategy 2: Extracted JSON from code block without language tag`
            );
          }
        }
      }

      // Strategy 3: Try to find JSON object directly (look for first { to last })
      if (!jsonText) {
        const firstBrace = responseText.indexOf("{");
        const lastBrace = responseText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonText = responseText.substring(firstBrace, lastBrace + 1);
          console.log(`  ✅ Strategy 3: Extracted JSON object directly`);
        }
      }

      if (!jsonText) {
        console.error(
          `  ❌ Could not find JSON in response for batch ${batchNumber}`
        );
        console.error(`  📄 Full response (first 1000 chars):`);
        console.error(responseText.substring(0, 1000));
        console.error(`  📄 Full response (last 1000 chars):`);
        console.error(
          responseText.substring(Math.max(0, responseText.length - 1000))
        );
        throw new Error(
          `No valid JSON found in response for batch ${batchNumber}`
        );
      }

      // Verify JSON is complete (check if it ends properly)
      const trimmedJson = jsonText.trim();
      if (!trimmedJson.endsWith("}")) {
        console.warn(
          `  ⚠️  JSON appears to be truncated in batch ${batchNumber}, attempting to fix...`
        );
        // Try to find the last complete entry
        const lastCompleteEntry = trimmedJson.lastIndexOf('",');
        if (lastCompleteEntry !== -1) {
          // Find the opening brace of that entry
          const entryStart = trimmedJson.lastIndexOf(
            '"',
            lastCompleteEntry - 1
          );
          if (entryStart !== -1) {
            jsonText = trimmedJson.substring(0, entryStart) + '"}';
            console.log(`  ✅ Attempted to fix truncated JSON`);
          } else {
            throw new Error(
              `JSON appears to be truncated and cannot be fixed for batch ${batchNumber}`
            );
          }
        } else {
          throw new Error(
            `JSON appears to be truncated and cannot be fixed for batch ${batchNumber}`
          );
        }
      }

      console.log(`  📝 Extracted JSON length: ${jsonText.length} characters`);
      console.log(
        `  📝 First 300 chars of JSON: ${jsonText.substring(0, 300)}...`
      );
      console.log(
        `  📝 Last 200 chars of JSON: ...${jsonText.substring(
          Math.max(0, jsonText.length - 200)
        )}`
      );

      let mapping: Record<string, string>;
      try {
        mapping = JSON.parse(jsonText) as Record<string, string>;
        console.log(
          `  ✅ Successfully parsed JSON (${
            Object.keys(mapping).length
          } entries)`
        );
      } catch (parseError) {
        console.error(
          `  ❌ JSON parse error:`,
          parseError instanceof Error ? parseError.message : parseError
        );
        console.error(`  📄 JSON text that failed to parse (first 500 chars):`);
        console.error(jsonText.substring(0, 500));
        console.error(`  📄 JSON text that failed to parse (last 500 chars):`);
        console.error(jsonText.substring(Math.max(0, jsonText.length - 500)));
        throw parseError;
      }

      // Record the request
      tracker = recordRequest(tracker);
      saveRateLimitTracker(tracker);

      // Merge batch mappings into all mappings
      for (const [key, value] of Object.entries(mapping)) {
        if (typeof key === "string" && typeof value === "string") {
          allMappings.set(key, value);
        }
      }

      console.log(
        `  ✅ Batch ${batchNumber}/${totalBatches} completed (${
          Object.keys(mapping).length
        } mappings)`
      );
    } catch (error) {
      console.error(
        `\n❌ Error generating cleaning mapping for batch ${batchNumber}/${totalBatches} of ${field}:`,
        error instanceof Error ? error.message : error
      );
      if (error instanceof Error && error.stack) {
        console.error(`   Stack trace:`, error.stack);
      }
      console.error(
        `   Batch values (${batch.length} items):`,
        batch.slice(0, 10)
      );
      console.error(
        `\n💥 Aborting execution due to error in cleaning mapping generation`
      );
      throw error; // Abort execution instead of returning identity mapping
    }
  }

  console.log(
    `  ✅ All batches completed. Total mappings: ${allMappings.size}`
  );
  return allMappings;
}

/**
 * Generates semantic/extended mapping using Gemini API
 * Processes values in batches to avoid response truncation
 */
async function generateSemanticMapping(
  cleanedValues: string[],
  field: string,
  tracker: RateLimitTracker
): Promise<Map<string, string>> {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  const BATCH_SIZE = 150; // Process 150 values at a time to avoid truncation
  const allMappings = new Map<string, string>();

  console.log(
    `  📦 Processing ${cleanedValues.length} values in batches of ${BATCH_SIZE}...`
  );

  // Process in batches
  for (let i = 0; i < cleanedValues.length; i += BATCH_SIZE) {
    const batch = cleanedValues.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cleanedValues.length / BATCH_SIZE);

    console.log(
      `  📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} values)...`
    );

    // Check rate limit
    const { canMake } = canMakeRequest(tracker);
    if (!canMake) {
      throw new Error("Daily rate limit reached. Please try again tomorrow.");
    }

    // Respect rate limit per minute
    await respectRateLimitPerMinute(tracker);

    const valuesList = batch.map((v, idx) => `${idx + 1}. ${v}`).join("\n");

    const prompt = `Analiza los siguientes ${field} corregidos de un podcast sobre finanzas personales, economía, etc., y agrupa los que son similares o variaciones del mismo concepto bajo un término más amplio y adecuado.

${field} corregidos:
${valuesList}

Ejemplos de agrupación:
- "psicología", "psicología del dinero", "psicología financiera" → "Psicología Financiera"
- "inversión", "inversión en acciones", "inversión en bonos" → "Inversión"

IMPORTANTE:
- Responde SOLO con un JSON válido y completo en el formato:
{
  "${field}_corregido_1": "${field}_extendido_1",
  "${field}_corregido_2": "${field}_extendido_2",
  ...
}
- Agrupa conceptos similares bajo el término más adecuado y descriptivo
- Si un ${field} no necesita agrupación, inclúyelo como: "${field}": "${field}"
- Prioriza términos más específicos y descriptivos cuando corresponda
- Usa español con acentos correctos
- Capitaliza como título (primera letra de cada palabra en mayúscula)
- Asegúrate de que el JSON esté completo y bien formado

Ejemplo:
{
  "psicología": "Psicología Financiera",
  "psicología del dinero": "Psicología Financiera",
  "psicología financiera": "Psicología Financiera"
}`;

    try {
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

      const responseText = parts
        .filter((part: any) => part.text)
        .map((part: any) => part.text)
        .join("\n")
        .trim();

      console.log(
        `  📥 Raw response length: ${responseText.length} characters`
      );
      console.log(`  📥 First 500 chars: ${responseText.substring(0, 500)}...`);
      console.log(
        `  📥 Last 200 chars: ...${responseText.substring(
          Math.max(0, responseText.length - 200)
        )}`
      );

      // Extract JSON from response - try multiple strategies
      let jsonText: string | null = null;

      // Strategy 1: Try to extract JSON from markdown code blocks with json tag
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        jsonText = jsonMatch[1].trim();
        console.log(
          `  ✅ Strategy 1: Extracted JSON from markdown code block with json tag`
        );
      } else {
        // Strategy 2: Try to extract JSON from code blocks without language tag
        const codeBlockMatch = responseText.match(/```\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch && codeBlockMatch[1]) {
          const extracted = codeBlockMatch[1].trim();
          // Check if it looks like JSON (starts with {)
          if (extracted.startsWith("{")) {
            jsonText = extracted;
            console.log(
              `  ✅ Strategy 2: Extracted JSON from code block without language tag`
            );
          }
        }
      }

      // Strategy 3: Try to find JSON object directly (look for first { to last })
      if (!jsonText) {
        const firstBrace = responseText.indexOf("{");
        const lastBrace = responseText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonText = responseText.substring(firstBrace, lastBrace + 1);
          console.log(`  ✅ Strategy 3: Extracted JSON object directly`);
        }
      }

      if (!jsonText) {
        console.error(
          `  ❌ Could not find JSON in response for batch ${batchNumber}`
        );
        console.error(`  📄 Full response (first 1000 chars):`);
        console.error(responseText.substring(0, 1000));
        console.error(`  📄 Full response (last 1000 chars):`);
        console.error(
          responseText.substring(Math.max(0, responseText.length - 1000))
        );
        throw new Error(
          `No valid JSON found in response for batch ${batchNumber}`
        );
      }

      // Verify JSON is complete (check if it ends properly)
      const trimmedJson = jsonText.trim();
      if (!trimmedJson.endsWith("}")) {
        console.warn(
          `  ⚠️  JSON appears to be truncated in batch ${batchNumber}, attempting to fix...`
        );
        // Try to find the last complete entry
        const lastCompleteEntry = trimmedJson.lastIndexOf('",');
        if (lastCompleteEntry !== -1) {
          // Find the opening brace of that entry
          const entryStart = trimmedJson.lastIndexOf(
            '"',
            lastCompleteEntry - 1
          );
          if (entryStart !== -1) {
            jsonText = trimmedJson.substring(0, entryStart) + '"}';
            console.log(`  ✅ Attempted to fix truncated JSON`);
          } else {
            throw new Error(
              `JSON appears to be truncated and cannot be fixed for batch ${batchNumber}`
            );
          }
        } else {
          throw new Error(
            `JSON appears to be truncated and cannot be fixed for batch ${batchNumber}`
          );
        }
      }

      console.log(`  📝 Extracted JSON length: ${jsonText.length} characters`);
      console.log(
        `  📝 First 300 chars of JSON: ${jsonText.substring(0, 300)}...`
      );
      console.log(
        `  📝 Last 200 chars of JSON: ...${jsonText.substring(
          Math.max(0, jsonText.length - 200)
        )}`
      );

      let mapping: Record<string, string>;
      try {
        mapping = JSON.parse(jsonText) as Record<string, string>;
        console.log(
          `  ✅ Successfully parsed JSON (${
            Object.keys(mapping).length
          } entries)`
        );
      } catch (parseError) {
        console.error(
          `  ❌ JSON parse error:`,
          parseError instanceof Error ? parseError.message : parseError
        );
        console.error(`  📄 JSON text that failed to parse (first 500 chars):`);
        console.error(jsonText.substring(0, 500));
        console.error(`  📄 JSON text that failed to parse (last 500 chars):`);
        console.error(jsonText.substring(Math.max(0, jsonText.length - 500)));
        throw parseError;
      }

      // Record the request
      tracker = recordRequest(tracker);
      saveRateLimitTracker(tracker);

      // Merge batch mappings into all mappings
      for (const [key, value] of Object.entries(mapping)) {
        if (typeof key === "string" && typeof value === "string") {
          allMappings.set(key, value);
        }
      }

      console.log(
        `  ✅ Batch ${batchNumber}/${totalBatches} completed (${
          Object.keys(mapping).length
        } mappings)`
      );
    } catch (error) {
      console.error(
        `\n❌ Error generating semantic mapping for batch ${batchNumber}/${totalBatches} of ${field}:`,
        error instanceof Error ? error.message : error
      );
      if (error instanceof Error && error.stack) {
        console.error(`   Stack trace:`, error.stack);
      }
      console.error(
        `   Batch values (${batch.length} items):`,
        batch.slice(0, 10)
      );
      console.error(
        `\n💥 Aborting execution due to error in semantic mapping generation`
      );
      throw error; // Abort execution instead of returning identity mapping
    }
  }

  console.log(
    `  ✅ All batches completed. Total mappings: ${allMappings.size}`
  );
  return allMappings;
}

/**
 * Parses existing mapping file to extract mappings
 */
function parseExistingMappingFile(filePath: string): {
  rawValues: Set<string>;
  cleaningMap: Map<string, string>;
  extendedMap: Map<string, string>;
} {
  const rawValues = new Set<string>();
  const cleaningMap = new Map<string, string>();
  const extendedMap = new Map<string, string>();

  if (!fs.existsSync(filePath)) {
    return { rawValues, cleaningMap, extendedMap };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let currentSection = "";
    for (const line of lines) {
      if (line.startsWith("# ")) {
        if (line.includes("_raw")) {
          currentSection = "raw";
        } else if (line.includes("_mapping")) {
          currentSection = "cleaning";
        } else if (line.includes("_extended")) {
          currentSection = "extended";
        }
        continue;
      }

      if (currentSection === "raw" && line.trim() && !line.startsWith("|")) {
        const value = line.replace(/^[-*]\s*/, "").trim();
        if (value) {
          rawValues.add(value);
        }
      } else if (
        currentSection === "cleaning" &&
        line.includes("=>") &&
        !line.startsWith("|")
      ) {
        const match = line.match(/^[-*]\s*(.+?)\s*=>\s*(.+?)$/);
        if (match) {
          const original = match[1].trim();
          const cleaned = match[2].trim();
          cleaningMap.set(original, cleaned);
        }
      } else if (
        currentSection === "extended" &&
        line.includes("=>") &&
        !line.startsWith("|")
      ) {
        const match = line.match(/^[-*]\s*(.+?)\s*=>\s*(.+?)$/);
        if (match) {
          const original = match[1].trim();
          const extended = match[2].trim();
          extendedMap.set(original, extended);
        }
      }
    }
  } catch (error) {
    console.warn(
      `⚠️  Error parsing existing mapping file ${filePath}: ${error}`
    );
  }

  return { rawValues, cleaningMap, extendedMap };
}

/**
 * Creates or updates mapping file
 */
function createOrUpdateMappingFile(
  field: string,
  allRawValues: Set<string>,
  cleaningMap: Map<string, string>,
  extendedMap: Map<string, string>
): void {
  const filePath = path.join(NORMALIZED_DIR, `__05_${field}.md`);

  // Ensure directory exists
  if (!fs.existsSync(NORMALIZED_DIR)) {
    fs.mkdirSync(NORMALIZED_DIR, { recursive: true });
  }

  let content = `# ${field}_raw\n\n`;
  const sortedRawValues = Array.from(allRawValues).sort();
  for (const value of sortedRawValues) {
    content += `- ${value}\n`;
  }

  content += `\n# ${field}_mapping\n\n`;
  const sortedCleaning = Array.from(cleaningMap.entries()).sort();
  for (const [original, cleaned] of sortedCleaning) {
    content += `- ${original} => ${cleaned}\n`;
  }

  content += `\n# ${field}_extended\n\n`;
  // Build extended mapping from raw to extended (via cleaning)
  const rawToExtended = new Map<string, string>();
  for (const rawValue of allRawValues) {
    const cleaned = cleaningMap.get(rawValue) || rawValue;
    const extended = extendedMap.get(cleaned) || cleaned;
    rawToExtended.set(rawValue, extended);
  }

  const sortedExtended = Array.from(rawToExtended.entries()).sort();
  for (const [original, extended] of sortedExtended) {
    content += `- ${original} => ${extended}\n`;
  }

  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Validates that all episodes have exactly one category and map to one extended category
 */
function validateFinalMappings(
  episodes: Episode[],
  categoryExtendedMap: Map<string, string>
): boolean {
  console.log("\n🔍 Validating final mappings...");

  let errors = 0;

  for (const episode of episodes) {
    if (!episode.status.annotatedPath) {
      continue;
    }

    const filePath = episode.status.annotatedPath;
    try {
      const { frontmatter } = readMarkdownWithFrontmatter(filePath);
      const parsed = parseFrontmatter(frontmatter);

      // Check category
      if (!parsed.category) {
        console.error(
          `  ❌ Episode ${episode.episode} has no category after processing`
        );
        errors++;
      } else {
        const extended = categoryExtendedMap.get(parsed.category);
        if (!extended) {
          console.error(
            `  ❌ Episode ${episode.episode} category "${parsed.category}" has no extended mapping`
          );
          errors++;
        }
      }
    } catch (error) {
      console.error(
        `  ❌ Error validating episode ${episode.episode}: ${error}`
      );
      errors++;
    }
  }

  if (errors === 0) {
    console.log("✅ All episodes validated successfully");
    return true;
  } else {
    console.error(`❌ Found ${errors} validation errors`);
    return false;
  }
}

/**
 * Main function to refine frontmatter metadata
 */
async function refineFrontmatterMetadata(): Promise<void> {
  try {
    console.log("🔍 Starting frontmatter metadata refinement...\n");

    // Ensure normalized directory exists
    if (!fs.existsSync(NORMALIZED_DIR)) {
      fs.mkdirSync(NORMALIZED_DIR, { recursive: true });
      console.log(`📁 Created directory: ${NORMALIZED_DIR}`);
    }

    // Load episodes
    console.log("📂 Loading episodes from JSON file...");
    const allEpisodes = loadExistingEpisodes(EPISODES_FILE);
    console.log(`✅ Loaded ${allEpisodes.length} episodes`);

    // Filter episodes that need refinement
    const episodesToProcess = allEpisodes.filter(
      (ep) => !ep.status.normalized.refined
    );
    console.log(
      `📊 Found ${episodesToProcess.length} episodes to process (${
        allEpisodes.length - episodesToProcess.length
      } already refined)`
    );

    if (episodesToProcess.length === 0) {
      console.log(
        "ℹ️  No episodes to process. All episodes are already refined."
      );
      return;
    }

    // Load rate limit tracker
    let tracker = loadRateLimitTracker();
    console.log(
      `📊 Rate limit status: ${tracker.requestCount}/${RATE_LIMIT_PER_DAY} requests used today`
    );

    // Validate and fix categories
    await validateAndFixCategories(episodesToProcess, tracker);
    tracker = loadRateLimitTracker(); // Reload after API calls

    // Process each field: categories, topics, tags
    const fields: Array<"category" | "topics" | "tags"> = [
      "category",
      "topics",
      "tags",
    ];

    for (const field of fields) {
      console.log(`\n📝 Processing ${field}...`);

      // Extract unique values
      console.log(
        `  🔍 Extracting unique ${field} from ${episodesToProcess.length} episodes...`
      );
      const uniqueValues = extractUniqueValues(episodesToProcess, field);
      console.log(`  ✅ Found ${uniqueValues.size} unique ${field}`);
      if (uniqueValues.size > 0 && uniqueValues.size <= 10) {
        console.log(
          `  📋 Sample values:`,
          Array.from(uniqueValues).slice(0, 10)
        );
      }

      // Load existing mappings
      const mappingFilePath = path.join(
        NORMALIZED_DIR,
        `__05_${field === "category" ? "categories" : field}.md`
      );
      const existing = parseExistingMappingFile(mappingFilePath);

      // Find new values to process
      const newValues = Array.from(uniqueValues).filter(
        (v) => !existing.rawValues.has(v)
      );

      if (newValues.length === 0) {
        console.log(`  ✅ All ${field} already processed`);
        // Merge with existing
        for (const raw of uniqueValues) {
          existing.rawValues.add(raw);
        }
        // Update cleaning map for new values
        for (const raw of uniqueValues) {
          if (!existing.cleaningMap.has(raw)) {
            existing.cleaningMap.set(raw, raw);
          }
        }
        // Update extended map for new values
        for (const raw of uniqueValues) {
          const cleaned = existing.cleaningMap.get(raw) || raw;
          if (!existing.extendedMap.has(cleaned)) {
            existing.extendedMap.set(cleaned, cleaned);
          }
        }
        createOrUpdateMappingFile(
          field === "category" ? "categories" : field,
          existing.rawValues,
          existing.cleaningMap,
          existing.extendedMap
        );
        continue;
      }

      console.log(`  Processing ${newValues.length} new ${field}...`);

      // Generate cleaning mapping
      console.log(`  🤖 Generating cleaning mapping...`);
      const cleaningMap = await generateCleaningMapping(
        newValues,
        field,
        tracker
      );
      tracker = loadRateLimitTracker();

      // Merge with existing cleaning map
      for (const [key, value] of cleaningMap) {
        existing.cleaningMap.set(key, value);
      }
      for (const raw of uniqueValues) {
        if (!existing.cleaningMap.has(raw)) {
          existing.cleaningMap.set(raw, raw);
        }
      }

      // Get cleaned values
      const cleanedValues = Array.from(uniqueValues).map(
        (raw) => existing.cleaningMap.get(raw) || raw
      );
      const uniqueCleanedValues = Array.from(new Set(cleanedValues));

      // Generate semantic/extended mapping
      console.log(`  🤖 Generating semantic/extended mapping...`);
      const extendedMap = await generateSemanticMapping(
        uniqueCleanedValues,
        field,
        tracker
      );
      tracker = loadRateLimitTracker();

      // Merge with existing extended map
      for (const [key, value] of extendedMap) {
        existing.extendedMap.set(key, value);
      }
      for (const cleaned of uniqueCleanedValues) {
        if (!existing.extendedMap.has(cleaned)) {
          existing.extendedMap.set(cleaned, cleaned);
        }
      }

      // Update raw values set
      for (const raw of uniqueValues) {
        existing.rawValues.add(raw);
      }

      // Create/update mapping file
      createOrUpdateMappingFile(
        field === "category" ? "categories" : field,
        existing.rawValues,
        existing.cleaningMap,
        existing.extendedMap
      );

      console.log(`  ✅ Completed processing ${field}`);
    }

    // Validate final mappings for categories
    console.log("\n🔍 Validating final category mappings...");
    const categoriesMappingPath = path.join(
      NORMALIZED_DIR,
      "__05_categories.md"
    );
    const categoryMappings = parseExistingMappingFile(categoriesMappingPath);
    const categoryExtendedMap = new Map<string, string>();
    for (const raw of categoryMappings.rawValues) {
      const cleaned = categoryMappings.cleaningMap.get(raw) || raw;
      const extended = categoryMappings.extendedMap.get(cleaned) || cleaned;
      categoryExtendedMap.set(raw, extended);
    }

    if (!validateFinalMappings(episodesToProcess, categoryExtendedMap)) {
      console.error(
        "\n❌ Validation failed. Please review and fix issues before continuing."
      );
      process.exit(1);
    }

    // Mark episodes as refined
    console.log("\n🏷️  Marking episodes as refined...");
    let updatedCount = 0;
    for (const episode of allEpisodes) {
      if (
        episodesToProcess.some((e) => e.episode === episode.episode) &&
        !episode.status.normalized.refined
      ) {
        episode.status.normalized.refined = true;
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      saveEpisodes(allEpisodes, EPISODES_FILE);
      console.log(`✅ Marked ${updatedCount} episode(s) as refined`);
    }

    console.log("\n✅ Frontmatter metadata refinement completed!");
    console.log("\n📝 Next steps:");
    console.log("   1. Review the mapping files in 04_normalized/");
    console.log("   2. Adjust mappings if needed");
    console.log("   3. Run 06_applyNormalization script to apply mappings");
  } catch (error) {
    console.error("\n❌ Error refining frontmatter metadata:", error);
    if (error instanceof Error) {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

// Run the refine function
refineFrontmatterMetadata().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
